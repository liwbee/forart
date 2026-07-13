import "@xyflow/react/dist/style.css";
import {
  addEdge,
  Background,
  BackgroundVariant,
  getNodesBounds,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
  type Connection,
  type NodeTypes,
  type OnConnectEnd,
} from "@xyflow/react";
import { Crosshair, Eye, EyeOff, Grid3X3, Images, Map as MapIcon, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from "../../components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { LibraryAssetPickerRail } from "../library-asset-picker/LibraryAssetPickerRail";
import type { LibraryAssetSelection } from "../library-asset-picker/types";
import { resolveLibraryImageUrl } from "../../lib/libraryImageActions";
import { NativeCanvasActionsContext, readImageDimensions, readImageFileAsDataUrl, type NativeCanvasActions } from "./canvasActions";
import { useNativeCanvasInteractionStore } from "./canvasInteractionStore";
import { CanvasFloatingPanel } from "./components/CanvasFloatingPanel";
import {
  cloneNativeCanvasNodeData,
  createNativeCanvasNode,
  getImageGeneratorNodeSize,
  getImageNodeSize,
  nativeCanvasNodePrimaryImage,
  NATIVE_CANVAS_NODE_DEFINITIONS,
  NATIVE_CANVAS_NODE_KINDS,
  type NativeCanvasEdge,
  type NativeCanvasNode,
  type NativeCanvasNodeKind,
} from "./nativeCanvas";
import { NativeCanvasNode as NativeCanvasNodeComponent } from "./nodes/NativeCanvasNode";
import { ActionFissionRowSettingsDialog } from "./nodes/ActionFissionRowSettingsDialog";
import { configureActionFissionRow, normalizeActionFissionState } from "./action-fission/actionFissionState";
import type { ActionFissionRow } from "./action-fission/actionFissionTypes";
import { emptyCanvasSnapshot, type NativeCanvasSnapshot } from "./canvasWorkspaceTypes";
import { useNativeImageGeneration } from "./generation/useNativeImageGeneration";
import { useNativeActionFissionGeneration } from "./generation/useNativeActionFissionGeneration";
import { useNativeLibtvGeneration } from "./libtv-generation/useNativeLibtvGeneration";
import {
  collectImageGeneratorPrompts,
  collectImageGeneratorReferences,
  edgeDataForConnection,
} from "./generation/imageGenerationInputs";
import { useGenerationRuntimeStore } from "./generation/generationRuntimeStore";
import {
  beginInfiniteCanvasHistoryGesture,
  commitInfiniteCanvasHistoryGesture,
  recordInfiniteCanvasHistory,
  redoInfiniteCanvasHistory,
  resetInfiniteCanvasHistory,
  restoreInfiniteCanvasHistorySnapshot,
  undoInfiniteCanvasHistory,
  type NativeCanvasHistorySnapshot,
} from "./canvasHistoryStore";
import { rememberedGenerationNodeData } from "./generation/generationPreferenceStore";

const NODE_TYPES: NodeTypes = { canvasNode: NativeCanvasNodeComponent };

interface ContextPoint {
  flowX: number;
  flowY: number;
}

interface ActionFissionSettingsTarget {
  nodeId: string;
  rowId: string;
}

const CANVAS_CLIPBOARD_KIND = "forart.reactflow.nodes";
const CANVAS_CLIPBOARD_MIME = "application/x-forart-canvas-nodes";

interface CanvasClipboardPayload {
  edges: NativeCanvasEdge[];
  kind: typeof CANVAS_CLIPBOARD_KIND;
  nodes: NativeCanvasNode[];
  version: 1;
}

interface PasteSequence {
  count: number;
  pointer: { x: number; y: number };
  serialized: string;
}

const PASTE_POINTER_RESET_DISTANCE = 8;
const PASTE_CASCADE_OFFSET = 24;

function isEditingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function parseCanvasClipboard(serialized: string): CanvasClipboardPayload | null {
  if (!serialized) return null;
  try {
    const parsed = JSON.parse(serialized) as Partial<CanvasClipboardPayload>;
    if (parsed.kind !== CANVAS_CLIPBOARD_KIND || parsed.version !== 1) return null;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges) || !parsed.nodes.length) return null;
    return parsed as CanvasClipboardPayload;
  } catch {
    return null;
  }
}

