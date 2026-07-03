import { Check, Crosshair, Crop, Eye, Images, Layers, Map as MapIcon, Play, Ratio, Square, Trash2, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { PointerEvent, WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageViewer } from "../../lib/ImageViewer";
import { API_PROVIDER_CHANGED_EVENT, getModelDisplayName, loadApiSettings, readApiProviders, type ApiProvider } from "../settings/apiProviders";
import { CanvasHomePanel } from "./CanvasHomePanel";
import { CanvasTabsBar } from "./CanvasTabsBar";
import { ACTION_FISSION_NODE_MIN_HEIGHT, ACTION_FISSION_NODE_MIN_WIDTH } from "./constants";
import { canConnect } from "./core/rules";
import { collectPrompt } from "./core/workflow";
import { clamp, getGroupBounds, linkMidpoint, WORLD_CENTER } from "./canvasGeometry";
import { ImageGeneratorComposer } from "./composers/ImageGeneratorComposer";
import { useLibtvGenerationActions } from "./libtv-generation/useLibtvGenerationActions";
import { LibraryAssetPickerRail } from "../library-asset-picker/LibraryAssetPickerRail";
import type { LibraryAssetSelection } from "../library-asset-picker/types";
import type { ActionEntry, ActionTag } from "../action-library/types";
import type { ImageGeneratorInputPreview } from "./composers/composerTypes";
import { getImageGenerationReadiness } from "./core/imageGenerationReadiness";
import { ConnectionLayer } from "./layers/ConnectionLayer";
import { GroupLayer } from "./layers/GroupLayer";
import { NodeLayer, type NodeBodyRenderState } from "./layers/NodeLayer";
import { SelectionPreviewLayer } from "./layers/SelectionPreviewLayer";
import { isImageLikeNode } from "./nodePredicates";
import { NodeToolbar } from "./toolbars/NodeToolbar";
import { SelectionToolbar } from "./toolbars/SelectionToolbar";
import { CanvasNodeBodyRenderer, type CanvasNodeBodyActions } from "./nodes/CanvasNodeBodyRenderer";
import {
  commitCanvasDocumentChange,
  ensureCanvasDocument,
  redoCanvasHistory,
  undoCanvasHistory,
  useCanvasStore,
  type CanvasDocument,
} from "./canvasStore";
import { cloneCanvasNodeForNewTarget } from "./canvasNodeClone";
import { useCanvasUiStore } from "./canvasUiStore";
import { createCanvasNode, getNodeDefinition } from "./nodes/registry";
import { createInitialCanvas, useCanvasProjects } from "./useCanvasProjects";
import type { CanvasDocumentTab } from "./canvasTabs";
import { useRemoteCanvasExchange } from "./remote-canvas/useRemoteCanvasExchange";
import { useCanvasGenerationActions } from "./useCanvasGenerationActions";
import { useActionFissionGenerationActions } from "./generation/useActionFissionGenerationActions";
import { stopLocalGenerationTasksForNode, stopLocalGenerationTasksForTarget } from "./generation/generationTaskRegistry";
import { getGenerationTaskForNodeTarget, isGenerationTargetActiveFromNodes, isNodeGenerationActiveFromAnchor } from "./generation/nodeGenerationTaskAnchors";
import { hasClipboardImage, hasDraggedImageFile, useCanvasMediaActions } from "./useCanvasMediaActions";
import type { ActionFissionRow } from "./action-fission/actionFissionTypes";
import { detectImageModelRuleId, getImageModelRule } from "../settings/imageModelRules";
import { countDirectActionFissionImageConnections } from "./action-fission/actionFissionReferences";
import { BASE_PUBLIC_REFERENCE_LIMIT } from "./action-fission/actionFissionTypes";
import type { CanvasConnection, CanvasGenerationTarget, CanvasGroup, CanvasNode, CanvasNodeType, Viewport } from "./types";

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const MINIMAP_DEFAULT_WIDTH = 190;
const MINIMAP_DEFAULT_HEIGHT = 128;
const MINIMAP_PADDING = 160;
const FIT_VIEW_PADDING = 0.16;
const NODE_DRAG_START_THRESHOLD = 8;
const GROUP_PADDING = 32;
const EMPTY_GROUP_DEFAULT_WIDTH = 360;
const EMPTY_GROUP_DEFAULT_HEIGHT = 240;
const CANVAS_LIBRARY_PICKER_TARGET = "__canvas__";
const LOCAL_CONTEXT_MENU_NODE_TYPES = ["imageGenerator", "imageLoader", "actionFission", "llm", "prompt"] as const satisfies readonly CanvasNodeType[];

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  pendingSelectNodeId: string;
  selectionIds: Set<string>;
  nodes: Array<{
    id: string;
    startX: number;
    startY: number;
  }>;
  active: boolean;
  copyOnDrag: boolean;
}

interface GroupDragState {
  pointerId: number;
  groupId: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
    nodes: Array<{
      id: string;
      startX: number;
    startY: number;
  }>;
  active: boolean;
}

interface PanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewport: Viewport;
}

interface SelectionDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
}

interface ResizeState {
  pointerId: number;
  nodeId: string;
  startClientX: number;
  startClientY: number;
  startW: number;
  startH: number;
}

interface GroupResizeState {
  pointerId: number;
  groupId: string;
  startClientX: number;
  startClientY: number;
  startW: number;
  startH: number;
}

interface LinkDraft {
  pointerId: number;
  from: string;
  x: number;
  y: number;
}

interface MinimapDragState {
  pointerId: number;
}

interface ScheduledFrame<T> {
  frame: number;
  value: T | null;
}

interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CopiedCanvasSelection {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
}

const CANVAS_NODES_CLIPBOARD_KIND = "forart.canvas.nodes";

function nodeDefaults(type: CanvasNodeType): CanvasNode {
  return createCanvasNode(type, uid(type));
}

function getNodesBounds(nodes: CanvasNode[]): BoundsRect | null {
  if (!nodes.length) return null;
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.w));
  const maxY = Math.max(...nodes.map((node) => node.y + node.h));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function pointInBounds(point: { x: number; y: number }, bounds: BoundsRect) {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function getViewportForBounds(bounds: BoundsRect, width: number, height: number, minZoom: number, maxZoom: number, padding = FIT_VIEW_PADDING): Viewport {
  const paddedWidth = bounds.width * (1 + padding * 2);
  const paddedHeight = bounds.height * (1 + padding * 2);
  const nextScale = clamp(Math.min(width / paddedWidth, height / paddedHeight), minZoom, maxZoom);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    x: -centerX * nextScale,
    y: -centerY * nextScale,
    scale: nextScale,
  };
}

function isEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function isCanvasNodeType(value: unknown): value is CanvasNodeType {
  return value === "imageGenerator"
    || value === "libtvImageGenerator"
    || value === "imageLoader"
    || value === "prompt"
    || value === "llm"
    || value === "actionFission";
}

function normalizeClipboardSelection(input: unknown): CopiedCanvasSelection | null {
  const parsed = input as (Partial<CopiedCanvasSelection> & { kind?: unknown }) | null;
  if (!parsed || !Array.isArray(parsed.nodes)) return null;
  if (parsed.kind !== CANVAS_NODES_CLIPBOARD_KIND) return null;
  const nodes = parsed.nodes.flatMap((nodeInput) => {
    const node = nodeInput as Partial<CanvasNode> | null;
    if (!node?.id || !isCanvasNodeType(node.type)) return [];
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.w) || !Number.isFinite(node.h)) return [];
    return [{
      ...node,
      id: String(node.id),
      type: node.type,
      x: Number(node.x),
      y: Number(node.y),
      w: Number(node.w),
      h: Number(node.h),
      title: String(node.title || ""),
    } as CanvasNode];
  });
  if (!nodes.length) return null;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const connections = Array.isArray(parsed.connections)
    ? parsed.connections.flatMap((connectionInput) => {
      const connection = connectionInput as Partial<CanvasConnection> | null;
      if (!connection?.id || !connection.from || !connection.to) return [];
      if (!nodeIds.has(connection.from) || !nodeIds.has(connection.to)) return [];
      return [{ id: String(connection.id), from: String(connection.from), to: String(connection.to) }];
    })
    : [];
  return { nodes, connections };
}

function readClipboardSelection(dataTransfer: DataTransfer | null) {
  const text = dataTransfer?.getData("text/plain");
  if (!text) return null;
  try {
    return normalizeClipboardSelection(JSON.parse(text));
  } catch {
    return null;
  }
}

function useStableEvent<T extends (...args: never[]) => unknown>(handler: T): T {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback(((...args: Parameters<T>) => handlerRef.current(...args)) as T, []);
}

interface CanvasPageProps {
  imageDownloadPath?: string;
}

