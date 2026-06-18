import { PointerEvent, useCallback, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import {
  constrainCropRect,
  constrainCropResizeRect,
  cropImageToRect,
  cropRectForAspect,
  fitImageNodeSize,
  imageContentRect,
  initialCropRect,
  readImageDimensions,
} from "./imageCrop";
import { isImageLikeNode } from "./nodePredicates";
import type { CanvasConnection, CanvasGroup, CanvasNode, CanvasNodeType, CropAspectKey, CropInteractionState, ImageDialogState } from "./types";

type StateUpdater<T> = T | ((current: T) => T);

interface DownloadStatus {
  nodeId: string;
  tone: "busy" | "ready" | "error";
  text: string;
}

interface SavedCanvasAsset {
  url: string;
  fileName?: string;
  filePath?: string;
}

interface UseCanvasMediaActionsOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  imageDownloadPath: string;
  isLibtvCanvas: boolean;
  setNodes: (updater: StateUpdater<CanvasNode[]>) => void;
  setCanvasDocument: (updater: StateUpdater<{ nodes: CanvasNode[]; connections: CanvasConnection[]; groups: CanvasGroup[] }>) => void;
  patchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  createNode: (type: CanvasNodeType) => CanvasNode;
  screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  setSelectedIds: (updater: StateUpdater<Set<string>>) => void;
  setSelectedGroupId: (groupId: string) => void;
  setSelectedConnectionId: (connectionId: string) => void;
  setConnectionAction: (action: { id: string; left: number; top: number } | null) => void;
  setContextMenu: (menu: { x: number; y: number; worldX: number; worldY: number } | null) => void;
  showLibtvSyncStatus: (tone: "busy" | "ready" | "error", text: string) => void;
  deleteLibtvRemoteNodeIfNeeded: (node: CanvasNode) => Promise<void>;
  t: TFunction;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(file.name);
}

