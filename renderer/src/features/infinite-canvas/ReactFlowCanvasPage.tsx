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
  applyNodeChanges,
  useEdgesState,
  useReactFlow,
  useStore,
  useViewport,
  type Connection,
  type EdgeMouseHandler,
  type IsValidConnection,
  type NodeChange,
  type NodeTypes,
  type OnConnectEnd,
  type OnConnectStart,
  type OnNodeDrag,
} from "@xyflow/react";
import { ClipboardPaste, Copy, Crosshair, Download, Eye, EyeOff, Grid3X3, Group as GroupIcon, Image, Images, Map as MapIcon, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
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
  isCanvasAssetFile,
  readMediaFileDimensions,
  type CanvasImageCropRect,
  type CanvasResultAssetRequest,
  type CanvasStoredAsset,
  type NativeCanvasActions,
} from "./canvasActions";
import { useNativeCanvasInteractionStore } from "./canvasInteractionStore";
import { CanvasFloatingPanel } from "./components/CanvasFloatingPanel";
import { CanvasSaveStatusIndicator } from "./components/CanvasSaveStatusIndicator";
import { applyNativeNodeDataPatch } from "./applyNativeNodeDataPatch";
import { sameCanvasNodeRuntime } from "./canvasNodeChanges";
import { withActionFissionSelection } from "./action-fission/actionFissionSelection";
import { applyCanvasNodeThumbnail, collectMissingCanvasThumbnailTargets } from "./canvasThumbnails";
import {
  cloneNativeCanvasNodeData,
  createNativeCanvasNode,
  createNativeCanvasGroupNode,
  getImageNodeSize,
  getVideoNodeSize,
  nativeCanvasNodeImages,
  nativeCanvasNodePrimaryImage,
  nativeCanvasNodeTaskId,
  NATIVE_CANVAS_NODE_DEFINITIONS,
  remapNativeCanvasNodePromptReferences,
  type ImageGenerationRunOptions,
  type NativeCanvasEdge,
  type NativeCanvasNode,
  type NativeCanvasNodeKind,
} from "./nativeCanvas";
import { NativeCanvasNode as NativeCanvasNodeComponent } from "./nodes/NativeCanvasNode";
import { NativeCanvasGroupNode } from "./nodes/NativeCanvasGroupNode";
import { ActionFissionRowSettingsDialog } from "./nodes/ActionFissionRowSettingsDialog";
import { ImageAdjustDialog } from "./nodes/ImageAdjustDialog";
import { DEFAULT_IMAGE_ADJUSTMENTS, type NativeCanvasImageAdjustments } from "./imageAdjustments";
import { configureActionFissionRow, createDefaultActionFissionState, normalizeActionFissionState } from "./action-fission/actionFissionState";
import { actionFissionRowTaskId, type ActionFissionRow } from "./action-fission/actionFissionTypes";
import { emptyCanvasSnapshot, type NativeCanvasSnapshot } from "./canvasWorkspaceTypes";
import { useNativeImageGeneration } from "./generation/useNativeImageGeneration";
import { useNativeActionFissionGeneration } from "./generation/useNativeActionFissionGeneration";
import { useNativeBatchImageGeneration } from "./generation/useNativeBatchImageGeneration";
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
  useGenerationTaskCache,
} from "./generation/generationTaskCache";
import { downloadGenerationResult, saveGenerationImageFile } from "./generation/generationDownload";
import { actionFissionDownloadTarget } from "./generation/generationDownloadTarget";
import { derivedAssetName, FALLBACK_DOWNLOAD_NAME, storedImageDownloadTarget, type DerivedAssetKind } from "./assetNaming";
import { ASSET_LOADER_DEFAULT_SIZE } from "./imageNodeSizing";
import { collectGroupImageAdjustTargets, groupImageAdjustTargetKey } from "./groupImageAdjustTargets";
import { removeEmptyNativeCanvasGroups } from "./nativeCanvasGroups";
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
import {
  isNativeCanvasConnectionValid,
  type NativeCanvasConnectionCandidate,
} from "./canvasConnectionValidation";

const NODE_TYPES: NodeTypes = { canvasNode: NativeCanvasNodeComponent, groupNode: NativeCanvasGroupNode };
const MULTI_SELECTION_SCREEN_GAP = 24;
// 多选工具栏跟着虚框走：虚框已经比节点包围盒外扩了 MULTI_SELECTION_SCREEN_GAP，
// 工具栏再往上留一段，免得贴着虚线（NodeToolbar 的 offset 是屏幕像素，和虚框的扩边同一套口径）。
const MULTI_SELECTION_TOOLBAR_SCREEN_OFFSET = MULTI_SELECTION_SCREEN_GAP + 20;

const CONTEXT_CANVAS_NODE_GROUPS: NativeCanvasNodeKind[][] = [
  ["assetLoader", "prompt"],
  ["imageGenerator", "batchImageGenerator", "smartReverse", "actionFission"],
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

interface ImageAdjustTarget {
  nodeId: string;
  imageIndex: number;
}

interface PendingGenerationStop {
  kind: "imageGenerator" | "actionFission";
  nodeId: string;
  rowId?: string;
  taskIds: string[];
}

interface ActiveConnectionStart {
  handleId: string | null;
  handleType: "source" | "target";
  nodeId: string;
}

interface ConnectionTargetFeedback {
  nodeId: string;
  status: "valid" | "invalid";
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
/** 结果图派生的素材节点：从点击处向右下偏移，同一张卡片连续创建时再逐次错开。 */
const RESULT_ASSET_OFFSET = 18;
const RESULT_ASSET_CASCADE = 26;

function isEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("input, textarea, select")) return true;
  if (target.closest("[data-canvas-text-copy]")) return true;
  return Boolean(target.closest<HTMLElement>("[contenteditable]")?.isContentEditable);
}

function isNativeCanvasGroupNode(node: NativeCanvasNode) {
  return node.type === "groupNode" || node.data.kind === "group";
}

/**
 * 用户新加到画布上的节点统一置顶。
 *
 * 画布会把拖动过的节点顶到最前（handleNodeDragStart 给它们递增 zIndex），
 * 新节点如果不取最高的那一层，就会落在这些节点下面被整块盖住不见。
 */
function nextCanvasNodeZIndex(nodes: NativeCanvasNode[]) {
  return Math.max(0, ...nodes.map((node) => node.zIndex || 0)) + 1;
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
  "assetThumbUrl",
  "imageNaturalWidth",
  "imageNaturalHeight",
  "assetLoadState",
  "assetLoadError",
];

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

/** Shallow data comparison used to keep no-op silent patches from republishing nodes. */
function sameNodeData(a: NativeCanvasNode["data"], b: NativeCanvasNode["data"]) {
  const keys = Object.keys(a) as (keyof NativeCanvasNode["data"])[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.is(a[key], b[key]));
}

function sameNodeGeometry(a: NativeCanvasNode, b: NativeCanvasNode) {
  return a.style === b.style && a.position === b.position;
}

