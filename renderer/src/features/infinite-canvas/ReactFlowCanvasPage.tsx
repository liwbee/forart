import "@xyflow/react/dist/style.css";
import {
  addEdge,
  Background,
  BackgroundVariant,
  EdgeToolbar,
  getNodesBounds,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  useViewport,
  type Connection,
  type EdgeMouseHandler,
  type NodeTypes,
  type OnConnectEnd,
  type OnNodeDrag,
} from "@xyflow/react";
import { ClipboardPaste, Copy, Crosshair, Download, Eye, EyeOff, Grid3X3, Group as GroupIcon, Image, Images, Map as MapIcon, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "../../components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { LibraryAssetPickerRail } from "../library-asset-picker/LibraryAssetPickerRail";
import type { LibraryAssetSelection } from "../library-asset-picker/types";
import { copyLibraryImage, resolveLibraryImageUrl } from "../../lib/libraryImageActions";
import {
  NativeCanvasActionsContext,
  readImageDimensions,
  readImageFileAsDataUrl,
  type CanvasImageCropRect,
  type NativeCanvasActions,
} from "./canvasActions";
import { useNativeCanvasInteractionStore } from "./canvasInteractionStore";
import { CanvasFloatingPanel } from "./components/CanvasFloatingPanel";
import { applyNativeNodeDataPatch } from "./applyNativeNodeDataPatch";
import {
  cloneNativeCanvasNodeData,
  createNativeCanvasNode,
  createNativeCanvasGroupNode,
  getImageNodeSize,
  nativeCanvasNodePrimaryImage,
  nativeCanvasNodeTaskId,
  NATIVE_CANVAS_NODE_DEFINITIONS,
  type ImageGenerationRunOptions,
  type NativeCanvasEdge,
  type NativeCanvasNode,
  type NativeCanvasNodeKind,
} from "./nativeCanvas";
import { NativeCanvasNode as NativeCanvasNodeComponent } from "./nodes/NativeCanvasNode";
import { NativeCanvasGroupNode } from "./nodes/NativeCanvasGroupNode";
import { ActionFissionRowSettingsDialog } from "./nodes/ActionFissionRowSettingsDialog";
import { configureActionFissionRow, normalizeActionFissionState } from "./action-fission/actionFissionState";
import { actionFissionRowTaskId, type ActionFissionRow } from "./action-fission/actionFissionTypes";
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
  isGenerationTaskActive,
  loadGenerationTasks,
  partitionGenerationStopTasks,
  requiresGenerationStopConfirmation,
} from "./generation/generationTaskCache";
import { buildGenerationDownloadName, buildTaskDownloadName } from "./generation/generationDownloadName";
import { loadApiSettings } from "../settings/apiProviders";
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
import { useInfiniteCanvasSettings } from "./infiniteCanvasSettings";
import {
  collectNativeCanvasSubtree,
  detachNativeCanvasChildrenOutsideParents,
  expandNativeCanvasGroupSelection,
  groupNativeCanvasNodes,
  prepareNativeCanvasNodesForClipboard,
} from "./nativeCanvasGroups";
import { ViewportMomentumController } from "./viewportMomentum";
import {
  projectAltDragOntoClones,
  type AltDragCloneGestureState,
} from "./canvasAltDragClone";

const NODE_TYPES: NodeTypes = { canvasNode: NativeCanvasNodeComponent, groupNode: NativeCanvasGroupNode };
const MULTI_SELECTION_SCREEN_GAP = 24;

const CONTEXT_CANVAS_NODE_GROUPS: NativeCanvasNodeKind[][] = [
  ["imageLoader", "prompt"],
  ["imageGenerator", "llm", "actionFission"],
  ["annotation"],
];

interface ContextPoint {
  flowX: number;
  flowY: number;
}

interface NodeContextTarget {
  node: NativeCanvasNode;
}

interface EdgeToolbarPoint {
  edgeId: string;
  x: number;
  y: number;
}

interface ActionFissionSettingsTarget {
  nodeId: string;
  rowId: string;
}

interface PendingGenerationStop {
  kind: "imageGenerator" | "actionFission";
  nodeId: string;
  rowId?: string;
  taskIds: string[];
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

interface AltDragCloneGesture extends AltDragCloneGestureState {
  clonedEdges: NativeCanvasEdge[];
}

const PASTE_POINTER_RESET_DISTANCE = 8;
const PASTE_CASCADE_OFFSET = 24;
const NODE_POINTER_GESTURE_THRESHOLD = 3;

export type CanvasSaveStatus = "saved" | "unsaved" | "saving";

const SAVE_STATUS_LABEL_KEYS: Record<CanvasSaveStatus, string> = {
  saved: "infiniteCanvas:saveStatusSaved",
  unsaved: "infiniteCanvas:saveStatusUnsaved",
  saving: "infiniteCanvas:saveStatusSaving",
};

function isEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("input, textarea, select")) return true;
  return Boolean(target.closest<HTMLElement>("[contenteditable]")?.isContentEditable);
}