function imageFilesFromTransfer(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return [];
  const files = Array.from(dataTransfer.files || []).filter(isImageFile);
  if (files.length) return files;
  return Array.from(dataTransfer.items || []).flatMap((item) => {
    if (item.kind !== "file" || !item.type.startsWith("image/")) return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}

export function hasDraggedImageFile(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  if (items.length) {
    return items.some((item) => item.kind === "file" && (item.type.startsWith("image/") || !item.type));
  }
  return Array.from(dataTransfer.files || []).some(isImageFile);
}

export function hasClipboardImage(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;
  const items = Array.from(dataTransfer.items || []);
  if (items.some((item) => item.kind === "file" && item.type.startsWith("image/"))) return true;
  return Array.from(dataTransfer.files || []).some(isImageFile);
}

export function useCanvasMediaActions({
  nodes,
  connections,
  imageDownloadPath,
  isLibtvCanvas,
  setNodes,
  setCanvasDocument,
  patchNode,
  createNode,
  screenToWorld,
  setSelectedIds,
  setSelectedGroupId,
  setSelectedConnectionId,
  setConnectionAction,
  setContextMenu,
  showLibtvSyncStatus,
  deleteLibtvRemoteNodeIfNeeded,
  t,
}: UseCanvasMediaActionsOptions) {
  const [imagePreview, setImagePreview] = useState<ImageDialogState | null>(null);
  const [imageCrop, setImageCrop] = useState<{ nodeId: string; rect: ReturnType<typeof initialCropRect>; aspect: CropAspectKey } | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus | null>(null);
  const [isImageDropActive, setIsImageDropActive] = useState(false);
  const cropInteractionRef = useRef<CropInteractionState | null>(null);
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const saveCanvasImageAsset = useCallback(async (source: { url?: string; dataUrl?: string; defaultName?: string; kind: "input" | "output" }): Promise<SavedCanvasAsset> => {
    if (!window.easyTool?.saveCanvasAsset) {
      return {
        url: source.dataUrl || source.url || "",
        fileName: source.defaultName || "canvas-image.png",
      };
    }
    return window.easyTool.saveCanvasAsset(source);
  }, []);

  const readImagePatch = useCallback(async (file: File): Promise<Partial<CanvasNode>> => {
    const dataUrl = await readFileAsDataUrl(file);
    const saved = await saveCanvasImageAsset({ dataUrl, defaultName: file.name, kind: "input" });
    const dimensions = await readImageDimensions(saved.url);
    const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
    return {
      url: saved.url,
      fileName: saved.fileName || file.name,
      filePath: saved.filePath,
      title: file.name || "Image",
      imageMode: "asset",
      imageSource: "uploaded",
      text: "",
      imageNaturalWidth: dimensions?.width,
      imageNaturalHeight: dimensions?.height,
      ...nextSize,
    };
  }, [saveCanvasImageAsset]);

  const getLibtvLeftOrderForReplacement = useCallback((targetId: string, oldLocalNodeId: string, oldRemoteNodeId: string, nextRemoteNodeId: string) => {
    const orderedLeft = connections
      .filter((connection) => connection.to === targetId)
      .map((connection) => {
        if (connection.from === oldLocalNodeId) return nextRemoteNodeId;
        const sourceNode = nodeMap.get(connection.from);
        return sourceNode?.libtvNodeId || "";
      })
      .filter(Boolean);
    return Array.from(new Set(orderedLeft)).filter((nodeId) => nodeId !== oldRemoteNodeId);
  }, [connections, nodeMap]);

  const replaceLibtvUploadNode = useCallback(async (source: CanvasNode, patches: Partial<CanvasNode>[]) => {
    const primaryPatch = patches[0];
    if (!primaryPatch?.url) return;
    if (!isLibtvCanvas || !source.libtvProjectId || !source.libtvNodeId) {
      setNodes((current) => current.map((node) => (node.id === source.id ? { ...node, ...primaryPatch } : node)));
      setSelectedIds(new Set([source.id]));
      setSelectedGroupId("");
      return;
    }
    if (!primaryPatch.filePath) {
      showLibtvSyncStatus("error", t("infiniteCanvas.libtvUploadNeedsLocalFile"));
      return;
    }
    if (!window.libtv?.uploadNode || !window.libtv.updateNode) {
      showLibtvSyncStatus("error", t("infiniteCanvas.libtvBridgeUnavailable"));
      return;
    }
    try {
      showLibtvSyncStatus("busy", t("infiniteCanvas.libtvSyncBusy"));
      const uploaded = await window.libtv.uploadNode({
        projectId: source.libtvProjectId,
        title: primaryPatch.title || primaryPatch.fileName || "Forart image",
        filePath: primaryPatch.filePath,
        x: source.x,
        y: source.y,
      });
      const nextRemoteNodeId = uploaded.nodeId || "";
      if (!nextRemoteNodeId) throw new Error(t("infiniteCanvas.libtvMissingBinding"));
      const downstreamLibtvNodes = connections
        .filter((connection) => connection.from === source.id)
        .map((connection) => nodeMap.get(connection.to))
        .filter((target): target is CanvasNode => Boolean(target && target.type === "libtvImage" && target.libtvProjectId && target.libtvNodeId));
      await Promise.all(downstreamLibtvNodes.map((target) => window.libtv!.updateNode({
        projectId: target.libtvProjectId!,
        nodeId: target.libtvNodeId!,
        left: getLibtvLeftOrderForReplacement(target.id, source.id, source.libtvNodeId!, nextRemoteNodeId),
      })));
      await deleteLibtvRemoteNodeIfNeeded(source);
      const updatedNode: CanvasNode = {
        ...source,
        ...primaryPatch,
        id: source.id,
        type: "libtvUpload",
        title: String(primaryPatch.title || primaryPatch.fileName || source.title || "LibTV Upload"),
        text: "",
        x: Math.round(source.x),
        y: Math.round(source.y),
        url: primaryPatch.url,
        fileName: primaryPatch.fileName || uploaded.fileName || source.fileName,
        filePath: primaryPatch.filePath,
        imageMode: "asset",
        imageSource: "uploaded",
        libtvProjectId: source.libtvProjectId,
        libtvNodeId: nextRemoteNodeId,
        libtvOriginalUrl: uploaded.url || primaryPatch.url,
        generationError: "",
        generationStatus: "",
      };
      setCanvasDocument((current) => ({
        nodes: current.nodes.map((node) => (node.id === source.id ? updatedNode : node)),
        connections: current.connections,
        groups: current.groups,
      }));
      setSelectedIds(new Set([source.id]));
      setSelectedGroupId("");
      showLibtvSyncStatus("ready", t("infiniteCanvas.libtvSyncIdle"));
    } catch (error) {
      showLibtvSyncStatus("error", error instanceof Error ? error.message : String(error));
      patchNode(source.id, {
        generationError: error instanceof Error ? error.message : String(error),
      });
    }
  }, [connections, deleteLibtvRemoteNodeIfNeeded, getLibtvLeftOrderForReplacement, isLibtvCanvas, nodeMap, patchNode, setCanvasDocument, setNodes, setSelectedGroupId, setSelectedIds, showLibtvSyncStatus, t]);

  const syncLibtvBoundNode = useCallback(async (nodeId: string, patch: Partial<CanvasNode>) => {
    const node = nodeMap.get(nodeId);
    if (!isLibtvCanvas || !node) return;
    if (!window.libtv?.updateNode) return;
    if (!node.libtvProjectId || !node.libtvNodeId) return;
    const nextNode = { ...node, ...patch };
    try {
      if (node.type === "libtvUpload" && patch.url !== undefined) {
        if (!nextNode.filePath) {
          showLibtvSyncStatus("error", t("infiniteCanvas.libtvUploadNeedsLocalFile"));
          return;
        }
        if (!window.libtv.uploadNode) {
          showLibtvSyncStatus("error", t("infiniteCanvas.libtvBridgeUnavailable"));
          return;
        }
        showLibtvSyncStatus("busy", t("infiniteCanvas.libtvSyncBusy"));
        const uploaded = await window.libtv.uploadNode({
          projectId: node.libtvProjectId,
          title: nextNode.title || nextNode.fileName || "Forart image",
          filePath: nextNode.filePath,
          x: node.x,
          y: node.y,
        });
        const nextRemoteNodeId = uploaded.nodeId || node.libtvNodeId;
        const downstreamLibtvNodes = connections
          .filter((connection) => connection.from === nodeId)
          .map((connection) => nodeMap.get(connection.to))
          .filter((target): target is CanvasNode => Boolean(target && target.type === "libtvImage" && target.libtvProjectId && target.libtvNodeId));
        await Promise.all(downstreamLibtvNodes.map((target) => window.libtv!.updateNode({
          projectId: target.libtvProjectId!,
          nodeId: target.libtvNodeId!,
          left: getLibtvLeftOrderForReplacement(target.id, node.id, node.libtvNodeId!, nextRemoteNodeId),
        })));
        if (nextRemoteNodeId !== node.libtvNodeId) {
          await deleteLibtvRemoteNodeIfNeeded(node);
        }
        patchNode(nodeId, {
          generationError: "",
          libtvNodeId: nextRemoteNodeId,
          libtvOriginalUrl: uploaded.url || nextNode.libtvOriginalUrl,
        });
        showLibtvSyncStatus("ready", t("infiniteCanvas.libtvSyncIdle"));
      }
    } catch (error) {
      showLibtvSyncStatus("error", error instanceof Error ? error.message : String(error));
      patchNode(nodeId, {
        generationError: error instanceof Error ? error.message : String(error),
      });
    }
  }, [connections, deleteLibtvRemoteNodeIfNeeded, getLibtvLeftOrderForReplacement, isLibtvCanvas, nodeMap, patchNode, showLibtvSyncStatus, t]);

  const handleImageFiles = useCallback(async (nodeId: string, files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(isImageFile);
    if (!imageFiles.length) return;
    const patches = await Promise.all(imageFiles.map(readImagePatch));
    const source = nodeMap.get(nodeId);
    if (source?.type === "libtvUpload") {
      await replaceLibtvUploadNode(source, patches);
      return;
    }
    const extraNodes = patches.slice(1).map((patch, index) => ({
      ...createNode("image"),
      ...patch,
      id: `image_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`,
      x: Math.round((source?.x || 0) + (index + 1) * 36),
      y: Math.round((source?.y || 0) + (index + 1) * 36),
    }));
    const primaryPatch = patches[0];
    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, ...primaryPatch } : node)).concat(extraNodes));
    void syncLibtvBoundNode(nodeId, primaryPatch);
    setSelectedIds(new Set([extraNodes[extraNodes.length - 1]?.id || nodeId]));
    setSelectedGroupId("");
  }, [createNode, nodeMap, readImagePatch, replaceLibtvUploadNode, setNodes, setSelectedGroupId, setSelectedIds, syncLibtvBoundNode]);

  const createImageNodesAtClientPoint = useCallback(async (files: FileList | File[], clientX: number, clientY: number) => {
    const imageFiles = Array.from(files).filter(isImageFile);
    if (!imageFiles.length) return false;
    const dropPoint = screenToWorld(clientX, clientY);
    const patches = await Promise.all(imageFiles.map(readImagePatch));
    const createdNodes = patches.map((patch, index) => {
      const node = {
        ...createNode("image"),
        ...patch,
        id: `image_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`,
      };
      return {
        ...node,
        x: Math.round(dropPoint.x - node.w / 2 + index * 36),
        y: Math.round(dropPoint.y - node.h / 2 + index * 36),
      };
    });
    setNodes((current) => current.concat(createdNodes));
    setSelectedIds(new Set(createdNodes.map((node) => node.id)));
    setSelectedGroupId("");
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
    setImageCrop(null);
    setIsImageDropActive(false);
    return true;
  }, [createNode, readImagePatch, screenToWorld, setConnectionAction, setContextMenu, setNodes, setSelectedConnectionId, setSelectedGroupId, setSelectedIds]);

  const createImageNodesFromDrop = useCallback(async (files: FileList | File[], clientX: number, clientY: number) => {
    await createImageNodesAtClientPoint(files, clientX, clientY);
  }, [createImageNodesAtClientPoint]);

  const createImageNodesFromClipboardData = useCallback(async (dataTransfer: DataTransfer | null, clientX: number, clientY: number) => {
    return createImageNodesAtClientPoint(imageFilesFromTransfer(dataTransfer), clientX, clientY);
  }, [createImageNodesAtClientPoint]);

  const openImagePreview = useCallback((nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || !isImageLikeNode(node) || !node.url) return;
    setImagePreview({ nodeId });
  }, [nodeMap]);

  const openImageCrop = useCallback((nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || !isImageLikeNode(node) || !node.url) return;
    setImageCrop((current) => (current?.nodeId === nodeId ? null : { nodeId, rect: initialCropRect(node), aspect: "free" }));
  }, [nodeMap]);

  const downloadNodeImage = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || !isImageLikeNode(node) || !node.url) return;
    const defaultName = node.fileName || `${node.type}-${Date.now()}.png`;
    setDownloadStatus({ nodeId, tone: "busy", text: t("infiniteCanvas.downloadBusy") });
    if (window.easyTool?.saveResult) {
      try {
        const result = await window.easyTool.saveResult({ url: node.url, dataUrl: node.url, defaultName, directory: imageDownloadPath });
        setDownloadStatus({ nodeId, tone: "ready", text: result.filePath ? t("infiniteCanvas.downloadSaved", { path: result.filePath }) : t("infiniteCanvas.downloadComplete") });
        window.setTimeout(() => setDownloadStatus((current) => (current?.nodeId === nodeId && current.tone === "ready" ? null : current)), 4500);
      } catch (error) {
        setDownloadStatus({ nodeId, tone: "error", text: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    const link = document.createElement("a");
    link.href = node.url;
    link.download = defaultName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setDownloadStatus({ nodeId, tone: "ready", text: t("infiniteCanvas.downloadComplete") });
    window.setTimeout(() => setDownloadStatus((current) => (current?.nodeId === nodeId && current.tone === "ready" ? null : current)), 3000);
  }, [imageDownloadPath, nodeMap, t]);

  const changeCropAspect = useCallback((nodeId: string, aspect: CropAspectKey) => {
    const node = nodeMap.get(nodeId);
    if (node?.type !== "image" || imageCrop?.nodeId !== nodeId) return;
    setImageCrop({ nodeId, aspect, rect: cropRectForAspect(imageCrop.rect, node, aspect) });
  }, [imageCrop, nodeMap]);

  const startCropInteraction = useCallback((event: PointerEvent<HTMLDivElement | HTMLButtonElement>, nodeId: string, mode: "move" | "resize") => {
    const node = nodeMap.get(nodeId);
    if (!node || imageCrop?.nodeId !== nodeId) return;
    event.preventDefault();
    event.stopPropagation();
    cropInteractionRef.current = {
      pointerId: event.pointerId,
      nodeId,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: imageCrop.rect,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [imageCrop, nodeMap]);

  const handleCropPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const crop = cropInteractionRef.current;
    if (!crop || crop.pointerId !== event.pointerId || imageCrop?.nodeId !== crop.nodeId) return;
    const node = nodeMap.get(crop.nodeId);
    if (!node) return;
    event.preventDefault();
    const dx = event.clientX - crop.startClientX;
    const dy = event.clientY - crop.startClientY;
    const nextRect = crop.mode === "move"
      ? { ...crop.startRect, x: crop.startRect.x + dx, y: crop.startRect.y + dy }
      : { ...crop.startRect, w: crop.startRect.w + dx, h: crop.startRect.h + dy };
    setImageCrop({
      nodeId: crop.nodeId,
      aspect: imageCrop.aspect,
      rect: crop.mode === "move" ? constrainCropRect(nextRect, node, imageCrop.aspect) : constrainCropResizeRect(nextRect, node, imageCrop.aspect),
    });
  }, [imageCrop, nodeMap]);

  const stopCropInteraction = useCallback((event: PointerEvent<HTMLElement>) => {
    const crop = cropInteractionRef.current;
    if (!crop || crop.pointerId !== event.pointerId) return;
    cropInteractionRef.current = null;
  }, []);

  const applyCrop = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || (node.type !== "image" && node.type !== "libtvUpload") || !node.url || imageCrop?.nodeId !== nodeId) return;
    const contentRect = imageContentRect(node);
    const rect = constrainCropRect(imageCrop.rect, node, imageCrop.aspect);
    const naturalWidth = node.imageNaturalWidth || node.w;
    const naturalHeight = node.imageNaturalHeight || node.h;
    const result = await cropImageToRect(node.url, naturalWidth, naturalHeight, rect, contentRect);
    if (!result) return;
    const saved = await saveCanvasImageAsset({ dataUrl: result.dataUrl, defaultName: node.fileName ? `cropped-${node.fileName}` : "cropped-image.png", kind: "output" });
    const nextSize = fitImageNodeSize(result.width, result.height);
    const patch = {
      url: saved.url,
      fileName: saved.fileName,
      filePath: saved.filePath,
      imageNaturalWidth: result.width,
      imageNaturalHeight: result.height,
      ...nextSize,
    };
    patchNode(nodeId, patch);
    void syncLibtvBoundNode(nodeId, patch);
    setImageCrop(null);
  }, [imageCrop, nodeMap, patchNode, saveCanvasImageAsset, syncLibtvBoundNode]);

  return {
    imagePreview,
    setImagePreview,
    imageCrop,
    setImageCrop,
    downloadStatus,
    isImageDropActive,
    setIsImageDropActive,
    saveCanvasImageAsset,
    handleImageFiles,
    createImageNodesFromDrop,
    createImageNodesFromClipboardData,
    openImagePreview,
    openImageCrop,
    downloadNodeImage,
    changeCropAspect,
    startCropInteraction,
    handleCropPointerMove,
    stopCropInteraction,
    applyCrop,
  };
}