function NativeCanvasSurface({ canvasId, fileDownloadPath, initialSnapshot, onInteractionChange, onSnapshotChange, onViewportChange, onSave, readOnly }: {
  canvasId: string;
  fileDownloadPath?: string;
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
  const [nodes, setNodes] = useState<NativeCanvasNode[]>(initialSnapshot.nodes);
  const onNodesChange = useCallback((changes: NodeChange<NativeCanvasNode>[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      // Drop change batches that did not actually change anything: republishing an
      // identical array re-renders the whole canvas and can sustain a measurement loop.
      const meaningful = changes.some((change) => {
        if (change.type === "add" || change.type === "remove" || change.type === "replace") return true;
        if (!("id" in change) || !change.id) return true;
        const before = current.find((node) => node.id === change.id);
        const after = next.find((node) => node.id === change.id);
        return !before || !after || !sameCanvasNodeRuntime(before, after);
      });
      return meaningful ? next : current;
    });
  }, []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<NativeCanvasEdge>(initialSnapshot.edges);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const imageThumbnailAttemptsRef = useRef(new Set<string>());
  const imageThumbnailMountedRef = useRef(true);
  const imageMutationVersionRef = useRef(new Map<string, number>());
  // 同一张卡片连续创建素材节点时按次错开落点，避免新节点完全重叠。
  const resultAssetCascadeRef = useRef(new Map<string, number>());
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
  const [imageAdjustTarget, setImageAdjustTarget] = useState<ImageAdjustTarget | null>(null);
  /** 组入口的会话：记录这次调节来自哪个组，单节点入口为 null。 */
  const [imageAdjustSession, setImageAdjustSession] = useState<{ scope: "group"; groupId: string } | null>(null);
  const [imageAdjustGroupProgress, setImageAdjustGroupProgress] = useState<{ done: number; total: number } | null>(null);
  const [imageAdjustBusy, setImageAdjustBusy] = useState(false);
  const [pendingGenerationStop, setPendingGenerationStop] = useState<PendingGenerationStop | null>(null);
  const [generationStopPending, setGenerationStopPending] = useState(false);
  const [canvasClipboardAvailable, setCanvasClipboardAvailable] = useState(false);
  const [connectionTargetFeedback, setConnectionTargetFeedback] = useState<ConnectionTargetFeedback | null>(null);
  const pasteSequenceRef = useRef<PasteSequence | null>(null);
  const pendingContextPastePointRef = useRef<{ x: number; y: number } | null>(null);
  const altDragCloneGestureRef = useRef<AltDragCloneGesture | null>(null);
  const historyGestureRef = useRef<NativeCanvasHistorySnapshot | null>(null);
  const historyGestureDepthRef = useRef(0);
  const activeCanvasInteractionsRef = useRef(new Set<string>());
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const activeConnectionStartRef = useRef<ActiveConnectionStart | null>(null);
  const edgeToolbarFrameRef = useRef<number | null>(null);
  const edgeToolbarHideTimerRef = useRef<number | null>(null);
  const pendingEdgePointerRef = useRef<{ edgeId: string; clientX: number; clientY: number } | null>(null);
  const flowNodes = useMemo(() => {
    if (!connectionTargetFeedback) return nodes;
    return nodes.map((node) => node.id === connectionTargetFeedback.nodeId
      ? {
          ...node,
          className: cn(
            node.className,
            `rf-native-node--connection-${connectionTargetFeedback.status}`,
          ),
        }
      : node);
  }, [connectionTargetFeedback, nodes]);
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
  // 调整窗口的预览对象：打开时按 nodeId + 图片序号取图，节点或图片消失就关掉窗口。
  const imageAdjustContext = useMemo(() => {
    if (!imageAdjustTarget) return null;
    const node = nodes.find((item) => item.id === imageAdjustTarget.nodeId);
    if (!node) return null;
    const images = nativeCanvasNodeImages(node.data);
    const image = images[imageAdjustTarget.imageIndex] || images[0];
    const imageUrl = String(image?.localUrl || image?.url || "");
    if (!image) return null;
    return {
      label: String(node.data.label || "").trim() || t("infiniteCanvas:assetNode"),
      // 预览优先用缩略图（拖动滑块要跟手），导出始终用原图。
      imageUrl: resolveLibraryImageUrl(imageUrl),
      previewUrl: image.thumbUrl ? resolveLibraryImageUrl(image.thumbUrl) : resolveLibraryImageUrl(imageUrl),
      naturalWidth: Math.max(0, Number(image.width || 0)),
      naturalHeight: Math.max(0, Number(image.height || 0)),
    };
  }, [imageAdjustTarget, nodes, t]);
  // 组入口：预览下方轨道的候选图片，按画布上的阅读顺序列出（含嵌套子组）。
  const imageAdjustTargets = useMemo(() => {
    if (imageAdjustSession?.scope !== "group") return [];
    return collectGroupImageAdjustTargets(nodes, imageAdjustSession.groupId);
  }, [imageAdjustSession, nodes]);
  const imageAdjustTargetOptions = useMemo(() => imageAdjustTargets.map((target) => ({
      key: target.key,
      label: target.label || t("infiniteCanvas:assetNode"),
      thumbnailUrl: target.thumbnailUrl ? resolveLibraryImageUrl(target.thumbnailUrl) : "",
      taskId: target.taskId,
      isAssetLoading: target.isAssetLoading,
  })), [imageAdjustTargets, t]);
  // 目标节点/图片消失：组入口自动切到组内下一张，单节点入口直接关窗。
  useEffect(() => {
    if (!imageAdjustTarget || imageAdjustContext) return;
    if (imageAdjustSession?.scope === "group") {
      const activeKey = groupImageAdjustTargetKey(imageAdjustTarget.nodeId, imageAdjustTarget.imageIndex);
      const next = imageAdjustTargets.find((target) => target.key !== activeKey) || imageAdjustTargets[0];
      if (next) {
        setImageAdjustTarget({ nodeId: next.nodeId, imageIndex: next.imageIndex });
        return;
      }
    }
    setImageAdjustTarget(null);
  }, [imageAdjustContext, imageAdjustSession, imageAdjustTarget, imageAdjustTargets]);
  const contextNode = useMemo(
    () => nodeContextTarget
      ? nodes.find((node) => node.id === nodeContextTarget.node.id) || nodeContextTarget.node
      : null,
    [nodeContextTarget, nodes],
  );
  const contextNodeImage = useMemo(() => {
    if (contextNode?.data.kind !== "assetLoader" && contextNode?.data.kind !== "imageGenerator") return null;
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
    // 空组（成员被删光/拖出去）跟着这次节点变化一起消失：并进同一步，
    // 撤销时组才会和子节点一起回来，而不是先恢复出一个马上又被清掉的空组。
    const withoutEmptyGroups = removeEmptyNativeCanvasGroups(nodes, edges);
    const nextNodes = withoutEmptyGroups ? withoutEmptyGroups.nodes : nodes;
    const nextEdges = withoutEmptyGroups ? withoutEmptyGroups.edges : edges;
    if (withoutEmptyGroups) {
      setNodes(nextNodes);
      setEdges(nextEdges);
    }
    recordInfiniteCanvasHistory(nextNodes, nextEdges);
    onSnapshotChange?.({ nodes: nextNodes, edges: nextEdges, viewport: viewportRef.current });
  }, [edges, nodes, onSnapshotChange, readOnly, setEdges, setNodes]);

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
    const retainedNodeIds = restored.nodes.filter((node) => node.selected).map((node) => node.id);
    const retainedEdgeIds = new Set(restored.edges.filter((edge) => edge.selected).map((edge) => edge.id));
    stopCanvasNodeGenerationTasks(nodesRef.current.filter((node) => !restoredIds.has(node.id)));
    setNodes(restored.nodes);
    setEdges(restored.edges);
    syncSelection(retainedNodeIds);
    setEdgeToolbarPoint((current) => current && retainedEdgeIds.has(current.edgeId) ? current : null);
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

  // Selection-derived interaction state (sole selected node, toolbar target) is derived
  // from our own node state instead of React Flow's onSelectionChange effect. React Flow
  // runs that callback from an effect whose dependency array contains the callback itself
  // plus its own selection snapshot, so writing to the interaction store from inside it fed
  // straight back into React's update loop ("Maximum update depth exceeded", reproducible
  // right after a multi-selection collapses into the new group node). Deriving it from
  // `nodes` keeps the write on our own update path, where it converges.
  useEffect(() => {
    syncSelection(nodes.filter((node) => node.selected).map((node) => node.id));
  }, [nodes, syncSelection]);

  const handleSelectionChange = useCallback(({ edges: selectedEdges }: {
    nodes: NativeCanvasNode[];
    edges: NativeCanvasEdge[];
  }) => {
    setEdgeToolbarPoint((current) => current && selectedEdges.some((edge) => edge.id === current.edgeId) ? current : null);
  }, []);

  const addNode = useCallback((kind: NativeCanvasNodeKind, x: number, y: number, data?: Partial<NativeCanvasNode["data"]>) => {
    const definition = NATIVE_CANVAS_NODE_DEFINITIONS[kind];
    const rememberedData = rememberedGenerationNodeData(kind);
    const nodeData = {
      ...rememberedData,
      ...data,
      ...(kind === "actionFission" && !data?.actionFission
        ? { actionFission: createDefaultActionFissionState() }
        : {}),
      ...(kind === "batchImageGenerator" && !data?.batchImageGenerator
        ? { batchImageGenerator: { items: [], prompt: "" } }
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
      { ...node, selected: true, zIndex: nextCanvasNodeZIndex(current) },
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

  const setNodeAsset = useCallback((nodeId: string, assetUrl: string, fileName: string, assetType: "image" | "video" | "audio" = "image", assetMimeType = "", metadata: { width?: number; height?: number; durationMs?: number; sizeBytes?: number; thumbUrl?: string } = {}) => {
    const version = (imageMutationVersionRef.current.get(nodeId) || 0) + 1;
    imageMutationVersionRef.current.set(nodeId, version);
    // Show the shared upload placeholder immediately while library selections
    // and other non-file sources are persisted and thumbnailized asynchronously.
    setNodes((current) => current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, assetLoadState: "processing", assetLoadError: undefined } }
      : node));
    void (async () => {
      let storedUrl = assetUrl;
      let thumbUrl = metadata.thumbUrl || "";
      try {
        if (/^data:image\//i.test(assetUrl) && window.easyTool?.saveCanvasAsset) {
          const stored = await window.easyTool.saveCanvasAsset({ dataUrl: assetUrl, defaultName: fileName, kind: "input" });
          storedUrl = stored.url;
          thumbUrl = stored.thumbUrl || "";
        } else if (!thumbUrl && window.easyTool?.ensureCanvasAssetThumbnail) {
          const thumbnail = await window.easyTool.ensureCanvasAssetThumbnail({ url: assetUrl });
          thumbUrl = thumbnail.thumbUrl || "";
        }
      } catch {
        storedUrl = assetUrl;
        thumbUrl = "";
      }
      if (!imageThumbnailMountedRef.current || imageMutationVersionRef.current.get(nodeId) !== version) return;
      let dimensions: { width: number; height: number } | null = metadata.width && metadata.height
        ? { width: metadata.width, height: metadata.height }
        : null;
      if (!dimensions && assetType === "image") {
        try {
          dimensions = await readImageDimensions(resolveLibraryImageUrl(storedUrl));
        } catch {
          // Keep the selected image even when its metadata cannot be read.
        }
      }
      if (!imageThumbnailMountedRef.current || imageMutationVersionRef.current.get(nodeId) !== version) return;
      const size = assetType === "video"
        ? getVideoNodeSize(dimensions?.width || 0, dimensions?.height || 0)
        : dimensions
          ? getImageNodeSize(dimensions.width, dimensions.height)
          : null;
      setNodes((current) => current.map((node) => node.id === nodeId
        ? {
          ...node,
          data: {
            ...node.data,
            ...(node.data.kind === "imageGenerator"
              ? {
                  assetUrl: undefined,
                  assetFileName: undefined,
                  assetThumbUrl: undefined,
                  assetType: undefined,
                  assetMimeType: undefined,
                  assetNaturalWidth: undefined,
                  assetNaturalHeight: undefined,
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
                    assetLoadState: undefined,
                    assetLoadError: undefined,
                }
              : {
                  assetUrl: storedUrl,
                  assetFileName: fileName,
                  assetThumbUrl: thumbUrl || undefined,
                  assetType,
                  assetMimeType: assetMimeType || undefined,
                  assetLoadState: undefined,
                  assetLoadError: undefined,
                }),
             ...(node.data.kind === "imageGenerator" ? {
               imageNaturalWidth: dimensions?.width,
               imageNaturalHeight: dimensions?.height,
             } : {
               assetNaturalWidth: dimensions?.width,
               assetNaturalHeight: dimensions?.height,
               assetDurationMs: metadata.durationMs || undefined,
               assetSizeBytes: metadata.sizeBytes || undefined,
             }),
          },
          style: size ? { ...node.style, ...size } : node.style,
        }
        : node));
    })();
  }, [setNodes]);

  // 派生节点统一入口：命名由 assetNaming.derivedAssetName 统一给出（Crop-/Matting-/Frame-…），
  // 调用方只需要说明这是什么派生（kind）和显示标签（label），不需要自己拼文件名。
  const createDerivedAssetNode = useCallback((sourceNodeId: string, asset: CanvasStoredAsset, options: {
    kind: DerivedAssetKind;
    label: string;
    assetType?: "image" | "video" | "audio";
  }) => {
    const { kind, label, assetType = "image" } = options;
    const source = getNodes().find((node) => node.id === sourceNodeId);
    // 图片生成器节点也能派生（裁剪/调整都从它出图），落点用它的实际宽度算。
    if (!source || (source.data.kind !== "assetLoader" && source.data.kind !== "imageGenerator") || !asset?.url) return;
    const width = Math.max(1, Number(asset.width || 0));
    const height = Math.max(1, Number(asset.height || 0));
    const size = assetType === "video"
      ? getVideoNodeSize(width, height)
      : getImageNodeSize(width, height);
    const sourceWidth = Math.max(1, Number(source.style?.width || source.measured?.width || source.width || getImageNodeSize(Number(source.data.assetNaturalWidth || 0), Number(source.data.assetNaturalHeight || 0)).width));
    const nextNode = createNativeCanvasNode("assetLoader", {
      x: source.position.x + sourceWidth + 64,
      y: source.position.y,
    }, {
      label,
      assetUrl: asset.url,
      assetFileName: derivedAssetName(kind, source.data.assetFileName || source.data.label),
      assetThumbUrl: asset.thumbUrl || undefined,
      assetType,
      assetMimeType: assetType === "image" ? "image/png" : undefined,
      assetNaturalWidth: width || undefined,
      assetNaturalHeight: height || undefined,
      assetDurationMs: asset.durationMs || undefined,
      assetSizeBytes: asset.sizeBytes || undefined,
    });
    nextNode.style = size;
    if (source.parentId) nextNode.parentId = source.parentId;
    setNodes((current) => [
      ...current.map((node) => node.selected ? { ...node, selected: false } : node),
      { ...nextNode, selected: true, zIndex: nextCanvasNodeZIndex(current) },
    ]);
  }, [getNodes, setNodes]);

  // 批量类节点卡片上的「创建素材节点」按钮走这里：把那一格的结果图复制成
  // 一个独立素材节点，落点在点击处向右下偏移，不自动连线。
  const createAssetNodeFromResult = useCallback((request: CanvasResultAssetRequest) => {
    if (readOnly) return;
    const imageUrl = String(request.url || "").trim();
    if (!imageUrl) return;
    const currentNodes = getNodes();
    const source = currentNodes.find((node) => node.id === request.sourceNodeId);
    if (!source) return;
    // 分组里的子节点用相对坐标存位置，先把整条父链的绝对原点算出来。
    let origin = { x: 0, y: 0 };
    const visitedParents = new Set<string>();
    let parentId = source.parentId;
    while (parentId && !visitedParents.has(parentId)) {
      visitedParents.add(parentId);
      const parent = currentNodes.find((node) => node.id === parentId);
      if (!parent) break;
      origin = { x: origin.x + parent.position.x, y: origin.y + parent.position.y };
      parentId = parent.parentId;
    }
    const naturalWidth = Math.max(0, Math.round(Number(request.width || 0)));
    const naturalHeight = Math.max(0, Math.round(Number(request.height || 0)));
    const size = naturalWidth > 0 && naturalHeight > 0
      ? getImageNodeSize(naturalWidth, naturalHeight)
      : ASSET_LOADER_DEFAULT_SIZE;
    const sourceWidth = Math.max(1, Number(
      source.style?.width
      || source.measured?.width
      || source.width
      || NATIVE_CANVAS_NODE_DEFINITIONS[source.data.kind].size.width,
    ));
    const anchor = request.clientPoint
      ? screenToFlowPosition({ x: request.clientPoint.x, y: request.clientPoint.y })
      // 没有点击坐标时退回源节点右侧，偏移量照旧，仍然落在右下方向。
      : { x: source.position.x + origin.x + sourceWidth, y: source.position.y + origin.y };
    const cascadeKey = `${request.sourceNodeId}#${request.sourceKey || ""}`;
    const cascade = resultAssetCascadeRef.current.get(cascadeKey) || 0;
    resultAssetCascadeRef.current.set(cascadeKey, cascade + 1);
    const offset = RESULT_ASSET_OFFSET + cascade * RESULT_ASSET_CASCADE;
    const fileName = String(request.fileName || "").trim() || FALLBACK_DOWNLOAD_NAME;
    const nextNode = createNativeCanvasNode("assetLoader", {
      x: anchor.x - origin.x + offset,
      y: anchor.y - origin.y + offset,
    }, {
      label: fileName.replace(/\.[^./\\]+$/, "") || t("infiniteCanvas:assetNode"),
      assetUrl: imageUrl,
      assetFileName: fileName,
      assetThumbUrl: String(request.thumbUrl || "").trim() || undefined,
      assetType: "image",
      assetNaturalWidth: naturalWidth || undefined,
      assetNaturalHeight: naturalHeight || undefined,
    });
    nextNode.style = size;
    if (source.parentId) nextNode.parentId = source.parentId;
    setNodes((current) => {
      // 画布上被拖动过的节点会被顶到最前（见 handleNodeDragStart 的 nextZIndex），
      // 新节点落在卡片上方时必须跟着取最高的那一层，否则会被整块节点盖住看不见。
      return [
        ...current.map((node) => node.selected ? { ...node, selected: false } : node),
        { ...nextNode, selected: true, zIndex: nextCanvasNodeZIndex(current) },
      ];
    });
  }, [getNodes, readOnly, screenToFlowPosition, setNodes, t]);

  /**
   * 覆盖节点的某一张图：素材节点替换自己的素材；图片生成节点只替换指定序号的结果图。
   * 生成节点里还有别的结果图时不跟着改节点尺寸，否则多图网格会被裁成单图的比例。
   */
  const overwriteNodeImage = useCallback((
    nodeId: string,
    imageIndex: number,
    asset: CanvasStoredAsset,
    fileName: string,
  ) => {
    const node = getNodes().find((item) => item.id === nodeId);
    if (!node) return;
    if (node.data.kind !== "imageGenerator") {
      setNodeAsset(nodeId, asset.url, fileName, "image", "image/png", {
        width: asset.width,
        height: asset.height,
        thumbUrl: asset.thumbUrl,
      });
      return;
    }
    setNodes((current) => current.map((item) => {
      if (item.id !== nodeId) return item;
      const images = [...(item.data.generatedImages || [])];
      if (!images.length) return item;
      const targetIndex = imageIndex >= 0 && imageIndex < images.length ? imageIndex : 0;
      images[targetIndex] = {
        ...images[targetIndex],
        localUrl: asset.url,
        url: undefined,
        thumbUrl: asset.thumbUrl,
        fileName,
        width: asset.width,
        height: asset.height,
        downloadState: "pending",
        downloadedAt: undefined,
      };
      return {
        ...item,
        data: {
          ...item.data,
          generatedImages: images,
          // 只有写回主图时才更新节点记录的原始尺寸：多图节点里第 2+ 张的尺寸
          // 不代表节点展示的主图，写进去会让节点上的分辨率文案和主图对不上。
          ...(targetIndex === 0 ? { imageNaturalWidth: asset.width, imageNaturalHeight: asset.height } : {}),
        },
        style: images.length === 1 && asset.width && asset.height
          ? { ...item.style, ...getImageNodeSize(asset.width, asset.height) }
          : item.style,
      };
    }));
  }, [getNodes, setNodeAsset, setNodes]);

  const cropNodeImage = useCallback(async (
    nodeId: string,
    crop: CanvasImageCropRect,
    options: { mode?: "newNode" | "overwrite"; imageIndex?: number } = {},
  ) => {
    const { mode = "newNode", imageIndex = 0 } = options;
    const version = (imageMutationVersionRef.current.get(nodeId) || 0) + 1;
    imageMutationVersionRef.current.set(nodeId, version);
    const node = getNodes().find((item) => item.id === nodeId);
    // 素材节点只有一张图，图片生成节点可能有多张：按序号取当前正在看的那张。
    const nodeImages = node ? nativeCanvasNodeImages(node.data) : [];
    const image = nodeImages[imageIndex] || nodeImages[0];
    const sourceUrl = String(image?.localUrl || image?.url || "");
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
      // 百分比选区：主进程按源图真实尺寸换算像素（见 cropAsset）。
      unit: "percent",
      defaultName: node.data.label || "cropped-image.png",
    });
    if (!imageThumbnailMountedRef.current || imageMutationVersionRef.current.get(nodeId) !== version) return;
    if (mode === "overwrite") {
      // 覆盖原图：裁剪结果仍然是一张新图，只是把它填回这个节点，
      // 节点位置、连线和分组都保持不变。
      overwriteNodeImage(nodeId, imageIndex, result, derivedAssetName("crop", node.data.assetFileName || node.data.label));
      return;
    }
    createDerivedAssetNode(nodeId, result, {
      kind: "crop",
      label: `${String(node.data.label || t("infiniteCanvas:assetNode"))}-cropped`,
    });
  }, [createDerivedAssetNode, getNodes, overwriteNodeImage, t]);

  /**
   * 图片调整：源图先落到本地资产（远程图直接交给画布绘制会被跨域弄脏），
   * 再交给主进程按同一套公式渲染，最后作为一个派生素材节点落到画布上。
   */
  const adjustNodeImage = useCallback(async (
    nodeId: string,
    adjustments: NativeCanvasImageAdjustments,
    options: { imageIndex?: number; localSourceUrl?: string; mode?: "newNode" | "overwrite" } = {},
  ) => {
    const { imageIndex = 0, localSourceUrl: preloadedSourceUrl = "", mode = "newNode" } = options;
    const version = (imageMutationVersionRef.current.get(nodeId) || 0) + 1;
    imageMutationVersionRef.current.set(nodeId, version);
    const node = getNodes().find((item) => item.id === nodeId);
    const nodeImages = node ? nativeCanvasNodeImages(node.data) : [];
    const image = nodeImages[imageIndex] || nodeImages[0];
    const sourceUrl = String(image?.localUrl || image?.url || "");
    if (!node || !sourceUrl) throw new Error(t("infiniteCanvas:imageAdjustSourceMissing"));
    if (!window.easyTool?.adjustCanvasAsset) throw new Error(t("infiniteCanvas:imageAdjustUnavailable"));

    // 调整窗口里已经落过一次本地素材，这里直接用，避免重复复制文件。
    let localSourceUrl = /^forart-asset:/i.test(preloadedSourceUrl) ? preloadedSourceUrl : sourceUrl;
    if (!/^forart-asset:/i.test(localSourceUrl)) {
      if (!window.easyTool.saveCanvasAsset) throw new Error(t("infiniteCanvas:imageAdjustUnavailable"));
      const stored = await window.easyTool.saveCanvasAsset({
        url: resolveLibraryImageUrl(localSourceUrl),
        defaultName: node.data.label || "canvas-image.png",
        kind: "input",
      });
      localSourceUrl = stored.url;
    }

    const result = await window.easyTool.adjustCanvasAsset({
      url: localSourceUrl,
      adjustments,
      defaultName: node.data.label || "adjusted-image.png",
    });
    if (!imageThumbnailMountedRef.current || imageMutationVersionRef.current.get(nodeId) !== version) return;
    if (mode === "overwrite") {
      // 覆盖原图：渲染结果其实还是"一张新图"，只是把它填回这个节点，
      // 而不是新建一个节点（节点位置、连线、分组都保持不变）。
      overwriteNodeImage(nodeId, imageIndex, result, derivedAssetName("adjust", node.data.assetFileName || node.data.label));
      return;
    }
    createDerivedAssetNode(nodeId, result, {
      kind: "adjust",
      label: `${String(node.data.label || t("infiniteCanvas:assetNode"))}-adjusted`,
    });
  }, [createDerivedAssetNode, getNodes, overwriteNodeImage, t]);

  const applyImageAdjustment = useCallback((
    adjustments: NativeCanvasImageAdjustments,
    localSourceUrl: string,
    mode: "newNode" | "overwrite",
  ) => {
    const target = imageAdjustTarget;
    if (!target) return;
    setImageAdjustBusy(true);
    void adjustNodeImage(target.nodeId, adjustments, {
      imageIndex: target.imageIndex,
      localSourceUrl,
      mode,
    })
      .then(() => {
        // 保存即完成这次调节：组入口和单节点入口都关窗。
        setImageAdjustTarget(null);
        setImageAdjustSession(null);
        toast.success(t("infiniteCanvas:imageAdjustCompleted"));
      })
      .catch((error) => {
        toast.error(t("infiniteCanvas:imageAdjustFailed", {
          message: String(error instanceof Error ? error.message : error),
        }));
      })
      .finally(() => setImageAdjustBusy(false));
  }, [adjustNodeImage, imageAdjustTarget, t]);

  /**
   * 保存整组：按每张图各自的参数逐张覆盖原图（组内每张可以调得不一样）。
   * 串行执行（主进程渲染有并发上限），正在生成的图片跳过。
   */
  const saveImageAdjustGroup = useCallback((
    entries: Array<{ key: string; adjustments: NativeCanvasImageAdjustments }>,
    localSourceUrl: string,
  ) => {
    const activeTarget = imageAdjustTarget;
    const targets = imageAdjustTargets;
    if (!activeTarget || !targets.length) return;
    const activeKey = groupImageAdjustTargetKey(activeTarget.nodeId, activeTarget.imageIndex);
    const adjustmentsByKey = new Map(entries.map((entry) => [entry.key, entry.adjustments]));
    const fallbackAdjustments = adjustmentsByKey.get(activeKey)
      || entries[0]?.adjustments
      || DEFAULT_IMAGE_ADJUSTMENTS;
    setImageAdjustGroupProgress({ done: 0, total: targets.length });
    beginHistoryGesture();
    void (async () => {
      let failed = 0;
      let skipped = 0;
      let done = 0;
      try {
        for (const target of targets) {
          const task = target.taskId ? useGenerationTaskCache.getState().tasksById[target.taskId] : undefined;
          if (isGenerationTaskActive(task)) {
            skipped += 1;
          } else {
            try {
              await adjustNodeImage(target.nodeId, adjustmentsByKey.get(target.key) || fallbackAdjustments, {
                imageIndex: target.imageIndex,
                // 当前这张在面板里已经落过本地素材，直接复用，避免重复复制文件。
                localSourceUrl: target.key === activeKey ? localSourceUrl : undefined,
                mode: "overwrite",
              });
            } catch {
              failed += 1;
            }
          }
          done += 1;
          setImageAdjustGroupProgress({ done, total: targets.length });
        }
      } finally {
        endHistoryGesture();
        setImageAdjustGroupProgress(null);
      }
      if (failed || skipped) {
        toast.error(t("infiniteCanvas:imageAdjustGroupSaveFailed", { failed, skipped }));
      } else {
        toast.success(t("infiniteCanvas:imageAdjustGroupSaved", { count: done }));
      }
      // 保存整组也是"保存"：完成后和单张保存一样关窗。
      setImageAdjustTarget(null);
      setImageAdjustSession(null);
    })();
  }, [adjustNodeImage, beginHistoryGesture, endHistoryGesture, imageAdjustTarget, imageAdjustTargets, t]);

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

  // A silent patch that resolves to the same data must not publish a new node array:
  // node-level effects re-apply their values on every render, and republishing nodes
  // there re-renders the canvas, which lets React run away until it aborts with
  // "Maximum update depth exceeded".
  const applySilentNodePatch = useCallback((nodeId: string, transform: (node: NativeCanvasNode) => NativeCanvasNode) => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        if (node.id !== nodeId) return node;
        const patched = transform(node);
        if (patched === node || (sameNodeData(node.data, patched.data) && sameNodeGeometry(node, patched))) return node;
        changed = true;
        return patched;
      });
      return changed ? next : current;
    });
  }, [setNodes]);

  const patchNodeDataSilently = useCallback((nodeId: string, patch: Partial<NativeCanvasNode["data"]>) => {
    const transformCurrent = (node: NativeCanvasNode) => applyNativeNodeDataPatch(node, patch);
    const transformHistory = (node: NativeCanvasNode) => applyRuntimeNodeDataPatch(node, patch);
    rebaseNode(nodeId, transformCurrent, transformHistory);
    applySilentNodePatch(nodeId, transformCurrent);
  }, [applySilentNodePatch, rebaseNode]);

  const patchBatchImageGeneratorItemSilently = useCallback((nodeId: string, itemId: string, itemPatch: Partial<import("./nativeCanvas").BatchImageGeneratorItem>) => {
    const transform = (node: NativeCanvasNode) => {
      const batch = node.data.kind === "batchImageGenerator" ? node.data.batchImageGenerator : undefined;
      if (!batch?.items.some((item) => item.id === itemId)) return node;
      return applyNativeNodeDataPatch(node, {
        batchImageGenerator: {
          ...batch,
          items: batch.items.map((item) => item.id === itemId ? { ...item, ...itemPatch } : item),
        },
      });
    };
    rebaseNode(nodeId, transform, transform);
    applySilentNodePatch(nodeId, transform);
  }, [applySilentNodePatch, rebaseNode]);

  const patchActionFissionSelectionSilently = useCallback((
    nodeId: string,
    actionFission: NonNullable<NativeCanvasNode["data"]["actionFission"]>,
  ) => {
    const selectedRows = new Map(actionFission.rows.map((row) => [row.id, row]));
    // Current state: copy the selection fields that actually differ. Rows that already
    // match keep their identity, so re-applying the same selection publishes nothing.
    const transformCurrent = (node: NativeCanvasNode) => {
      const current = node.data.kind === "actionFission" ? node.data.actionFission : undefined;
      if (!current) return node;
      const rows = current.rows.map((row) => (
        selectedRows.has(row.id) ? withActionFissionSelection(row, selectedRows.get(row.id)!) : row
      ));
      if (rows.every((row, index) => row === current.rows[index])) return node;
      return {
        ...node,
        data: {
          ...node.data,
          actionFission: { ...current, rows },
        },
      };
    };
    // History keeps the configuration-rebased variant: undo/redo restores the row's
    // configuration, and the selection overlay is re-applied on top of it.
    const transformHistory = (node: NativeCanvasNode) => {
      if (node.data.kind !== "actionFission" || !node.data.actionFission) return node;
      const rows = node.data.actionFission.rows.map((row) => {
        const selectedRow = selectedRows.get(row.id);
        if (!selectedRow || !sameActionFissionConfiguration(row, selectedRow)) return row;
        return withActionFissionSelection(row, selectedRow);
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
    applySilentNodePatch(nodeId, transformCurrent);
  }, [applySilentNodePatch, rebaseNode]);

  const patchImageNodeThumbnail = useCallback((nodeId: string, sourceUrl: string, thumbUrl: string) => {
    const transform = (node: NativeCanvasNode) => applyCanvasNodeThumbnail([node], nodeId, sourceUrl, thumbUrl)[0];
    rebaseNode(nodeId, transform);
    applySilentNodePatch(nodeId, transform);
  }, [applySilentNodePatch, rebaseNode]);

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
  const { runBatchImageGeneration, stopBatchImageGeneration } = useNativeBatchImageGeneration({ canvasId, nodes, edges, patchNodeData: patchNodeDataSilently, t });
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

  const downloadNodeImage = useCallback(async (nodeId: string, imageIndex: number) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    if (node.data.kind === "assetLoader") {
      // 素材节点下载的就是“库里那份文件”：沿用它在库中的名字和格式。
      const target = storedImageDownloadTarget(nativeCanvasNodePrimaryImage(node.data));
      if (!target) return;
      await saveGenerationImageFile({
        imageUrl: target.imageUrl,
        defaultName: target.fileName,
        convertToPng: false,
        directory: fileDownloadPath,
        t,
      });
      return;
    }

    if (node.data.kind === "batchImageGenerator") {
      const item = node.data.batchImageGenerator?.items?.[imageIndex];
      // 批量结果的下载名同样用回传名，不再回退到上传时的原图名。
      const target = storedImageDownloadTarget(item && { localUrl: item.resultUrl, fileName: item.resultFileName });
      if (!target) return;
      await saveGenerationImageFile({ imageUrl: target.imageUrl, defaultName: target.fileName, directory: fileDownloadPath, t });
      const latestNode = nodesRef.current.find((candidate) => candidate.id === nodeId && candidate.data.kind === "batchImageGenerator");
      const latestItems = latestNode?.data.batchImageGenerator?.items || [];
      patchNodeDataSilently(nodeId, { batchImageGenerator: { ...(latestNode?.data.batchImageGenerator || { items: [] }), items: latestItems.map((candidate, index) => index === imageIndex ? { ...candidate, resultDownloadState: "downloaded", resultDownloadedAt: Date.now() } : candidate) } });
      return;
    }

    const target = storedImageDownloadTarget((node.data.generatedImages || [])[imageIndex]);
    if (!target) return;
    const { saved } = await downloadGenerationResult({
      resolveTarget: () => target,
      directory: fileDownloadPath,
    }, t);
    if (!saved) return;
    const latestNode = nodesRef.current.find((item) => item.id === nodeId && item.data.kind === "imageGenerator");
    const latestImages = latestNode?.data.generatedImages || [];
    const latestIndex = latestImages.findIndex((item) => String(item.localUrl || item.url || "").trim() === target.imageUrl);
    if (latestIndex < 0) return;
    patchNodeDataSilently(nodeId, {
      generatedImages: latestImages.map((item, index) => index === latestIndex
        ? { ...item, downloadState: "downloaded", downloadedAt: Date.now() }
        : item),
    });
  }, [nodes, patchNodeDataSilently, t, fileDownloadPath]);

  const downloadContextNodeImage = useCallback(async () => {
    if (!contextNodeImage || !contextNode) return;
    await downloadNodeImage(contextNode.id, 0);
  }, [contextNode, contextNodeImage, downloadNodeImage]);

  const downloadActionFissionResult = useCallback(async (nodeId: string, rowId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    const actionFission = node?.data.actionFission;
    const row = actionFission?.rows.find((item) => item.id === rowId);
    if (!row) return;
    const { task, saved } = await downloadGenerationResult({
      taskId: actionFissionRowTaskId(row) || undefined,
      resolveTarget: (loadedTask) => actionFissionDownloadTarget(row, loadedTask),
      directory: fileDownloadPath,
    }, t);
    if (!saved) return;
    const target = actionFissionDownloadTarget(row, task);
    if (!target) return;
    const latestRow = nodesRef.current
      .find((item) => item.id === nodeId && item.data.kind === "actionFission")
      ?.data.actionFission?.rows.find((item) => item.id === rowId);
    const latestTarget = latestRow ? actionFissionDownloadTarget(latestRow, task) : null;
    if (!latestTarget || latestTarget.imageUrl !== target.imageUrl) return;
    patchActionFissionRow(nodeId, rowId, { resultDownloadState: "downloaded", resultDownloadedAt: Date.now() });
  }, [nodes, patchActionFissionRow, t, fileDownloadPath]);

  const addReferenceImage = useCallback(async (targetNodeId: string, source: {
    imageUrl: string;
    label: string;
    thumbUrl?: string;
    type?: string;
    verticalOffset?: number;
  }) => {
    const target = getNodes().find((node) => (
      node.id === targetNodeId
      && (node.data.kind === "imageGenerator" || node.data.kind === "actionFission" || node.data.kind === "smartReverse")
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
      && (node.data.kind === "imageGenerator" || node.data.kind === "actionFission" || node.data.kind === "smartReverse")
    ));
    if (!latestTarget) return;
    const size = getImageNodeSize(dimensions.width, dimensions.height);
    const referenceNode = createNativeCanvasNode("assetLoader", {
      x: latestTarget.position.x - size.width - 64,
      y: latestTarget.position.y + Number(source.verticalOffset || 0),
    }, {
      assetUrl: imageUrl,
      assetFileName: source.label,
      assetThumbUrl: thumbUrl || undefined,
      assetType: "image",
      assetNaturalWidth: dimensions.width,
      assetNaturalHeight: dimensions.height,
    });
    referenceNode.style = size;
    referenceNode.selected = false;
    setNodes((current) => [...current, { ...referenceNode, zIndex: nextCanvasNodeZIndex(current) }]);
    setEdges((current) => addEdge({
      id: `edge_${crypto.randomUUID()}`,
      type: "default",
      source: referenceNode.id,
      sourceHandle: "output",
      target: targetNodeId,
      targetHandle: "input",
      data: edgeDataForConnection("assetLoader", latestTarget.data.kind, targetNodeId, current),
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
        label: selection.name || t("infiniteCanvas:assetNode"),
      });
      setLibraryReferenceTargetNodeId(null);
      setLibraryOpen(false);
      return;
    }
    if (libraryTargetNodeId) {
      setNodeAsset(libraryTargetNodeId, selection.url, selection.name || t("infiniteCanvas:assetNode"));
      setLibraryTargetNodeId(null);
      setLibraryOpen(false);
      return;
    }
    const rect = wrapperRef.current?.getBoundingClientRect();
    const point = rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 };
    const node = addNode("assetLoader", point.x, point.y, {
      assetUrl: selection.url,
      assetType: "image",
    });
    setNodeAsset(node.id, selection.url, selection.name || t("infiniteCanvas:assetNode"));
  }, [addNode, addReferenceImage, libraryReferenceTargetNodeId, libraryTargetNodeId, screenToFlowPosition, setNodeAsset, t]);

  const canvasActionHandlersRef = useRef({
    addImageReferenceFiles,
    downloadActionFissionResult,
    downloadNodeImage,
    discardActionFissionRow: stopActionFissionImmediately,
    runImageGeneration,
    runActionFission,
    runBatchImageGeneration,
    stopImageGeneration,
    stopActionFission,
    stopBatchImageGeneration,
  });
  canvasActionHandlersRef.current = {
    addImageReferenceFiles,
    downloadActionFissionResult,
    downloadNodeImage,
    discardActionFissionRow: stopActionFissionImmediately,
    runImageGeneration,
    runActionFission,
    runBatchImageGeneration,
    stopImageGeneration,
    stopActionFission,
    stopBatchImageGeneration,
  };

  const canvasActions = useMemo<NativeCanvasActions>(() => ({
    readOnly,
    beginHistoryGesture,
    endHistoryGesture,
    undoCanvasHistory: undoHistory,
    redoCanvasHistory: redoHistory,
    addImageReferenceFiles: (nodeId, files) => canvasActionHandlersRef.current.addImageReferenceFiles(nodeId, files),
    cropNodeImage,
    adjustNodeImage,
    openImageAdjustDialog: (nodeId: string, imageIndex = 0, options: { scope?: "node" | "group" } = {}) => {
      if (readOnly) return;
      const scope = options.scope === "group" ? "group" : "node";
      // 组入口先记下是哪个组，活动目标由 context 失效逻辑切到组内第一张图。
      setImageAdjustSession(scope === "group" ? { scope, groupId: nodeId } : null);
      setImageAdjustTarget({ nodeId, imageIndex });
    },
    createAssetNodeFromResult,
    createDerivedAssetNode,
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
    patchBatchImageGeneratorItemSilently,
    removeCanvasEdge: (edgeId: string) => setEdges((current) => current.filter((edge) => edge.id !== edgeId)),
    reorderImageGeneratorReferences: (nodeId: string, orderedEdgeIds: string[]) => {
      // 参考条里的每一项可能来自同一条边的多张图（多图节点、组），
      // 所以这里同时推导「边之间的顺序」和「边内部多张图的顺序」。
      const references = collectImageGeneratorReferences(nodeId, nodesRef.current, edgesRef.current);
      const referenceById = new Map(references.map((reference) => [reference.edgeId, reference]));
      const orderByEdgeId = new Map<string, number>();
      const imageOrderByEdgeId = new Map<string, string[]>();
      orderedEdgeIds.forEach((edgeId) => {
        const reference = referenceById.get(edgeId);
        const sourceEdgeId = reference?.sourceEdgeId || edgeId;
        if (!sourceEdgeId) return;
        if (!orderByEdgeId.has(sourceEdgeId)) orderByEdgeId.set(sourceEdgeId, orderByEdgeId.size + 1);
        if (!reference?.sortKey) return;
        const images = imageOrderByEdgeId.get(sourceEdgeId) || [];
        if (!images.includes(reference.sortKey)) images.push(reference.sortKey);
        imageOrderByEdgeId.set(sourceEdgeId, images);
      });
      setEdges((current) => current.map((edge) => (
        edge.target === nodeId && (orderByEdgeId.has(edge.id) || imageOrderByEdgeId.has(edge.id))
          ? {
              ...edge,
              data: {
                ...edge.data,
                ...(orderByEdgeId.has(edge.id) ? { referenceOrder: orderByEdgeId.get(edge.id) } : {}),
                ...(imageOrderByEdgeId.has(edge.id) ? { referenceImageOrder: imageOrderByEdgeId.get(edge.id) } : {}),
              },
            }
          : edge
      )));
    },
    runImageGeneration: (nodeId, options) => canvasActionHandlersRef.current.runImageGeneration(nodeId, options),
    runActionFission: (nodeId, rowId) => canvasActionHandlersRef.current.runActionFission(nodeId, rowId),
    runBatchImageGeneration: (nodeId, itemId) => canvasActionHandlersRef.current.runBatchImageGeneration(nodeId, itemId),
    setNodeAsset,
    setNodeText: (nodeId: string, text: string) => patchNodeData(nodeId, { text }),
    stopImageGeneration: (nodeId) => canvasActionHandlersRef.current.stopImageGeneration(nodeId),
    stopActionFission: (nodeId, rowId) => canvasActionHandlersRef.current.stopActionFission(nodeId, rowId),
    stopBatchImageGeneration: (nodeId, itemId) => canvasActionHandlersRef.current.stopBatchImageGeneration(nodeId, itemId),
  }), [adjustNodeImage, beginHistoryGesture, cropNodeImage, createAssetNodeFromResult, createDerivedAssetNode, endHistoryGesture, patchActionFissionSelectionSilently, patchBatchImageGeneratorItemSilently, patchNodeData, patchNodeDataSilently, readOnly, setEdges, setNodeAsset, t]);

  const validateConnection = useCallback<IsValidConnection<NativeCanvasEdge>>((connection) => (
    isNativeCanvasConnectionValid(connection, nodesRef.current, edgesRef.current)
  ), []);

  const beginConnectionFeedback = useCallback<OnConnectStart>((_event, params) => {
    if (!params.nodeId || !params.handleType) return;
    activeConnectionStartRef.current = {
      nodeId: params.nodeId,
      handleId: params.handleId,
      handleType: params.handleType,
    };
    setConnectionTargetFeedback(null);
  }, []);

  const clearConnectionFeedback = useCallback(() => {
    activeConnectionStartRef.current = null;
    setConnectionTargetFeedback(null);
  }, []);

  const updateConnectionTargetFeedback = useCallback((clientX: number, clientY: number) => {
    const activeConnection = activeConnectionStartRef.current;
    if (!activeConnection) return;

    const hoveredElement = document.elementFromPoint(clientX, clientY);
    const nodeElement = hoveredElement?.closest<HTMLElement>(".react-flow__node");
    const nodeId = nodeElement?.dataset.id;
    if (!nodeId || !wrapperRef.current?.contains(nodeElement)) {
      setConnectionTargetFeedback(null);
      return;
    }

    const handleElement = hoveredElement?.closest<HTMLElement>(".react-flow__handle");
    const hoveredHandleType = handleElement?.classList.contains("source")
      ? "source"
      : handleElement?.classList.contains("target")
        ? "target"
        : null;
    const expectedHandleType = activeConnection.handleType === "source" ? "target" : "source";
    const candidate: NativeCanvasConnectionCandidate = activeConnection.handleType === "source"
      ? {
          source: activeConnection.nodeId,
          sourceHandle: activeConnection.handleId,
          target: nodeId,
          targetHandle: handleElement?.dataset.handleid || "input",
        }
      : {
          source: nodeId,
          sourceHandle: handleElement?.dataset.handleid || "output",
          target: activeConnection.nodeId,
          targetHandle: activeConnection.handleId,
        };
    const canConnectFromPointer = activeConnection.handleType === "source"
      ? hoveredHandleType !== "source"
      : hoveredHandleType === expectedHandleType;
    const status = canConnectFromPointer
      && isNativeCanvasConnectionValid(candidate, nodesRef.current, edgesRef.current)
      ? "valid"
      : "invalid";

    setConnectionTargetFeedback((current) => (
      current?.nodeId === nodeId && current.status === status
        ? current
        : { nodeId, status }
    ));
  }, []);

  const connectNodes = useCallback((connection: Connection) => {
    setEdges((current) => {
      const currentNodes = getNodes();
      if (!isNativeCanvasConnectionValid(connection, currentNodes, current)) return current;
      const nodeMap = new Map(currentNodes.map((node) => [node.id, node]));
      const source = connection.source ? nodeMap.get(connection.source) : undefined;
      const target = connection.target ? nodeMap.get(connection.target) : undefined;
      if (!source || !target) return current;
      const data = edgeDataForConnection(
        source.data.kind,
        target.data.kind,
        target.id,
        current,
        connection.targetHandle,
      );
      return addEdge({
        ...connection,
        type: "default",
        data,
      }, current);
    });
  }, [getNodes, setEdges]);

  const connectToNodeBody = useCallback<OnConnectEnd>((event, connectionState) => {
    clearConnectionFeedback();
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
  }, [clearConnectionFeedback, connectNodes, getIntersectingNodes, screenToFlowPosition]);

  const addImageFilesAtFlowPoint = useCallback(async (
    files: File[],
    flowPoint: { x: number; y: number },
  ) => {
    const assetFiles = files.filter(isCanvasAssetFile);
    if (!assetFiles.length) return;
    // Read only the image header/dimensions first. This avoids waiting for
    // Base64 conversion, disk I/O, and sharp thumbnail generation before the
    // user sees anything on the canvas.
    const images = await Promise.all(assetFiles.map(async (file, index) => ({
      file,
      dimensions: await readMediaFileDimensions(file),
      assetType: file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm)$/i.test(file.name) ? "video" as const : "image" as const,
      index,
    })));
    const imageNodes = images.map(({ file, dimensions, assetType, index }) => {
      const size = assetType === "video"
        ? getVideoNodeSize(dimensions.width, dimensions.height)
        : getImageNodeSize(dimensions.width, dimensions.height);
      const node = createNativeCanvasNode("assetLoader", {
        x: flowPoint.x - size.width / 2 + index * 32,
        y: flowPoint.y - size.height / 2 + index * 32,
      }, {
        assetFileName: file.name,
        assetType,
        assetNaturalWidth: dimensions.width,
        assetNaturalHeight: dimensions.height,
        assetLoadState: "processing",
      });
      return { node: { ...node, style: size, selected: true }, file, dimensions, assetType };
    });
    setNodes((current) => {
      const zIndex = nextCanvasNodeZIndex(current);
      return [
        ...current.map((node) => node.selected ? { ...node, selected: false } : node),
        ...imageNodes.map((item) => ({ ...item.node, zIndex })),
      ];
    });

    // Process each image independently. The first completed image is patched
    // into the canvas immediately instead of waiting for the whole paste/drop
    // batch to finish.
    void Promise.all(imageNodes.map(async ({ node, file, dimensions, assetType }) => {
      const version = (imageMutationVersionRef.current.get(node.id) || 0) + 1;
      imageMutationVersionRef.current.set(node.id, version);
      try {
        const stored = window.easyTool?.importCanvasAssetFile
          ? await window.easyTool.importCanvasAssetFile({ file })
          : assetType === "image" && window.easyTool?.saveCanvasAsset
            ? await readImageFileAsDataUrl(file).then((dataUrl) => window.easyTool!.saveCanvasAsset({ dataUrl, defaultName: file.name, kind: "input", type: file.type }))
            : { url: URL.createObjectURL(file), thumbUrl: "" };
        if (!imageThumbnailMountedRef.current || imageMutationVersionRef.current.get(node.id) !== version) return;
        setNodes((current) => current.map((item) => item.id === node.id
          ? {
              ...item,
              data: {
                ...item.data,
                assetUrl: stored.url,
                assetFileName: file.name,
                assetType,
                assetThumbUrl: stored.thumbUrl || undefined,
                assetNaturalWidth: dimensions.width,
                assetNaturalHeight: dimensions.height,
                assetDurationMs: Number((stored as { durationMs?: number }).durationMs || 0) || undefined,
                assetSizeBytes: Number((stored as { sizeBytes?: number }).sizeBytes || file.size) || undefined,
                assetLoadState: undefined,
                assetLoadError: undefined,
              },
            }
          : item));
      } catch (error) {
        if (!imageThumbnailMountedRef.current || imageMutationVersionRef.current.get(node.id) !== version) return;
        setNodes((current) => current.map((item) => item.id === node.id
          ? {
              ...item,
              data: {
                ...item.data,
                assetLoadState: "error",
                assetLoadError: error instanceof Error ? error.message : String(error),
              },
            }
          : item));
      }
    }));
  }, [setNodes]);

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
      const selectionAnchor = window.getSelection()?.anchorNode;
      const selectionElement = selectionAnchor instanceof HTMLElement
        ? selectionAnchor
        : selectionAnchor?.parentElement;
      if (
        readOnly
        || !isCanvasAvailable()
        || isEditingTarget(event.target)
        || Boolean(selectionElement?.closest("[data-canvas-text-copy]"))
      ) return;
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

        setNodes((current) => {
          // 粘贴出来的节点整体上移一层：组和它的子节点相对层级保持不变，
          // 同时整组都落在画布已有节点之上。
          const zIndex = nextCanvasNodeZIndex(current);
          return [
            ...current.map((node) => node.selected ? { ...node, selected: false } : node),
            ...pasted.nodes.map((node) => ({ ...node, zIndex: (node.zIndex || 0) + zIndex })),
          ];
        });
        setEdges((current) => [
          ...current.map((edge) => edge.selected ? { ...edge, selected: false } : edge),
          ...pasted.edges,
        ]);
        return;
      }

      const itemImageFiles = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === "file" && (item.type.startsWith("image/") || item.type.startsWith("video/")))
        .flatMap((item) => item.getAsFile() || []);
      const imageFiles = itemImageFiles.length ? itemImageFiles : Array.from(event.clipboardData?.files || [])
        .filter(isCanvasAssetFile);
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
              updateConnectionTargetFeedback(event.clientX, event.clientY);
            }}
            onDragOver={(event) => {
              if (readOnly) return;
              const hasImage = Array.from(event.dataTransfer.items || [])
                .some((item) => item.kind === "file" && (item.type.startsWith("image/") || item.type.startsWith("video/") || /\.(mp4|m4v|mov|webm)$/i.test(item.getAsFile?.()?.name || "")));
              if (!hasImage) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              if (readOnly) return;
              const imageFiles = Array.from(event.dataTransfer.files || [])
                .filter(isCanvasAssetFile);
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
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onNodesDelete={readOnly ? undefined : stopDeletedNodeTasks}
              onEdgesChange={onEdgesChange}
              onSelectionChange={handleSelectionChange}
              onEdgeMouseMove={trackSelectedEdge}
              onEdgeMouseLeave={leaveSelectedEdge}
              isValidConnection={validateConnection}
              onConnect={readOnly ? undefined : connectNodes}
              onConnectStart={readOnly ? undefined : beginConnectionFeedback}
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
                  offset={MULTI_SELECTION_TOOLBAR_SCREEN_OFFSET}
                  className="rf-native-multi-selection-toolbar nodrag nopan nowheel"
                >
                  <span className="rf-native-multi-selection-count">
                    {t("infiniteCanvas:selectedNodeCount", { count: selectedNodeIds.length })}
                  </span>
                  <Button type="button" variant="ghost" size="sm" disabled={!canGroupSelectedNodes} onClick={groupSelectedNodes}>
                    <GroupIcon aria-hidden="true" />
                    <span>{t("infiniteCanvas:groupSelectedNodes")}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-sm"
                    aria-label={t("infiniteCanvas:deleteSelectedNodes")}
                    title={t("infiniteCanvas:deleteSelectedNodes")}
                    onClick={deleteSelectedNodes}
                  >
                    <Trash2 aria-hidden="true" />
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
              {contextNode.data.kind === "assetLoader" || contextNode.data.kind === "imageGenerator" ? (
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

        {!readOnly && imageAdjustContext ? <ImageAdjustDialog
          open
          label={imageAdjustContext.label}
          sourceUrl={imageAdjustContext.imageUrl}
          fallbackUrl={imageAdjustContext.previewUrl}
          naturalWidth={imageAdjustContext.naturalWidth}
          naturalHeight={imageAdjustContext.naturalHeight}
          busy={imageAdjustBusy || Boolean(imageAdjustGroupProgress)}
          targets={imageAdjustTargetOptions.length ? imageAdjustTargetOptions : undefined}
          activeTargetKey={imageAdjustTarget ? groupImageAdjustTargetKey(imageAdjustTarget.nodeId, imageAdjustTarget.imageIndex) : ""}
          onSelectTarget={(key) => {
            const target = imageAdjustTargets.find((item) => item.key === key);
            if (target) setImageAdjustTarget({ nodeId: target.nodeId, imageIndex: target.imageIndex });
          }}
          onSaveGroup={imageAdjustSession ? saveImageAdjustGroup : undefined}
          groupSaveProgress={imageAdjustGroupProgress}
          onOpenChange={(open) => {
            if (!open) {
              setImageAdjustTarget(null);
              setImageAdjustSession(null);
              setImageAdjustGroupProgress(null);
            }
          }}
          onApply={applyImageAdjustment}
        /> : null}

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
  fileDownloadPath?: string;
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
  const edgeIdMap = new Map(payload.edges.map((edge) => [edge.id, `edge_${crypto.randomUUID()}`]));
  return {
    idMap,
    nodes: payload.nodes.map((node) => {
      const clonedParentId = node.parentId ? idMap.get(node.parentId) : undefined;
      const data = remapNativeCanvasNodePromptReferences(node.data, edgeIdMap);
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
      id: edgeIdMap.get(edge.id)!,
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
      data: edge.data ? { ...edge.data } : undefined,
      selected: false,
    })),
  };
}

export const ReactFlowCanvasPage = memo(function ReactFlowCanvasPage({ canvasId, fileDownloadPath, initialSnapshot = emptyCanvasSnapshot(), onInteractionChange, onSnapshotChange, onViewportChange, onSave, readOnly = false }: ReactFlowCanvasPageProps) {
  const { t } = useTranslation();
  return (
    <section className="infinite-canvas-page" aria-label={t("infiniteCanvas:title")}>
      <ReactFlowProvider>
        <NativeCanvasSurface canvasId={canvasId} fileDownloadPath={fileDownloadPath} initialSnapshot={initialSnapshot} onInteractionChange={onInteractionChange} onSnapshotChange={onSnapshotChange} onViewportChange={onViewportChange} onSave={onSave} readOnly={readOnly} />
      </ReactFlowProvider>
    </section>
  );
});

export default ReactFlowCanvasPage;
