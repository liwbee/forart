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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { CanvasSaveStatusIndicator } from "./components/CanvasSaveStatusIndicator";
import { applyNativeNodeDataPatch } from "./applyNativeNodeDataPatch";
import { applyCanvasNodeThumbnail, collectMissingCanvasThumbnailTargets } from "./canvasThumbnails";
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
import { configureActionFissionRow, createDefaultActionFissionState, normalizeActionFissionState } from "./action-fission/actionFissionState";
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
import { actionFissionDownloadTarget } from "./generation/generationDownloadTarget";
import { loadApiSettings } from "../settings/apiProviders";
import {
  beginInfiniteCanvasHistoryGesture,
  commitInfiniteCanvasHistoryGesture,
  recordInfiniteCanvasHistory,
  rebaseInfiniteCanvasHistoryNode,
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

function stopCanvasNodeGenerationTasks(deletedNodes: NativeCanvasNode[]) {
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
}

const HISTORY_REBASED_NODE_DATA_FIELDS: (keyof NativeCanvasNode["data"])[] = [
  "latestGenerationTaskId",
  "generatedImages",
  "multiImageExpanded",
  "multiImageCollapsedSize",
  "thumbUrl",
  "imageNaturalWidth",
  "imageNaturalHeight",
];

const ACTION_FISSION_SELECTION_FIELDS = [
  "selectedCategoryGroupId",
  "selectedActionId",
  "selectedActionName",
  "selectedActionPrompt",
  "selectedActionTags",
  "selectedActionAssetUrl",
  "selectedActionThumbUrl",
] as const;

function sameActionFissionConfiguration(left: ActionFissionRow, right: ActionFissionRow) {
  return JSON.stringify(left.categoryGroups || []) === JSON.stringify(right.categoryGroups || []);
}

function applyRuntimeNodeDataPatch(
  node: NativeCanvasNode,
  patch: Partial<NativeCanvasNode["data"]>,
) {
  const patchRecord = patch as Record<string, unknown>;
  const runtimePatch: Record<string, unknown> = {};
  HISTORY_REBASED_NODE_DATA_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) runtimePatch[field] = patchRecord[field];
  });
  let next = Object.keys(runtimePatch).length
    ? applyNativeNodeDataPatch(node, runtimePatch as Partial<NativeCanvasNode["data"]>)
    : node;
  const libtvPatch = patch.libtvImageGeneration as Record<string, unknown> | undefined;
  if (libtvPatch && Object.prototype.hasOwnProperty.call(libtvPatch, "error")) {
    const libtvImageGeneration = {
      ...(next.data.libtvImageGeneration as Record<string, unknown> | undefined),
      error: libtvPatch.error,
    };
    next = {
      ...next,
      data: {
        ...next.data,
        libtvImageGeneration: libtvImageGeneration as NativeCanvasNode["data"]["libtvImageGeneration"],
      },
    };
  }
  return next;
}