function isNativeCanvasGroupNode(node: NativeCanvasNode) {
  return node.type === "groupNode" || node.data.kind === "group";
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

interface NativeCanvasMultiSelectionFrameGeometry {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function equalMultiSelectionFrameGeometry(
  previous: NativeCanvasMultiSelectionFrameGeometry | null,
  next: NativeCanvasMultiSelectionFrameGeometry | null,
) {
  return previous === next || (
    previous !== null
    && next !== null
    && previous.left === next.left
    && previous.top === next.top
    && previous.right === next.right
    && previous.bottom === next.bottom
  );
}

function NativeCanvasMultiSelectionFrame({
  nodeIds,
  visible,
}: {
  nodeIds: string[];
  visible: boolean;
}) {
  const geometry = useStore((state) => {
    if (!visible || nodeIds.length === 0) return null;
    const liveNodes = nodeIds.flatMap((nodeId) => {
      const node = state.nodeLookup.get(nodeId);
      return node ? [node] : [];
    });
    if (liveNodes.length !== nodeIds.length) return null;
    const bounds = getNodesBounds(liveNodes, { nodeLookup: state.nodeLookup });
    const [x, y, zoom] = state.transform;
    return {
      left: Math.round(x + bounds.x * zoom - MULTI_SELECTION_SCREEN_GAP),
      top: Math.round(y + bounds.y * zoom - MULTI_SELECTION_SCREEN_GAP),
      right: Math.round(x + (bounds.x + bounds.width) * zoom + MULTI_SELECTION_SCREEN_GAP),
      bottom: Math.round(y + (bounds.y + bounds.height) * zoom + MULTI_SELECTION_SCREEN_GAP),
    };
  }, equalMultiSelectionFrameGeometry);

  if (!geometry) return null;

  return (
    <div
      className="react-flow__selection rf-native-multi-selection-frame"
      aria-hidden="true"
      style={{
        width: geometry.right - geometry.left,
        height: geometry.bottom - geometry.top,
        transform: `translate(${geometry.left}px, ${geometry.top}px)`,
      }}
    />
  );
}

function NativeCanvasSurface({ canvasId, imageDownloadPath, initialSnapshot, onSnapshotChange, onSave, readOnly, saveStatus }: {
  canvasId: string;
  imageDownloadPath?: string;
  initialSnapshot: NativeCanvasSnapshot;
  onSnapshotChange?: (snapshot: NativeCanvasSnapshot) => void;
  onSave?: () => void | Promise<void>;
  readOnly: boolean;
  saveStatus: CanvasSaveStatus;
}) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useInfiniteCanvasSettings();
  const { connectionsVisible, minimapOpen, snapToGrid } = settings;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<NativeCanvasNode>(initialSnapshot.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<NativeCanvasEdge>(initialSnapshot.edges);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const flowEdges = useMemo(
    () => edges.map((edge) => edge.hidden === !connectionsVisible
      ? edge
      : { ...edge, hidden: !connectionsVisible }),
    [connectionsVisible, edges],
  );
  const viewportRef = useRef(initialSnapshot.viewport);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTargetNodeId, setLibraryTargetNodeId] = useState<string | null>(null);
  const [libraryReferenceTargetNodeId, setLibraryReferenceTargetNodeId] = useState<string | null>(null);
  const [contextPoint, setContextPoint] = useState<ContextPoint | null>(null);
  const [nodeContextTarget, setNodeContextTarget] = useState<NodeContextTarget | null>(null);
  const [edgeToolbarPoint, setEdgeToolbarPoint] = useState<EdgeToolbarPoint | null>(null);
  const [actionFissionSettingsTarget, setActionFissionSettingsTarget] = useState<ActionFissionSettingsTarget | null>(null);
  const [pendingGenerationStop, setPendingGenerationStop] = useState<PendingGenerationStop | null>(null);
  const [generationStopPending, setGenerationStopPending] = useState(false);
  const [canvasClipboardAvailable, setCanvasClipboardAvailable] = useState(false);
  const pasteSequenceRef = useRef<PasteSequence | null>(null);
  const pendingContextPastePointRef = useRef<{ x: number; y: number } | null>(null);
  const altDragCloneGestureRef = useRef<AltDragCloneGesture | null>(null);
  const historyGestureRef = useRef<NativeCanvasHistorySnapshot | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const edgeToolbarFrameRef = useRef<number | null>(null);
  const edgeToolbarHideTimerRef = useRef<number | null>(null);
  const pendingEdgePointerRef = useRef<{ edgeId: string; clientX: number; clientY: number } | null>(null);
  const { deleteElements, getEdges, getIntersectingNodes, getNodes, getNodesBounds: getFlowNodesBounds, screenToFlowPosition, setViewport } = useReactFlow<NativeCanvasNode, NativeCanvasEdge>();
  const syncSelection = useNativeCanvasInteractionStore((state) => state.syncSelection);
  const beginSelectionGesture = useNativeCanvasInteractionStore((state) => state.beginSelectionGesture);
  const endSelectionGesture = useNativeCanvasInteractionStore((state) => state.endSelectionGesture);
  const selectionGestureActive = useNativeCanvasInteractionStore((state) => state.selectionGestureActive);
  const toolbarNodeId = useNativeCanvasInteractionStore((state) => state.toolbarNodeId);
  const resetInteractions = useNativeCanvasInteractionStore((state) => state.resetInteractions);
  const clearCanvasLaunching = useGenerationRuntimeStore((state) => state.clearCanvasLaunching);
  const actionFissionSettingsRow = useMemo<ActionFissionRow | null>(() => {
    if (!actionFissionSettingsTarget) return null;
    const node = nodes.find((item) => item.id === actionFissionSettingsTarget.nodeId);
    return normalizeActionFissionState(node?.data.actionFission).rows.find((row) => row.id === actionFissionSettingsTarget.rowId) || null;
  }, [actionFissionSettingsTarget, nodes]);
  const contextNode = useMemo(
    () => nodeContextTarget
      ? nodes.find((node) => node.id === nodeContextTarget.node.id) || nodeContextTarget.node
      : null,
    [nodeContextTarget, nodes],
  );
  const contextNodeImage = useMemo(() => {
    if (contextNode?.data.kind !== "imageLoader" && contextNode?.data.kind !== "imageGenerator") return null;
    return nativeCanvasNodePrimaryImage(contextNode.data);
  }, [contextNode]);
  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected && !isNativeCanvasGroupNode(node)), [nodes]);
  const selectedNodeIds = useMemo(() => selectedNodes.map((node) => node.id), [selectedNodes]);
  const canGroupSelectedNodes = selectedNodes.length > 1;
  const selectedGroupNodes = useMemo(() => nodes.filter((node) => node.selected && isNativeCanvasGroupNode(node)), [nodes]);
  const multiSelectionFrameNodeIds = useMemo(() => {
    const groupNodeIds = selectedGroupNodes
      .filter((node) => toolbarNodeId !== node.id)
      .map((node) => node.id);
    const nodeIds = [...selectedNodeIds, ...groupNodeIds];
    return nodeIds.length > 1 || groupNodeIds.length > 0 ? nodeIds : [];
  }, [selectedGroupNodes, selectedNodeIds, toolbarNodeId]);
  const multiSelectionDragging = selectedNodes.some((node) => node.dragging);

  const readOnlyRef = useRef(readOnly);
  const onSnapshotChangeRef = useRef(onSnapshotChange);
  readOnlyRef.current = readOnly;
  onSnapshotChangeRef.current = onSnapshotChange;
  const viewportMomentumRef = useRef<ViewportMomentumController | null>(null);
  if (!viewportMomentumRef.current) {
    viewportMomentumRef.current = new ViewportMomentumController({
      initialViewport: initialSnapshot.viewport,
      applyViewport: (viewport) => {
        viewportRef.current = viewport;
        void setViewport(viewport, { duration: 0 });
      },
      settleViewport: (viewport) => {
        viewportRef.current = viewport;
        if (!readOnlyRef.current) {
          onSnapshotChangeRef.current?.({ nodes: nodesRef.current, edges: edgesRef.current, viewport });
        }
      },
    });
  }
  const viewportMomentum = viewportMomentumRef.current;
  const stopViewportMomentum = useCallback(() => viewportMomentum.stop(), [viewportMomentum]);

  useEffect(() => () => viewportMomentum.dispose(), [viewportMomentum]);

  useEffect(() => resetInteractions, [resetInteractions]);
  useEffect(() => () => clearCanvasLaunching(canvasId), [canvasId, clearCanvasLaunching]);

  const clearEdgeToolbarHide = useCallback(() => {
    if (edgeToolbarHideTimerRef.current === null) return;
    window.clearTimeout(edgeToolbarHideTimerRef.current);
    edgeToolbarHideTimerRef.current = null;
  }, []);

  const scheduleEdgeToolbarHide = useCallback(() => {
    clearEdgeToolbarHide();
    edgeToolbarHideTimerRef.current = window.setTimeout(() => {
      edgeToolbarHideTimerRef.current = null;
      setEdgeToolbarPoint(null);
    }, 320);
  }, [clearEdgeToolbarHide]);

  const trackSelectedEdge = useCallback<EdgeMouseHandler<NativeCanvasEdge>>((event, edge) => {
    if (readOnly || !edge.selected) return;
    clearEdgeToolbarHide();
    pendingEdgePointerRef.current = { edgeId: edge.id, clientX: event.clientX, clientY: event.clientY };
    if (edgeToolbarFrameRef.current !== null) return;
    edgeToolbarFrameRef.current = window.requestAnimationFrame(() => {
      edgeToolbarFrameRef.current = null;
      const pending = pendingEdgePointerRef.current;
      if (!pending) return;
      const point = screenToFlowPosition({ x: pending.clientX, y: pending.clientY });
      setEdgeToolbarPoint({ edgeId: pending.edgeId, x: point.x, y: point.y });
    });
  }, [clearEdgeToolbarHide, readOnly, screenToFlowPosition]);

  const leaveSelectedEdge = useCallback<EdgeMouseHandler<NativeCanvasEdge>>((event) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Element && relatedTarget.closest(".rf-native-edge-toolbar")) {
      clearEdgeToolbarHide();
      return;
    }
    scheduleEdgeToolbarHide();
  }, [clearEdgeToolbarHide, scheduleEdgeToolbarHide]);

  useEffect(() => () => {
    clearEdgeToolbarHide();
    if (edgeToolbarFrameRef.current !== null) window.cancelAnimationFrame(edgeToolbarFrameRef.current);
  }, [clearEdgeToolbarHide]);

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
    stopViewportMomentum();
    beginSelectionGesture();
  }, [beginSelectionGesture, stopViewportMomentum]);

  const finishCanvasSelection = useCallback(() => {
    const currentNodes = getNodes();
    const expanded = expandNativeCanvasGroupSelection(currentNodes);
    if (expanded.nodes !== currentNodes) setNodes(expanded.nodes);
    endSelectionGesture(new Set(expanded.groupIds));
  }, [endSelectionGesture, getNodes, setNodes]);

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
    addNode(kind, contextPoint.flowX, contextPoint.flowY, kind === "annotation"
      ? { text: t("infiniteCanvas:annotationDefaultText") }
      : undefined);
    setContextPoint(null);
  }, [addNode, contextPoint, t]);

  const refreshCanvasClipboardStatus = useCallback(async () => {
    setCanvasClipboardAvailable(false);
    if (!window.easyTool?.getCanvasClipboardStatus) return;
    try {
      const status = await window.easyTool.getCanvasClipboardStatus();
      setCanvasClipboardAvailable(status.hasNodes || status.hasImage);
    } catch {
      setCanvasClipboardAvailable(false);
    }
  }, []);

  const pasteContextClipboard = useCallback(async () => {
    if (!contextPoint || !window.easyTool?.pasteCanvasClipboard) return;
    const pastePoint = { x: contextPoint.flowX, y: contextPoint.flowY };
    pendingContextPastePointRef.current = pastePoint;
    setContextPoint(null);
    try {
      await window.easyTool.pasteCanvasClipboard();
    } finally {
      window.setTimeout(() => {
        if (pendingContextPastePointRef.current === pastePoint) {
          pendingContextPastePointRef.current = null;
        }
      }, 1000);
    }
  }, [contextPoint]);

  const copyContextNode = useCallback(async () => {
    if (!contextNode) return;
    const allNodes = getNodes();
    const sourceNodes = prepareNativeCanvasNodesForClipboard(
      isNativeCanvasGroupNode(contextNode)
        ? collectNativeCanvasSubtree(contextNode.id, allNodes)
        : [contextNode],
      allNodes,
    );
    const serialized = JSON.stringify(createCanvasClipboardPayload(sourceNodes, getEdges()));
    await navigator.clipboard.writeText(serialized);
    pasteSequenceRef.current = null;
  }, [contextNode, getEdges, getNodes]);

  const copyContextNodeImage = useCallback(async () => {
    const imageUrl = contextNodeImage?.localUrl || contextNodeImage?.url;
    if (!imageUrl) return;
    try {
      await copyLibraryImage(imageUrl);
      toast.success(t("common:states.imageCopied"));
    } catch (error) {
      toast.error(t("common:errors.imageActionFailed", {
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [contextNodeImage, t]);

  const deleteContextNode = useCallback(() => {
    if (!contextNode) return;
    void deleteElements({ nodes: [{ id: contextNode.id }] });
  }, [contextNode, deleteElements]);

  const groupSelectedNodes = useCallback(() => {
    if (readOnly || selectedNodeIds.length < 2) return;
    setNodes((current) => {
      const selected = current.filter((node) => node.selected && !isNativeCanvasGroupNode(node));
      if (selected.length < 2) return current;
      const bounds = getFlowNodesBounds(selected);
      const padding = 28;
      const group = createNativeCanvasGroupNode(
        { x: bounds.x - padding, y: bounds.y - padding },
        { width: Math.max(260, bounds.width + padding * 2), height: Math.max(180, bounds.height + padding * 2) },
        t("infiniteCanvas:group"),
      );
      const selectedIds = new Set(selected.map((node) => node.id));
      return groupNativeCanvasNodes(current, selectedIds, group);
    });
  }, [getFlowNodesBounds, readOnly, selectedNodeIds.length, setNodes, t]);

  const deleteSelectedNodes = useCallback(() => {
    if (readOnly || !selectedNodeIds.length) return;
    const selectedIds = new Set(selectedNodeIds);
    const current = getNodes();
    current.filter(isNativeCanvasGroupNode).forEach((group) => {
      const children = current.filter((node) => node.parentId === group.id);
      if (children.length && children.every((node) => selectedIds.has(node.id))) selectedIds.add(group.id);
    });
    void deleteElements({ nodes: [...selectedIds].map((id) => ({ id })) });
  }, [deleteElements, getNodes, readOnly, selectedNodeIds]);

  const stopDeletedNodeTasks = useCallback((deletedNodes: NativeCanvasNode[]) => {
    if (!window.forartGenerationTasks?.stop) return;
    const taskIds = new Set<string>();
    deletedNodes.forEach((node) => {
      const nodeTaskId = nativeCanvasNodeTaskId(node.data);
      if (nodeTaskId) taskIds.add(nodeTaskId);
      normalizeActionFissionState(node.data.actionFission).rows.forEach((row) => {
        const rowTaskId = actionFissionRowTaskId(row);
        if (rowTaskId) taskIds.add(rowTaskId);
      });
    });
    void Promise.allSettled([...taskIds].map((taskId) => (
      Promise.resolve().then(() => window.forartGenerationTasks!.stop(taskId))
    )));
  }, []);

  const setNodeImage = useCallback((nodeId: string, imageUrl: string, fileName: string) => {
    const nodeKind = getNodes().find((node) => node.id === nodeId)?.data.kind;
    setNodes((current) => current.map((node) => node.id === nodeId
      ? {
        ...node,
        data: {
          ...node.data,
          ...(node.data.kind === "imageGenerator"
            ? {
                imageUrl: undefined,
                thumbUrl: undefined,
                generatedImages: [{
                  localUrl: imageUrl,
                  fileName,
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
        const stored = await window.easyTool.saveCanvasAsset({ dataUrl: imageUrl, defaultName: fileName, kind: "input" });
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
                      fileName: node.data.generatedImages?.[0]?.fileName || fileName,
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

  const cropNodeImage = useCallback(async (nodeId: string, crop: CanvasImageCropRect) => {
    const node = getNodes().find((item) => item.id === nodeId);
    const sourceUrl = node?.data.kind === "imageLoader" ? String(node.data.imageUrl || "") : "";
    if (!node || !sourceUrl) throw new Error(t("infiniteCanvas:imageCropSourceMissing"));
    if (!window.easyTool?.cropCanvasAsset) throw new Error(t("infiniteCanvas:imageCropUnavailable"));

    let localSourceUrl = sourceUrl;
    if (!/^forart-asset:/i.test(localSourceUrl)) {
      if (!window.easyTool.saveCanvasAsset) throw new Error(t("infiniteCanvas:imageCropUnavailable"));
      const stored = await window.easyTool.saveCanvasAsset({
        url: resolveLibraryImageUrl(localSourceUrl),
        defaultName: node.data.label || "canvas-image.png",
        kind: "input",
      });
      localSourceUrl = stored.url;
    }

    const result = await window.easyTool.cropCanvasAsset({
      url: localSourceUrl,
      ...crop,
      defaultName: node.data.label || "cropped-image.png",
    });
    const size = getImageNodeSize(result.width, result.height);
    setNodes((current) => current.map((item) => item.id === nodeId && item.data.kind === "imageLoader"
      ? {
          ...item,
          data: {
            ...item.data,
            imageUrl: result.url,
            thumbUrl: result.thumbUrl || undefined,
            imageNaturalWidth: result.width,
            imageNaturalHeight: result.height,
          },
          style: { ...item.style, ...size },
        }
      : item));
  }, [getNodes, setNodes, t]);

  const patchNodeData = useCallback((nodeId: string, patch: Partial<NativeCanvasNode["data"]>) => {
    setNodes((current) => current.map((node) => node.id === nodeId
      ? applyNativeNodeDataPatch(node, patch)
      : node));
  }, [setNodes]);

  const patchActionFissionRow = useCallback((nodeId: string, rowId: string, patch: Partial<ActionFissionRow>) => {
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId || node.data.kind !== "actionFission") return node;
      const actionFission = normalizeActionFissionState(node.data.actionFission);
      const nextRows = actionFission.rows.map((row) => {
        if (row.id !== rowId) return row;
        const next = { ...row, ...patch } as ActionFissionRow & Record<string, unknown>;
        return next;
      });
      return {
        ...node,
        data: {
          ...node.data,
          actionFission: {
            ...actionFission,
            rows: nextRows,
          },
        },
      };
    }));
  }, [setNodes]);

  const {
    runImageGeneration: runApiImageGeneration,
    stopImageGeneration: stopApiImageGeneration,
  } = useNativeImageGeneration({
    canvasId,
    edges,
    nodes,
    patchNodeData,
    t,
  });
  const { runLibtvGeneration, stopLibtvGeneration } = useNativeLibtvGeneration({
    canvasId,
    edges,
    nodes,
    patchNodeData,
    t,
  });
  const { runActionFission, stopActionFission: stopActionFissionImmediately } = useNativeActionFissionGeneration({
    canvasId,
    edges,
    nodes,
    patchRow: patchActionFissionRow,
    t,
  });
  const runImageGeneration = useCallback(async (nodeId: string, options?: ImageGenerationRunOptions) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (node?.data.imageGenerationBackend === "libtv") await runLibtvGeneration(nodeId, options);
    else await runApiImageGeneration(nodeId, options);
  }, [nodes, runApiImageGeneration, runLibtvGeneration]);
  const stopImageGenerationTaskImmediately = useCallback(async (nodeId: string, taskId: string, executorKind: "api" | "libtv") => {
    if (executorKind === "libtv") await stopLibtvGeneration(nodeId, taskId);
    else await stopApiImageGeneration(nodeId, taskId);
  }, [stopApiImageGeneration, stopLibtvGeneration]);

  const stopImageGeneration = useCallback(async (nodeId: string) => {
    const data = nodes.find((item) => item.id === nodeId)?.data;
    const taskId = data ? nativeCanvasNodeTaskId(data) : "";
    if (!taskId) return;
    const [task] = await loadGenerationTasks([taskId]);
    if (!isGenerationTaskActive(task)) return;
    if (requiresGenerationStopConfirmation(task)) {
      setPendingGenerationStop({ kind: "imageGenerator", nodeId, taskIds: [task.id] });
      return;
    }
    await stopImageGenerationTaskImmediately(nodeId, task.id, task.executorKind);
  }, [nodes, stopImageGenerationTaskImmediately]);

  const stopActionFission = useCallback(async (nodeId: string, rowId?: string) => {
    await stopActionFissionImmediately(nodeId, rowId, []);
    const rows = nodes.find((item) => item.id === nodeId)?.data.actionFission?.rows || [];
    const taskIds = (rowId ? rows.filter((row) => row.id === rowId) : rows)
      .map(actionFissionRowTaskId)
      .filter(Boolean);
    const tasks = await loadGenerationTasks(taskIds);
    const { safeTasks, confirmationTasks } = partitionGenerationStopTasks(tasks);
    if (safeTasks.length) {
      await stopActionFissionImmediately(nodeId, rowId, safeTasks.map((task) => task.id));
    }
    if (confirmationTasks.length) {
      setPendingGenerationStop({
        kind: "actionFission",
        nodeId,
        rowId,
        taskIds: confirmationTasks.map((task) => task.id),
      });
    }
  }, [nodes, stopActionFissionImmediately]);

  const confirmGenerationStop = useCallback(async () => {
    if (!pendingGenerationStop || generationStopPending) return;
    setGenerationStopPending(true);
    try {
      const tasks = await loadGenerationTasks(pendingGenerationStop.taskIds);
      const activeTasks = tasks.filter(isGenerationTaskActive);
      if (pendingGenerationStop.kind === "imageGenerator") {
        await Promise.all(activeTasks.map((task) => (
          stopImageGenerationTaskImmediately(pendingGenerationStop.nodeId, task.id, task.executorKind)
        )));
      } else if (activeTasks.length) {
        await stopActionFissionImmediately(
          pendingGenerationStop.nodeId,
          pendingGenerationStop.rowId,
          activeTasks.map((task) => task.id),
        );
      }
      setPendingGenerationStop(null);
    } finally {
      setGenerationStopPending(false);
    }
  }, [generationStopPending, pendingGenerationStop, stopActionFissionImmediately, stopImageGenerationTaskImmediately]);

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

  const downloadNodeImage = useCallback(async (nodeId: string, imageIndex: number) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    if (node.data.kind === "imageLoader") {
      const image = nativeCanvasNodePrimaryImage(node.data);
      const imageUrl = String(image?.localUrl || image?.url || "");
      if (!image || !imageUrl) return;
      await saveGeneratedImage(imageUrl, buildGenerationDownloadName({
        platform: "Forart",
        model: "Local",
        sourceFileName: image.fileName,
        sourceUrl: imageUrl,
      }));
      return;
    }

    const images = node?.data.generatedImages || [];
    const image = images[imageIndex];
    const imageUrl = String(image?.localUrl || image?.url || "");
    if (!image || !imageUrl) return;
    const taskId = nativeCanvasNodeTaskId(node.data);
    const [task] = taskId ? await loadGenerationTasks([taskId]) : [];
    const apiSettings = task?.executorKind === "libtv" || node.data.imageGenerationBackend === "libtv"
      ? null
      : await loadApiSettings();
    const provider = apiSettings?.providers.find((item) => item.id === (task?.providerId || node.data.imageProviderId));
    await saveGeneratedImage(imageUrl, task
      ? buildTaskDownloadName(task, image.fileName, imageUrl)
      : buildGenerationDownloadName({
        platform: node.data.imageGenerationBackend === "libtv" ? "LibTV" : provider?.name || node.data.imageProviderId,
        model: node.data.imageGenerationBackend === "libtv"
          ? node.data.libtvImageGeneration?.modelName
          : node.data.imageModel,
        sourceFileName: image.fileName,
        sourceUrl: imageUrl,
      }));
    patchNodeData(nodeId, {
      generatedImages: images.map((item, index) => index === imageIndex
        ? { ...item, downloadState: "downloaded", downloadedAt: Date.now() }
        : item),
      });
  }, [nodes, patchNodeData, saveGeneratedImage]);

  const downloadContextNodeImage = useCallback(async () => {
    if (!contextNodeImage || !contextNode) return;
    await downloadNodeImage(contextNode.id, 0);
  }, [contextNode, contextNodeImage, downloadNodeImage]);

  const downloadActionFissionResult = useCallback(async (nodeId: string, rowId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    const actionFission = node?.data.actionFission;
    const row = actionFission?.rows.find((item) => item.id === rowId);
    const imageUrl = String(row?.resultUrl || "");
    if (!row || !imageUrl) return;
    const taskId = actionFissionRowTaskId(row);
    const [task] = taskId ? await loadGenerationTasks([taskId]) : [];
    const apiSettings = task?.executorKind === "libtv" || actionFission?.apiType === "libtv-api"
      ? null
      : await loadApiSettings();
    const provider = apiSettings?.providers.find((item) => item.id === (task?.providerId || actionFission?.providerId));
    await saveGeneratedImage(imageUrl, task
      ? buildTaskDownloadName(task, row.resultFileName, imageUrl)
      : buildGenerationDownloadName({
        platform: actionFission?.apiType === "libtv-api" ? "LibTV" : provider?.name || actionFission?.providerId,
        model: actionFission?.apiType === "libtv-api" ? actionFission?.libtvModelName : actionFission?.model,
        sourceFileName: row.resultFileName,
        sourceUrl: imageUrl,
      }));
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
      imageUrl: selection.url,
    });
    setNodeImage(node.id, selection.url, selection.name || t("infiniteCanvas:imageNode"));
  }, [addNode, addReferenceImage, libraryReferenceTargetNodeId, libraryTargetNodeId, screenToFlowPosition, setNodeImage, t]);

  const canvasActionHandlersRef = useRef({
    addImageReferenceFiles,
    downloadActionFissionResult,
    downloadNodeImage,
    discardActionFissionRow: stopActionFissionImmediately,
    runImageGeneration,
    runActionFission,
    stopImageGeneration,
    stopActionFission,
  });
  canvasActionHandlersRef.current = {
    addImageReferenceFiles,
    downloadActionFissionResult,
    downloadNodeImage,
    discardActionFissionRow: stopActionFissionImmediately,
    runImageGeneration,
    runActionFission,
    stopImageGeneration,
    stopActionFission,
  };

  const canvasActions = useMemo<NativeCanvasActions>(() => ({
    readOnly,
    addImageReferenceFiles: (nodeId, files) => canvasActionHandlersRef.current.addImageReferenceFiles(nodeId, files),
    cropNodeImage,
    downloadActionFissionResult: (nodeId, rowId) => canvasActionHandlersRef.current.downloadActionFissionResult(nodeId, rowId),
    downloadNodeImage: (nodeId, imageIndex) => canvasActionHandlersRef.current.downloadNodeImage(nodeId, imageIndex),
    discardActionFissionRow: (nodeId, rowId) => canvasActionHandlersRef.current.discardActionFissionRow(nodeId, rowId),
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
          ? { ...edge, data: { ...edge.data, referenceOrder: orderById.get(edge.id) } }
          : edge
      )));
    },
    runImageGeneration: (nodeId, options) => canvasActionHandlersRef.current.runImageGeneration(nodeId, options),
    runActionFission: (nodeId, rowId) => canvasActionHandlersRef.current.runActionFission(nodeId, rowId),
    setNodeImage,
    setNodeText: (nodeId: string, text: string) => patchNodeData(nodeId, { text }),
    stopImageGeneration: (nodeId) => canvasActionHandlersRef.current.stopImageGeneration(nodeId),
    stopActionFission: (nodeId, rowId) => canvasActionHandlersRef.current.stopActionFission(nodeId, rowId),
  }), [cropNodeImage, patchNodeData, readOnly, setEdges, setNodeImage, t]);

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
      const data = edgeDataForConnection(
        source.data.kind,
        target.data.kind,
        target.id,
        current,
        connection.targetHandle,
      );
      if ((target.data.kind === "imageGenerator" || target.data.kind === "actionFission") && !data) return current;
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

  const addImageFilesAtFlowPoint = useCallback(async (
    files: File[],
    flowPoint: { x: number; y: number },
  ) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
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
      });
      return { ...node, style: size, selected: true };
    }));
    setNodes((current) => [
      ...current.map((node) => node.selected ? { ...node, selected: false } : node),
      ...imageNodes,
    ]);
  }, [setNodes, t]);

  const addImageFilesAtClientPoint = useCallback((
    files: File[],
    clientPoint: { x: number; y: number },
  ) => addImageFilesAtFlowPoint(files, screenToFlowPosition(clientPoint)), [addImageFilesAtFlowPoint, screenToFlowPosition]);

  useEffect(() => {
    function isCanvasAvailable() {
      const canvasElement = wrapperRef.current;
      return Boolean(canvasElement && window.getComputedStyle(canvasElement).visibility === "visible");
    }

    function handleCopy(event: ClipboardEvent) {
      if (readOnly || !isCanvasAvailable() || isEditingTarget(event.target)) return;
      const allNodes = getNodes();
      const selectedNodes = allNodes.filter((node) => node.selected);
      if (!selectedNodes.length) return;
      const selectedIds = new Set(selectedNodes.map((node) => node.id));
      const copiedIds = new Set<string>();
      selectedNodes.forEach((node) => {
        if (isNativeCanvasGroupNode(node)) {
          collectNativeCanvasSubtree(node.id, allNodes).forEach((item) => copiedIds.add(item.id));
        } else {
          copiedIds.add(node.id);
        }
      });
      selectedNodes.forEach((node) => {
        if (!node.parentId || copiedIds.has(node.parentId)) return;
        const siblings = allNodes.filter((item) => item.parentId === node.parentId);
        if (!siblings.length || !siblings.every((item) => selectedIds.has(item.id))) return;
        collectNativeCanvasSubtree(node.parentId, allNodes).forEach((item) => copiedIds.add(item.id));
      });
      const copiedNodes = allNodes.filter((node) => copiedIds.has(node.id));
      const payload = createCanvasClipboardPayload(
        prepareNativeCanvasNodesForClipboard(copiedNodes, allNodes),
        getEdges(),
      );
      const serialized = JSON.stringify(payload);
      event.clipboardData?.setData(CANVAS_CLIPBOARD_MIME, serialized);
      event.clipboardData?.setData("text/plain", serialized);
      event.preventDefault();
      pasteSequenceRef.current = null;
    }

    function handlePaste(event: ClipboardEvent) {
      if (readOnly || !isCanvasAvailable() || isEditingTarget(event.target)) return;
      const contextPastePoint = pendingContextPastePointRef.current;
      pendingContextPastePointRef.current = null;
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
        const sourceRoots = payload.nodes.filter((node) => !node.parentId);
        const sourceBounds = getNodesBounds(sourceRoots);
        const targetCenter = contextPastePoint || screenToFlowPosition({
          x: pointer.x + cascadeOffset,
          y: pointer.y + cascadeOffset,
        });
        const deltaX = targetCenter.x - (sourceBounds.x + sourceBounds.width / 2);
        const deltaY = targetCenter.y - (sourceBounds.y + sourceBounds.height / 2);
        const pasted = instantiateCanvasClipboardPayload(payload, { x: deltaX, y: deltaY }, true);

        setNodes((current) => [
          ...current.map((node) => node.selected ? { ...node, selected: false } : node),
          ...pasted.nodes,
        ]);
        setEdges((current) => [
          ...current.map((edge) => edge.selected ? { ...edge, selected: false } : edge),
          ...pasted.edges,
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
      if (contextPastePoint) {
        void addImageFilesAtFlowPoint(imageFiles, contextPastePoint);
      } else {
        void addImageFilesAtClientPoint(imageFiles, clientPoint);
      }
    }

    window.addEventListener("copy", handleCopy);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("copy", handleCopy);
      window.removeEventListener("paste", handlePaste);
    };
  }, [addImageFilesAtClientPoint, addImageFilesAtFlowPoint, getEdges, getNodes, readOnly, screenToFlowPosition, setEdges, setNodes, t]);

  const handleNodeDragStart = useCallback<OnNodeDrag<NativeCanvasNode>>((event, draggedNode, draggedNodes) => {
    if (readOnly) return;
    stopViewportMomentum();
    historyGestureRef.current = beginInfiniteCanvasHistoryGesture();
    altDragCloneGestureRef.current = null;
    const historyNodeById = new Map(
      (historyGestureRef.current?.nodes || []).map((node) => [node.id, node]),
    );
    const reactFlowDraggedIds = new Set([draggedNode.id, ...draggedNodes.map((node) => node.id)]);
    const currentNodes = getNodes();
    const draggedIds = new Set(reactFlowDraggedIds);
    const isAltDrag = "altKey" in event && event.altKey;
    if (isAltDrag) {
      // Copy an entire native parent subtree when Alt-drag starts on a child.
      [...reactFlowDraggedIds].forEach((nodeId) => {
        const node = currentNodes.find((item) => item.id === nodeId);
        const parentId = node?.parentId;
        if (parentId) {
          draggedIds.add(parentId);
          currentNodes.forEach((item) => { if (item.parentId === parentId) draggedIds.add(item.id); });
        }
        if (node && isNativeCanvasGroupNode(node)) {
          currentNodes.forEach((item) => { if (item.parentId === nodeId) draggedIds.add(item.id); });
        }
      });
    }
    const sourceNodes = currentNodes
      .filter((node) => draggedIds.has(node.id))
      .sort((left, right) => Number(Boolean(left.parentId)) - Number(Boolean(right.parentId)));
    const sourceNodesAtDragStart = sourceNodes.map((node) => {
      const historyNode = historyNodeById.get(node.id);
      return historyNode ? { ...node, position: { ...historyNode.position } } : node;
    });
    const cloned = isAltDrag && sourceNodesAtDragStart.length
      ? instantiateCanvasClipboardPayload(
          createCanvasClipboardPayload(sourceNodesAtDragStart, getEdges()),
          { x: 0, y: 0 },
          false,
        )
      : null;

    if (cloned) {
      const cloneZIndex = Math.max(
        0,
        ...sourceNodes.map((node) => node.zIndex || 0),
        ...getNodes().map((node) => node.zIndex || 0),
      ) + 1;
      altDragCloneGestureRef.current = {
        cloneIdBySourceId: cloned.idMap,
        cloneZIndex,
        clonedEdges: cloned.edges,
        sourceNodes: sourceNodesAtDragStart.map((node) => ({
          id: node.id,
          position: { ...node.position },
          zIndex: node.zIndex,
        })),
      };
      pasteSequenceRef.current = null;
    }

    setNodes((current) => {
      const nextZIndex = Math.max(0, ...current.map((node) => node.zIndex || 0)) + 1;
      if (!cloned || !altDragCloneGestureRef.current) {
        return current.map((node) => draggedIds.has(node.id)
          ? { ...node, zIndex: nextZIndex, selected: node.selected }
          : node);
      }
      const prepared = [
        ...current.map((node) => node.selected && !draggedIds.has(node.id) ? { ...node, selected: false } : node),
        ...cloned.nodes,
      ];
      return projectAltDragOntoClones(
        prepared,
        altDragCloneGestureRef.current,
        sourceNodesAtDragStart.map((node) => ({ ...node, zIndex: nextZIndex })),
        true,
      );
    });
    if (cloned) syncSelection([...cloned.idMap.values()]);
  }, [getEdges, getNodes, readOnly, setNodes, stopViewportMomentum, syncSelection]);

  const handleNodeDrag = useCallback<OnNodeDrag<NativeCanvasNode>>((_event, draggedNode, draggedNodes) => {
    const cloneGesture = altDragCloneGestureRef.current;
    if (readOnly || !cloneGesture) return;
    setNodes((current) => {
      return projectAltDragOntoClones(current, cloneGesture, [draggedNode, ...draggedNodes], true);
    });
  }, [readOnly, setNodes]);

  const handleNodeDragStop = useCallback<OnNodeDrag<NativeCanvasNode>>((_event, draggedNode, draggedNodes) => {
    if (readOnly) return;
    const cloneGesture = altDragCloneGestureRef.current;
    altDragCloneGestureRef.current = null;

    if (cloneGesture) {
      const currentNodes = getNodes();
      const currentEdges = getEdges();
      const cloneIds = new Set(cloneGesture.cloneIdBySourceId.values());
      const projectedNodes = projectAltDragOntoClones(
        currentNodes,
        cloneGesture,
        [draggedNode, ...draggedNodes],
        false,
      );
      const finalNodes = projectedNodes.map((node) => (
        node.selected && !cloneIds.has(node.id) ? { ...node, selected: false } : node
      ));
      const finalEdges = [
        ...currentEdges.map((edge) => edge.selected ? { ...edge, selected: false } : edge),
        ...cloneGesture.clonedEdges,
      ];

      setNodes(finalNodes);
      setEdges(finalEdges);
      syncSelection([...cloneIds]);
      recordInfiniteCanvasHistory(finalNodes, finalEdges);
      commitInfiniteCanvasHistoryGesture(historyGestureRef.current);
      historyGestureRef.current = null;
      return;
    }

    const currentNodes = getNodes();
    const draggedIds = new Set([draggedNode.id, ...draggedNodes.map((node) => node.id)]);
    const finalNodes = detachNativeCanvasChildrenOutsideParents(currentNodes, draggedIds);
    if (finalNodes !== currentNodes) setNodes(finalNodes);
    recordInfiniteCanvasHistory(finalNodes, getEdges());
    commitInfiniteCanvasHistoryGesture(historyGestureRef.current);
    historyGestureRef.current = null;
  }, [getEdges, getNodes, readOnly, setEdges, setNodes, syncSelection]);

  return (
    <div ref={wrapperRef} className={`rf-native-canvas${readOnly ? " rf-native-canvas--readonly" : ""}`}>
      <NativeCanvasActionsContext.Provider value={canvasActions}>
        <ContextMenu onOpenChange={(open) => {
          if (open) void refreshCanvasClipboardStatus();
        }}>
        <ContextMenuTrigger asChild disabled={readOnly}>
          <div
            className="rf-native-flow-surface"
            onPointerDown={stopViewportMomentum}
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
              if (event.target instanceof Element && event.target.closest(".react-flow__node")) return;
              const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
              setNodeContextTarget(null);
              setContextPoint({ flowX: point.x, flowY: point.y });
            }}
          >
            <ReactFlow<NativeCanvasNode, NativeCanvasEdge>
              nodes={nodes}
              edges={flowEdges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onNodesDelete={readOnly ? undefined : stopDeletedNodeTasks}
              onEdgesChange={onEdgesChange}
              onSelectionChange={({ nodes: selectedNodes, edges: selectedEdges }) => {
                syncSelection(selectedNodes.map((node) => node.id));
                setEdgeToolbarPoint((current) => current && selectedEdges.some((edge) => edge.id === current.edgeId) ? current : null);
              }}
              onEdgeMouseMove={trackSelectedEdge}
              onEdgeMouseLeave={leaveSelectedEdge}
              onConnect={readOnly ? undefined : connectNodes}
              onConnectEnd={readOnly ? undefined : connectToNodeBody}
              onSelectionStart={beginCanvasSelection}
              onSelectionEnd={finishCanvasSelection}
              onMoveStart={(event, viewport) => {
                if (!event && viewportMomentum.isInternalViewport(viewport)) return;
                viewportRef.current = viewport;
                if (!event) {
                  viewportMomentum.stop();
                  viewportMomentum.syncViewport(viewport);
                  return;
                }
                viewportMomentum.beginUserMove(viewport);
              }}
              onMove={(event, viewport) => {
                if (!event && viewportMomentum.isInternalViewport(viewport)) return;
                viewportRef.current = viewport;
                if (!event) {
                  viewportMomentum.syncViewport(viewport);
                  return;
                }
                viewportMomentum.updateUserMove(viewport);
              }}
              onMoveEnd={(event, viewport) => {
                if (!event && viewportMomentum.isInternalViewport(viewport)) return;
                viewportRef.current = viewport;
                if (!event) {
                  viewportMomentum.syncViewport(viewport);
                  if (!readOnly) onSnapshotChange?.({ nodes: nodesRef.current, edges: edgesRef.current, viewport });
                  return;
                }
                viewportMomentum.endUserMove(viewport);
              }}
              onNodeDragStart={handleNodeDragStart}
              onNodeDrag={handleNodeDrag}
              onNodeDragStop={handleNodeDragStop}
              onNodeContextMenu={(_event, node) => {
                if (readOnly) return;
                setContextPoint(null);
                setNodeContextTarget({ node });
              }}
              minZoom={0.1}
              maxZoom={6}
              nodeClickDistance={NODE_POINTER_GESTURE_THRESHOLD}
              nodeDragThreshold={NODE_POINTER_GESTURE_THRESHOLD}
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
              {!readOnly && selectedNodeIds.length > 1 && !selectedGroupNodes.length ? (
                <NodeToolbar
                  nodeId={selectedNodeIds}
                  isVisible={!multiSelectionDragging && !selectionGestureActive}
                  position={Position.Top}
                  offset={18}
                  className="rf-native-multi-selection-toolbar nodrag nopan nowheel"
                >
                  <span className="rf-native-multi-selection-count">
                    {t("infiniteCanvas:selectedNodeCount", { count: selectedNodeIds.length })}
                  </span>
                  <Button type="button" variant="ghost" size="sm" disabled={!canGroupSelectedNodes} onClick={groupSelectedNodes}>
                    <GroupIcon aria-hidden="true" />
                    <span>{t("infiniteCanvas:groupSelectedNodes")}</span>
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={deleteSelectedNodes}>
                    <Trash2 aria-hidden="true" />
                    <span>{t("infiniteCanvas:deleteSelectedNodes")}</span>
                  </Button>
                </NodeToolbar>
              ) : null}
              {minimapOpen ? <MiniMap className="rf-native-minimap" position="bottom-left" pannable zoomable ariaLabel={t("infiniteCanvas:minimap")} /> : null}
              {edgeToolbarPoint ? (
                <EdgeToolbar
                  edgeId={edgeToolbarPoint.edgeId}
                  x={edgeToolbarPoint.x}
                  y={edgeToolbarPoint.y}
                  isVisible
                  alignX="center"
                  alignY="center"
                  className="rf-native-edge-toolbar nodrag nopan"
                  onMouseEnter={clearEdgeToolbarHide}
                  onMouseLeave={scheduleEdgeToolbarHide}
                >
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-xs"
                    aria-label={t("common:actions.delete")}
                    title={t("common:actions.delete")}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      const edgeId = edgeToolbarPoint.edgeId;
                      setEdgeToolbarPoint(null);
                      void deleteElements({ edges: [{ id: edgeId }] });
                    }}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </EdgeToolbar>
              ) : null}
            </ReactFlow>
            <NativeCanvasMultiSelectionFrame
              nodeIds={multiSelectionFrameNodeIds}
              visible={!selectionGestureActive}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            {contextNode ? <>
              <ContextMenuItem onSelect={() => void copyContextNode()}>
                <Copy aria-hidden="true" />
                <span>{t("common:actions.copyNode")}</span>
              </ContextMenuItem>
              {contextNode.data.kind === "imageLoader" || contextNode.data.kind === "imageGenerator" ? (
                <>
                  <ContextMenuItem disabled={!contextNodeImage} onSelect={() => void copyContextNodeImage()}>
                    <Image aria-hidden="true" />
                    <span>{t("common:actions.copyImage")}</span>
                  </ContextMenuItem>
                  <ContextMenuItem disabled={!contextNodeImage} onSelect={() => void downloadContextNodeImage()}>
                    <Download aria-hidden="true" />
                    <span>{t("infiniteCanvas:downloadImage")}</span>
                  </ContextMenuItem>
                </>
              ) : null}
              <ContextMenuItem variant="destructive" onSelect={deleteContextNode}>
                <Trash2 aria-hidden="true" />
                <span>{t("common:actions.delete")}</span>
              </ContextMenuItem>
            </> : <>
              <ContextMenuItem disabled={!canvasClipboardAvailable} onSelect={() => void pasteContextClipboard()}>
                <ClipboardPaste aria-hidden="true" />
                <span>{t("common:actions.paste")}</span>
              </ContextMenuItem>
              <ContextMenuSeparator className="mx-2" />
              {CONTEXT_CANVAS_NODE_GROUPS.map((group, groupIndex) => (
                <ContextMenuGroup key={groupIndex}>
                  {group.map((kind) => {
                    const definition = NATIVE_CANVAS_NODE_DEFINITIONS[kind];
                    const Icon = definition.icon;
                    return (
                      <ContextMenuItem key={kind} className="rf-native-context-item" onSelect={() => addContextNode(kind)}>
                        <Icon aria-hidden="true" />
                        <span>{t(`infiniteCanvas:${definition.labelKey}`)}</span>
                      </ContextMenuItem>
                    );
                  })}
                  {groupIndex < CONTEXT_CANVAS_NODE_GROUPS.length - 1 ? <ContextMenuSeparator className="mx-2" /> : null}
                </ContextMenuGroup>
              ))}
            </>}
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
          onApply={(groups, selection) => {
            if (!actionFissionSettingsTarget) return;
            setNodes((current) => current.map((node) => {
              if (node.id !== actionFissionSettingsTarget.nodeId) return node;
              const actionFission = configureActionFissionRow(
                normalizeActionFissionState(node.data.actionFission),
                actionFissionSettingsTarget.rowId,
                groups,
                selection,
              );
              return { ...node, data: { ...node.data, actionFission } };
            }));
          }}
        /> : null}

        <AlertDialog
          open={Boolean(pendingGenerationStop)}
          onOpenChange={(open) => {
            if (!open && !generationStopPending) setPendingGenerationStop(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("infiniteCanvas:stopGenerationConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingGenerationStop?.kind === "actionFission"
                  ? t("infiniteCanvas:stopActionFissionConfirmDescription", { count: pendingGenerationStop.taskIds.length })
                  : t("infiniteCanvas:stopGenerationConfirmDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={generationStopPending}>
                {t("common:actions.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={generationStopPending}
                onClick={(event) => {
                  event.preventDefault();
                  void confirmGenerationStop();
                }}
              >
                {t("common:actions.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Button
          type="button"
          variant="ghost"
          className={`rf-canvas-save-status rf-canvas-save-status--${saveStatus}`}
          disabled={!onSave || saveStatus === "saving"}
          aria-label={t("infiniteCanvas:saveCanvas")}
          aria-live="polite"
          aria-atomic="true"
          title={t("infiniteCanvas:saveCanvas")}
          onClick={() => void onSave?.()}
        >
          <span className="rf-canvas-save-status__dot" aria-hidden="true" />
          <span>{t(SAVE_STATUS_LABEL_KEYS[saveStatus])}</span>
        </Button>

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
        onToggleMinimap={() => updateSettings((current) => ({ ...current, minimapOpen: !current.minimapOpen }))}
        onToggleSnapToGrid={() => updateSettings((current) => ({ ...current, snapToGrid: !current.snapToGrid }))}
        onToggleConnections={() => {
          if (connectionsVisible) {
            setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
            setEdgeToolbarPoint(null);
          }
          updateSettings((current) => ({ ...current, connectionsVisible: !current.connectionsVisible }));
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
  onSave?: () => void | Promise<void>;
  readOnly?: boolean;
  saveStatus: CanvasSaveStatus;
}

function createCanvasClipboardPayload(
  sourceNodes: NativeCanvasNode[],
  edges: NativeCanvasEdge[],
): CanvasClipboardPayload {
  const sourceIds = new Set(sourceNodes.map((node) => node.id));
  return {
    kind: CANVAS_CLIPBOARD_KIND,
    version: 1,
    nodes: sourceNodes.map((node) => ({
      ...node,
      data: cloneNativeCanvasNodeData(node.data),
      position: { ...node.position },
      selected: false,
      dragging: false,
    })),
    edges: edges
      .filter((edge) => sourceIds.has(edge.source) && sourceIds.has(edge.target))
      .map((edge) => ({ ...edge, data: edge.data ? { ...edge.data } : undefined, selected: false })),
  };
}

function instantiateCanvasClipboardPayload(
  payload: CanvasClipboardPayload,
  delta: { x: number; y: number },
  selected: boolean,
) {
  const idMap = new Map(payload.nodes.map((node) => [node.id, `${node.data.kind}_${crypto.randomUUID()}`]));
  return {
    idMap,
    nodes: payload.nodes.map((node) => {
      const clonedParentId = node.parentId ? idMap.get(node.parentId) : undefined;
      const data = cloneNativeCanvasNodeData(node.data);
      delete data.groupId;
      return {
        ...node,
        id: idMap.get(node.id)!,
        parentId: clonedParentId,
        extent: undefined,
        expandParent: undefined,
        data,
        position: clonedParentId
          ? { ...node.position }
          : { x: node.position.x + delta.x, y: node.position.y + delta.y },
        selected,
        dragging: false,
      };
    }),
    edges: payload.edges.map((edge) => ({
      ...edge,
      id: `edge_${crypto.randomUUID()}`,
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
      data: edge.data ? { ...edge.data } : undefined,
      selected: false,
    })),
  };
}

export function ReactFlowCanvasPage({ canvasId, imageDownloadPath, initialSnapshot = emptyCanvasSnapshot(), onSnapshotChange, onSave, readOnly = false, saveStatus }: ReactFlowCanvasPageProps) {
  const { t } = useTranslation();
  return (
    <section className="infinite-canvas-page" aria-label={t("infiniteCanvas:title")}>
      <ReactFlowProvider>
        <NativeCanvasSurface canvasId={canvasId} imageDownloadPath={imageDownloadPath} initialSnapshot={initialSnapshot} onSnapshotChange={onSnapshotChange} onSave={onSave} readOnly={readOnly} saveStatus={saveStatus} />
      </ReactFlowProvider>
    </section>
  );
}

export default ReactFlowCanvasPage;
