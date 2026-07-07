import { PointerEvent, useCallback, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import {
  countDirectActionFissionImageConnections,
} from "./action-fission/actionFissionReferences";
import {
  BASE_PUBLIC_REFERENCE_LIMIT,
} from "./action-fission/actionFissionTypes";
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
import type { LibraryAssetSelection } from "../library-asset-picker/types";
import { createImageThumbnail } from "../image-thumbnails/createImageThumbnail";

type StateUpdater<T> = T | ((current: T) => T);
const CANVAS_TOAST_AUTO_HIDE_MS = 2000;

interface DownloadStatus {
  nodeId: string;
  tone: "busy" | "ready" | "error";
  text: string;
}

interface SavedCanvasAsset {
  url: string;
  thumbUrl?: string;
  fileName?: string;
  filePath?: string;
  thumbFilePath?: string;
}

interface UseCanvasMediaActionsOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  imageDownloadPath: string;
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
  t,
}: UseCanvasMediaActionsOptions) {
  const [imagePreview, setImagePreview] = useState<ImageDialogState | null>(null);
  const [imageCrop, setImageCrop] = useState<{ nodeId: string; rect: ReturnType<typeof initialCropRect>; aspect: CropAspectKey } | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus | null>(null);
  const [isImageDropActive, setIsImageDropActive] = useState(false);
  const cropInteractionRef = useRef<CropInteractionState | null>(null);
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const saveCanvasImageAsset = useCallback(async (source: { url?: string; dataUrl?: string; defaultName?: string; kind: "input" | "output"; type?: string }): Promise<SavedCanvasAsset> => {
    const thumbnail = await createImageThumbnail({
      dataUrl: source.dataUrl,
      url: source.url,
      name: source.defaultName,
      type: source.type,
    });
    if (!window.easyTool?.saveCanvasAsset) {
      return {
        url: source.dataUrl || source.url || "",
        thumbUrl: thumbnail?.dataUrl,
        fileName: source.defaultName || "canvas-image.png",
      };
    }
    return window.easyTool.saveCanvasAsset({ ...source, thumbDataUrl: thumbnail?.dataUrl });
  }, []);

  const showMediaStatus = useCallback((status: DownloadStatus) => {
    setDownloadStatus(status);
    if (status.tone === "busy") return;
    window.setTimeout(() => {
      setDownloadStatus((current) => (current?.nodeId === status.nodeId && current.tone !== "busy" ? null : current));
    }, CANVAS_TOAST_AUTO_HIDE_MS);
  }, []);

  const downloadCanvasImageAsset = useCallback(async (source: { url: string; defaultName: string; statusKey: string; onDownloaded?: () => void }) => {
    const clearDownloadStatus = () => {
      window.setTimeout(() => setDownloadStatus((current) => (current?.nodeId === source.statusKey && current.tone !== "busy" ? null : current)), CANVAS_TOAST_AUTO_HIDE_MS);
    };
    setDownloadStatus({ nodeId: source.statusKey, tone: "busy", text: t("infiniteCanvas:downloadBusy") });
    if (window.easyTool?.saveResult) {
      try {
        const result = await window.easyTool.saveResult({ url: source.url, dataUrl: source.url, defaultName: source.defaultName, directory: imageDownloadPath });
        source.onDownloaded?.();
        setDownloadStatus({ nodeId: source.statusKey, tone: "ready", text: result.filePath ? t("infiniteCanvas:downloadSaved", { path: result.filePath }) : t("infiniteCanvas:downloadComplete") });
        clearDownloadStatus();
      } catch (error) {
        setDownloadStatus({ nodeId: source.statusKey, tone: "error", text: error instanceof Error ? error.message : String(error) });
        clearDownloadStatus();
      }
      return;
    }
    const link = document.createElement("a");
    link.href = source.url;
    link.download = source.defaultName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    source.onDownloaded?.();
    setDownloadStatus({ nodeId: source.statusKey, tone: "ready", text: t("infiniteCanvas:downloadComplete") });
    clearDownloadStatus();
  }, [imageDownloadPath, t]);

  const readImagePatch = useCallback(async (file: File): Promise<Partial<CanvasNode>> => {
    const dataUrl = await readFileAsDataUrl(file);
    const saved = await saveCanvasImageAsset({ dataUrl, defaultName: file.name, kind: "input", type: file.type });
    const dimensions = await readImageDimensions(saved.url);
    const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
    return {
      url: saved.url,
      thumbUrl: saved.thumbUrl,
      fileName: saved.fileName || file.name,
      filePath: saved.filePath,
      thumbFilePath: saved.thumbFilePath,
      title: file.name || "Image",
      imageMode: "asset",
      imageSource: "uploaded",
      text: "",
      imageNaturalWidth: dimensions?.width,
      imageNaturalHeight: dimensions?.height,
      ...nextSize,
    };
  }, [saveCanvasImageAsset]);

  const readLibraryImagePatch = useCallback(async (selection: LibraryAssetSelection): Promise<Partial<CanvasNode>> => {
    const dimensions = await readImageDimensions(selection.url);
    const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
    return {
      url: selection.url,
      fileName: selection.name || "Library image",
      filePath: undefined,
      title: selection.name || "Library image",
      imageMode: "asset",
      imageSource: "uploaded",
      text: "",
      imageNaturalWidth: dimensions?.width,
      imageNaturalHeight: dimensions?.height,
      librarySource: {
        kind: selection.kind,
        assetId: selection.assetId,
        entryId: selection.entryId,
        name: selection.name,
      },
      ...nextSize,
    };
  }, []);

  const handleImageFiles = useCallback(async (nodeId: string, files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(isImageFile);
    if (!imageFiles.length) return;
    const patches = await Promise.all(imageFiles.map(readImagePatch));
    const source = nodeMap.get(nodeId);
    const extraNodes = patches.slice(1).map((patch, index) => ({
      ...createNode("imageLoader"),
      ...patch,
      id: `image_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`,
      x: Math.round((source?.x || 0) + (index + 1) * 36),
      y: Math.round((source?.y || 0) + (index + 1) * 36),
    }));
    const primaryPatch = patches[0];
    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, ...primaryPatch } : node)).concat(extraNodes));
    setSelectedIds(new Set([extraNodes[extraNodes.length - 1]?.id || nodeId]));
    setSelectedGroupId("");
  }, [createNode, nodeMap, readImagePatch, setNodes, setSelectedGroupId, setSelectedIds]);

  const importLibraryImageToNode = useCallback(async (nodeId: string, selection: LibraryAssetSelection) => {
    if (!selection.url) return;
    const patch = await readLibraryImagePatch(selection);
    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)));
    setSelectedIds(new Set([nodeId]));
    setSelectedGroupId("");
  }, [readLibraryImagePatch, setNodes, setSelectedGroupId, setSelectedIds]);

  const createLibraryImageNodeAtWorldPoint = useCallback(async (selection: LibraryAssetSelection, point: { x: number; y: number }) => {
    if (!selection.url) return "";
    const patch = await readLibraryImagePatch(selection);
    const node = {
      ...createNode("imageLoader"),
      ...patch,
    };
    node.x = Math.round(point.x - node.w / 2);
    node.y = Math.round(point.y - node.h / 2);
    setNodes((current) => current.concat(node));
    setSelectedIds(new Set([node.id]));
    setSelectedGroupId("");
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
    setImageCrop(null);
    return node.id;
  }, [createNode, readLibraryImagePatch, setConnectionAction, setContextMenu, setNodes, setSelectedConnectionId, setSelectedGroupId, setSelectedIds]);

  const createImageNodesAtClientPoint = useCallback(async (files: FileList | File[], clientX: number, clientY: number) => {
    const imageFiles = Array.from(files).filter(isImageFile);
    if (!imageFiles.length) return false;
    const dropPoint = screenToWorld(clientX, clientY);
    const patches = await Promise.all(imageFiles.map(readImagePatch));
    const createdNodes = patches.map((patch, index) => {
      const node = {
        ...createNode("imageLoader"),
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

  const createImageReferenceForNode = useCallback(async (targetNodeId: string, files: FileList | File[]) => {
    const imageFile = Array.from(files).find(isImageFile);
    const target = nodeMap.get(targetNodeId);
    if (!imageFile || !target) return;
    if (target.type === "actionFission" && countDirectActionFissionImageConnections(targetNodeId, nodes, connections) >= BASE_PUBLIC_REFERENCE_LIMIT) return;
    const patch = await readImagePatch(imageFile);
    const imageNode: CanvasNode = {
      ...createNode("imageLoader"),
      ...patch,
      id: `image_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`,
    };
    imageNode.x = Math.round(target.x - imageNode.w - 48);
    imageNode.y = Math.round(target.y);
    const connectionId = `link_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
    setCanvasDocument((current) => {
      if (current.connections.some((connection) => connection.from === imageNode.id && connection.to === targetNodeId)) return current;
      return {
        nodes: current.nodes.concat(imageNode),
        connections: current.connections.concat({ id: connectionId, from: imageNode.id, to: targetNodeId }),
        groups: current.groups,
      };
    });
    setSelectedIds(new Set([imageNode.id]));
    setSelectedGroupId("");
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
    setImageCrop(null);
  }, [connections, createNode, nodeMap, nodes, readImagePatch, setCanvasDocument, setConnectionAction, setContextMenu, setSelectedConnectionId, setSelectedGroupId, setSelectedIds]);

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
    const markDownloaded = () => {
      if (node.type !== "imageGenerator" && node.type !== "libtvImageGenerator") return;
      patchNode(nodeId, { outputDownloadState: "downloaded", outputDownloadedAt: Date.now() });
    };
    await downloadCanvasImageAsset({
      url: node.url,
      defaultName: node.fileName || `${node.type}-${Date.now()}.png`,
      statusKey: nodeId,
      onDownloaded: markDownloaded,
    });
  }, [downloadCanvasImageAsset, nodeMap, patchNode]);

  const changeCropAspect = useCallback((nodeId: string, aspect: CropAspectKey) => {
    const node = nodeMap.get(nodeId);
    if (node?.type !== "imageLoader" || imageCrop?.nodeId !== nodeId) return;
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
    if (!node || node.type !== "imageLoader" || !node.url || imageCrop?.nodeId !== nodeId) return;
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
      thumbUrl: saved.thumbUrl,
      fileName: saved.fileName,
      filePath: saved.filePath,
      thumbFilePath: saved.thumbFilePath,
      imageNaturalWidth: result.width,
      imageNaturalHeight: result.height,
      ...nextSize,
    };
    patchNode(nodeId, patch);
    setImageCrop(null);
  }, [imageCrop, nodeMap, patchNode, saveCanvasImageAsset]);

  return {
    imagePreview,
    setImagePreview,
    imageCrop,
    setImageCrop,
    downloadStatus,
    showMediaStatus,
    isImageDropActive,
    setIsImageDropActive,
    saveCanvasImageAsset,
    downloadCanvasImageAsset,
    handleImageFiles,
    importLibraryImageToNode,
    createLibraryImageNodeAtWorldPoint,
    createImageNodesFromDrop,
    createImageNodesFromClipboardData,
    createImageReferenceForNode,
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