function NativeCanvasSurface({ canvasId, imageDownloadPath, initialSnapshot, onInteractionChange, onSnapshotChange, onViewportChange, onSave, readOnly }: {
  canvasId: string;
  imageDownloadPath?: string;
  initialSnapshot: NativeCanvasSnapshot;
  onInteractionChange?: (active: boolean) => void;
  onSnapshotChange?: (snapshot: NativeCanvasSnapshot) => void;
  onViewportChange?: (viewport: NativeCanvasSnapshot["viewport"]) => void;
  onSave?: () => void | Promise<void>;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useInfiniteCanvasSettings();
  const { connectionsVisible, minimapOpen, snapToGrid } = settings;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<NativeCanvasNode>(initialSnapshot.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<NativeCanvasEdge>(initialSnapshot.edges);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const imageThumbnailAttemptsRef = useRef(new Set<string>());
  const imageThumbnailMountedRef = useRef(true);
  const imageMutationVersionRef = useRef(new Map<string, number>());
  nodesRef.current = nodes;
  edgesRef.current = edges;

  useEffect(() => {
    imageThumbnailMountedRef.current = true;
    return () => {
      imageThumbnailMountedRef.current = false;
    };
  }, []);
  const flowEdges = useMemo(
    () => edges.map((edge) => edge.hidden === !connectionsVisible
      ? edge
      : { ...edge, hidden: !connectionsVisible }),
    [connectionsVisible, edges],
  );
  const viewportRef = useRef(initialSnapshot.viewport);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
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
  const historyGestureDepthRef = useRef(0);
  const activeCanvasInteractionsRef = useRef(new Set<string>());
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

  const setCanvasInteraction = useCallback((kind: string, active: boolean) => {
    const interactions = activeCanvasInteractionsRef.current;
    const wasActive = interactions.size > 0;
    if (active) interactions.add(kind);
    else interactions.delete(kind);
    const isActive = interactions.size > 0;
    if (wasActive !== isActive) onInteractionChange?.(isActive);
  }, [onInteractionChange]);

  const setCanvasInteractionRef = useRef(setCanvasInteraction);
  setCanvasInteractionRef.current = setCanvasInteraction;
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
        onViewportChangeRef.current?.(viewport);
        if (viewportMomentumRef.current?.getState() === "idle") {
          setCanvasInteractionRef.current("viewport", false);
        }
      },
    });
  }
  const viewportMomentum = viewportMomentumRef.current;
  const stopViewportMomentum = useCallback(() => viewportMomentum.stop(), [viewportMomentum]);

  useEffect(() => () => viewportMomentum.dispose(), [viewportMomentum]);

  useEffect(() => resetInteractions, [resetInteractions]);
  useEffect(() => () => clearCanvasLaunching(canvasId), [canvasId, clearCanvasLaunching]);
  useEffect(() => () => onInteractionChange?.(false), [onInteractionChange]);

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
    historyGestureDepthRef.current = 0;
    historyGestureRef.current = null;
    resetInfiniteCanvasHistory(initialSnapshot.nodes, initialSnapshot.edges);
  }, [canvasId, initialSnapshot.edges, initialSnapshot.nodes]);

  useEffect(() => {
    if (readOnly) return;
    recordInfiniteCanvasHistory(nodes, edges);
    onSnapshotChange?.({ nodes, edges, viewport: viewportRef.current });
  }, [edges, nodes, onSnapshotChange, readOnly]);

  const beginHistoryGesture = useCallback(() => {
    historyGestureDepthRef.current += 1;
    if (historyGestureDepthRef.current > 1) return;
    historyGestureRef.current = beginInfiniteCanvasHistoryGesture();
  }, []);

  const endHistoryGesture = useCallback((
    finalNodes: NativeCanvasNode[] = nodesRef.current,
    finalEdges: NativeCanvasEdge[] = edgesRef.current,
  ) => {
    if (!historyGestureDepthRef.current) return;
    historyGestureDepthRef.current -= 1;
    if (historyGestureDepthRef.current > 0) return;
    const previous = historyGestureRef.current;
    if (!previous) return;
    recordInfiniteCanvasHistory(finalNodes, finalEdges);
    commitInfiniteCanvasHistoryGesture(previous);
    historyGestureRef.current = null;
  }, []);

  const restoreHistory = useCallback((snapshot: NativeCanvasHistorySnapshot) => {
    imageMutationVersionRef.current.clear();
    const restored = restoreInfiniteCanvasHistorySnapshot(snapshot, nodesRef.current, edgesRef.current);
    const restoredIds = new Set(restored.nodes.map((node) => node.id));
    stopCanvasNodeGenerationTasks(nodesRef.current.filter((node) => !restoredIds.has(node.id)));
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
    setCanvasInteraction("selection", true);
    beginSelectionGesture();
  }, [beginSelectionGesture, setCanvasInteraction, stopViewportMomentum]);

  const finishCanvasSelection = useCallback(() => {
    const currentNodes = getNodes();
    const expanded = expandNativeCanvasGroupSelection(currentNodes);
    if (expanded.nodes !== currentNodes) setNodes(expanded.nodes);
    endSelectionGesture(new Set(expanded.groupIds));
    setCanvasInteraction("selection", false);
  }, [endSelectionGesture, getNodes, setCanvasInteraction, setNodes]);

  const addNode = useCallback((kind: NativeCanvasNodeKind, x: number, y: number, data?: Partial<NativeCanvasNode["data"]>) => {
    const definition = NATIVE_CANVAS_NODE_DEFINITIONS[kind];
    const rememberedData = rememberedGenerationNodeData(kind);
    const nodeData = {
      ...rememberedData,
      ...data,
      ...(kind === "actionFission" && !data?.actionFission
        ? { actionFission: createDefaultActionFissionState() }
        : {}),
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
    stopCanvasNodeGenerationTasks(deletedNodes);
  }, []);

  const setNodeImage = useCallback((nodeId: string, imageUrl: string, fileName: string) => {
    const version = (imageMutationVersionRef.current.get(nodeId) || 0) + 1;
    imageMutationVersionRef.current.set(nodeId, version);
    void (async () => {
      let storedUrl = imageUrl;
      let thumbUrl = "";
      try {
        if (/^data:image\//i.test(imageUrl) && window.easyTool?.saveCanvasAsset) {
          const stored = await window.easyTool.saveCanvasAsset({ dataUrl: imageUrl, defaultName: fileName, kind: "input" });
          storedUrl = stored.url;
          thumbUrl = stored.thumbUrl || "";
        } else if (window.easyTool?.ensureCanvasAssetThumbnail) {
          const thumbnail = await window.easyTool.ensureCanvasAssetThumbnail({ url: imageUrl });
          thumbUrl = thumbnail.thumbUrl || "";
        }
      } catch {
        storedUrl = imageUrl;
        thumbUrl = "";
      }
      if (!imageThumbnailMountedRef.current || imageMutationVersionRef.current.get(nodeId) !== version) return;
      let dimensions: { width: number; height: number } | null = null;
      try {
        dimensions = await readImageDimensions(resolveLibraryImageUrl(storedUrl));
      } catch {
        // Keep the selected image even when its metadata cannot be read.
      }
      if (!imageThumbnailMountedRef.current || imageMutationVersionRef.current.get(nodeId) !== version) return;
      const size = dimensions ? getImageNodeSize(dimensions.width, dimensions.height) : null;
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
                      width: dimensions?.width,
                      height: dimensions?.height,
                      downloadState: node.data.generatedImages?.[0]?.downloadState || "pending" as const,
                    },
                    ...(node.data.generatedImages?.slice(1) || []),
                  ],
                }
              : { imageUrl: storedUrl, imageFileName: fileName, thumbUrl: thumbUrl || undefined }),
            imageNaturalWidth: dimensions?.width,
            imageNaturalHeight: dimensions?.height,
          },
          style: size ? { ...node.style, ...size } : node.style,
        }
        : node));
    })();
  }, [setNodes]);

  const cropNodeImage = useCallback(async (nodeId: string, crop: CanvasImageCropRect) => {
    const version = (imageMutationVersionRef.current.get(nodeId) || 0) + 1;
    imageMutationVersionRef.current.set(nodeId, version);
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
    if (!imageThumbnailMountedRef.current || imageMutationVersionRef.current.get(nodeId) !== version) return;
    const size = getImageNodeSize(result.width, result.height);
    setNodes((current) => current.map((item) => item.id === nodeId && item.data.kind === "imageLoader"
      ? {
          ...item,
          data: {
            ...item.data,
            imageUrl: result.url,
            imageFileName: result.fileName,
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

  const rebaseNode = useCallback((
    nodeId: string,
    transformCurrent: (node: NativeCanvasNode) => NativeCanvasNode,
    transformHistory: (node: NativeCanvasNode) => NativeCanvasNode = transformCurrent,
  ) => {
    rebaseInfiniteCanvasHistoryNode(nodeId, transformCurrent, transformHistory);
    const gesture = historyGestureRef.current;
    if (gesture) {
      historyGestureRef.current = {
        ...gesture,
        nodes: gesture.nodes.map((node) => node.id === nodeId ? transformCurrent(node) : node),
      };
    }
  }, []);

  const patchNodeDataSilently = useCallback((nodeId: string, patch: Partial<NativeCanvasNode["data"]>) => {
    const transformCurrent = (node: NativeCanvasNode) => applyNativeNodeDataPatch(node, patch);
    const transformHistory = (node: NativeCanvasNode) => applyRuntimeNodeDataPatch(node, patch);
    rebaseNode(nodeId, transformCurrent, transformHistory);
    setNodes((current) => current.map((node) => node.id === nodeId ? transformCurrent(node) : node));
  }, [rebaseNode, setNodes]);

  const patchActionFissionSelectionSilently = useCallback((
    nodeId: string,
    actionFission: NonNullable<NativeCanvasNode["data"]["actionFission"]>,
  ) => {
    const transformCurrent = (node: NativeCanvasNode) => applyNativeNodeDataPatch(node, { actionFission });
    const selectedRows = new Map(actionFission.rows.map((row) => [row.id, row]));
    const transformHistory = (node: NativeCanvasNode) => {
      if (node.data.kind !== "actionFission" || !node.data.actionFission) return node;
      const rows = node.data.actionFission.rows.map((row) => {
        const selectedRow = selectedRows.get(row.id);
        if (!selectedRow || !sameActionFissionConfiguration(row, selectedRow)) return row;
        const nextRow = { ...row } as ActionFissionRow & Record<string, unknown>;
        const selectedRecord = selectedRow as ActionFissionRow & Record<string, unknown>;
        ACTION_FISSION_SELECTION_FIELDS.forEach((field) => {
          (nextRow as Record<string, unknown>)[field] = structuredClone(selectedRecord[field]);
        });
        return nextRow;
      });
      return {
        ...node,
        data: {
          ...node.data,
          actionFission: { ...node.data.actionFission, rows },
        },
      };
    };
    rebaseNode(nodeId, transformCurrent, transformHistory);
    setNodes((current) => current.map((node) => node.id === nodeId ? transformCurrent(node) : node));
  }, [rebaseNode, setNodes]);

  const patchImageNodeThumbnail = useCallback((nodeId: string, sourceUrl: string, thumbUrl: string) => {
    const transform = (node: NativeCanvasNode) => applyCanvasNodeThumbnail([node], nodeId, sourceUrl, thumbUrl)[0];
    rebaseNode(nodeId, transform);
    setNodes((current) => current.map((node) => node.id === nodeId ? transform(node) : node));
  }, [rebaseNode, setNodes]);

  useEffect(() => {
    const ensureThumbnail = window.easyTool?.ensureCanvasAssetThumbnail;
    if (!ensureThumbnail) return;
    const pending = collectMissingCanvasThumbnailTargets(nodes).filter((item) => {
      const key = `${item.nodeId}:${item.sourceUrl}`;
      if (imageThumbnailAttemptsRef.current.has(key)) return false;
      imageThumbnailAttemptsRef.current.add(key);
      return true;
    });
    if (!pending.length) return;

    let nextIndex = 0;
    const worker = async () => {
      while (imageThumbnailMountedRef.current) {
        const item = pending[nextIndex++];
        if (!item) return;
        try {
          const thumbnail = await ensureThumbnail({ url: item.sourceUrl });
          if (imageThumbnailMountedRef.current && thumbnail.thumbUrl) {
            patchImageNodeThumbnail(item.nodeId, item.sourceUrl, thumbnail.thumbUrl);
          }
        } catch {
          // Keep the placeholder when an asset cannot be resolved or thumb generation fails.
        }
      }
    };
    void Promise.all([worker(), worker()]);
  }, [nodes, patchImageNodeThumbnail]);

  const patchActionFissionRows = useCallback((
    nodeId: string,
    patches: Array<{ rowId: string; patch: Partial<ActionFissionRow> }>,
  ) => {
    if (!patches.length) return;
    const currentPatches = new Map<string, Partial<ActionFissionRow>>();
    const historyPatches = new Map<string, Partial<ActionFissionRow>>();
    patches.forEach(({ rowId, patch }) => {
      currentPatches.set(rowId, { ...(currentPatches.get(rowId) || {}), ...patch });
      const historyPatch = { ...(historyPatches.get(rowId) || {}), ...patch };
      delete historyPatch.selectedActionThumbUrl;
      if (Object.keys(historyPatch).length) historyPatches.set(rowId, historyPatch);
      else historyPatches.delete(rowId);
    });
    const transformWithPatches = (
      node: NativeCanvasNode,
      rowPatches: ReadonlyMap<string, Partial<ActionFissionRow>>,
    ) => {
      if (node.id !== nodeId || node.data.kind !== "actionFission") return node;
      const actionFission = normalizeActionFissionState(node.data.actionFission);
      const nextRows = actionFission.rows.map((row) => {
        const rowPatch = rowPatches.get(row.id);
        return rowPatch ? { ...row, ...rowPatch } as ActionFissionRow & Record<string, unknown> : row;
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
    };
    const transformCurrent = (node: NativeCanvasNode) => transformWithPatches(node, currentPatches);
    const transformHistory = historyPatches.size
      ? (node: NativeCanvasNode) => transformWithPatches(node, historyPatches)
      : (node: NativeCanvasNode) => node;
    rebaseNode(nodeId, transformCurrent, transformHistory);
    setNodes((current) => current.map((node) => node.id === nodeId ? transformCurrent(node) : node));
  }, [rebaseNode, setNodes]);

  const patchActionFissionRow = useCallback((nodeId: string, rowId: string, patch: Partial<ActionFissionRow>) => {
    patchActionFissionRows(nodeId, [{ rowId, patch }]);
  }, [patchActionFissionRows]);

  const {
    runImageGeneration: runApiImageGeneration,
    stopImageGeneration: stopApiImageGeneration,
  } = useNativeImageGeneration({
    canvasId,
    edges,
    nodes,
    patchNodeData: patchNodeDataSilently,
    t,
  });
  const { runLibtvGeneration, stopLibtvGeneration } = useNativeLibtvGeneration({
    canvasId,
    edges,
    nodes,
    patchNodeData: patchNodeDataSilently,
    t,
  });
  const { runActionFission, stopActionFission: stopActionFissionImmediately } = useNativeActionFissionGeneration({
    canvasId,
    edges,
    nodes,
    patchRow: patchActionFissionRow,
    patchRows: patchActionFissionRows,
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

  const saveGeneratedImage = useCallback(async (
    imageUrl: string,
    defaultName: string,
    { convertToPng = true }: { convertToPng?: boolean } = {},
  ) => {
    try {
      if (window.easyTool?.saveResult) {
        const result = await window.easyTool.saveResult({
          url: resolveLibraryImageUrl(imageUrl),
          dataUrl: resolveLibraryImageUrl(imageUrl),
          defaultName,
          directory: imageDownloadPath,
          convertToPng,
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
      }), { convertToPng: false });
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
    const latestNode = nodesRef.current.find((item) => item.id === nodeId && item.data.kind === "imageGenerator");
    const latestImages = latestNode?.data.generatedImages || [];
    const latestIndex = latestImages.findIndex((item) => String(item.localUrl || item.url || "") === imageUrl);
    if (latestIndex < 0) return;
    patchNodeDataSilently(nodeId, {
      generatedImages: latestImages.map((item, index) => index === latestIndex
        ? { ...item, downloadState: "downloaded", downloadedAt: Date.now() }
        : item),
    });
  }, [nodes, patchNodeDataSilently, saveGeneratedImage]);

  const downloadContextNodeImage = useCallback(async () => {
    if (!contextNodeImage || !contextNode) return;
    await downloadNodeImage(contextNode.id, 0);
  }, [contextNode, contextNodeImage, downloadNodeImage]);

  const downloadActionFissionResult = useCallback(async (nodeId: string, rowId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    const actionFission = node?.data.actionFission;
    const row = actionFission?.rows.find((item) => item.id === rowId);
    if (!row) return;
    const taskId = actionFissionRowTaskId(row);
    const [task] = taskId ? await loadGenerationTasks([taskId]) : [];
    const target = actionFissionDownloadTarget(row, task);
    if (!target) return;
    const apiSettings = task?.executorKind === "libtv" || actionFission?.apiType === "libtv-api"
      ? null
      : await loadApiSettings();
    const provider = apiSettings?.providers.find((item) => item.id === (task?.providerId || actionFission?.providerId));
    await saveGeneratedImage(target.imageUrl, task
      ? buildTaskDownloadName(task, target.fileName, target.imageUrl)
      : buildGenerationDownloadName({
        platform: actionFission?.apiType === "libtv-api" ? "LibTV" : provider?.name || actionFission?.providerId,
        model: actionFission?.apiType === "libtv-api" ? actionFission?.libtvModelName : actionFission?.model,
        sourceFileName: target.fileName,
        sourceUrl: target.imageUrl,
      }));
    const latestRow = nodesRef.current
      .find((item) => item.id === nodeId && item.data.kind === "actionFission")
      ?.data.actionFission?.rows.find((item) => item.id === rowId);
    const latestTarget = latestRow ? actionFissionDownloadTarget(latestRow, task) : null;
    if (!latestTarget || latestTarget.imageUrl !== target.imageUrl) return;
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
    const latestTarget = getNodes().find((node) => (
      node.id === targetNodeId
      && (node.data.kind === "imageGenerator" || node.data.kind === "actionFission")
    ));
    if (!latestTarget) return;
    const size = getImageNodeSize(dimensions.width, dimensions.height);
    const referenceNode = createNativeCanvasNode("imageLoader", {
      x: latestTarget.position.x - size.width - 64,
      y: latestTarget.position.y + Number(source.verticalOffset || 0),
    }, {
      imageUrl,
      imageFileName: source.label,
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
      data: edgeDataForConnection("imageLoader", latestTarget.data.kind, targetNodeId, current),
    }, current));
  }, [getNodes, setEdges, setNodes]);

  const addImageReferenceFiles = useCallback(async (targetNodeId: string, files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    beginHistoryGesture();
    try {
      for (let index = 0; index < imageFiles.length; index += 1) {
        const file = imageFiles[index];
        await addReferenceImage(targetNodeId, {
          imageUrl: await readImageFileAsDataUrl(file),
          label: file.name || t("infiniteCanvas:pastedImage"),
          type: file.type,
          verticalOffset: index * 28,
        });
      }
    } finally {
      window.requestAnimationFrame(() => endHistoryGesture());
    }
  }, [addReferenceImage, beginHistoryGesture, endHistoryGesture, t]);

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
    beginHistoryGesture,
    endHistoryGesture,
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
    patchActionFissionSelectionSilently,
    patchNodeData,
    patchNodeDataSilently,
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
  }), [beginHistoryGesture, cropNodeImage, endHistoryGesture, patchActionFissionSelectionSilently, patchNodeData, patchNodeDataSilently, readOnly, setEdges, setNodeImage, t]);

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
        imageFileName: file.name,
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
    setCanvasInteraction("node-drag", true);
    beginHistoryGesture();
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
  }, [beginHistoryGesture, getEdges, getNodes, readOnly, setCanvasInteraction, setNodes, stopViewportMomentum, syncSelection]);

  const handleNodeDrag = useCallback<OnNodeDrag<NativeCanvasNode>>((_event, draggedNode, draggedNodes) => {
    const cloneGesture = altDragCloneGestureRef.current;
    if (readOnly || !cloneGesture) return;
    setNodes((current) => {
      return projectAltDragOntoClones(current, cloneGesture, [draggedNode, ...draggedNodes], true);
    });
  }, [readOnly, setNodes]);

  const handleNodeDragStop = useCallback<OnNodeDrag<NativeCanvasNode>>((_event, draggedNode, draggedNodes) => {
    if (readOnly) return;
    setCanvasInteraction("node-drag", false);
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
      endHistoryGesture(finalNodes, finalEdges);
      return;
    }

    const currentNodes = getNodes();
    const draggedIds = new Set([draggedNode.id, ...draggedNodes.map((node) => node.id)]);
    const finalNodes = detachNativeCanvasChildrenOutsideParents(currentNodes, draggedIds);
    if (finalNodes !== currentNodes) setNodes(finalNodes);
    endHistoryGesture(finalNodes, getEdges());
  }, [endHistoryGesture, getEdges, getNodes, readOnly, setCanvasInteraction, setEdges, setNodes, syncSelection]);

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
                  setCanvasInteraction("viewport", true);
                  return;
                }
                viewportMomentum.beginUserMove(viewport);
                setCanvasInteraction("viewport", true);
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
                  setCanvasInteraction("viewport", false);
                  onViewportChangeRef.current?.(viewport);
                  return;
                }
                viewportMomentum.endUserMove(viewport);
                if (viewportMomentum.getState() !== "sliding") {
                  setCanvasInteraction("viewport", false);
                }
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

        <CanvasSaveStatusIndicator canvasId={canvasId} onSave={onSave} />

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
  onInteractionChange?: (active: boolean) => void;
  onSnapshotChange?: (snapshot: NativeCanvasSnapshot) => void;
  onViewportChange?: (viewport: NativeCanvasSnapshot["viewport"]) => void;
  onSave?: () => void | Promise<void>;
  readOnly?: boolean;
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

export const ReactFlowCanvasPage = memo(function ReactFlowCanvasPage({ canvasId, imageDownloadPath, initialSnapshot = emptyCanvasSnapshot(), onInteractionChange, onSnapshotChange, onViewportChange, onSave, readOnly = false }: ReactFlowCanvasPageProps) {
  const { t } = useTranslation();
  return (
    <section className="infinite-canvas-page" aria-label={t("infiniteCanvas:title")}>
      <ReactFlowProvider>
        <NativeCanvasSurface canvasId={canvasId} imageDownloadPath={imageDownloadPath} initialSnapshot={initialSnapshot} onInteractionChange={onInteractionChange} onSnapshotChange={onSnapshotChange} onViewportChange={onViewportChange} onSave={onSave} readOnly={readOnly} />
      </ReactFlowProvider>
    </section>
  );
});

export default ReactFlowCanvasPage;