export function CanvasPage({ imageDownloadPath = "" }: CanvasPageProps) {
  const { t } = useTranslation();
  const initialRef = useRef(createInitialCanvas());
  ensureCanvasDocument({ nodes: initialRef.current.nodes, connections: initialRef.current.connections, groups: initialRef.current.groups });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const dragRef = useRef<DragState | null>(null);
  const groupDragRef = useRef<GroupDragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const groupResizeRef = useRef<GroupResizeState | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const minimapDragRef = useRef<MinimapDragState | null>(null);
  const readOnlyRef = useRef(false);
  const zoomInputRef = useRef<HTMLInputElement | null>(null);
  const dragHistoryRef = useRef<CanvasDocument | null>(null);
  const selectionFrameRef = useRef<ScheduledFrame<{ box: SelectionBox; selectedIds: Set<string> }>>({ frame: 0, value: null });
  const viewportFrameRef = useRef<ScheduledFrame<Viewport>>({ frame: 0, value: null });
  const nodeDragFrameRef = useRef<ScheduledFrame<{ positions: Map<string, { x: number; y: number }> }>>({ frame: 0, value: null });
  const groupDragFrameRef = useRef<ScheduledFrame<{ groupId: string; groupX: number; groupY: number; positions: Map<string, { x: number; y: number }> }>>({ frame: 0, value: null });
  const nodeResizeFrameRef = useRef<ScheduledFrame<{ nodeId: string; w: number; h: number }>>({ frame: 0, value: null });
  const groupResizeFrameRef = useRef<ScheduledFrame<{ groupId: string; w: number; h: number }>>({ frame: 0, value: null });
  const linkDraftFrameRef = useRef<ScheduledFrame<LinkDraft>>({ frame: 0, value: null });
  const nodes = useCanvasStore((state) => state.nodes);
  const connections = useCanvasStore((state) => state.connections);
  const groups = useCanvasStore((state) => state.groups);
  const setNodes = useCanvasStore((state) => state.setNodes);
  const setNodesWithoutHistory = useCanvasStore((state) => state.setNodesWithoutHistory);
  const setConnections = useCanvasStore((state) => state.setConnections);
  const setGroups = useCanvasStore((state) => state.setGroups);
  const setCanvasDocument = useCanvasStore((state) => state.setCanvasDocument);
  const setCanvasDocumentWithoutHistory = useCanvasStore((state) => state.setCanvasDocumentWithoutHistory);
  const [viewport, setViewport] = useState<Viewport>(initialRef.current.viewport);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [minimapSize, setMinimapSize] = useState({ width: MINIMAP_DEFAULT_WIDTH, height: MINIMAP_DEFAULT_HEIGHT });
  const selectedIds = useCanvasUiStore((state) => state.selectedIds);
  const selectedGroupId = useCanvasUiStore((state) => state.selectedGroupId);
  const selectedConnectionId = useCanvasUiStore((state) => state.selectedConnectionId);
  const setSelectedIds = useCanvasUiStore((state) => state.setSelectedIds);
  const setSelectedGroupId = useCanvasUiStore((state) => state.setSelectedGroupId);
  const setSelectedConnectionId = useCanvasUiStore((state) => state.setSelectedConnectionId);
  const [showConnections, setShowConnections] = useState(true);
  const [isNodeDragging, setIsNodeDragging] = useState(false);
  const [connectionAction, setConnectionAction] = useState<{ id: string; left: number; top: number } | null>(null);
  const setHoveredId = useCanvasUiStore((state) => state.setHoveredId);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const [cropAspectMenuOpen, setCropAspectMenuOpen] = useState(false);
  const [isMinimapOpen, setIsMinimapOpen] = useState(false);
  const [isZoomMenuOpen, setIsZoomMenuOpen] = useState(false);
  const [zoomInput, setZoomInput] = useState(() => String(Math.round(initialRef.current.viewport.scale * 100)));
  const [apiProviders, setApiProviders] = useState<ApiProvider[]>(readApiProviders);
  const defaultImageProviderId = "";
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [draggedInputConnectionId, setDraggedInputConnectionId] = useState("");
  const [inputInsertIndex, setInputInsertIndex] = useState<number | null>(null);
  const editingPromptId = useCanvasUiStore((state) => state.editingPromptId);
  const setEditingPromptId = useCanvasUiStore((state) => state.setEditingPromptId);
  const [editingGroupId, setEditingGroupId] = useState("");
  const [openImageComposerSelect, setOpenImageComposerSelect] = useState("");
  const [libraryPickerNodeId, setLibraryPickerNodeId] = useState("");
  const [actionFissionPreview, setActionFissionPreview] = useState<{ src: string; alt: string } | null>(null);

  const scheduleFrame = useCallback(<T,>(slot: React.MutableRefObject<ScheduledFrame<T>>, value: T, apply: (value: T) => void) => {
    slot.current.value = value;
    if (slot.current.frame) return;
    slot.current.frame = window.requestAnimationFrame(() => {
      slot.current.frame = 0;
      const latest = slot.current.value;
      slot.current.value = null;
      if (latest) apply(latest);
    });
  }, []);

  const cancelScheduledFrame = useCallback(<T,>(slot: React.MutableRefObject<ScheduledFrame<T>>) => {
    if (slot.current.frame) window.cancelAnimationFrame(slot.current.frame);
    slot.current.frame = 0;
    slot.current.value = null;
  }, []);

  const flushScheduledFrame = useCallback(<T,>(slot: React.MutableRefObject<ScheduledFrame<T>>, apply: (value: T) => void) => {
    if (slot.current.frame) window.cancelAnimationFrame(slot.current.frame);
    slot.current.frame = 0;
    const latest = slot.current.value;
    slot.current.value = null;
    if (latest) apply(latest);
  }, []);

  const applySelectionFrame = useCallback(({ box, selectedIds: nextIds }: { box: SelectionBox; selectedIds: Set<string> }) => {
    setSelectionBox(box);
    setSelectedIds(nextIds);
  }, []);

  const applyViewportFrame = useCallback((nextViewport: Viewport) => {
    setViewport(nextViewport);
  }, []);

  const applyNodeDragFrame = useCallback(({ positions }: { positions: Map<string, { x: number; y: number }> }) => {
    setNodesWithoutHistory((current) => current.map((currentNode) => {
      const nextPosition = positions.get(currentNode.id);
      return nextPosition ? { ...currentNode, ...nextPosition } : currentNode;
    }));
  }, [setNodesWithoutHistory]);

  const applyGroupDragFrame = useCallback(({ groupId, groupX, groupY, positions }: { groupId: string; groupX: number; groupY: number; positions: Map<string, { x: number; y: number }> }) => {
    setCanvasDocumentWithoutHistory((current) => ({
      ...current,
      nodes: current.nodes.map((currentNode) => {
        const nextPosition = positions.get(currentNode.id);
        return nextPosition ? { ...currentNode, ...nextPosition } : currentNode;
      }),
      groups: current.groups.map((group) => (
        group.id === groupId
          ? { ...group, x: groupX, y: groupY }
          : group
      )),
    }));
  }, [setCanvasDocumentWithoutHistory]);

  function nodeDragPositions(drag: DragState, clientX: number, clientY: number) {
    const dx = (clientX - drag.startClientX) / viewport.scale;
    const dy = (clientY - drag.startClientY) / viewport.scale;
    return new Map(drag.nodes.map((draggedNode) => [draggedNode.id, {
      x: Math.round(draggedNode.startX + dx),
      y: Math.round(draggedNode.startY + dy),
    }]));
  }

  function groupDragSnapshot(groupDrag: GroupDragState, clientX: number, clientY: number) {
    const dx = (clientX - groupDrag.startClientX) / viewport.scale;
    const dy = (clientY - groupDrag.startClientY) / viewport.scale;
    return {
      groupId: groupDrag.groupId,
      groupX: Math.round(groupDrag.startX + dx),
      groupY: Math.round(groupDrag.startY + dy),
      positions: new Map(groupDrag.nodes.map((draggedNode) => [draggedNode.id, {
        x: Math.round(draggedNode.startX + dx),
        y: Math.round(draggedNode.startY + dy),
      }])),
    };
  }

  const applyNodeResizeFrame = useCallback(({ nodeId, w, h }: { nodeId: string; w: number; h: number }) => {
    setNodesWithoutHistory((current) => current.map((node) => (node.id === nodeId ? { ...node, w, h } : node)));
  }, [setNodesWithoutHistory]);

  const applyGroupResizeFrame = useCallback(({ groupId, w, h }: { groupId: string; w: number; h: number }) => {
    setCanvasDocumentWithoutHistory((current) => ({
      ...current,
      groups: current.groups.map((group) => (
        group.id === groupId ? { ...group, w, h } : group
      )),
    }));
  }, [setCanvasDocumentWithoutHistory]);

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const nodeMapRef = useRef(nodeMap);
  const viewportRef = useRef(viewport);
  const stageSizeRef = useRef(stageSize);
  nodeMapRef.current = nodeMap;
  viewportRef.current = viewport;
  stageSizeRef.current = stageSize;
  const selectedNodesBounds = useMemo(() => getNodesBounds(nodes.filter((node) => selectedIds.has(node.id))), [nodes, selectedIds]);
  const selectionGroupBounds = useMemo(() => selectedNodesBounds ? ({
    x: selectedNodesBounds.x - GROUP_PADDING,
    y: selectedNodesBounds.y - GROUP_PADDING,
    width: selectedNodesBounds.width + GROUP_PADDING * 2,
    height: selectedNodesBounds.height + GROUP_PADDING * 2,
  }) : null, [selectedNodesBounds]);
  const imageProviders = useMemo(() => apiProviders.filter((provider) => provider.protocol !== "gemini" && provider.imageModels.length), [apiProviders]);
  const chatProviders = useMemo(() => apiProviders.filter((provider) => provider.chatModels.length), [apiProviders]);
  const fixedCanvasUiStyle = useMemo(() => ({
    "--ic-fixed-ui-scale": `${1 / viewport.scale}`,
    "--ic-fixed-ui-hover-scale": `${1.06 / viewport.scale}`,
  }) as React.CSSProperties, [viewport.scale]);
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0] : "";

  const patchNode = useCallback((nodeId: string, patch: Partial<CanvasNode>) => {
    if (readOnlyRef.current) return;
    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)));
  }, [setNodes]);
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - rect.width / 2 - viewport.x) / viewport.scale,
      y: (clientY - rect.top - rect.height / 2 - viewport.y) / viewport.scale,
    };
  }, [viewport]);

  const getPasteClientPoint = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    return rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }, []);

  const defaultImageProvider = useMemo(() => imageProviders[0] || null, [imageProviders]);
  const defaultChatProvider = useMemo(() => chatProviders[0] || apiProviders.find((provider) => provider.chatModels.length) || null, [apiProviders, chatProviders]);
  const minimap = useMemo(() => {
    const viewportWorld = {
      x: (-stageSize.width / 2 - viewport.x) / viewport.scale,
      y: (-stageSize.height / 2 - viewport.y) / viewport.scale,
      w: Math.max(1, stageSize.width / viewport.scale),
      h: Math.max(1, stageSize.height / viewport.scale),
    };
    let minX = viewportWorld.x;
    let minY = viewportWorld.y;
    let maxX = viewportWorld.x + viewportWorld.w;
    let maxY = viewportWorld.y + viewportWorld.h;

    nodes.forEach((node) => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.w);
      maxY = Math.max(maxY, node.y + node.h);
    });

    const bounds = {
      x: minX - MINIMAP_PADDING,
      y: minY - MINIMAP_PADDING,
      w: Math.max(1, maxX - minX + MINIMAP_PADDING * 2),
      h: Math.max(1, maxY - minY + MINIMAP_PADDING * 2),
    };
    const scale = Math.min(minimapSize.width / bounds.w, minimapSize.height / bounds.h);
    const offsetX = (minimapSize.width - bounds.w * scale) / 2;
    const offsetY = (minimapSize.height - bounds.h * scale) / 2;
    const toMinimapRect = (rect: { x: number; y: number; w: number; h: number }) => ({
      left: offsetX + (rect.x - bounds.x) * scale,
      top: offsetY + (rect.y - bounds.y) * scale,
      width: rect.w * scale,
      height: rect.h * scale,
    });

    return {
      bounds,
      offsetX,
      offsetY,
      scale,
      viewport: toMinimapRect(viewportWorld),
      nodes: nodes.map((node) => ({ node, rect: toMinimapRect(node) })),
    };
  }, [minimapSize.height, minimapSize.width, nodes, stageSize.height, stageSize.width, viewport]);

  const deleteConnection = useCallback((connectionId: string) => {
    if (readOnlyRef.current) return;
    setConnections((current) => current.filter((connection) => connection.id !== connectionId));
    setSelectedConnectionId((current) => (current === connectionId ? "" : current));
    setConnectionAction((current) => (current?.id === connectionId ? null : current));
  }, [setConnections]);

  const clearCanvasTransientState = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedGroupId("");
    setSelectedConnectionId("");
    setConnectionAction(null);
    setHoveredId("");
    setImagePreview(null);
    setImageCrop(null);
    setContextMenu(null);
    setLinkDraft(null);
    setSelectionBox(null);
    setDraggedInputConnectionId("");
    setInputInsertIndex(null);
    setEditingPromptId("");
    setEditingGroupId("");
    setOpenImageComposerSelect("");
    setIsImageDropActive(false);
    dragRef.current = null;
    groupDragRef.current = null;
    panRef.current = null;
    selectionDragRef.current = null;
    resizeRef.current = null;
    groupResizeRef.current = null;
    dragHistoryRef.current = null;
  }, []);

  const {
    activeProject,
    activeCanvasTitle,
    activeCanvasId,
    activeCanvasIdRef,
    canvasTabs,
    showCanvasHome,
    returnToCanvasHome,
    canvasHomeMode,
    setCanvasHomeMode,
    selectedHomeCanvasId,
    setSelectedHomeCanvasId,
    activeProjectId,
    canvasProjects,
    renamingCanvasId,
    setRenamingCanvasId,
    renamingProjectId,
    setRenamingProjectId,
    renamingTitle,
    setRenamingTitle,
    confirmingDeleteCanvasId,
    setConfirmingDeleteCanvasId,
    confirmingDeleteProjectId,
    setConfirmingDeleteProjectId,
    canvasSortMode,
    setCanvasSortMode,
    projectStatus,
    projectStatusTone,
    sortedCanvasDocuments,
    refreshCanvasWorkspace,
    openCanvasDocument,
    openReadOnlyCanvasDocument,
    closeCanvasTab,
    reorderCanvasTabs,
    createCanvasDocumentFromDraft,
    createCanvasProject,
    selectCanvasProject,
    submitRenameCanvasDocument,
    submitRenameCanvasProject,
    duplicateCanvasDocument,
    exportCanvasDocumentJson,
    exportCanvasDocumentPackage,
    importCanvasDocument,
    moveCanvasToProject,
    deleteCanvasDocument,
    deleteCanvasProject,
  } = useCanvasProjects({
    nodes,
    connections,
    groups,
    viewport,
    setViewport,
    setZoomInput,
    clearCanvasTransientState,
    t,
  });
  const remoteCanvas = useRemoteCanvasExchange();
  const [activeRemoteCanvasId, setActiveRemoteCanvasId] = useState("");
  const [remoteCanvasTabs, setRemoteCanvasTabs] = useState<CanvasDocumentTab[]>([]);
  const isReadOnlyCanvas = Boolean(activeRemoteCanvasId);
  const displayedCanvasTabs = useMemo(() => [...canvasTabs, ...remoteCanvasTabs], [canvasTabs, remoteCanvasTabs]);
  const openRemoteCanvasTab = useCallback(async (canvasId: string) => {
    const document = await remoteCanvas.openRemoteCanvas(canvasId);
    const tab: CanvasDocumentTab = {
      id: canvasId,
      title: document.title || t("infiniteCanvas:untitledCanvas"),
      icon: document.icon || "layers",
      canvasType: "forart",
      source: "remote",
      updatedAt: Number(document.updatedAt || document.createdAt || Date.now()),
    };
    setRemoteCanvasTabs((current) => (
      current.some((item) => item.id === tab.id)
        ? current.map((item) => (item.id === tab.id ? tab : item))
        : [...current, tab]
    ));
    setActiveRemoteCanvasId(canvasId);
    openReadOnlyCanvasDocument(document);
  }, [openReadOnlyCanvasDocument, remoteCanvas, t]);
  useEffect(() => {
    readOnlyRef.current = isReadOnlyCanvas;
    if (worldRef.current) {
      if (isReadOnlyCanvas) worldRef.current.setAttribute("inert", "");
      else worldRef.current.removeAttribute("inert");
    }
    if (isReadOnlyCanvas) clearCanvasTransientState();
  }, [clearCanvasTransientState, isReadOnlyCanvas]);
  const {
    imagePreview,
    setImagePreview,
    imageCrop,
    setImageCrop,
    downloadStatus,
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
    showMediaStatus,
    changeCropAspect,
    startCropInteraction,
    handleCropPointerMove,
    stopCropInteraction,
    applyCrop,
  } = useCanvasMediaActions({
    nodes,
    connections,
    imageDownloadPath,
    setNodes,
    setCanvasDocument,
    patchNode,
    createNode: nodeDefaults,
    screenToWorld,
    setSelectedIds,
    setSelectedGroupId,
    setSelectedConnectionId,
    setConnectionAction,
    setContextMenu,
    t,
  });

  const {
    resumeImageGenerationTasks,
    runImageComposer,
    stopImageComposer,
    runLlmNode,
    stopLlmNode,
    writebackGenerationTask,
  } = useCanvasGenerationActions({
    nodes,
    connections,
    groups,
    viewport,
    apiProviders,
    imageProviders,
    defaultChatProvider,
    chatProviders,
    activeCanvasId,
    activeCanvasTitle,
    activeProject,
    activeCanvasIdRef,
    patchNode,
    setNodes,
    t,
  });

  const {
    refreshActionFissionRow,
    resumeActionFissionTasks,
    runActionFissionRow,
    runAllActionFissionRows,
    switchAllActionFissionRows,
    stopActionFissionRow,
    stopAllActionFissionRows,
  } = useActionFissionGenerationActions({
    nodes,
    connections,
    groups,
    viewport,
    apiProviders,
    defaultImageProviderId,
    imageProviders,
    activeCanvasId,
    activeCanvasTitle,
    activeProject,
    activeCanvasIdRef,
    patchNode,
    setNodes,
    writebackGenerationTask,
    t,
  });

  const {
    runLibtvImageGenerator,
    stopLibtvImageGenerator,
  } = useLibtvGenerationActions({
    nodes,
    connections,
    patchNode,
    t,
  });

  useEffect(() => {
    if (!activeProject || showCanvasHome) return;
    resumeImageGenerationTasks(nodes);
    resumeActionFissionTasks(nodes);
  }, [activeProject?.id, nodes, showCanvasHome, resumeActionFissionTasks, resumeImageGenerationTasks]);

  const toolbarNode = imageCrop?.nodeId ? nodeMap.get(imageCrop.nodeId) || null : selectedId ? nodeMap.get(selectedId) || null : null;
  const previewNode = imagePreview ? nodeMap.get(imagePreview.nodeId) : null;

  useEffect(() => {
    const syncApiProviders = () => {
      setApiProviders(readApiProviders());
    };
    void loadApiSettings().then((settings) => {
      setApiProviders(settings.providers);
    });
    window.addEventListener("storage", syncApiProviders);
    window.addEventListener("focus", syncApiProviders);
    window.addEventListener(API_PROVIDER_CHANGED_EVENT, syncApiProviders);
    return () => {
      window.removeEventListener("storage", syncApiProviders);
      window.removeEventListener("focus", syncApiProviders);
      window.removeEventListener(API_PROVIDER_CHANGED_EVENT, syncApiProviders);
    };
  }, []);

  useEffect(() => () => {
    cancelScheduledFrame(selectionFrameRef);
    cancelScheduledFrame(viewportFrameRef);
    cancelScheduledFrame(nodeDragFrameRef);
    cancelScheduledFrame(groupDragFrameRef);
    cancelScheduledFrame(nodeResizeFrameRef);
    cancelScheduledFrame(groupResizeFrameRef);
    cancelScheduledFrame(linkDraftFrameRef);
  }, [cancelScheduledFrame]);

  useEffect(() => {
    if (!selectedConnectionId) return;
    if (connections.some((connection) => connection.id === selectedConnectionId)) return;
    setSelectedConnectionId("");
    setConnectionAction(null);
  }, [connections, selectedConnectionId]);

  useEffect(() => {
    const ids = new Set(nodes.map((node) => node.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
    setImageCrop((current) => (current && !ids.has(current.nodeId) ? null : current));
    setImagePreview((current) => (current && !ids.has(current.nodeId) ? null : current));
    setEditingPromptId((current) => (current && !ids.has(current) ? "" : current));
    setSelectedGroupId((current) => (current && !groups.some((group) => group.id === current) ? "" : current));
    setEditingGroupId((current) => (current && !groups.some((group) => group.id === current) ? "" : current));
  }, [groups, nodes]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditingTarget(event.target)) return;
      if (readOnlyRef.current) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoCanvasHistory();
        } else {
          undoCanvasHistory();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault();
        redoCanvasHistory();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === "h") {
        event.preventDefault();
        setShowConnections((current) => {
          const next = !current;
          if (!next) {
            setSelectedConnectionId("");
            setConnectionAction(null);
          }
          return next;
        });
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedIds.size) {
          event.preventDefault();
          void deleteSelectedNodes();
          return;
        }
        if (selectedGroupId) {
          event.preventDefault();
          void deleteSelectedGroup();
          return;
        }
        if (selectedConnectionId) {
          event.preventDefault();
          deleteConnection(selectedConnectionId);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === "c") {
        if (!selectedIds.size) return;
        event.preventDefault();
        copySelectedNodes();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "g") {
        event.preventDefault();
        if (event.shiftKey) {
          ungroup();
        } else {
          createGroupFromSelection();
        }
        return;
      }
    }

    function handlePaste(event: ClipboardEvent) {
      if (isEditingTarget(event.target)) return;
      if (readOnlyRef.current) return;
      const copiedSelection = readClipboardSelection(event.clipboardData);
      if (copiedSelection?.nodes.length) {
        event.preventDefault();
        pasteCopiedNodes(copiedSelection);
        return;
      }
      if (hasClipboardImage(event.clipboardData)) {
        event.preventDefault();
        const point = getPasteClientPoint();
        void createImageNodesFromClipboardData(event.clipboardData, point.x, point.y);
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("paste", handlePaste);
    };
  }, [connections, createImageNodesFromClipboardData, deleteConnection, getPasteClientPoint, groups, nodes, selectedConnectionId, selectedGroupId, selectedIds, t]);

  useEffect(() => {
    function updateSizes() {
      const stageRect = stageRef.current?.getBoundingClientRect();
      if (stageRect) {
        setStageSize((current) => (
          current.width === stageRect.width && current.height === stageRect.height
            ? current
            : { width: stageRect.width, height: stageRect.height }
        ));
      }
      const minimapRect = minimapRef.current?.getBoundingClientRect();
      if (minimapRect) {
        setMinimapSize((current) => (
          current.width === minimapRect.width && current.height === minimapRect.height
            ? current
            : { width: minimapRect.width, height: minimapRect.height }
        ));
      }
    }

    updateSizes();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSizes);
      return () => window.removeEventListener("resize", updateSizes);
    }

    const observer = new ResizeObserver(updateSizes);
    if (stageRef.current) observer.observe(stageRef.current);
    if (minimapRef.current) observer.observe(minimapRef.current);
    return () => observer.disconnect();
  }, [isMinimapOpen]);

  useEffect(() => {
    if (!isZoomMenuOpen) return;
    setZoomInput(String(Math.round(viewport.scale * 100)));
    window.requestAnimationFrame(() => zoomInputRef.current?.select());
  }, [isZoomMenuOpen, viewport.scale]);

  const patchNodeWithoutHistory = useCallback((nodeId: string, patch: Partial<CanvasNode>) => {
    if (readOnlyRef.current) return;
    setNodesWithoutHistory((current) => current.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)));
  }, [setNodesWithoutHistory]);

  function getKindLabel(type: CanvasNodeType) {
    return t(`infiniteCanvas:${type}`);
  }

  function getImageGeneratorInputPreviews(nodeId: string): ImageGeneratorInputPreview[] {
    const targetNode = nodeMap.get(nodeId);
    const promptPreviews: ImageGeneratorInputPreview[] = [];
    const imagePreviews: ImageGeneratorInputPreview[] = [];
    connections
      .filter((connection) => connection.to === nodeId)
      .forEach((connection) => {
        const source = nodeMap.get(connection.from);
        if (!source) return;
        if (isImageLikeNode(source) && source.url) {
          imagePreviews.push({
            id: source.id,
            connectionId: connection.id,
            kind: "image",
            order: imagePreviews.length + 1,
            title: source.fileName || getKindLabel(source.type),
            url: source.url,
          });
          return;
        }
        if (targetNode?.type === "actionFission") return;
        const text = collectPrompt(source, nodes, connections).trim();
        if (!text) return;
        promptPreviews.push({
          id: source.id,
          connectionId: connection.id,
          kind: "prompt",
          title: getKindLabel(source.type),
          text,
        });
      });
    return [...promptPreviews, ...imagePreviews];
  }

  async function addNode(type: CanvasNodeType, worldPosition?: { x: number; y: number }) {
    if (readOnlyRef.current) return;
    const definition = getNodeDefinition(type);
    const node = nodeDefaults(type);
    const center = worldPosition || screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    node.x = Math.round(center.x - definition.defaultSize.w / 2);
    node.y = Math.round(center.y - definition.defaultSize.h / 2);

    setNodes((current) => [...current, node]);
    setSelectedIds(new Set([node.id]));
    setSelectedGroupId("");
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
  }

  async function deleteNode(nodeId: string) {
    if (readOnlyRef.current) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;
    if (activeCanvasId) {
      await stopLocalGenerationTasksForNode(activeCanvasId, nodeId);
    }
    if (node.type === "libtvImageGenerator") stopLibtvImageGenerator(nodeId);
    setCanvasDocument((current) => ({
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      connections: current.connections.filter((connection) => connection.from !== nodeId && connection.to !== nodeId),
      groups: current.groups.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => id !== nodeId) })),
    }));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
    setImageCrop((current) => (current?.nodeId === nodeId ? null : current));
  }

  async function deleteSelectedNodes() {
    if (readOnlyRef.current) return;
    const ids = new Set(selectedIds);
    if (!ids.size) return;
    if (activeCanvasId) {
      await Promise.all(Array.from(ids).map((nodeId) => stopLocalGenerationTasksForNode(activeCanvasId, nodeId)));
    }
    setCanvasDocument((current) => ({
      nodes: current.nodes.filter((node) => !ids.has(node.id)),
      connections: current.connections.filter((connection) => !ids.has(connection.from) && !ids.has(connection.to)),
      groups: current.groups.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => !ids.has(id)) })),
    }));
    setSelectedIds(new Set());
    setSelectedGroupId("");
    setSelectedConnectionId("");
    setConnectionAction(null);
    setImageCrop((current) => (current && ids.has(current.nodeId) ? null : current));
    setImagePreview((current) => (current && ids.has(current.nodeId) ? null : current));
  }

  async function deleteSelectedGroup() {
    if (readOnlyRef.current) return;
    const group = groups.find((item) => item.id === selectedGroupId);
    if (!group) return;
    const ids = new Set(group.nodeIds);
    if (activeCanvasId) {
      await Promise.all(Array.from(ids).map((nodeId) => stopLocalGenerationTasksForNode(activeCanvasId, nodeId)));
    }
    setCanvasDocument((current) => ({
      nodes: current.nodes.filter((node) => !ids.has(node.id)),
      connections: current.connections.filter((connection) => !ids.has(connection.from) && !ids.has(connection.to)),
      groups: current.groups
        .filter((item) => item.id !== group.id)
        .map((item) => ({ ...item, nodeIds: item.nodeIds.filter((id) => !ids.has(id)) })),
    }));
    setSelectedIds(new Set());
    setSelectedGroupId("");
    setSelectedConnectionId("");
    setConnectionAction(null);
    setEditingGroupId("");
    setImageCrop((current) => (current && ids.has(current.nodeId) ? null : current));
    setImagePreview((current) => (current && ids.has(current.nodeId) ? null : current));
  }

  function writeCopiedSelectionToClipboard(selection: CopiedCanvasSelection) {
    void window.easyTool?.writeCanvasClipboard?.(selection);
  }

  function copySelectedNodes() {
    if (readOnlyRef.current) return;
    if (!selectedIds.size) return;
    const ids = new Set(selectedIds);
    const copiedNodes = nodes.filter((node) => ids.has(node.id)).map((node) => cloneCanvasNodeForNewTarget(node));
    if (!copiedNodes.length) return;
    const copied = {
      nodes: copiedNodes,
      connections: connections.filter((connection) => ids.has(connection.from) && ids.has(connection.to)).map((connection) => ({ ...connection })),
    };
    writeCopiedSelectionToClipboard(copied);
  }

  function pasteCopiedNodes(copied: CopiedCanvasSelection) {
    if (readOnlyRef.current) return;
    if (!copied?.nodes.length) return;
    const idMap = new Map<string, string>();
    const offset = 36;
    const nextNodes = copied.nodes.map((node) => {
      const nextId = uid(node.type);
      idMap.set(node.id, nextId);
      const clonedNode = cloneCanvasNodeForNewTarget(node, nextId);
      return {
        ...clonedNode,
        x: Math.round(clonedNode.x + offset),
        y: Math.round(clonedNode.y + offset),
        title: clonedNode.title,
      };
    });
    const nextConnections = copied.connections.flatMap((connection) => {
      const from = idMap.get(connection.from);
      const to = idMap.get(connection.to);
      return from && to ? [{ ...connection, id: uid("link"), from, to }] : [];
    });
    setCanvasDocument((current) => ({
      nodes: [...current.nodes, ...nextNodes],
      connections: [...current.connections, ...nextConnections],
      groups: current.groups,
    }));
    setSelectedIds(new Set(nextNodes.map((node) => node.id)));
    setSelectedGroupId("");
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
    setImageCrop(null);
  }

  function createGroupFromSelection() {
    if (readOnlyRef.current) return;
    if (selectedIds.size < 2) return;
    if (!selectionGroupBounds) return;
    const groupNodeIds = nodes.filter((node) => selectedIds.has(node.id)).map((node) => node.id);
    if (groupNodeIds.length < 2) return;
    const groupId = uid("group");
    setCanvasDocument((current) => ({
      nodes: current.nodes,
      connections: current.connections,
      groups: [
        ...current.groups.filter((group) => !groupNodeIds.every((nodeId) => group.nodeIds.includes(nodeId))),
        {
          id: groupId,
          title: `${t("infiniteCanvas:group")} ${current.groups.length + 1}`,
          x: Math.round(selectionGroupBounds.x),
          y: Math.round(selectionGroupBounds.y),
          w: Math.round(selectionGroupBounds.width),
          h: Math.round(selectionGroupBounds.height),
          nodeIds: groupNodeIds,
        },
      ],
    }));
    setSelectedIds(new Set());
    setSelectedGroupId(groupId);
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
  }

  function createEmptyGroup(worldPosition: { x: number; y: number }) {
    if (readOnlyRef.current) return;
    const groupId = uid("group");
    setGroups((current) => [
      ...current,
      {
        id: groupId,
        title: `${t("infiniteCanvas:group")} ${current.length + 1}`,
        x: Math.round(worldPosition.x - EMPTY_GROUP_DEFAULT_WIDTH / 2),
        y: Math.round(worldPosition.y - EMPTY_GROUP_DEFAULT_HEIGHT / 2),
        w: EMPTY_GROUP_DEFAULT_WIDTH,
        h: EMPTY_GROUP_DEFAULT_HEIGHT,
        nodeIds: [],
      },
    ]);
    setSelectedIds(new Set());
    setSelectedGroupId(groupId);
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
    setImageCrop(null);
  }

  function ungroup(groupId = selectedGroupId) {
    if (readOnlyRef.current) return;
    if (!groupId) return;
    setCanvasDocument((current) => ({
      nodes: current.nodes,
      connections: current.connections,
      groups: current.groups.filter((item) => item.id !== groupId),
    }));
    setSelectedGroupId("");
    setSelectedIds(new Set());
    setSelectedConnectionId("");
    setConnectionAction(null);
    setEditingGroupId("");
  }

  function patchGroup(groupId: string, patch: Partial<CanvasGroup>) {
    if (readOnlyRef.current) return;
    setGroups((current) => current.map((group) => (group.id === groupId ? { ...group, ...patch } : group)));
  }

  function syncDraggedNodesIntoGroups(nodeIds: string[]) {
    if (readOnlyRef.current) return;
    const draggedNodeIds = new Set(nodeIds);
    if (!draggedNodeIds.size || !groups.length) return;
    setCanvasDocumentWithoutHistory((current) => {
      const currentNodeMap = new Map(current.nodes.map((node) => [node.id, node]));
      const nextGroups = current.groups.flatMap((group) => {
        const bounds = getGroupBounds(group);
        if (!bounds) return [];
        const nodeIds = new Set(group.nodeIds.filter((nodeId) => currentNodeMap.has(nodeId)));
        draggedNodeIds.forEach((nodeId) => {
          const node = currentNodeMap.get(nodeId);
          if (!node) return;
          const center = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
          if (pointInBounds(center, bounds)) {
            nodeIds.add(nodeId);
          } else {
            nodeIds.delete(nodeId);
          }
        });
        return [{ ...group, nodeIds: [...nodeIds] }];
      });
      return { ...current, groups: nextGroups };
    });
  }

  function duplicateNodesForDrag(draggedNodes: DragState["nodes"]) {
    if (readOnlyRef.current) return null;
    const sourceIds = new Set(draggedNodes.map((node) => node.id));
    const sourceStartById = new Map(draggedNodes.map((node) => [node.id, node]));
    const sourceNodes = nodes.filter((node) => sourceIds.has(node.id));
    if (!sourceNodes.length) return null;
    const idMap = new Map<string, string>();
    const nextNodes = sourceNodes.map((node) => {
      const nextId = uid(node.type);
      idMap.set(node.id, nextId);
      return {
        ...node,
        id: nextId,
        title: node.title,
      };
    });
    const nextConnections = connections.flatMap((connection) => {
      const from = idMap.get(connection.from);
      const to = idMap.get(connection.to);
      return from && to ? [{ ...connection, id: uid("link"), from, to }] : [];
    });
    setCanvasDocument((current) => ({
      nodes: [...current.nodes, ...nextNodes],
      connections: [...current.connections, ...nextConnections],
      groups: current.groups,
    }));
    setSelectedIds(new Set(nextNodes.map((node) => node.id)));
    setSelectedGroupId("");
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
    setImageCrop(null);
    return nextNodes.map((node, index) => {
      const sourceStart = sourceStartById.get(sourceNodes[index]?.id || "");
      return {
        id: node.id,
        startX: sourceStart?.startX ?? node.x,
        startY: sourceStart?.startY ?? node.y,
      };
    });
  }

  function removeImageGeneratorInput(connectionId: string) {
    if (readOnlyRef.current) return;
    setConnections((current) => current.filter((connection) => connection.id !== connectionId));
  }

  function reorderImageGeneratorInput(imageGeneratorId: string, fromConnectionId: string, imageInsertIndex: number) {
    if (readOnlyRef.current) return;
    setConnections((current) => {
      const imageGeneratorInputs = current.filter((connection) => connection.to === imageGeneratorId);
      const imageInputIds = imageGeneratorInputs
        .filter((connection) => {
          const source = nodeMap.get(connection.from);
          return Boolean(isImageLikeNode(source) && source.url);
        })
        .map((connection) => connection.id);
      const fromImageIndex = imageInputIds.indexOf(fromConnectionId);
      if (fromImageIndex < 0) return current;
      const nextImageIds = [...imageInputIds];
      const [movedId] = nextImageIds.splice(fromImageIndex, 1);
      const insertIndex = clamp(fromImageIndex < imageInsertIndex ? imageInsertIndex - 1 : imageInsertIndex, 0, nextImageIds.length);
      nextImageIds.splice(insertIndex, 0, movedId);
      const imageOrder = new Map(nextImageIds.map((id, index) => [id, index]));
      const imageGeneratorInputOrder = new Map(imageGeneratorInputs.map((connection, index) => [connection.id, index]));
      const nextImageGeneratorInputs = [...imageGeneratorInputs].sort((a, b) => {
        const sourceA = nodeMap.get(a.from);
        const sourceB = nodeMap.get(b.from);
        const imageA = Boolean(isImageLikeNode(sourceA) && sourceA.url);
        const imageB = Boolean(isImageLikeNode(sourceB) && sourceB.url);
        if (imageA && imageB) return (imageOrder.get(a.id) || 0) - (imageOrder.get(b.id) || 0);
        if (imageA !== imageB) return imageA ? 1 : -1;
        return (imageGeneratorInputOrder.get(a.id) || 0) - (imageGeneratorInputOrder.get(b.id) || 0);
      });
      let inputCursor = 0;
      return current.map((connection) => (connection.to === imageGeneratorId ? nextImageGeneratorInputs[inputCursor++] : connection));
    });
  }

  function getImageInputInsertIndex(container: HTMLDivElement, clientX: number) {
    const imageItems = Array.from(container.querySelectorAll<HTMLElement>(".ic-image-composer__input--image"));
    if (!imageItems.length) return 0;
    const firstRect = imageItems[0].getBoundingClientRect();
    if (clientX <= firstRect.left + firstRect.width / 2) return 0;
    for (let index = 1; index < imageItems.length; index += 1) {
      const rect = imageItems[index].getBoundingClientRect();
      if (clientX <= rect.left + rect.width / 2) return index;
    }
    return imageItems.length;
  }

  const updateConnectionAction = useCallback((connectionId: string, clientX: number, clientY: number) => {
    if (readOnlyRef.current) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    setConnectionAction({
      id: connectionId,
      left: clamp(clientX - rect.left, 16, Math.max(16, rect.width - 16)),
      top: clamp(clientY - rect.top, 16, Math.max(16, rect.height - 16)),
    });
  }, []);

  const selectConnection = useCallback((event: React.PointerEvent<SVGPathElement>, connection: CanvasConnection) => {
    event.preventDefault();
    event.stopPropagation();
    if (readOnlyRef.current) return;
    setSelectedIds(new Set());
    setSelectedGroupId("");
    setSelectedConnectionId(connection.id);
    setContextMenu(null);
    setImageCrop(null);
    setIsZoomMenuOpen(false);
    updateConnectionAction(connection.id, event.clientX, event.clientY);
  }, [updateConnectionAction]);

  const focusConnection = useCallback((connection: CanvasConnection) => {
    if (readOnlyRef.current) return;
    const from = nodeMapRef.current.get(connection.from);
    const to = nodeMapRef.current.get(connection.to);
    if (!from || !to) return;
    setSelectedIds(new Set());
    setSelectedGroupId("");
    setSelectedConnectionId(connection.id);
    const point = linkMidpoint(from, to);
    const currentStageSize = stageSizeRef.current;
    const currentViewport = viewportRef.current;
    setConnectionAction({
      id: connection.id,
      left: clamp(currentStageSize.width / 2 + point.x * currentViewport.scale + currentViewport.x, 16, Math.max(16, currentStageSize.width - 16)),
      top: clamp(currentStageSize.height / 2 + point.y * currentViewport.scale + currentViewport.y, 16, Math.max(16, currentStageSize.height - 16)),
    });
  }, []);

  const clearCanvasSelection = useCallback(() => {
    setContextMenu(null);
    setImageCrop(null);
    setIsZoomMenuOpen(false);
    setEditingPromptId("");
    setEditingGroupId("");
    setOpenImageComposerSelect("");
    setSelectedIds(new Set());
    setSelectedGroupId("");
    setSelectedConnectionId("");
    setConnectionAction(null);
  }, [setEditingPromptId, setSelectedConnectionId, setSelectedGroupId, setSelectedIds]);

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable='true'], .ic-composer-select__menu, .ic-composer-size__panel")) return;
    event.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const oldScale = viewport.scale;
    const nextScale = clamp(oldScale * Math.exp(-event.deltaY * 0.0012), MIN_SCALE, MAX_SCALE);
    const pointerX = event.clientX - rect.left - rect.width / 2;
    const pointerY = event.clientY - rect.top - rect.height / 2;
    const worldX = (pointerX - viewport.x) / oldScale;
    const worldY = (pointerY - viewport.y) / oldScale;
    setViewport({
      x: pointerX - worldX * nextScale,
      y: pointerY - worldY * nextScale,
      scale: nextScale,
    });
  }

  function handleStagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest(".ic-context-menu")) return;
    if (readOnlyRef.current) {
      if (target.closest(".ic-canvas-controls, .ic-minimap, .ic-zoom-popover")) return;
      event.preventDefault();
      panRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: viewport,
      };
      setSelectionBox(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button === 0 && target.closest(".ic-node, .nodrag")) return;
    event.preventDefault();
    if (event.button === 1) {
      panRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: viewport,
      };
      setSelectionBox(null);
    } else {
      clearCanvasSelection();
      const start = screenToWorld(event.clientX, event.clientY);
      selectionDragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWorldX: start.x,
        startWorldY: start.y,
      };
      setSelectionBox(null);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleStagePointerMove(event: PointerEvent<HTMLDivElement>) {
    const selection = selectionDragRef.current;
    if (!readOnlyRef.current && selection && selection.pointerId === event.pointerId) {
      event.preventDefault();
      if (Math.hypot(event.clientX - selection.startClientX, event.clientY - selection.startClientY) < NODE_DRAG_START_THRESHOLD) return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.min(selection.startClientX, event.clientX) - rect.left;
      const top = Math.min(selection.startClientY, event.clientY) - rect.top;
      const width = Math.abs(event.clientX - selection.startClientX);
      const height = Math.abs(event.clientY - selection.startClientY);
      const current = screenToWorld(event.clientX, event.clientY);
      const minX = Math.min(selection.startWorldX, current.x);
      const minY = Math.min(selection.startWorldY, current.y);
      const maxX = Math.max(selection.startWorldX, current.x);
      const maxY = Math.max(selection.startWorldY, current.y);
      setSelectedGroupId("");
      const nextSelectedIds = new Set(nodes.filter((node) => (
        node.x < maxX
        && node.x + node.w > minX
        && node.y < maxY
        && node.y + node.h > minY
      )).map((node) => node.id));
      scheduleFrame(selectionFrameRef, {
        box: { left, top, width, height },
        selectedIds: nextSelectedIds,
      }, applySelectionFrame);
      return;
    }
    const pan = panRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      scheduleFrame(viewportFrameRef, {
        ...pan.startViewport,
        x: pan.startViewport.x + event.clientX - pan.startClientX,
        y: pan.startViewport.y + event.clientY - pan.startClientY,
      }, applyViewportFrame);
      return;
    }
    const drag = dragRef.current;
    if (!readOnlyRef.current && drag && drag.pointerId === event.pointerId) {
      const clientDx = event.clientX - drag.startClientX;
      const clientDy = event.clientY - drag.startClientY;
      if (!drag.active) {
        const distance = Math.hypot(clientDx, clientDy);
        if (distance < NODE_DRAG_START_THRESHOLD) return;
        drag.active = true;
        dragHistoryRef.current = { nodes, connections, groups };
        if (drag.copyOnDrag) {
          const copiedDragNodes = duplicateNodesForDrag(drag.nodes);
          if (copiedDragNodes?.length) drag.nodes = copiedDragNodes;
          drag.copyOnDrag = false;
        }
        setIsNodeDragging(true);
      }
      event.preventDefault();
      const positions = nodeDragPositions(drag, event.clientX, event.clientY);
      scheduleFrame(nodeDragFrameRef, { positions }, ({ positions: latestPositions }) => {
        applyNodeDragFrame({ positions: latestPositions });
      });
      return;
    }
    const groupDrag = groupDragRef.current;
    if (!readOnlyRef.current && groupDrag && groupDrag.pointerId === event.pointerId) {
      const clientDx = event.clientX - groupDrag.startClientX;
      const clientDy = event.clientY - groupDrag.startClientY;
      if (!groupDrag.active) {
        const distance = Math.hypot(clientDx, clientDy);
        if (distance < NODE_DRAG_START_THRESHOLD) return;
        groupDrag.active = true;
        setIsNodeDragging(true);
        dragHistoryRef.current = { nodes, connections, groups };
      }
      event.preventDefault();
      scheduleFrame(groupDragFrameRef, groupDragSnapshot(groupDrag, event.clientX, event.clientY), applyGroupDragFrame);
      return;
    }
    const resize = resizeRef.current;
    if (!readOnlyRef.current && resize && resize.pointerId === event.pointerId) {
      const node = nodeMap.get(resize.nodeId);
      if (!node) return;
      if (isImageLikeNode(node)) {
        resizeRef.current = null;
        return;
      }
      const dx = (event.clientX - resize.startClientX) / viewport.scale;
      const dy = (event.clientY - resize.startClientY) / viewport.scale;
      const minW = node.type === "actionFission" ? ACTION_FISSION_NODE_MIN_WIDTH : 180;
      const minH = node.type === "actionFission" ? ACTION_FISSION_NODE_MIN_HEIGHT : 140;
      const maxW = 1200;
      const nextW = clamp(Math.round(resize.startW + dx), minW, maxW);
      const nextRawH = Math.round(resize.startH + dy);
      const nextH = node.type === "actionFission" ? Math.max(minH, nextRawH) : clamp(nextRawH, minH, 900);
      scheduleFrame(nodeResizeFrameRef, { nodeId: resize.nodeId, w: nextW, h: nextH }, applyNodeResizeFrame);
      return;
    }
    const groupResize = groupResizeRef.current;
    if (!readOnlyRef.current && groupResize && groupResize.pointerId === event.pointerId) {
      event.preventDefault();
      const dx = (event.clientX - groupResize.startClientX) / viewport.scale;
      const dy = (event.clientY - groupResize.startClientY) / viewport.scale;
      const nextW = Math.max(160, Math.round(groupResize.startW + dx));
      const nextH = Math.max(120, Math.round(groupResize.startH + dy));
      scheduleFrame(groupResizeFrameRef, { groupId: groupResize.groupId, w: nextW, h: nextH }, applyGroupResizeFrame);
      return;
    }
    const link = linkDraft;
    if (!readOnlyRef.current && link && link.pointerId === event.pointerId) {
      const point = screenToWorld(event.clientX, event.clientY);
      scheduleFrame(linkDraftFrameRef, { ...link, x: point.x, y: point.y }, setLinkDraft);
    }
  }

  function minimapPointToWorld(clientX: number, clientY: number) {
    const rect = minimapRef.current?.getBoundingClientRect();
    if (!rect || !minimap.scale) return null;
    const x = clamp((clientX - rect.left - minimap.offsetX) / minimap.scale + minimap.bounds.x, minimap.bounds.x, minimap.bounds.x + minimap.bounds.w);
    const y = clamp((clientY - rect.top - minimap.offsetY) / minimap.scale + minimap.bounds.y, minimap.bounds.y, minimap.bounds.y + minimap.bounds.h);
    return { x, y };
  }

  function centerViewportOnWorldPoint(point: { x: number; y: number }) {
    const current = viewportRef.current;
    scheduleFrame(viewportFrameRef, {
      ...current,
      x: -point.x * current.scale,
      y: -point.y * current.scale,
    }, applyViewportFrame);
  }

  function handleMinimapPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = minimapPointToWorld(event.clientX, event.clientY);
    if (!point) return;
    setContextMenu(null);
    setIsZoomMenuOpen(false);
    centerViewportOnWorldPoint(point);
    minimapDragRef.current = { pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleMinimapPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (minimapDragRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = minimapPointToWorld(event.clientX, event.clientY);
    if (point) centerViewportOnWorldPoint(point);
  }

  function handleMinimapPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (minimapDragRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    flushScheduledFrame(viewportFrameRef, applyViewportFrame);
    minimapDragRef.current = null;
  }

  function handleMinimapKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 260 : 120;
    if (event.key === "Home") {
      event.preventDefault();
      resetView();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    setViewport((current) => ({
      ...current,
      x: current.x + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0),
      y: current.y + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0),
    }));
  }

  function handleStagePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId === event.pointerId) {
      flushScheduledFrame(viewportFrameRef, applyViewportFrame);
      panRef.current = null;
    }
    if (!readOnlyRef.current && selectionDragRef.current?.pointerId === event.pointerId) {
      flushScheduledFrame(selectionFrameRef, applySelectionFrame);
      selectionDragRef.current = null;
      setSelectionBox(null);
    }
    if (!readOnlyRef.current && dragRef.current?.pointerId === event.pointerId) {
      const previous = dragHistoryRef.current;
      const drag = dragRef.current;
      const draggedNodeIds = drag.nodes.map((node) => node.id);
      cancelScheduledFrame(nodeDragFrameRef);
      if (drag.active) {
        applyNodeDragFrame({ positions: nodeDragPositions(drag, event.clientX, event.clientY) });
        syncDraggedNodesIntoGroups(draggedNodeIds);
      } else {
        setSelectedIds(new Set([drag.pendingSelectNodeId]));
        setSelectedGroupId("");
        setSelectedConnectionId("");
        setConnectionAction(null);
        setContextMenu(null);
      }
      dragRef.current = null;
      setIsNodeDragging(false);
      dragHistoryRef.current = null;
      if (previous) commitCanvasDocumentChange(previous);
    }
    if (!readOnlyRef.current && groupDragRef.current?.pointerId === event.pointerId) {
      const previous = dragHistoryRef.current;
      const groupDrag = groupDragRef.current;
      cancelScheduledFrame(groupDragFrameRef);
      if (groupDrag.active) {
        applyGroupDragFrame(groupDragSnapshot(groupDrag, event.clientX, event.clientY));
      }
      groupDragRef.current = null;
      setIsNodeDragging(false);
      dragHistoryRef.current = null;
      if (previous) commitCanvasDocumentChange(previous);
    }
    if (!readOnlyRef.current && resizeRef.current?.pointerId === event.pointerId) {
      const previous = dragHistoryRef.current;
      flushScheduledFrame(nodeResizeFrameRef, applyNodeResizeFrame);
      resizeRef.current = null;
      dragHistoryRef.current = null;
      if (previous) commitCanvasDocumentChange(previous);
    }
    if (!readOnlyRef.current && groupResizeRef.current?.pointerId === event.pointerId) {
      const previous = dragHistoryRef.current;
      flushScheduledFrame(groupResizeFrameRef, applyGroupResizeFrame);
      groupResizeRef.current = null;
      dragHistoryRef.current = null;
      if (previous) commitCanvasDocumentChange(previous);
    }
    if (!readOnlyRef.current && linkDraft?.pointerId === event.pointerId) {
      cancelScheduledFrame(linkDraftFrameRef);
      setLinkDraft(null);
    }
  }

  function handleStageContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    if (readOnlyRef.current) return;
    if ((event.target as HTMLElement).closest(".ic-node, .ic-group-frame, .ic-group-controls")) return;
    event.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = screenToWorld(event.clientX, event.clientY);
    setContextMenu({
      x: clamp(event.clientX - rect.left, 8, Math.max(8, rect.width - 188)),
      y: clamp(event.clientY - rect.top, 8, Math.max(8, rect.height - 228)),
      worldX: point.x,
      worldY: point.y,
    });
    setSelectedConnectionId("");
    setConnectionAction(null);
  }

  function handleStageDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (readOnlyRef.current) return;
    if (!hasDraggedImageFile(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsImageDropActive(true);
  }

  function handleStageDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (readOnlyRef.current) return;
    if (!hasDraggedImageFile(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsImageDropActive(true);
  }

  function handleStageDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsImageDropActive(false);
  }

  function handleStageDrop(event: React.DragEvent<HTMLDivElement>) {
    if (readOnlyRef.current) return;
    if (!hasDraggedImageFile(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    void createImageNodesFromDrop(event.dataTransfer.files, event.clientX, event.clientY);
  }

  function startGroupDrag(event: PointerEvent<HTMLElement>, group: CanvasGroup) {
    if (readOnlyRef.current) return;
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("input, textarea, select, .ic-group-frame__action")) return;
    event.preventDefault();
    event.stopPropagation();
    const draggedNodes = group.nodeIds
      .map((nodeId) => nodeMap.get(nodeId))
      .filter((node): node is CanvasNode => Boolean(node))
      .map((node) => ({
        id: node.id,
        startX: node.x,
        startY: node.y,
      }));
    setSelectedGroupId(group.id);
    setSelectedIds(new Set());
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
    setImageCrop(null);
    setEditingPromptId("");
    groupDragRef.current = {
      pointerId: event.pointerId,
      groupId: group.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: group.x,
      startY: group.y,
      nodes: draggedNodes,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startGroupResize(event: PointerEvent<HTMLButtonElement>, group: CanvasGroup) {
    if (readOnlyRef.current) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedGroupId(group.id);
    setSelectedIds(new Set());
    setSelectedConnectionId("");
    setConnectionAction(null);
    groupResizeRef.current = {
      pointerId: event.pointerId,
      groupId: group.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startW: group.w,
      startH: group.h,
    };
    dragHistoryRef.current = { nodes, connections, groups };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startNodeDrag(event: PointerEvent<HTMLDivElement>, node: CanvasNode) {
    if (readOnlyRef.current) return;
    const target = event.target as HTMLElement;
    const blockedByInteractive = Boolean(target.closest(".nodrag, input, textarea, select, button"));
    if (event.button !== 0 || blockedByInteractive) return;
    event.stopPropagation();
    if (node.id !== editingPromptId) setEditingPromptId("");
    const dragSelectionIds = selectedIds.has(node.id) ? new Set(selectedIds) : new Set([node.id]);
    const draggedNodes = nodes
      .filter((currentNode) => dragSelectionIds.has(currentNode.id))
      .map((currentNode) => ({
        id: currentNode.id,
        startX: currentNode.x,
        startY: currentNode.y,
      }));
    setContextMenu(null);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      pendingSelectNodeId: node.id,
      selectionIds: dragSelectionIds,
      nodes: draggedNodes.length ? draggedNodes : [{ id: node.id, startX: node.x, startY: node.y }],
      active: false,
      copyOnDrag: event.altKey,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleNodeDoubleClick(event: React.MouseEvent<HTMLDivElement>, node: CanvasNode) {
    if (readOnlyRef.current) return;
    const target = event.target as HTMLElement;
    const blockedByInteractive = Boolean(target.closest(".nodrag, input, textarea, select, button"));
    if (isImageLikeNode(node) && node.url && !blockedByInteractive) {
      event.preventDefault();
      event.stopPropagation();
      openImagePreview(node.id);
      return;
    }
    if (node.type !== "prompt") return;
    if (blockedByInteractive) return;

    event.preventDefault();
    event.stopPropagation();
    setSelectedIds(new Set([node.id]));
    setSelectedGroupId("");
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
    setEditingPromptId(node.id);
  }

  function startNodeResize(event: PointerEvent<HTMLButtonElement>, node: CanvasNode) {
    if (readOnlyRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (isImageLikeNode(node)) return;
    resizeRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startW: node.w,
      startH: node.h,
    };
    dragHistoryRef.current = { nodes, connections, groups };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startLink(event: PointerEvent<HTMLButtonElement>, node: CanvasNode) {
    if (readOnlyRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const point = screenToWorld(event.clientX, event.clientY);
    setSelectedConnectionId("");
    setConnectionAction(null);
    setLinkDraft({ pointerId: event.pointerId, from: node.id, x: point.x, y: point.y });
  }

  function finishLink(event: PointerEvent<HTMLElement>, target: CanvasNode) {
    if (readOnlyRef.current) return;
    const draft = linkDraft;
    if (!draft || draft.from === target.id) return;
    event.preventDefault();
    event.stopPropagation();
    const from = nodeMap.get(draft.from);
    if (!from || !canConnect(from, target)) {
      setLinkDraft(null);
      return;
    }
    if (target.type === "actionFission" && isImageLikeNode(from)) {
      const currentCount = countDirectActionFissionImageConnections(target.id, nodes, connections);
      const duplicate = connections.some((connection) => connection.from === draft.from && connection.to === target.id);
      if (!duplicate && currentCount >= BASE_PUBLIC_REFERENCE_LIMIT) {
        setLinkDraft(null);
        return;
      }
    }
    setConnections((current) => current.some((connection) => connection.from === draft.from && connection.to === target.id)
      ? current
      : [...current, { id: uid("link"), from: draft.from, to: target.id }]);
    setLinkDraft(null);
  }

  const setNodeFileInputRefStable = useStableEvent((nodeId: string, input: HTMLInputElement | null) => {
    fileInputRefs.current[nodeId] = input;
  });
  const loadNodeFilesStable = useStableEvent((nodeId: string, files: FileList | File[]) => void handleImageFiles(nodeId, files));
  const clickNodeLoadStable = useStableEvent((nodeId: string) => fileInputRefs.current[nodeId]?.click());
  const clickNodeLibraryStable = useStableEvent((nodeId: string) => setLibraryPickerNodeId(nodeId));
  const previewNodeImageStable = useStableEvent(openImagePreview);
  const downloadNodeImageStable = useStableEvent((nodeId: string) => void downloadNodeImage(nodeId));
  const startCropInteractionStable = useStableEvent(startCropInteraction);
  const cropPointerMoveStable = useStableEvent(handleCropPointerMove);
  const stopCropInteractionStable = useStableEvent(stopCropInteraction);
  const runLlmNodeStable = useStableEvent((nodeId: string) => void runLlmNode(nodeId));
  const stopLlmNodeStable = useStableEvent(stopLlmNode);
  const editingPromptChangeStable = useStableEvent((nodeId: string, editing: boolean) => {
    setEditingPromptId(editing ? nodeId : "");
  });
  const commitPromptStable = useStableEvent((nodeId: string, text: string) => {
    void nodeId;
    void text;
  });
  const patchPromptStable = useStableEvent((nodeId: string, patch: Partial<CanvasNode>) => {
    patchNode(nodeId, patch);
  });
  const removeInputStable = useStableEvent(removeImageGeneratorInput);
  const reorderInputStable = useStableEvent(reorderImageGeneratorInput);
  const createImageReferenceStable = useStableEvent((nodeId: string, files: FileList | File[]) => void createImageReferenceForNode(nodeId, files));
  const refreshActionFissionRowStable = useStableEvent(refreshActionFissionRow);
  const runActionFissionRowStable = useStableEvent((nodeId: string, rowId: string, actions: ActionEntry[], tags: ActionTag[]) => void runActionFissionRow(nodeId, rowId, actions, tags));
  const stopActionFissionRowStable = useStableEvent(stopActionFissionRow);
  const getGenerationTaskForTargetStable = useStableEvent((target: CanvasGenerationTarget) => getGenerationTaskForNodeTarget(nodes, target));
  const isGenerationTargetActiveStable = useStableEvent((target: CanvasGenerationTarget) => isGenerationTargetActiveFromNodes(nodes, target));
  const isNodeRunningStable = useStableEvent((node: CanvasNode) => {
    return isNodeGenerationActiveFromAnchor(node) || Boolean(node.libtvImageGeneration?.running);
  });
  const beforeRemoveActionFissionRowStable = useStableEvent(async (nodeId: string, rowId: string) => {
    if (!activeCanvasId) return;
    await stopLocalGenerationTasksForTarget(activeCanvasId, { type: "actionFissionRow", nodeId, rowId });
  });
  const runAllActionFissionRowsStable = useStableEvent((nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => void runAllActionFissionRows(nodeId, rowsData));
  const switchAllActionFissionRowsStable = useStableEvent((nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => void switchAllActionFissionRows(nodeId, rowsData));
  const stopAllActionFissionRowsStable = useStableEvent(stopAllActionFissionRows);
  const previewActionFissionResultStable = useStableEvent((nodeId: string, row: ActionFissionRow) => {
    if (!row.resultUrl) return;
    setActionFissionPreview({ src: row.resultUrl, alt: row.resultFileName || row.selectedActionName || `${nodeId}-${row.id}` });
  });
  const previewActionFissionActionStable = useStableEvent((nodeId: string, row: ActionFissionRow) => {
    if (!row.selectedActionAssetUrl) return;
    setActionFissionPreview({ src: row.selectedActionAssetUrl, alt: row.selectedActionName || `${nodeId}-${row.id}-action` });
  });
  const downloadActionFissionResultStable = useStableEvent((nodeId: string, row: ActionFissionRow) => {
    if (!row.resultUrl) return;
    void downloadCanvasImageAsset({
      url: row.resultUrl,
      defaultName: row.resultFileName || `action-fission-${row.id}.png`,
      statusKey: `action-fission-result:${nodeId}:${row.id}`,
      onDownloaded: () => {
        const node = nodeMapRef.current.get(nodeId);
        if (!node?.actionFission) return;
        patchNode(nodeId, {
          actionFission: {
            ...node.actionFission,
            rows: node.actionFission.rows.map((item) => (
              item.id === row.id ? { ...item, resultDownloadState: "downloaded", resultDownloadedAt: Date.now() } : item
            )),
          },
        });
      },
    });
  });
  const downloadAllActionFissionRowsStable = useStableEvent((nodeId: string, rowsData: Array<{ rowId: string }>) => {
    const node = nodeMapRef.current.get(nodeId);
    if (!node?.actionFission) return;
    const rowIds = new Set(rowsData.map((rowData) => rowData.rowId));
    node.actionFission.rows
      .filter((row) => rowIds.has(row.id) && row.resultUrl)
      .forEach((row) => downloadActionFissionResultStable(nodeId, row));
  });
  const runLibtvImageGeneratorStable = useStableEvent((nodeId: string) => void runLibtvImageGenerator(nodeId));
  const stopLibtvImageGeneratorStable = useStableEvent(stopLibtvImageGenerator);

  const nodeBodyActions = useMemo<CanvasNodeBodyActions>(() => ({
    openSelectChange: setOpenImageComposerSelect,
    setFileInputRef: setNodeFileInputRefStable,
    loadFiles: loadNodeFilesStable,
    loadClick: clickNodeLoadStable,
    libraryClick: clickNodeLibraryStable,
    previewImage: previewNodeImageStable,
    downloadImage: downloadNodeImageStable,
    patchNode,
    startCropInteraction: startCropInteractionStable,
    cropPointerMove: cropPointerMoveStable,
    stopCropInteraction: stopCropInteractionStable,
    runLlm: runLlmNodeStable,
    stopLlm: stopLlmNodeStable,
    runLibtvImageGenerator: runLibtvImageGeneratorStable,
    stopLibtvImageGenerator: stopLibtvImageGeneratorStable,
    editingPromptChange: editingPromptChangeStable,
    commitPrompt: commitPromptStable,
    patchPrompt: patchPromptStable,
    imageProviders,
    defaultImageProvider,
    draggedInputConnectionId,
    removeInput: removeInputStable,
    reorderInput: reorderInputStable,
    createImageReference: createImageReferenceStable,
    draggedInputConnectionIdChange: setDraggedInputConnectionId,
    refreshActionFissionRow: refreshActionFissionRowStable,
    runActionFissionRow: runActionFissionRowStable,
    stopActionFissionRow: stopActionFissionRowStable,
    beforeRemoveActionFissionRow: beforeRemoveActionFissionRowStable,
    runAllActionFissionRows: runAllActionFissionRowsStable,
    switchAllActionFissionRows: switchAllActionFissionRowsStable,
    downloadAllActionFissionRows: downloadAllActionFissionRowsStable,
    stopAllActionFissionRows: stopAllActionFissionRowsStable,
    previewActionFissionResult: previewActionFissionResultStable,
    previewActionFissionAction: previewActionFissionActionStable,
    downloadActionFissionResult: downloadActionFissionResultStable,
    actionFissionDownloadStatusKey: downloadStatus?.tone === "busy" ? downloadStatus.nodeId.replace(/^action-fission-result:/, "") : "",
    showMediaStatus,
    getGenerationTaskForTarget: getGenerationTaskForTargetStable,
    isGenerationTargetActive: isGenerationTargetActiveStable,
    saveCanvasImageAsset,
  }), [
    clickNodeLoadStable,
    clickNodeLibraryStable,
    commitPromptStable,
    createImageReferenceStable,
    cropPointerMoveStable,
    downloadActionFissionResultStable,
    downloadAllActionFissionRowsStable,
    downloadNodeImageStable,
    downloadStatus,
    editingPromptChangeStable,
    defaultImageProvider,
    draggedInputConnectionId,
    getGenerationTaskForTargetStable,
    patchNode,
    patchPromptStable,
    previewNodeImageStable,
    previewActionFissionResultStable,
    previewActionFissionActionStable,
    imageProviders,
    isGenerationTargetActiveStable,
    beforeRemoveActionFissionRowStable,
    refreshActionFissionRowStable,
    removeInputStable,
    reorderInputStable,
    runActionFissionRowStable,
    runAllActionFissionRowsStable,
    saveCanvasImageAsset,
    showMediaStatus,
    runLlmNodeStable,
    runLibtvImageGeneratorStable,
    setNodeFileInputRefStable,
    startCropInteractionStable,
    stopActionFissionRowStable,
    switchAllActionFissionRowsStable,
    stopAllActionFissionRowsStable,
    stopCropInteractionStable,
    stopLibtvImageGeneratorStable,
    stopLlmNodeStable,
    loadNodeFilesStable,
  ]);

  async function importLibraryImage(selection: LibraryAssetSelection) {
    const nodeId = libraryPickerNodeId;
    if (!nodeId) return;
    if (nodeId === CANVAS_LIBRARY_PICKER_TARGET) {
      const rect = stageRef.current?.getBoundingClientRect();
      const point = rect
        ? screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
        : screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
      await createLibraryImageNodeAtWorldPoint(selection, point);
      return;
    }
    await importLibraryImageToNode(nodeId, selection);
  }

  function toggleCanvasLibraryPicker() {
    setIsZoomMenuOpen(false);
    setIsMinimapOpen(false);
    setLibraryPickerNodeId((current) => (current ? "" : CANVAS_LIBRARY_PICKER_TARGET));
  }

  const renderNodeBodyStable = useStableEvent(renderNodeBody);
  const startNodeDragStable = useStableEvent(startNodeDrag);
  const finishLinkStable = useStableEvent(finishLink);
  const handleNodeDoubleClickStable = useStableEvent(handleNodeDoubleClick);
  const startNodeResizeStable = useStableEvent(startNodeResize);
  const startLinkStable = useStableEvent(startLink);
  const getKindLabelStable = useStableEvent(getKindLabel);

  function resetView() {
    const bounds = getNodesBounds(nodes);
    if (!bounds || !stageSize.width || !stageSize.height) {
      setViewport({ x: 0, y: 0, scale: 1 });
      return;
    }
    setViewport(getViewportForBounds(bounds, stageSize.width, stageSize.height, MIN_SCALE, 1, FIT_VIEW_PADDING));
  }

  function zoomBy(factor: number) {
    setViewport((current) => ({ ...current, scale: clamp(current.scale * factor, MIN_SCALE, MAX_SCALE) }));
  }

  function zoomToPercent(percent: number) {
    if (!Number.isFinite(percent)) return;
    setViewport((current) => ({ ...current, scale: clamp(percent / 100, MIN_SCALE, MAX_SCALE) }));
  }

  function submitZoomInput(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    zoomToPercent(Number(zoomInput));
  }

  function renderNodeBody(node: CanvasNode, bodyState: NodeBodyRenderState) {
    return (
      <CanvasNodeBodyRenderer
        node={node}
        cropRect={bodyState.cropRect}
        isDownloadBusy={bodyState.isDownloadBusy}
        chatProviders={chatProviders}
        defaultChatProvider={defaultChatProvider}
        openSelectId={bodyState.openSelectId}
        isEditingPrompt={bodyState.isEditingPrompt}
        actions={nodeBodyActions}
      />
    );
  }

  function renderImageComposer() {
    const node = selectedId ? nodeMap.get(selectedId) : null;
    if (isNodeDragging || !node || node.type !== "imageGenerator" || imageCrop?.nodeId === node.id) return null;
    const selectedProvider = imageProviders.find((provider) => provider.id === node.imageProviderId)
      || imageProviders[0]
      || null;
    const selectedModel = node.imageModel && selectedProvider?.imageModels.includes(node.imageModel) ? node.imageModel : selectedProvider?.imageModels[0] || "";
    const inputPreviews = getImageGeneratorInputPreviews(node.id);
    const prompt = [node.text || "", collectPrompt(node, nodes, connections)].filter(Boolean).join("\n\n").trim();
    const selectedRule = selectedProvider && selectedModel
      ? getImageModelRule(selectedProvider.modelRules.image[selectedModel] || detectImageModelRuleId(selectedModel))
      : null;
    const generationReadiness = getImageGenerationReadiness({
      prompt,
      referenceImageCount: inputPreviews.filter((item) => item.kind === "image").length,
      rule: selectedRule,
    });
    return (
      <ImageGeneratorComposer
        node={node}
        viewport={viewport}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        imageProviders={imageProviders}
        inputPreviews={inputPreviews}
        generationReadiness={generationReadiness}
        generationTask={getGenerationTaskForNodeTarget(nodes, { type: "imageGenerator", nodeId: node.id })}
        openSelectId={openImageComposerSelect}
        draggedInputConnectionId={draggedInputConnectionId}
        onOpenSelectChange={setOpenImageComposerSelect}
        onPatchNode={patchNode}
        onRun={(nodeId) => {
          const target = nodeMap.get(nodeId);
          if (target?.imageGenerationApiType === "libtv-api") runLibtvImageGeneratorStable(nodeId);
          else runImageComposer(nodeId);
        }}
        onStop={(nodeId) => {
          const target = nodeMap.get(nodeId);
          if (target?.imageGenerationApiType === "libtv-api") stopLibtvImageGeneratorStable(nodeId);
          else stopImageComposer(nodeId);
        }}
        onRemoveInput={removeImageGeneratorInput}
        onReorderInput={reorderImageGeneratorInput}
        onCreateImageReference={createImageReferenceForNode}
        onDraggedInputConnectionIdChange={setDraggedInputConnectionId}
        t={t}
      />
    );
  }

  function renderDownloadToast() {
    if (!downloadStatus) return null;
    return (
      <div className={`ic-download-toast ic-download-toast--${downloadStatus.tone}`} role={downloadStatus.tone === "error" ? "alert" : "status"} aria-live={downloadStatus.tone === "error" ? "assertive" : "polite"}>
        {downloadStatus.text}
      </div>
    );
  }

  function renderPageToast() {
    const status = projectStatus;
    if (!status) return null;
    const tone = projectStatusTone;
    const shouldShowReadyToast = [
      t("infiniteCanvas:canvasDuplicated"),
      t("infiniteCanvas:canvasMoved"),
      t("infiniteCanvas:canvasExported"),
      t("infiniteCanvas:canvasImported"),
    ].includes(status);
    if (tone !== "error" && !shouldShowReadyToast) return null;
    const Icon = tone === "error" ? X : Check;
    return (
      <div className={`ic-page-toast ic-page-toast--${tone}`} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"}>
        <Icon size={14} aria-hidden="true" />
        <span>{status}</span>
      </div>
    );
  }

  function renderCanvasHome() {
    const homeIsServer = canvasHomeMode === "server";
    return (
      <CanvasHomePanel
        mode={canvasHomeMode}
        documents={homeIsServer ? remoteCanvas.records : sortedCanvasDocuments}
        projects={homeIsServer ? remoteCanvas.projects : canvasProjects}
        activeProjectId={homeIsServer ? remoteCanvas.activeProjectId : activeProjectId}
        selectedDocumentId={selectedHomeCanvasId}
        renamingDocumentId={renamingCanvasId}
        renamingProjectId={renamingProjectId}
        renamingTitle={renamingTitle}
        confirmingDeleteDocumentId={confirmingDeleteCanvasId}
        confirmingDeleteProjectId={confirmingDeleteProjectId}
        sortMode={homeIsServer ? (remoteCanvas.sortMode === "name" ? "name" : "recent") : canvasSortMode}
        isRemoteServerMode={remoteCanvas.isRemoteMode}
        localProjectsForCopy={canvasProjects}
        remoteProjectsForUpload={remoteCanvas.projects}
        searchText={remoteCanvas.search}
        onRefreshLocal={() => void refreshCanvasWorkspace()}
        onRefreshServer={() => void remoteCanvas.refresh()}
        onCreateCanvas={() => void createCanvasDocumentFromDraft()}
        onCreateProject={() => {
          if (homeIsServer) {
            void remoteCanvas.createProject(t("infiniteCanvas:projectBaseName"));
          } else {
            void createCanvasProject();
          }
        }}
        onImportCanvas={() => void importCanvasDocument()}
        onSelectDocument={setSelectedHomeCanvasId}
        onOpenDocument={(canvasId) => {
          if (homeIsServer) {
            void openRemoteCanvasTab(canvasId);
          } else {
            setActiveRemoteCanvasId("");
            void openCanvasDocument(canvasId);
          }
        }}
        onSelectProject={(projectId) => {
          if (homeIsServer) remoteCanvas.setActiveProjectId(projectId);
          else selectCanvasProject(projectId);
          setSelectedHomeCanvasId("");
          setRenamingCanvasId("");
          setRenamingProjectId("");
          setRenamingTitle("");
          setConfirmingDeleteCanvasId("");
          setConfirmingDeleteProjectId("");
        }}
        onStartRenameDocument={(canvasId, title) => {
          setRenamingCanvasId(canvasId);
          setRenamingProjectId("");
          setRenamingTitle(title);
          setConfirmingDeleteCanvasId("");
          setConfirmingDeleteProjectId("");
        }}
        onStartRenameProject={(projectId, title) => {
          setRenamingProjectId(projectId);
          setRenamingCanvasId("");
          setRenamingTitle(title);
          setConfirmingDeleteCanvasId("");
          setConfirmingDeleteProjectId("");
        }}
        onCancelRename={() => {
          setRenamingCanvasId("");
          setRenamingProjectId("");
          setRenamingTitle("");
        }}
        onRenamingTitleChange={setRenamingTitle}
        onSubmitRenameDocument={(canvasId) => void submitRenameCanvasDocument(canvasId)}
        onSubmitRenameProject={(projectId) => {
          if (homeIsServer) {
            void remoteCanvas.renameProject(projectId, renamingTitle).finally(() => {
              setRenamingProjectId("");
              setRenamingTitle("");
            });
          } else {
            void submitRenameCanvasProject(projectId);
          }
        }}
        onDuplicateDocument={(canvasId) => void duplicateCanvasDocument(canvasId)}
        onExportDocumentJson={(canvasId) => void exportCanvasDocumentJson(canvasId)}
        onExportDocumentPackage={(canvasId) => void exportCanvasDocumentPackage(canvasId)}
        onMoveDocumentToProject={(canvasId, projectId) => void moveCanvasToProject(canvasId, projectId)}
        onUploadDocumentToRemote={(canvasId, projectId) => void remoteCanvas.uploadLocalCanvas(canvasId, projectId).then((result) => {
          if (!result) return;
          if (result.warnings.length) {
            // Use existing toast channel for warning summary.
            console.warn("Canvas upload warnings", result.warnings);
          }
        })}
        onCopyRemoteDocumentToLocal={(canvasId, projectId) => void remoteCanvas.copyRemoteToLocal(canvasId, projectId).then(() => refreshCanvasWorkspace())}
        onConfirmDeleteDocument={(canvasId) => {
          setConfirmingDeleteCanvasId(canvasId);
          setConfirmingDeleteProjectId("");
        }}
        onConfirmDeleteProject={(projectId) => {
          setConfirmingDeleteProjectId(projectId);
          setConfirmingDeleteCanvasId("");
        }}
        onDeleteDocument={(canvasId) => {
          if (homeIsServer) {
            setConfirmingDeleteCanvasId("");
            void remoteCanvas.deleteCanvas(canvasId);
          }
          else void deleteCanvasDocument(canvasId);
        }}
        onDeleteProject={(projectId) => {
          if (homeIsServer) {
            setConfirmingDeleteProjectId("");
            void remoteCanvas.deleteProject(projectId);
          }
          else void deleteCanvasProject(projectId);
        }}
        onSortModeChange={(mode) => {
          if (homeIsServer) remoteCanvas.setSortMode(mode === "name" ? "name" : "uploadedAt");
          else setCanvasSortMode(mode);
        }}
        onHomeModeChange={(mode) => {
          setActiveRemoteCanvasId("");
          setCanvasHomeMode(mode);
          setSelectedHomeCanvasId("");
        }}
        onSearchTextChange={remoteCanvas.setSearch}
      />
    );
  }
  return (
    <section className="infinite-canvas-page" aria-label={t("infiniteCanvas:title")}>
      <CanvasTabsBar
        tabs={displayedCanvasTabs}
        activeCanvasId={activeCanvasId}
        activeRemoteCanvasId={activeRemoteCanvasId}
        showHome={showCanvasHome}
        onOpenHome={() => {
          setActiveRemoteCanvasId("");
          returnToCanvasHome();
        }}
        onOpenCanvas={(tab) => {
          if (tab.source === "remote") {
            void openRemoteCanvasTab(tab.id);
            return;
          }
          setActiveRemoteCanvasId("");
          void openCanvasDocument(tab.id);
        }}
        onCloseCanvas={(tab) => {
          if (tab.source === "remote") {
            setRemoteCanvasTabs((current) => current.filter((item) => item.id !== tab.id));
            if (activeRemoteCanvasId === tab.id) {
              setActiveRemoteCanvasId("");
              returnToCanvasHome();
            }
            return;
          }
          void closeCanvasTab(tab.id);
        }}
        onReorderCanvas={(canvasId, targetIndex) => {
          if (displayedCanvasTabs.find((tab) => tab.id === canvasId)?.source === "remote") return;
          reorderCanvasTabs(canvasId, targetIndex);
        }}
        t={t}
      />
      {renderPageToast()}
      {showCanvasHome ? renderCanvasHome() : null}
      <div
        ref={stageRef}
        className={`ic-workspace ic-stage${panRef.current ? " panning" : ""}${isNodeDragging ? " is-node-dragging" : ""}${isReadOnlyCanvas ? " is-readonly" : ""}${showCanvasHome ? " is-hidden" : ""}`}
        onWheel={handleWheel}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerUp}
        onContextMenu={handleStageContextMenu}
        onDragEnter={handleStageDragEnter}
        onDragOver={handleStageDragOver}
        onDragLeave={handleStageDragLeave}
        onDrop={handleStageDrop}
      >
        <div
          className="ic-canvas-grid"
          style={{
            "--ic-grid-x": `${viewport.x}px`,
            "--ic-grid-y": `${viewport.y}px`,
            "--ic-grid-size": `${32 * viewport.scale}px`,
            "--ic-grid-opacity": `${clamp(0.08 + viewport.scale * 0.44, 0.18, 0.52)}`,
          } as React.CSSProperties}
        />
        {selectionBox ? (
          <div
            className="ic-selection-box"
            style={{
              left: selectionBox.left,
              top: selectionBox.top,
              width: selectionBox.width,
              height: selectionBox.height,
            }}
          />
        ) : null}
        {isReadOnlyCanvas ? (
          <div className="ic-readonly-badge" role="status">{t("infiniteCanvas:readOnlyMode", { defaultValue: "Read-only mode" })}</div>
        ) : null}
        {isImageDropActive && !isReadOnlyCanvas ? (
          <div className="ic-stage-drop-hint" aria-live="polite">
            <Upload size={18} aria-hidden="true" />
            <span>{t("infiniteCanvas:dropImagesToCanvas")}</span>
          </div>
        ) : null}
        {!isReadOnlyCanvas ? <SelectionToolbar
          bounds={selectionGroupBounds}
          selectedCount={selectedIds.size}
          stageSize={stageSize}
          viewport={viewport}
          isHidden={Boolean(imageCrop) || isNodeDragging}
          onCreateGroup={createGroupFromSelection}
          t={t}
        /> : null}
        {!isNodeDragging && !isReadOnlyCanvas ? (
          <NodeToolbar
            node={toolbarNode}
            imageCrop={imageCrop}
            selectedCount={selectedIds.size}
            stageSize={stageSize}
            viewport={viewport}
            cropAspectMenuOpen={cropAspectMenuOpen}
            downloadStatus={downloadStatus}
            onCropAspectMenuOpenChange={setCropAspectMenuOpen}
            onLoadImage={(nodeId) => fileInputRefs.current[nodeId]?.click()}
            onImportLibraryImage={setLibraryPickerNodeId}
            onOpenCrop={openImageCrop}
            onChangeCropAspect={changeCropAspect}
            onApplyCrop={(nodeId) => void applyCrop(nodeId)}
            onCancelCrop={() => setImageCrop(null)}
            onPreviewImage={openImagePreview}
            onDownloadImage={(nodeId) => void downloadNodeImage(nodeId)}
            onDeleteNode={(nodeId) => void deleteNode(nodeId)}
            imageProviders={imageProviders}
            defaultImageProvider={defaultImageProvider}
            isGenerationTargetActive={isGenerationTargetActiveStable}
            onRunAllActionFissionRows={runAllActionFissionRowsStable}
            onSwitchAllActionFissionRows={switchAllActionFissionRowsStable}
            onDownloadAllActionFissionRows={downloadAllActionFissionRowsStable}
            onStopAllActionFissionRows={stopAllActionFissionRowsStable}
            t={t}
          />
        ) : null}
        <div
          ref={worldRef}
          className="ic-world"
          aria-hidden={isReadOnlyCanvas ? "true" : undefined}
          style={{
            ...fixedCanvasUiStyle,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
        >
          <ConnectionLayer
            showConnections={showConnections}
            linkDraft={linkDraft}
            selectConnectionLabel={t("infiniteCanvas:selectConnection")}
            onSelectConnection={selectConnection}
            onFocusConnection={focusConnection}
            onMoveSelectedConnection={updateConnectionAction}
          />
          <GroupLayer
            editingGroupId={editingGroupId}
            onEditingGroupChange={setEditingGroupId}
            onPatchGroup={patchGroup}
            onStartGroupDrag={startGroupDrag}
            onStartGroupResize={startGroupResize}
            onUngroup={ungroup}
            t={t}
          />
          <SelectionPreviewLayer
            bounds={selectionGroupBounds}
            isVisible={Boolean(selectionGroupBounds && selectedIds.size >= 2 && !imageCrop)}
          />
          <NodeLayer
            imageCropNodeId={imageCrop?.nodeId || ""}
            imageCropRect={imageCrop?.rect || null}
            downloadNodeId={downloadStatus?.nodeId || ""}
            downloadTone={downloadStatus?.tone || ""}
            openSelectId={openImageComposerSelect}
            editingPromptId={editingPromptId}
            linkDraftFromId={linkDraft?.from || ""}
            linkDraftSourceNode={linkDraft ? nodeMap.get(linkDraft.from) || null : null}
            renderNodeBody={renderNodeBodyStable}
            startNodeDrag={startNodeDragStable}
            finishLink={finishLinkStable}
            handleNodeDoubleClick={handleNodeDoubleClickStable}
            startNodeResize={startNodeResizeStable}
            startLink={startLinkStable}
            setHoveredId={setHoveredId}
            getKindLabel={getKindLabelStable}
            isNodeRunning={isNodeRunningStable}
            t={t}
          />
          {renderImageComposer()}
        </div>
        {showConnections && connectionAction && selectedConnectionId === connectionAction.id && !isReadOnlyCanvas ? (
          <button
            className="ic-link-delete-button nodrag"
            type="button"
            aria-label={t("infiniteCanvas:deleteConnection")}
            title={t("infiniteCanvas:deleteConnection")}
            style={{
              left: connectionAction.left,
              top: connectionAction.top,
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={() => deleteConnection(connectionAction.id)}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        ) : null}
        {renderDownloadToast()}
        <div className="ic-canvas-controls nodrag">
          {isMinimapOpen ? (
            <div className="ic-minimap-popover">
              <div
                ref={minimapRef}
                className="ic-minimap"
                role="button"
                tabIndex={0}
                aria-label={t("infiniteCanvas:minimap")}
                title={t("infiniteCanvas:minimap")}
                onPointerDown={handleMinimapPointerDown}
                onPointerMove={handleMinimapPointerMove}
                onPointerUp={handleMinimapPointerUp}
                onPointerCancel={handleMinimapPointerUp}
                onKeyDown={handleMinimapKeyDown}
              >
                <div className="ic-minimap__stage">
                  {minimap.nodes.map(({ node, rect }) => (
                    <div
                      key={node.id}
                      className={`ic-minimap__node ic-minimap__node--${node.type}${selectedIds.has(node.id) ? " selected" : ""}`}
                      style={{
                        left: rect.left,
                        top: rect.top,
                        width: Math.max(3, rect.width),
                        height: Math.max(3, rect.height),
                      }}
                    />
                  ))}
                  <div
                    className="ic-minimap__viewport"
                    style={{
                      left: minimap.viewport.left,
                      top: minimap.viewport.top,
                      width: Math.max(10, minimap.viewport.width),
                      height: Math.max(10, minimap.viewport.height),
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}
          {isZoomMenuOpen ? (
            <form className="ic-zoom-popover" onSubmit={submitZoomInput}>
              <button type="button" title={t("infiniteCanvas:zoomOut")} aria-label={t("infiniteCanvas:zoomOut")} onClick={() => zoomBy(0.88)}>
                <ZoomOut size={16} aria-hidden="true" />
              </button>
              <label>
                <input
                  ref={zoomInputRef}
                  aria-label={t("infiniteCanvas:zoomCanvas")}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={zoomInput}
                  onChange={(event) => setZoomInput(event.target.value)}
                  onBlur={() => zoomToPercent(Number(zoomInput))}
                />
                <span>%</span>
              </label>
              <button type="submit" title={t("common:actions.save")} aria-label={t("common:actions.save")}>
                <Check size={16} aria-hidden="true" />
              </button>
              <button type="button" title={t("infiniteCanvas:zoomIn")} aria-label={t("infiniteCanvas:zoomIn")} onClick={() => zoomBy(1.12)}>
                <ZoomIn size={16} aria-hidden="true" />
              </button>
            </form>
          ) : null}
          <div className="ic-control-bar">
            {!isReadOnlyCanvas ? (
              <button
                type="button"
                className={libraryPickerNodeId ? "active" : ""}
                data-tooltip={t("infiniteCanvas:importFromLibrary")}
                aria-label={t("infiniteCanvas:importFromLibrary")}
                aria-pressed={Boolean(libraryPickerNodeId)}
                onClick={toggleCanvasLibraryPicker}
              >
                <Images size={16} aria-hidden="true" />
              </button>
            ) : null}
            <button type="button" data-tooltip={t("infiniteCanvas:resetView")} aria-label={t("infiniteCanvas:resetView")} onClick={resetView}>
              <Crosshair size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={!showConnections ? "active" : ""}
              data-tooltip={t(showConnections ? "infiniteCanvas:hideConnections" : "infiniteCanvas:showConnections")}
              aria-label={t(showConnections ? "infiniteCanvas:hideConnections" : "infiniteCanvas:showConnections")}
              aria-pressed={!showConnections}
              onClick={() => {
                setShowConnections((current) => !current);
                if (showConnections) {
                  setSelectedConnectionId("");
                  setConnectionAction(null);
                }
              }}
            >
              <Eye size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={isMinimapOpen ? "active" : ""}
              data-tooltip={t("infiniteCanvas:minimap")}
              aria-label={t("infiniteCanvas:minimap")}
              aria-pressed={isMinimapOpen}
              onClick={() => {
                setIsZoomMenuOpen(false);
                setIsMinimapOpen((current) => !current);
              }}
            >
              <MapIcon size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ic-zoom-value"
              data-tooltip={t("infiniteCanvas:zoomCanvas")}
              aria-label={t("infiniteCanvas:zoomCanvas")}
              aria-expanded={isZoomMenuOpen}
              onClick={() => {
                setIsZoomMenuOpen((current) => !current);
              }}
            >
              {Math.round(viewport.scale * 100)}%
            </button>
          </div>
        </div>
        {contextMenu && !isReadOnlyCanvas ? (
          <div className="ic-context-menu popover-surface popover-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
            <button className="popover-menu-item" type="button" role="menuitem" onClick={() => createEmptyGroup({ x: contextMenu.worldX, y: contextMenu.worldY })}>
              <Layers size={15} aria-hidden="true" />
              <span>{t("infiniteCanvas:emptyGroup")}</span>
            </button>
            {LOCAL_CONTEXT_MENU_NODE_TYPES.map((type) => {
              const Icon = getNodeDefinition(type).icon;
              return (
                <button className="popover-menu-item" key={type} type="button" role="menuitem" onClick={() => void addNode(type, { x: contextMenu.worldX, y: contextMenu.worldY })}>
                  <Icon size={15} aria-hidden="true" />
                  <span>{getKindLabel(type)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {previewNode && isImageLikeNode(previewNode) && previewNode.url ? <ImageViewer src={previewNode.url} alt={previewNode.fileName || "canvas image preview"} ariaLabel={t("infiniteCanvas:viewLargeImage")} onClose={() => setImagePreview(null)} /> : null}
        {actionFissionPreview ? <ImageViewer src={actionFissionPreview.src} alt={actionFissionPreview.alt} ariaLabel={t("infiniteCanvas:viewLargeImage")} onClose={() => setActionFissionPreview(null)} /> : null}
        {libraryPickerNodeId && !isReadOnlyCanvas ? (
          <div className="ic-library-rail-panel nodrag nopan" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <LibraryAssetPickerRail onSelect={(selection) => void importLibraryImage(selection)} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default CanvasPage;