function NativeCanvasToolbar({
  readOnly,
  libraryOpen,
  minimapOpen,
  connectionsVisible,
  snapToGrid,
  onToggleLibrary,
  onToggleMinimap,
  onToggleConnections,
  onToggleSnapToGrid,
}: {
  readOnly: boolean;
  libraryOpen: boolean;
  minimapOpen: boolean;
  connectionsVisible: boolean;
  snapToGrid: boolean;
  onToggleLibrary: () => void;
  onToggleMinimap: () => void;
  onToggleConnections: () => void;
  onToggleSnapToGrid: () => void;
}) {
  const { t } = useTranslation();
  const { fitView, zoomIn, zoomOut } = useReactFlow<NativeCanvasNode, NativeCanvasEdge>();
  const { zoom } = useViewport();

  return (
    <div className="rf-native-controls nodrag nopan nowheel">
      <div className="rf-native-control-bar">
        {!readOnly ? <>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant={libraryOpen ? "default" : "ghost"} size="icon" aria-label={t("infiniteCanvas:importFromLibrary")} aria-pressed={libraryOpen} onClick={onToggleLibrary}>
              <Images aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{t("infiniteCanvas:importFromLibrary")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant={connectionsVisible ? "ghost" : "default"} size="icon" aria-label={t(connectionsVisible ? "infiniteCanvas:hideConnections" : "infiniteCanvas:showConnections")} aria-pressed={!connectionsVisible} onClick={onToggleConnections}>
              {connectionsVisible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{t(connectionsVisible ? "infiniteCanvas:hideConnections" : "infiniteCanvas:showConnections")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant={minimapOpen ? "default" : "ghost"} size="icon" aria-label={t("infiniteCanvas:minimap")} aria-pressed={minimapOpen} onClick={onToggleMinimap}>
              <MapIcon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{t("infiniteCanvas:minimap")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant={snapToGrid ? "default" : "ghost"} size="icon" aria-label={t(snapToGrid ? "infiniteCanvas:disableSnapToGrid" : "infiniteCanvas:enableSnapToGrid")} aria-pressed={snapToGrid} onClick={onToggleSnapToGrid}>
              <Grid3X3 aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{t(snapToGrid ? "infiniteCanvas:disableSnapToGrid" : "infiniteCanvas:enableSnapToGrid")}</TooltipContent>
        </Tooltip>
        </> : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={t("infiniteCanvas:resetView")} onClick={() => void fitView({ padding: 0.18 })}>
              <Crosshair aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{t("infiniteCanvas:resetView")}</TooltipContent>
        </Tooltip>

        <Button type="button" variant="ghost" size="icon" aria-label={t("infiniteCanvas:zoomOut")} onClick={() => void zoomOut()}>
          <ZoomOut aria-hidden="true" />
        </Button>
        <span className="rf-native-zoom-value" aria-label={t("infiniteCanvas:zoomCanvas")}>{Math.round(zoom * 100)}%</span>
        <Button type="button" variant="ghost" size="icon" aria-label={t("infiniteCanvas:zoomIn")} onClick={() => void zoomIn()}>
          <ZoomIn aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function NativeCanvasSurface({ canvasId, imageDownloadPath, initialSnapshot, onSnapshotChange, readOnly }: {
  canvasId: string;
  imageDownloadPath?: string;
  initialSnapshot: NativeCanvasSnapshot;
  onSnapshotChange?: (snapshot: NativeCanvasSnapshot) => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<NativeCanvasNode>(initialSnapshot.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<NativeCanvasEdge>(initialSnapshot.edges);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const viewportRef = useRef(initialSnapshot.viewport);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTargetNodeId, setLibraryTargetNodeId] = useState<string | null>(null);
  const [libraryReferenceTargetNodeId, setLibraryReferenceTargetNodeId] = useState<string | null>(null);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [connectionsVisible, setConnectionsVisible] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [contextPoint, setContextPoint] = useState<ContextPoint | null>(null);
  const [actionFissionSettingsTarget, setActionFissionSettingsTarget] = useState<ActionFissionSettingsTarget | null>(null);
  const pasteSequenceRef = useRef<PasteSequence | null>(null);
  const historyGestureRef = useRef<NativeCanvasHistorySnapshot | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const { getEdges, getIntersectingNodes, getNodes, screenToFlowPosition } = useReactFlow<NativeCanvasNode, NativeCanvasEdge>();
  const syncSelection = useNativeCanvasInteractionStore((state) => state.syncSelection);
  const beginSelectionGesture = useNativeCanvasInteractionStore((state) => state.beginSelectionGesture);
  const endSelectionGesture = useNativeCanvasInteractionStore((state) => state.endSelectionGesture);
  const resetInteractions = useNativeCanvasInteractionStore((state) => state.resetInteractions);
  const clearCanvasLaunching = useGenerationRuntimeStore((state) => state.clearCanvasLaunching);
  const actionFissionSettingsRow = useMemo<ActionFissionRow | null>(() => {
    if (!actionFissionSettingsTarget) return null;
    const node = nodes.find((item) => item.id === actionFissionSettingsTarget.nodeId);
    return node?.data.actionFission?.rows.find((row) => row.id === actionFissionSettingsTarget.rowId) || null;
  }, [actionFissionSettingsTarget, nodes]);

  useEffect(() => resetInteractions, [resetInteractions]);
  useEffect(() => () => clearCanvasLaunching(canvasId), [canvasId, clearCanvasLaunching]);

  useEffect(() => {
    resetInfiniteCanvasHistory(initialSnapshot.nodes, initialSnapshot.edges);
  }, [canvasId, initialSnapshot.edges, initialSnapshot.nodes]);

  useEffect(() => {
    if (readOnly) return;
    recordInfiniteCanvasHistory(nodes, edges);
    onSnapshotChange?.({ nodes, edges, viewport: viewportRef.current });
  }, [edges, nodes, onSnapshotChange, readOnly]);

  const restoreHistory = useCallback((snapshot: NativeCanvasHistorySnapshot) => {
    const restored = restoreInfiniteCanvasHistorySnapshot(snapshot, nodesRef.current, edgesRef.current);
    setNodes(restored.nodes);
    setEdges(restored.edges);
    syncSelection([]);
  }, [setEdges, setNodes, syncSelection]);

  const undoHistory = useCallback(() => restoreHistory(undoInfiniteCanvasHistory()), [restoreHistory]);
  const redoHistory = useCallback(() => restoreHistory(redoInfiniteCanvasHistory()), [restoreHistory]);

  useEffect(() => {
    if (readOnly) return;
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (isEditingTarget(event.target) || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redoHistory();
      } else if (key === "z") {
        event.preventDefault();
        undoHistory();
      } else if (key === "y") {
        event.preventDefault();
        redoHistory();
      }
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [readOnly, redoHistory, undoHistory]);

  const beginCanvasSelection = useCallback(() => {
    beginSelectionGesture();
  }, [beginSelectionGesture]);

  const finishCanvasSelection = useCallback(() => {
    endSelectionGesture();
  }, [endSelectionGesture]);

  const addNode = useCallback((kind: NativeCanvasNodeKind, x: number, y: number, data?: Partial<NativeCanvasNode["data"]>) => {
    const definition = NATIVE_CANVAS_NODE_DEFINITIONS[kind];
    const rememberedData = rememberedGenerationNodeData(kind);
    const nodeData = {
      ...rememberedData,
      ...data,
      ...((rememberedData.libtvImageGeneration || data?.libtvImageGeneration) ? {
        libtvImageGeneration: {
          ...rememberedData.libtvImageGeneration,
          ...data?.libtvImageGeneration,
        },
      } : {}),
    };
    const node = createNativeCanvasNode(kind, {
      x: x - definition.size.width / 2,
      y: y - definition.size.height / 2,
    }, nodeData);
    setNodes((current) => [
      ...current.map((item) => item.selected ? { ...item, selected: false } : item),
      { ...node, selected: true },
    ]);
    return node;
  }, [setNodes]);

  const addContextNode = useCallback((kind: NativeCanvasNodeKind) => {
    if (!contextPoint) return;
    addNode(kind, contextPoint.flowX, contextPoint.flowY);
    setContextPoint(null);
  }, [addNode, contextPoint]);

  const setNodeImage = useCallback((nodeId: string, imageUrl: string, label: string) => {
    const nodeKind = getNodes().find((node) => node.id === nodeId)?.data.kind;
    setNodes((current) => current.map((node) => node.id === nodeId
      ? {
        ...node,
        data: {
          ...node.data,
          label,
          ...(node.data.kind === "imageGenerator"
            ? {
                imageUrl: undefined,
                thumbUrl: undefined,
                generatedImages: [{
                  localUrl: imageUrl,
                  fileName: label,
                  downloadState: "pending" as const,
                }],
              }
            : { imageUrl, thumbUrl: undefined }),
        },
      }
      : node));
    void (async () => {
      let storedUrl = imageUrl;
      let thumbUrl = "";
      if (nodeKind === "imageLoader" && /^data:image\//i.test(imageUrl) && window.easyTool?.saveCanvasAsset) {
        const stored = await window.easyTool.saveCanvasAsset({ dataUrl: imageUrl, defaultName: label, kind: "input" });
        storedUrl = stored.url;
        thumbUrl = stored.thumbUrl || "";
      } else if (window.easyTool?.ensureCanvasAssetThumbnail) {
        const thumbnail = await window.easyTool.ensureCanvasAssetThumbnail({ url: imageUrl });
        thumbUrl = thumbnail.thumbUrl || "";
      }
      const { width, height } = await readImageDimensions(resolveLibraryImageUrl(storedUrl));
      const size = getImageNodeSize(width, height);
      setNodes((current) => current.map((node) => node.id === nodeId
        ? {
          ...node,
          data: {
            ...node.data,
            ...(node.data.kind === "imageGenerator"
              ? {
                  imageUrl: undefined,
                  thumbUrl: undefined,
                  generatedImages: [
                    {
                      ...(node.data.generatedImages?.[0] || {}),
                      localUrl: storedUrl,
                      thumbUrl: thumbUrl || undefined,
                      fileName: node.data.generatedImages?.[0]?.fileName || label,
                      width,
                      height,
                      downloadState: node.data.generatedImages?.[0]?.downloadState || "pending" as const,
                    },
                    ...(node.data.generatedImages?.slice(1) || []),
                  ],
                }
              : { imageUrl: storedUrl, thumbUrl: thumbUrl || undefined }),
            imageNaturalWidth: width,
            imageNaturalHeight: height,
          },
          style: { ...node.style, ...size },
        }
        : node));
    })().catch(() => undefined);
  }, [getNodes, setNodes]);

  const patchNodeData = useCallback((nodeId: string, patch: Partial<NativeCanvasNode["data"]>) => {
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;
      const data = { ...node.data, ...patch };
      if (data.kind !== "imageGenerator" || nativeCanvasNodePrimaryImage(data) || patch.imageAspectRatio === undefined) {
        return { ...node, data };
      }

      const size = getImageGeneratorNodeSize(data.imageAspectRatio);
      const currentWidth = typeof node.style?.width === "number" ? node.style.width : node.measured?.width || size.width;
      const currentHeight = typeof node.style?.height === "number" ? node.style.height : node.measured?.height || size.height;
      return {
        ...node,
        data,
        position: {
          x: node.position.x + (currentWidth - size.width) / 2,
          y: node.position.y + (currentHeight - size.height) / 2,
        },
        style: { ...node.style, ...size },
      };
    }));
  }, [setNodes]);

  const patchActionFissionRow = useCallback((nodeId: string, rowId: string, patch: Partial<ActionFissionRow>) => {
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId || node.data.kind !== "actionFission") return node;
      const actionFission = normalizeActionFissionState(node.data.actionFission);
      return {
        ...node,
        data: {
          ...node.data,
          actionFission: {
            ...actionFission,
            rows: actionFission.rows.map((row) => row.id === rowId ? { ...row, ...patch } : row),
          },
        },
      };
    }));
  }, [setNodes]);

  const patchActionFissionState = useCallback((nodeId: string, patch: Partial<NonNullable<NativeCanvasNode["data"]["actionFission"]>>) => {
    setNodes((current) => current.map((node) => node.id === nodeId && node.data.kind === "actionFission"
      ? {
          ...node,
          data: {
            ...node.data,
            actionFission: { ...normalizeActionFissionState(node.data.actionFission), ...patch },
          },
        }
      : node));
  }, [setNodes]);

  const {
    runImageGeneration: runApiImageGeneration,
    stopImageGeneration: stopApiImageGeneration,
  } = useNativeImageGeneration({
    canvasId,
    edges,
    nodes,
    patchNodeData,
    setNodeImage,
    t,
  });
  const { runLibtvGeneration, stopLibtvGeneration } = useNativeLibtvGeneration({
    canvasId,
    edges,
    nodes,
    patchNodeData,
    setNodeImage,
    t,
  });
  const { runActionFission, stopActionFission } = useNativeActionFissionGeneration({
    canvasId,
    edges,
    nodes,
    patchRow: patchActionFissionRow,
    patchState: patchActionFissionState,
    t,
  });
  const runImageGeneration = useCallback(async (nodeId: string, options?: { promptOverride?: string }) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (node?.data.imageGenerationBackend === "libtv") await runLibtvGeneration(nodeId, options);
    else await runApiImageGeneration(nodeId, options);
  }, [nodes, runApiImageGeneration, runLibtvGeneration]);
  const stopImageGeneration = useCallback(async (nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (node?.data.imageGenerationBackend === "libtv") await stopLibtvGeneration(nodeId);
    else await stopApiImageGeneration(nodeId);
  }, [nodes, stopApiImageGeneration, stopLibtvGeneration]);

  const saveGeneratedImage = useCallback(async (imageUrl: string, defaultName: string) => {
    try {
      if (window.easyTool?.saveResult) {
        const result = await window.easyTool.saveResult({
          url: resolveLibraryImageUrl(imageUrl),
          dataUrl: resolveLibraryImageUrl(imageUrl),
          defaultName,
          directory: imageDownloadPath,
        });
        toast.success(result.filePath
          ? t("infiniteCanvas:downloadSaved", { path: result.filePath })
          : t("infiniteCanvas:downloadComplete"));
        return;
      }
      const link = document.createElement("a");
      link.href = resolveLibraryImageUrl(imageUrl);
      link.download = defaultName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success(t("infiniteCanvas:downloadComplete"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [imageDownloadPath, t]);

  const downloadGeneratedImage = useCallback(async (nodeId: string, imageIndex: number) => {
    const node = nodes.find((item) => item.id === nodeId);
    const images = node?.data.generatedImages || [];
    const image = images[imageIndex];
    const imageUrl = String(image?.localUrl || image?.url || "");
    if (!node || !image || !imageUrl) return;
    await saveGeneratedImage(imageUrl, image.fileName || `generated-image-${imageIndex + 1}.png`);
    patchNodeData(nodeId, {
      generatedImages: images.map((item, index) => index === imageIndex
        ? { ...item, downloadState: "downloaded", downloadedAt: Date.now() }
        : item),
    });
  }, [nodes, patchNodeData, saveGeneratedImage]);

  const downloadActionFissionResult = useCallback(async (nodeId: string, rowId: string) => {
    const row = nodes.find((node) => node.id === nodeId)?.data.actionFission?.rows.find((item) => item.id === rowId);
    const imageUrl = String(row?.resultUrl || row?.generationTask?.result?.localUrl || row?.generationTask?.result?.url || "");
    if (!row || !imageUrl) return;
    const defaultName = String(row.resultFileName || row.selectedActionName || `generated-image-${Date.now()}.png`);
    await saveGeneratedImage(imageUrl, defaultName);
    patchActionFissionRow(nodeId, rowId, { resultDownloadState: "downloaded", resultDownloadedAt: Date.now() });
  }, [nodes, patchActionFissionRow, saveGeneratedImage]);

  const addReferenceImage = useCallback(async (targetNodeId: string, source: {
    imageUrl: string;
    label: string;
    thumbUrl?: string;
    type?: string;
    verticalOffset?: number;
  }) => {
    const target = getNodes().find((node) => (
      node.id === targetNodeId
      && (node.data.kind === "imageGenerator" || node.data.kind === "actionFission")
    ));
    if (!target) return;
    let imageUrl = source.imageUrl;
    let thumbUrl = source.thumbUrl || "";
    if (/^data:image\//i.test(imageUrl) && window.easyTool?.saveCanvasAsset) {
      const stored = await window.easyTool.saveCanvasAsset({
        dataUrl: imageUrl,
        defaultName: source.label,
        kind: "input",
        type: source.type,
      });
      imageUrl = stored.url;
      thumbUrl = stored.thumbUrl || thumbUrl;
    }
    const dimensions = await readImageDimensions(resolveLibraryImageUrl(imageUrl));
    const size = getImageNodeSize(dimensions.width, dimensions.height);
    const referenceNode = createNativeCanvasNode("imageLoader", {
      x: target.position.x - size.width - 64,
      y: target.position.y + Number(source.verticalOffset || 0),
    }, {
      imageUrl,
      thumbUrl: thumbUrl || undefined,
      imageNaturalWidth: dimensions.width,
      imageNaturalHeight: dimensions.height,
      label: source.label,
    });
    referenceNode.style = size;
    referenceNode.selected = false;
    setNodes((current) => [...current, referenceNode]);
    setEdges((current) => addEdge({
      id: `edge_${crypto.randomUUID()}`,
      type: "default",
      source: referenceNode.id,
      sourceHandle: "output",
      target: targetNodeId,
      targetHandle: "input",
      data: edgeDataForConnection("imageLoader", target.data.kind, targetNodeId, current),
    }, current));
  }, [getNodes, setEdges, setNodes]);

  const addImageReferenceFiles = useCallback(async (targetNodeId: string, files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    for (let index = 0; index < imageFiles.length; index += 1) {
      const file = imageFiles[index];
      await addReferenceImage(targetNodeId, {
        imageUrl: await readImageFileAsDataUrl(file),
        label: file.name || t("infiniteCanvas:pastedImage"),
        type: file.type,
        verticalOffset: index * 28,
      });
    }
  }, [addReferenceImage, t]);

  const addLibraryImage = useCallback((selection: LibraryAssetSelection) => {
    if (libraryReferenceTargetNodeId) {
      void addReferenceImage(libraryReferenceTargetNodeId, {
        imageUrl: selection.url,
        thumbUrl: selection.thumbnailUrl,
        label: selection.name || t("infiniteCanvas:imageNode"),
      });
      setLibraryReferenceTargetNodeId(null);
      setLibraryOpen(false);
      return;
    }
    if (libraryTargetNodeId) {
      setNodeImage(libraryTargetNodeId, selection.url, selection.name || t("infiniteCanvas:imageNode"));
      setLibraryTargetNodeId(null);
      setLibraryOpen(false);
      return;
    }
    const rect = wrapperRef.current?.getBoundingClientRect();
    const point = rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 };
    const node = addNode("imageLoader", point.x, point.y, {
      label: selection.name || t("infiniteCanvas:imageNode"),
      imageUrl: selection.url,
    });
    setNodeImage(node.id, selection.url, selection.name || t("infiniteCanvas:imageNode"));
  }, [addNode, addReferenceImage, libraryReferenceTargetNodeId, libraryTargetNodeId, screenToFlowPosition, setNodeImage, t]);

  const canvasActionHandlersRef = useRef({
    addImageReferenceFiles,
    downloadActionFissionResult,
    downloadGeneratedImage,
    runImageGeneration,
    runActionFission,
    stopImageGeneration,
    stopActionFission,
  });
  canvasActionHandlersRef.current = {
    addImageReferenceFiles,
    downloadActionFissionResult,
    downloadGeneratedImage,
    runImageGeneration,
    runActionFission,
    stopImageGeneration,
    stopActionFission,
  };

  const canvasActions = useMemo<NativeCanvasActions>(() => ({
    addImageReferenceFiles: (nodeId, files) => canvasActionHandlersRef.current.addImageReferenceFiles(nodeId, files),
    downloadActionFissionResult: (nodeId, rowId) => canvasActionHandlersRef.current.downloadActionFissionResult(nodeId, rowId),
    downloadGeneratedImage: (nodeId, imageIndex) => canvasActionHandlersRef.current.downloadGeneratedImage(nodeId, imageIndex),
    getImageGeneratorPrompts: (nodeId: string) => collectImageGeneratorPrompts(nodeId, nodesRef.current, edgesRef.current, t("infiniteCanvas:prompt")),
    getImageGeneratorReferences: (nodeId: string) => collectImageGeneratorReferences(nodeId, nodesRef.current, edgesRef.current, t("infiniteCanvas:referenceImage")),
    openLibraryForNode: (nodeId: string) => {
      setLibraryReferenceTargetNodeId(null);
      setLibraryTargetNodeId(nodeId);
      setLibraryOpen(true);
    },
    openLibraryForReference: (nodeId: string) => {
      setLibraryTargetNodeId(null);
      setLibraryReferenceTargetNodeId(nodeId);
      setLibraryOpen(true);
    },
    openActionFissionRowSettings: (nodeId: string, rowId: string) => {
      setActionFissionSettingsTarget({ nodeId, rowId });
    },
    patchNodeData,
    removeCanvasEdge: (edgeId: string) => setEdges((current) => current.filter((edge) => edge.id !== edgeId)),
    reorderImageGeneratorReferences: (nodeId: string, orderedEdgeIds: string[]) => {
      const orderById = new Map(orderedEdgeIds.map((edgeId, index) => [edgeId, index + 1]));
      setEdges((current) => current.map((edge) => (
        edge.target === nodeId && orderById.has(edge.id)
          ? { ...edge, data: { ...edge.data, inputKind: "referenceImage", referenceOrder: orderById.get(edge.id) } }
          : edge
      )));
    },
    runImageGeneration: (nodeId, options) => canvasActionHandlersRef.current.runImageGeneration(nodeId, options),
    runActionFission: (nodeId, rowId) => canvasActionHandlersRef.current.runActionFission(nodeId, rowId),
    setNodeImage,
    setNodeText: (nodeId: string, text: string) => patchNodeData(nodeId, { text }),
    stopImageGeneration: (nodeId) => canvasActionHandlersRef.current.stopImageGeneration(nodeId),
    stopActionFission: (nodeId, rowId) => canvasActionHandlersRef.current.stopActionFission(nodeId, rowId),
  }), [patchNodeData, setEdges, setNodeImage, t]);

  const connectNodes = useCallback((connection: Connection) => {
    setEdges((current) => {
      const nodeMap = new Map(getNodes().map((node) => [node.id, node]));
      const source = connection.source ? nodeMap.get(connection.source) : undefined;
      const target = connection.target ? nodeMap.get(connection.target) : undefined;
      if (!source || !target) return current;
      if (current.some((edge) => (
        edge.source === source.id
        && edge.target === target.id
        && edge.sourceHandle === (connection.sourceHandle || null)
        && edge.targetHandle === (connection.targetHandle || null)
      ))) return current;
      const data = edgeDataForConnection(source.data.kind, target.data.kind, target.id, current);
      if (target.data.kind === "imageGenerator" && !data) return current;
      return addEdge({
        ...connection,
        type: "default",
        data,
      }, current);
    });
  }, [getNodes, setEdges]);

  const connectToNodeBody = useCallback<OnConnectEnd>((event, connectionState) => {
    if (connectionState.isValid || !connectionState.fromNode || !connectionState.fromHandle) return;

    const pointer = "changedTouches" in event
      ? event.changedTouches[0]
      : event;
    if (!pointer) return;

    const flowPoint = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
    const targetNode = getIntersectingNodes({
      x: flowPoint.x,
      y: flowPoint.y,
      width: 1,
      height: 1,
    }, true)
      .filter((node) => (
        node.id !== connectionState.fromNode?.id
        && NATIVE_CANVAS_NODE_DEFINITIONS[node.data.kind].acceptsInput
      ))
      .sort((left, right) => (right.zIndex || 0) - (left.zIndex || 0))[0];

    if (!targetNode) return;
    connectNodes({
      source: connectionState.fromNode.id,
      sourceHandle: connectionState.fromHandle.id ?? null,
      target: targetNode.id,
      targetHandle: "input",
    });
  }, [connectNodes, getIntersectingNodes, screenToFlowPosition]);

  const addImageFilesAtClientPoint = useCallback(async (
    files: File[],
    clientPoint: { x: number; y: number },
  ) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const flowPoint = screenToFlowPosition(clientPoint);
    const images = await Promise.all(imageFiles.map(async (file, index) => {
      const dataUrl = await readImageFileAsDataUrl(file);
      const stored = window.easyTool?.saveCanvasAsset
        ? await window.easyTool.saveCanvasAsset({ dataUrl, defaultName: file.name, kind: "input", type: file.type })
        : { url: dataUrl, fileName: file.name };
      return { file, imageUrl: stored.url, thumbUrl: stored.thumbUrl, index };
    }));
    const imageNodes = await Promise.all(images.map(async ({ file, imageUrl, thumbUrl, index }) => {
      const dimensions = await readImageDimensions(imageUrl);
      const size = getImageNodeSize(dimensions.width, dimensions.height);
      const node = createNativeCanvasNode("imageLoader", {
        x: flowPoint.x - size.width / 2 + index * 32,
        y: flowPoint.y - size.height / 2 + index * 32,
      }, {
        imageUrl,
        thumbUrl,
        imageNaturalWidth: dimensions.width,
        imageNaturalHeight: dimensions.height,
        label: file.name || t("infiniteCanvas:pastedImage"),
      });
      return { ...node, style: size, selected: true };
    }));
    setNodes((current) => [
      ...current.map((node) => node.selected ? { ...node, selected: false } : node),
      ...imageNodes,
    ]);
  }, [screenToFlowPosition, setNodes, t]);

  useEffect(() => {
    function isCanvasAvailable() {
      const canvasElement = wrapperRef.current;
      return Boolean(canvasElement && window.getComputedStyle(canvasElement).visibility === "visible");
    }

    function handleCopy(event: ClipboardEvent) {
      if (readOnly || !isCanvasAvailable() || isEditingTarget(event.target)) return;
      const selectedNodes = getNodes().filter((node) => node.selected);
      if (!selectedNodes.length) return;
      const selectedIds = new Set(selectedNodes.map((node) => node.id));
      const payload: CanvasClipboardPayload = {
        kind: CANVAS_CLIPBOARD_KIND,
        version: 1,
        nodes: selectedNodes.map((node) => ({
          ...node,
          data: cloneNativeCanvasNodeData(node.data),
          position: { ...node.position },
          selected: false,
        })),
        edges: getEdges()
          .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
          .map((edge) => ({ ...edge, data: edge.data ? { ...edge.data } : undefined, selected: false })),
      };
      const serialized = JSON.stringify(payload);
      event.clipboardData?.setData(CANVAS_CLIPBOARD_MIME, serialized);
      event.clipboardData?.setData("text/plain", serialized);
      event.preventDefault();
      pasteSequenceRef.current = null;
    }

    function handlePaste(event: ClipboardEvent) {
      if (readOnly || !isCanvasAvailable() || isEditingTarget(event.target)) return;
      const serialized = event.clipboardData?.getData(CANVAS_CLIPBOARD_MIME)
        || event.clipboardData?.getData("text/plain")
        || "";
      const payload = parseCanvasClipboard(serialized);
      if (payload) {
        event.preventDefault();
        const rect = wrapperRef.current?.getBoundingClientRect();
        const pointer = lastPointerRef.current || (rect
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { x: 0, y: 0 });
        const previousSequence = pasteSequenceRef.current;
        const pointerDistance = previousSequence
          ? Math.hypot(pointer.x - previousSequence.pointer.x, pointer.y - previousSequence.pointer.y)
          : Number.POSITIVE_INFINITY;
        const pasteCount = previousSequence?.serialized === serialized && pointerDistance <= PASTE_POINTER_RESET_DISTANCE
          ? previousSequence.count + 1
          : 0;
        pasteSequenceRef.current = { serialized, count: pasteCount, pointer: { ...pointer } };
        const cascadeOffset = pasteCount * PASTE_CASCADE_OFFSET;
        const targetCenter = screenToFlowPosition({
          x: pointer.x + cascadeOffset,
          y: pointer.y + cascadeOffset,
        });
        const sourceBounds = getNodesBounds(payload.nodes);
        const deltaX = targetCenter.x - (sourceBounds.x + sourceBounds.width / 2);
        const deltaY = targetCenter.y - (sourceBounds.y + sourceBounds.height / 2);
        const idMap = new Map(payload.nodes.map((node) => [node.id, `${node.data.kind}_${crypto.randomUUID()}`]));
        const pastedNodes = payload.nodes.map((node) => ({
          ...node,
          id: idMap.get(node.id)!,
          data: cloneNativeCanvasNodeData(node.data),
          position: { x: node.position.x + deltaX, y: node.position.y + deltaY },
          selected: true,
        }));
        const pastedEdges = payload.edges.map((edge) => ({
          ...edge,
          id: `edge_${crypto.randomUUID()}`,
          source: idMap.get(edge.source)!,
          target: idMap.get(edge.target)!,
          data: edge.data ? { ...edge.data } : undefined,
          selected: false,
        }));

        setNodes((current) => [
          ...current.map((node) => node.selected ? { ...node, selected: false } : node),
          ...pastedNodes,
        ]);
        setEdges((current) => [
          ...current.map((edge) => edge.selected ? { ...edge, selected: false } : edge),
          ...pastedEdges,
        ]);
        return;
      }

      const itemImageFiles = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .flatMap((item) => item.getAsFile() || []);
      const imageFiles = itemImageFiles.length ? itemImageFiles : Array.from(event.clipboardData?.files || [])
        .filter((file) => file.type.startsWith("image/"));
      if (!imageFiles.length) return;
      event.preventDefault();
      const rect = wrapperRef.current?.getBoundingClientRect();
      const clientPoint = lastPointerRef.current || (rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: 0, y: 0 });
      void addImageFilesAtClientPoint(imageFiles, clientPoint);
    }

    window.addEventListener("copy", handleCopy);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("copy", handleCopy);
      window.removeEventListener("paste", handlePaste);
    };
  }, [addImageFilesAtClientPoint, getEdges, getNodes, readOnly, screenToFlowPosition, setEdges, setNodes, t]);

  return (
    <div ref={wrapperRef} className={`rf-native-canvas${readOnly ? " rf-native-canvas--readonly" : ""}`}>
      <NativeCanvasActionsContext.Provider value={canvasActions}>
        <ContextMenu onOpenChange={(open) => !open && setContextPoint(null)}>
        <ContextMenuTrigger asChild disabled={readOnly}>
          <div
            className="rf-native-flow-surface"
            onPointerMove={(event) => {
              lastPointerRef.current = { x: event.clientX, y: event.clientY };
            }}
            onDragOver={(event) => {
              if (readOnly) return;
              const hasImage = Array.from(event.dataTransfer.items || [])
                .some((item) => item.kind === "file" && item.type.startsWith("image/"));
              if (!hasImage) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              if (readOnly) return;
              const imageFiles = Array.from(event.dataTransfer.files || [])
                .filter((file) => file.type.startsWith("image/"));
              if (!imageFiles.length) return;
              event.preventDefault();
              event.stopPropagation();
              void addImageFilesAtClientPoint(imageFiles, { x: event.clientX, y: event.clientY });
            }}
            onContextMenu={(event) => {
              if (readOnly) return;
              const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
              setContextPoint({ flowX: point.x, flowY: point.y });
            }}
          >
            <ReactFlow<NativeCanvasNode, NativeCanvasEdge>
              nodes={nodes}
              edges={connectionsVisible ? edges : []}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onSelectionChange={({ nodes: selectedNodes }) => {
                if (wrapperRef.current) {
                  wrapperRef.current.dataset.selectionCount = String(selectedNodes.length);
                }
                syncSelection(selectedNodes.map((node) => node.id));
              }}
              onConnect={readOnly ? undefined : connectNodes}
              onConnectEnd={readOnly ? undefined : connectToNodeBody}
              onSelectionStart={beginCanvasSelection}
              onSelectionEnd={finishCanvasSelection}
              onViewportChange={({ zoom }) => {
                wrapperRef.current?.style.setProperty("--rf-selection-inverse-zoom", String(1 / zoom));
              }}
              onMoveEnd={(_event, viewport) => {
                viewportRef.current = viewport;
                if (!readOnly) onSnapshotChange?.({ nodes, edges, viewport });
              }}
              onNodeDragStart={(_event, draggedNode, draggedNodes) => {
                if (readOnly) return;
                historyGestureRef.current = beginInfiniteCanvasHistoryGesture();
                const draggedIds = new Set([draggedNode.id, ...draggedNodes.map((node) => node.id)]);
                setNodes((current) => {
                  const nextZIndex = Math.max(0, ...current.map((node) => node.zIndex || 0)) + 1;
                  return current.map((node) => draggedIds.has(node.id) ? { ...node, zIndex: nextZIndex } : node);
                });
              }}
              onNodeDragStop={() => {
                if (readOnly) return;
                recordInfiniteCanvasHistory(getNodes(), getEdges());
                commitInfiniteCanvasHistoryGesture(historyGestureRef.current);
                historyGestureRef.current = null;
              }}
              minZoom={0.1}
              maxZoom={6}
              selectionOnDrag={!readOnly}
              selectionMode={SelectionMode.Partial}
              elevateNodesOnSelect={false}
              disableKeyboardA11y
              panOnDrag={readOnly ? [0, 1, 2] : [1]}
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              elementsSelectable={!readOnly}
              snapToGrid={snapToGrid}
              snapGrid={[28, 28]}
              onlyRenderVisibleElements
              deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
              defaultEdgeOptions={{ interactionWidth: 20 }}
              fitViewOptions={{ padding: 0.18 }}
              proOptions={{ hideAttribution: true }}
              defaultViewport={initialSnapshot.viewport}
            >
              <Background variant={BackgroundVariant.Dots} gap={28} size={1.4} />
              {minimapOpen ? <MiniMap className="rf-native-minimap" position="bottom-left" pannable zoomable ariaLabel={t("infiniteCanvas:minimap")} /> : null}
            </ReactFlow>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            {NATIVE_CANVAS_NODE_KINDS.map((kind) => {
              const definition = NATIVE_CANVAS_NODE_DEFINITIONS[kind];
              const Icon = definition.icon;
              return (
                <ContextMenuItem key={kind} className="rf-native-context-item" onSelect={() => addContextNode(kind)}>
                  <Icon aria-hidden="true" />
                  <span>{t(`infiniteCanvas:${definition.labelKey}`)}</span>
                </ContextMenuItem>
              );
            })}
          </ContextMenuGroup>
        </ContextMenuContent>
        </ContextMenu>

        {!readOnly ? <CanvasFloatingPanel
          open={libraryOpen}
          title={t("infiniteCanvas:importFromLibrary")}
          className="rf-native-library"
        >
          <LibraryAssetPickerRail onSelect={addLibraryImage} />
        </CanvasFloatingPanel> : null}

        {!readOnly ? <ActionFissionRowSettingsDialog
          open={Boolean(actionFissionSettingsTarget && actionFissionSettingsRow)}
          row={actionFissionSettingsRow}
          onOpenChange={(open) => {
            if (!open) setActionFissionSettingsTarget(null);
          }}
          onApply={(projectId, includeTagIds, excludeTagIds, selectedAction) => {
            if (!actionFissionSettingsTarget) return;
            setNodes((current) => current.map((node) => {
              if (node.id !== actionFissionSettingsTarget.nodeId) return node;
              const actionFission = configureActionFissionRow(
                normalizeActionFissionState(node.data.actionFission),
                actionFissionSettingsTarget.rowId,
                projectId,
                includeTagIds,
                excludeTagIds,
                selectedAction,
              );
              return { ...node, data: { ...node.data, actionFission } };
            }));
          }}
        /> : null}

        <NativeCanvasToolbar
        readOnly={readOnly}
        libraryOpen={libraryOpen}
        minimapOpen={minimapOpen}
        connectionsVisible={connectionsVisible}
        snapToGrid={snapToGrid}
        onToggleLibrary={() => {
          setLibraryTargetNodeId(null);
          setLibraryReferenceTargetNodeId(null);
          setLibraryOpen((current) => !current);
        }}
        onToggleMinimap={() => setMinimapOpen((current) => !current)}
        onToggleSnapToGrid={() => setSnapToGrid((current) => !current)}
        onToggleConnections={() => {
          if (connectionsVisible) {
            setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
          }
          setConnectionsVisible((current) => !current);
        }}
        />

      </NativeCanvasActionsContext.Provider>
    </div>
  );
}

interface ReactFlowCanvasPageProps {
  canvasId: string;
  imageDownloadPath?: string;
  initialSnapshot?: NativeCanvasSnapshot;
  onSnapshotChange?: (snapshot: NativeCanvasSnapshot) => void;
  readOnly?: boolean;
}

export function ReactFlowCanvasPage({ canvasId, imageDownloadPath, initialSnapshot = emptyCanvasSnapshot(), onSnapshotChange, readOnly = false }: ReactFlowCanvasPageProps) {
  const { t } = useTranslation();
  return (
    <section className="infinite-canvas-page" aria-label={t("infiniteCanvas:title")}>
      <ReactFlowProvider>
        <NativeCanvasSurface canvasId={canvasId} imageDownloadPath={imageDownloadPath} initialSnapshot={initialSnapshot} onSnapshotChange={onSnapshotChange} readOnly={readOnly} />
      </ReactFlowProvider>
    </section>
  );
}

export default ReactFlowCanvasPage;
