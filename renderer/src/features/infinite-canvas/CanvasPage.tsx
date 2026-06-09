import { Check, ChevronDown, Crosshair, Crop, Download, Eye, Layers, Link2, Map as MapIcon, Pencil, Play, Plus, Ratio, RefreshCw, Square, Trash2, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { PointerEvent, WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageViewer } from "../../lib/ImageViewer";
import { API_PROVIDER_CHANGED_EVENT, loadApiSettings, readApiProviders, readDefaultImageProviderId, type ApiProvider } from "../settings/apiProviders";
import { CANVAS_STORAGE_KEY } from "./constants";
import { generateImageWithProvider } from "./core/apiImageGeneration";
import { canConnect } from "./core/rules";
import { collectPrompt, collectReferenceImages } from "./core/workflow";
import { clamp } from "./geometry";
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
import { ImageNodeBody } from "./nodes/ImageNodeBody";
import { LoopNodeBody } from "./nodes/LoopNodeBody";
import { PromptNodeBody } from "./nodes/PromptNodeBody";
import { CROP_ASPECT_OPTIONS } from "./constants";
import {
  commitCanvasDocumentChange,
  ensureCanvasDocument,
  redoCanvasHistory,
  replaceCanvasDocument,
  undoCanvasHistory,
  useCanvasStore,
  type CanvasDocument,
} from "./canvasStore";
import { createCanvasNode, getNodeDefinition } from "./nodes/registry";
import type { CanvasConnection, CanvasNode, CanvasNodeType, CanvasProject, CanvasProjectRecord, CanvasSnapshot, CropAspectKey, CropInteractionState, ImageDialogState, Viewport } from "./types";

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
const WORLD_SIZE = 4000;
const WORLD_CENTER = WORLD_SIZE / 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const MINIMAP_DEFAULT_WIDTH = 190;
const MINIMAP_DEFAULT_HEIGHT = 128;
const MINIMAP_PADDING = 160;
const FIT_VIEW_PADDING = 0.16;
const NODE_DRAG_START_THRESHOLD = 8;
const IMAGE_RESOLUTION_OPTIONS = ["1k", "2k", "4k"] as const;
const IMAGE_ASPECT_RATIO_OPTIONS = ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16"] as const;
const ACTIVE_CANVAS_ID_KEY = "forart_active_canvas_project_id";
const CANVAS_NODE_TYPES = ["generator", "image", "prompt", "loop"] as const;

type StoredCanvasNode = Omit<CanvasNode, "type"> & { type: CanvasNodeType | "output" | "group" };

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
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

interface LinkDraft {
  pointerId: number;
  from: string;
  x: number;
  y: number;
}

interface MinimapDragState {
  pointerId: number;
}

interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DownloadStatus {
  nodeId: string;
  tone: "busy" | "ready" | "error";
  text: string;
}

interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

type GeneratorInputPreview =
  | { id: string; connectionId: string; kind: "image"; order: number; title: string; url: string }
  | { id: string; connectionId: string; kind: "prompt"; title: string; text: string };

function nodeDefaults(type: CanvasNodeType): CanvasNode {
  return createCanvasNode(type, uid(type));
}

function isCanvasNodeType(type: string): type is CanvasNodeType {
  return CANVAS_NODE_TYPES.includes(type as CanvasNodeType);
}

function createInitialCanvas(): CanvasSnapshot {
  const prompt = { ...nodeDefaults("prompt"), id: uid("prompt"), x: -470, y: -110, text: "Describe the image, then connect it to a generator node." };
  const generator = { ...nodeDefaults("generator"), id: uid("generator"), x: -60, y: -120, text: "" };
  return {
    nodes: [prompt, generator],
    connections: [{ id: uid("link"), from: prompt.id, to: generator.id }],
    viewport: { x: 0, y: 0, scale: 1 },
  };
}

function normalizeStoredNode(node: StoredCanvasNode): CanvasNode | null {
  const normalizedType = node.type === "image" && node.imageMode === "generator" ? "generator" : node.type;
  if (!isCanvasNodeType(normalizedType)) return null;
  return {
    ...node,
    type: normalizedType,
    title: normalizedType === "generator" && (node.title === "Image" || node.title === "Upload") ? "Generate" : node.title,
    url: node.url?.startsWith("blob:") ? "" : node.url,
    imageMode: normalizedType === "generator" ? "generator" : normalizedType === "image" ? "asset" : node.imageMode,
    imageSource: normalizedType === "generator" ? "generated" : normalizedType === "image" ? "uploaded" : node.imageSource,
  };
}

function normalizeStoredCanvas(input: unknown): CanvasSnapshot | null {
  const parsed = input as { nodes?: StoredCanvasNode[]; connections?: CanvasConnection[]; viewport?: Viewport } | null;
  if (!parsed || !Array.isArray(parsed.nodes)) return null;
  const nodes = parsed.nodes.map(normalizeStoredNode).filter(Boolean) as CanvasNode[];
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    connections: Array.isArray(parsed.connections) ? parsed.connections.filter((connection) => nodeIds.has(connection.from) && nodeIds.has(connection.to)) : [],
    viewport: parsed.viewport || { x: 0, y: 0, scale: 1 },
  };
}

function normalizeCanvasProject(input: unknown): CanvasProject | null {
  const parsed = input as Partial<CanvasProject> | null;
  const snapshot = normalizeStoredCanvas(input);
  if (!parsed?.id || !snapshot) return null;
  const timestamp = Date.now();
  return {
    id: String(parsed.id),
    title: String(parsed.title || "Untitled canvas"),
    icon: parsed.icon || "layers",
    color: parsed.color || "",
    pinned: Boolean(parsed.pinned),
    createdAt: Number(parsed.createdAt || timestamp),
    updatedAt: Number(parsed.updatedAt || parsed.createdAt || timestamp),
    ...snapshot,
  };
}

function normalizeCanvasRecord(input: unknown): CanvasProjectRecord | null {
  const parsed = input as Partial<CanvasProjectRecord> | null;
  if (!parsed?.id) return null;
  const timestamp = Date.now();
  return {
    id: String(parsed.id),
    title: String(parsed.title || "Untitled canvas"),
    icon: parsed.icon || "layers",
    color: parsed.color || "",
    pinned: Boolean(parsed.pinned),
    createdAt: Number(parsed.createdAt || timestamp),
    updatedAt: Number(parsed.updatedAt || parsed.createdAt || timestamp),
    nodeCount: Number(parsed.nodeCount || 0),
  };
}

function readStoredCanvas(): CanvasSnapshot {
  if (typeof window === "undefined") return createInitialCanvas();
  try {
    const rawCanvas = window.localStorage.getItem(CANVAS_STORAGE_KEY);
    if (!rawCanvas) return createInitialCanvas();
    return normalizeStoredCanvas(JSON.parse(rawCanvas)) || createInitialCanvas();
  } catch {
    return createInitialCanvas();
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function fitGenerationNodeSize(aspectRatio: string) {
  const [rawW, rawH] = aspectRatio.split(":").map(Number);
  const ratioW = rawW || 1;
  const ratioH = rawH || 1;
  return fitImageNodeSize(ratioW * 1024, ratioH * 1024);
}

function linkPath(from: CanvasNode, to: CanvasNode) {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const dx = Math.max(80, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function linkMidpoint(from: CanvasNode, to: CanvasNode) {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const dx = Math.max(80, Math.abs(x2 - x1) * 0.45);
  const c1x = x1 + dx;
  const c2x = x2 - dx;
  return {
    x: (x1 + 3 * c1x + 3 * c2x + x2) / 8,
    y: (y1 + 3 * y1 + 3 * y2 + y2) / 8,
  };
}

function tempLinkPath(from: CanvasNode, x2: number, y2: number) {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const dx = Math.max(80, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
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

interface CanvasPageProps {
  imageDownloadPath?: string;
}

export function CanvasPage({ imageDownloadPath = "" }: CanvasPageProps) {
  const { t } = useTranslation();
  const initialRef = useRef(readStoredCanvas());
  ensureCanvasDocument({ nodes: initialRef.current.nodes, connections: initialRef.current.connections });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const copiedSelectionRef = useRef<{ nodes: CanvasNode[]; connections: CanvasConnection[] } | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const minimapDragRef = useRef<MinimapDragState | null>(null);
  const zoomInputRef = useRef<HTMLInputElement | null>(null);
  const cropInteractionRef = useRef<CropInteractionState | null>(null);
  const dragHistoryRef = useRef<CanvasDocument | null>(null);
  const generationAbortControllersRef = useRef<Record<string, AbortController>>({});
  const nodes = useCanvasStore((state) => state.nodes);
  const connections = useCanvasStore((state) => state.connections);
  const setNodes = useCanvasStore((state) => state.setNodes);
  const setNodesWithoutHistory = useCanvasStore((state) => state.setNodesWithoutHistory);
  const setConnections = useCanvasStore((state) => state.setConnections);
  const setCanvasDocument = useCanvasStore((state) => state.setCanvasDocument);
  const [viewport, setViewport] = useState<Viewport>(initialRef.current.viewport);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [minimapSize, setMinimapSize] = useState({ width: MINIMAP_DEFAULT_WIDTH, height: MINIMAP_DEFAULT_HEIGHT });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [hoveredConnectionId, setHoveredConnectionId] = useState("");
  const [connectionAction, setConnectionAction] = useState<{ id: string; left: number; top: number } | null>(null);
  const [hoveredId, setHoveredId] = useState("");
  const [imagePreview, setImagePreview] = useState<ImageDialogState | null>(null);
  const [imageCrop, setImageCrop] = useState<{ nodeId: string; rect: CanvasSnapshot extends never ? never : ReturnType<typeof initialCropRect>; aspect: CropAspectKey } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const [cropAspectMenuOpen, setCropAspectMenuOpen] = useState(false);
  const [isMinimapOpen, setIsMinimapOpen] = useState(false);
  const [isZoomMenuOpen, setIsZoomMenuOpen] = useState(false);
  const [zoomInput, setZoomInput] = useState(() => String(Math.round(initialRef.current.viewport.scale * 100)));
  const [apiProviders, setApiProviders] = useState<ApiProvider[]>(readApiProviders);
  const [defaultImageProviderId, setDefaultImageProviderId] = useState(readDefaultImageProviderId);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus | null>(null);
  const [canvasStorageReady, setCanvasStorageReady] = useState(() => typeof window === "undefined" || !window.easyTool?.loadCanvas);
  const [canvasProjects, setCanvasProjects] = useState<CanvasProjectRecord[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState("");
  const [activeCanvasTitle, setActiveCanvasTitle] = useState(t("infiniteCanvas.untitledCanvas"));
  const [projectDraftTitle, setProjectDraftTitle] = useState("");
  const [renamingCanvasId, setRenamingCanvasId] = useState("");
  const [renamingTitle, setRenamingTitle] = useState("");
  const [projectStatus, setProjectStatus] = useState("");
  const [showCanvasHome, setShowCanvasHome] = useState(true);
  const [selectedHomeCanvasId, setSelectedHomeCanvasId] = useState("");
  const [canvasSortMode, setCanvasSortMode] = useState<"recent" | "name">("recent");
  const [confirmingDeleteCanvasId, setConfirmingDeleteCanvasId] = useState("");
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [draggedInputConnectionId, setDraggedInputConnectionId] = useState("");
  const [inputInsertIndex, setInputInsertIndex] = useState<number | null>(null);
  const [editingPromptId, setEditingPromptId] = useState("");
  const [openImageComposerSelect, setOpenImageComposerSelect] = useState("");

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const imageProviders = useMemo(() => apiProviders.filter((provider) => provider.imageModels.length), [apiProviders]);
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0] : "";
  const previewNode = imagePreview ? nodeMap.get(imagePreview.nodeId) : null;
  const activeProject = useMemo(() => canvasProjects.find((project) => project.id === activeCanvasId) || null, [activeCanvasId, canvasProjects]);
  const sortedCanvasProjects = useMemo(() => {
    const projects = [...canvasProjects];
    if (canvasSortMode === "name") {
      return projects.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { numeric: true, sensitivity: "base" }));
    }
    return projects.sort((a, b) => Number(b.updatedAt || b.createdAt) - Number(a.updatedAt || a.createdAt));
  }, [canvasProjects, canvasSortMode]);
  const defaultImageProvider = useMemo(() => (
    apiProviders.find((provider) => provider.id === defaultImageProviderId)
    || imageProviders[0]
    || apiProviders[0]
    || null
  ), [apiProviders, defaultImageProviderId, imageProviders]);
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
    setConnections((current) => current.filter((connection) => connection.id !== connectionId));
    setSelectedConnectionId((current) => (current === connectionId ? "" : current));
    setHoveredConnectionId((current) => (current === connectionId ? "" : current));
    setConnectionAction((current) => (current?.id === connectionId ? null : current));
  }, [setConnections]);

  const clearCanvasTransientState = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedConnectionId("");
    setHoveredConnectionId("");
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
    setOpenImageComposerSelect("");
    copiedSelectionRef.current = null;
    dragRef.current = null;
    panRef.current = null;
    selectionDragRef.current = null;
    resizeRef.current = null;
    dragHistoryRef.current = null;
  }, []);

  const applyCanvasProject = useCallback((project: CanvasProject) => {
    replaceCanvasDocument({ nodes: project.nodes, connections: project.connections });
    setViewport(project.viewport);
    setZoomInput(String(Math.round(project.viewport.scale * 100)));
    setActiveCanvasId(project.id);
    setActiveCanvasTitle(project.title);
    setShowCanvasHome(false);
    window.localStorage.setItem(ACTIVE_CANVAS_ID_KEY, project.id);
    clearCanvasTransientState();
  }, [clearCanvasTransientState]);

  const updateCanvasProjectRecord = useCallback((recordInput: unknown) => {
    const record = normalizeCanvasRecord(recordInput);
    if (!record) return;
    setCanvasProjects((current) => {
      const next = current.some((item) => item.id === record.id)
        ? current.map((item) => (item.id === record.id ? { ...item, ...record } : item))
        : [record, ...current];
      return [...next].sort((a, b) => Number(b.updatedAt || b.createdAt) - Number(a.updatedAt || a.createdAt));
    });
    if (record.id === activeCanvasId) setActiveCanvasTitle(record.title);
  }, [activeCanvasId]);

  const refreshCanvasProjects = useCallback(async () => {
    if (!window.easyTool?.listCanvases) return [];
    const result = await window.easyTool.listCanvases();
    const projects = (result.canvases || []).map(normalizeCanvasRecord).filter(Boolean) as CanvasProjectRecord[];
    setCanvasProjects(projects);
    return projects;
  }, []);

  const openCanvasProject = useCallback(async (canvasId: string) => {
    if (!canvasId || !window.easyTool?.loadCanvasProject) return;
    setProjectStatus(t("infiniteCanvas.openingCanvas"));
    const project = normalizeCanvasProject(await window.easyTool.loadCanvasProject(canvasId));
    if (!project) {
      setProjectStatus(t("infiniteCanvas.canvasNotFound"));
      await refreshCanvasProjects();
      return;
    }
    applyCanvasProject(project);
    updateCanvasProjectRecord(project);
    setProjectStatus(t("infiniteCanvas.canvasReady"));
  }, [applyCanvasProject, refreshCanvasProjects, t, updateCanvasProjectRecord]);

  useEffect(() => {
    let canceled = false;
    async function loadDiskCanvasProjects() {
      if (!window.easyTool?.listCanvases || !window.easyTool?.loadCanvasProject) {
        const snapshot = readStoredCanvas();
        replaceCanvasDocument({ nodes: snapshot.nodes, connections: snapshot.connections });
        setViewport(snapshot.viewport);
        setZoomInput(String(Math.round(snapshot.viewport.scale * 100)));
        setActiveCanvasId("local-storage");
        setActiveCanvasTitle(t("infiniteCanvas.localCanvas"));
        setCanvasProjects([{ id: "local-storage", title: t("infiniteCanvas.localCanvas"), icon: "layers", createdAt: Date.now(), updatedAt: Date.now(), nodeCount: snapshot.nodes.length }]);
        setCanvasStorageReady(true);
        return;
      }
      try {
        const projects = await refreshCanvasProjects();
        if (canceled) return;
        setShowCanvasHome(true);
      } finally {
        if (!canceled) setCanvasStorageReady(true);
      }
    }
    void loadDiskCanvasProjects();
    return () => {
      canceled = true;
    };
  }, [applyCanvasProject, refreshCanvasProjects, t]);

  useEffect(() => {
    if (!canvasStorageReady) return;
    if (!activeCanvasId) return;
    const snapshot = { title: activeCanvasTitle, nodes, connections, viewport };
    const timeout = window.setTimeout(() => {
      if (window.easyTool?.saveCanvasProject && activeCanvasId !== "local-storage") {
        void window.easyTool.saveCanvasProject(activeCanvasId, snapshot).then((result) => updateCanvasProjectRecord(result.record || result.canvas));
      } else {
        window.localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify({ nodes, connections, viewport }));
      }
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [activeCanvasId, activeCanvasTitle, canvasStorageReady, connections, nodes, updateCanvasProjectRecord, viewport]);

  useEffect(() => {
    const syncApiProviders = () => {
      setApiProviders(readApiProviders());
      setDefaultImageProviderId(readDefaultImageProviderId());
    };
    void loadApiSettings().then((settings) => {
      setApiProviders(settings.providers);
      setDefaultImageProviderId(settings.defaultImageProviderId);
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
  }, [nodes]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditingTarget(event.target)) return;
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
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedIds.size) {
          event.preventDefault();
          deleteSelectedNodes();
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
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === "v") {
        event.preventDefault();
        pasteCopiedNodes();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [connections, deleteConnection, nodes, selectedConnectionId, selectedIds]);

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

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - rect.width / 2 - viewport.x) / viewport.scale,
      y: (clientY - rect.top - rect.height / 2 - viewport.y) / viewport.scale,
    };
  }, [viewport]);

  const patchNode = useCallback((nodeId: string, patch: Partial<CanvasNode>) => {
    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)));
  }, [setNodes]);

  const patchNodeWithoutHistory = useCallback((nodeId: string, patch: Partial<CanvasNode>) => {
    setNodesWithoutHistory((current) => current.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)));
  }, [setNodesWithoutHistory]);

  async function createCanvasProjectFromDraft() {
    const title = projectDraftTitle.trim() || `${t("infiniteCanvas.canvasBaseName")} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const initialCanvas = createInitialCanvas();
    if (!window.easyTool?.createCanvas) {
      setProjectStatus(t("infiniteCanvas.canvasDesktopRequired"));
      return;
    }
    setProjectStatus(t("infiniteCanvas.creatingCanvas"));
    const created = await window.easyTool.createCanvas({ title, nodes: initialCanvas.nodes, connections: initialCanvas.connections, viewport: initialCanvas.viewport });
    const project = normalizeCanvasProject(created.canvas);
    const record = normalizeCanvasRecord(created.record || created.canvas);
    if (record) updateCanvasProjectRecord(record);
    if (project) applyCanvasProject(project);
    if (project) setSelectedHomeCanvasId(project.id);
    setProjectDraftTitle("");
    setProjectStatus(t("infiniteCanvas.canvasReady"));
  }

  async function submitRenameCanvasProject(canvasId: string) {
    const title = renamingTitle.trim();
    if (!canvasId || !title || !window.easyTool?.updateCanvasMeta) {
      setRenamingCanvasId("");
      return;
    }
    const result = await window.easyTool.updateCanvasMeta(canvasId, { title });
    updateCanvasProjectRecord(result.record || result.canvas);
    if (canvasId === activeCanvasId) setActiveCanvasTitle(title);
    setRenamingCanvasId("");
    setRenamingTitle("");
  }

  async function deleteCanvasProject(canvasId: string) {
    if (!canvasId || !window.easyTool?.deleteCanvas) return;
    setConfirmingDeleteCanvasId("");
    await window.easyTool.deleteCanvas(canvasId);
    const nextProjects = await refreshCanvasProjects();
    setSelectedHomeCanvasId((current) => (current === canvasId ? nextProjects[0]?.id || "" : current));
    if (canvasId === activeCanvasId && showCanvasHome) {
      setActiveCanvasId("");
      setActiveCanvasTitle(t("infiniteCanvas.untitledCanvas"));
      window.localStorage.removeItem(ACTIVE_CANVAS_ID_KEY);
      return;
    }
    if (canvasId === activeCanvasId) {
      const nextProject = nextProjects.find((project) => project.id !== canvasId) || nextProjects[0];
      if (nextProject) {
        await openCanvasProject(nextProject.id);
      } else if (window.easyTool.createCanvas) {
        const initialCanvas = createInitialCanvas();
        const created = await window.easyTool.createCanvas({ title: t("infiniteCanvas.untitledCanvas"), nodes: initialCanvas.nodes, connections: initialCanvas.connections, viewport: initialCanvas.viewport });
        const project = normalizeCanvasProject(created.canvas);
        const record = normalizeCanvasRecord(created.record || created.canvas);
        if (record) setCanvasProjects([record]);
        if (project) applyCanvasProject(project);
      }
    }
  }

  function getKindLabel(type: CanvasNodeType) {
    return t(`infiniteCanvas.${type}`);
  }

  function getGeneratorInputPreviews(nodeId: string): GeneratorInputPreview[] {
    const promptPreviews: GeneratorInputPreview[] = [];
    const imagePreviews: GeneratorInputPreview[] = [];
    connections
      .filter((connection) => connection.to === nodeId)
      .forEach((connection) => {
        const source = nodeMap.get(connection.from);
        if (!source) return;
        if ((source.type === "image" || source.type === "generator") && source.url) {
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

  function addNode(type: CanvasNodeType, worldPosition?: { x: number; y: number }) {
    const definition = getNodeDefinition(type);
    const node = nodeDefaults(type);
    const center = worldPosition || screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    node.x = Math.round(center.x - definition.defaultSize.w / 2);
    node.y = Math.round(center.y - definition.defaultSize.h / 2);
    setNodes((current) => [...current, node]);
    setSelectedIds(new Set([node.id]));
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
  }

  async function saveCanvasImageAsset(source: { url?: string; dataUrl?: string; defaultName?: string; kind: "input" | "output" }) {
    if (!window.easyTool?.saveCanvasAsset) {
      return {
        url: source.dataUrl || source.url || "",
        fileName: source.defaultName || "canvas-image.png",
      };
    }
    return window.easyTool.saveCanvasAsset(source);
  }

  async function readImagePatch(file: File): Promise<Partial<CanvasNode>> {
    const dataUrl = await readFileAsDataUrl(file);
    const saved = await saveCanvasImageAsset({ dataUrl, defaultName: file.name, kind: "input" });
    const dimensions = await readImageDimensions(saved.url);
    const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
    return {
      url: saved.url,
      fileName: saved.fileName || file.name,
      title: file.name || "Image",
      imageMode: "asset",
      imageSource: "uploaded",
      text: "",
      imageNaturalWidth: dimensions?.width,
      imageNaturalHeight: dimensions?.height,
      ...nextSize,
    };
  }

  async function handleImageFiles(nodeId: string, files: FileList | File[]) {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const patches = await Promise.all(imageFiles.map(readImagePatch));
    const source = nodeMap.get(nodeId);
    const extraNodes = patches.slice(1).map((patch, index) => ({
      ...nodeDefaults("image"),
      ...patch,
      id: uid("image"),
      x: Math.round((source?.x || 0) + (index + 1) * 36),
      y: Math.round((source?.y || 0) + (index + 1) * 36),
    }));
    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, ...patches[0] } : node)).concat(extraNodes));
    setSelectedIds(new Set([extraNodes[extraNodes.length - 1]?.id || nodeId]));
  }

  async function runImageComposer(nodeId: string) {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "generator" || node.running) return;
    const provider = apiProviders.find((item) => item.id === node.imageProviderId)
      || apiProviders.find((item) => item.id === defaultImageProviderId)
      || imageProviders[0]
      || apiProviders[0];
    const model = node.imageModel && provider?.imageModels.includes(node.imageModel) ? node.imageModel : provider?.imageModels[0] || "";
    const resolution = IMAGE_RESOLUTION_OPTIONS.includes(node.imageResolution || "1k") ? node.imageResolution || "1k" : "1k";
    const aspectRatio = IMAGE_ASPECT_RATIO_OPTIONS.includes(node.imageAspectRatio || "1:1") ? node.imageAspectRatio || "1:1" : "1:1";
    if (!provider || !model) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.noImageApiConfigured") });
      return;
    }

    const prompt = [node.text || "", collectPrompt(node, nodes, connections)].filter(Boolean).join("\n\n").trim();
    const referenceImages = collectReferenceImages(node, nodes, connections);
    if (!prompt) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.promptRequired") });
      return;
    }

    const runningSize = fitGenerationNodeSize(aspectRatio);
    patchNode(nodeId, {
      running: true,
      x: Math.round(node.x + (node.w - runningSize.w) / 2),
      y: Math.round(node.y + (node.h - runningSize.h) / 2),
      ...runningSize,
      generationError: "",
      generationStatus: t("infiniteCanvas.running"),
      imageProviderId: provider.id,
      imageModel: model,
      imageResolution: resolution,
      imageAspectRatio: aspectRatio,
      imageMode: "generator",
    });

    const abortController = new AbortController();
    generationAbortControllersRef.current[nodeId]?.abort();
    generationAbortControllersRef.current[nodeId] = abortController;

    try {
      const setGenerationStatus = (message: string) => {
        patchNode(nodeId, { generationStatus: message });
      };
      const result = await generateImageWithProvider({ provider, model, prompt, referenceImages, resolution, aspectRatio, onStatus: setGenerationStatus, signal: abortController.signal });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      setGenerationStatus("正在保存图片...");
      const saved = await saveCanvasImageAsset({ url: result.url, defaultName: result.fileName, kind: "output" });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const dimensions = await readImageDimensions(saved.url);
      const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : fitImageNodeSize(result.width || 1024, result.height || 1024);
      setNodes((current) => current.map((currentNode) => {
        if (currentNode.id === nodeId) {
          return {
            ...currentNode,
            url: saved.url,
            fileName: saved.fileName || result.fileName,
            imageProviderId: provider.id,
            imageModel: model,
            imageResolution: resolution,
            imageAspectRatio: aspectRatio,
            imageMode: "generator",
            imageSource: "generated",
            imageNaturalWidth: dimensions?.width || result.width || 1024,
            imageNaturalHeight: dimensions?.height || result.height || 1024,
            running: false,
            generationError: "",
            generationStatus: "",
            ...nextSize,
          };
        }
        return currentNode;
      }));
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      patchNode(nodeId, {
        running: false,
        generationError: isAbort ? "" : error instanceof Error ? error.message : String(error),
        generationStatus: "",
      });
    } finally {
      if (generationAbortControllersRef.current[nodeId] === abortController) {
        delete generationAbortControllersRef.current[nodeId];
      }
    }
  }

  function stopImageComposer(nodeId: string) {
    generationAbortControllersRef.current[nodeId]?.abort();
    delete generationAbortControllersRef.current[nodeId];
    patchNode(nodeId, {
      running: false,
      generationError: "",
      generationStatus: "",
    });
  }

  function openImagePreview(nodeId: string) {
    const node = nodeMap.get(nodeId);
    if ((node?.type !== "image" && node?.type !== "generator") || !node.url) return;
    setImagePreview({ nodeId });
  }

  function openImageCrop(nodeId: string) {
    const node = nodeMap.get(nodeId);
    if ((node?.type !== "image" && node?.type !== "generator") || !node.url) return;
    setImageCrop((current) => (current?.nodeId === nodeId ? null : { nodeId, rect: initialCropRect(node), aspect: "free" }));
  }

  async function downloadNodeImage(nodeId: string) {
    const node = nodeMap.get(nodeId);
    if ((node?.type !== "image" && node?.type !== "generator") || !node.url) return;
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
  }

  function changeCropAspect(nodeId: string, aspect: CropAspectKey) {
    const node = nodeMap.get(nodeId);
    if (node?.type !== "image" || imageCrop?.nodeId !== nodeId) return;
    setImageCrop({ nodeId, aspect, rect: cropRectForAspect(imageCrop.rect, node, aspect) });
  }

  function startCropInteraction(event: PointerEvent<HTMLDivElement | HTMLButtonElement>, nodeId: string, mode: "move" | "resize") {
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
  }

  function handleCropPointerMove(event: PointerEvent<HTMLElement>) {
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
  }

  function stopCropInteraction(event: PointerEvent<HTMLElement>) {
    const crop = cropInteractionRef.current;
    if (!crop || crop.pointerId !== event.pointerId) return;
    cropInteractionRef.current = null;
  }

  async function applyCrop(nodeId: string) {
    const node = nodeMap.get(nodeId);
    if (node?.type !== "image" || !node.url || imageCrop?.nodeId !== nodeId) return;
    const contentRect = imageContentRect(node);
    const rect = constrainCropRect(imageCrop.rect, node, imageCrop.aspect);
    const naturalWidth = node.imageNaturalWidth || node.w;
    const naturalHeight = node.imageNaturalHeight || node.h;
    const result = await cropImageToRect(node.url, naturalWidth, naturalHeight, rect, contentRect);
    if (!result) return;
    const saved = await saveCanvasImageAsset({ dataUrl: result.dataUrl, defaultName: node.fileName ? `cropped-${node.fileName}` : "cropped-image.png", kind: "output" });
    const nextSize = fitImageNodeSize(result.width, result.height);
    patchNode(nodeId, {
      url: saved.url,
      fileName: saved.fileName,
      imageNaturalWidth: result.width,
      imageNaturalHeight: result.height,
      ...nextSize,
    });
    setImageCrop(null);
  }

  function deleteNode(nodeId: string) {
    setCanvasDocument((current) => ({
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      connections: current.connections.filter((connection) => connection.from !== nodeId && connection.to !== nodeId),
    }));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
    setImageCrop((current) => (current?.nodeId === nodeId ? null : current));
  }

  function deleteSelectedNodes() {
    const ids = new Set(selectedIds);
    if (!ids.size) return;
    setCanvasDocument((current) => ({
      nodes: current.nodes.filter((node) => !ids.has(node.id)),
      connections: current.connections.filter((connection) => !ids.has(connection.from) && !ids.has(connection.to)),
    }));
    setSelectedIds(new Set());
    setSelectedConnectionId("");
    setConnectionAction(null);
    setImageCrop((current) => (current && ids.has(current.nodeId) ? null : current));
    setImagePreview((current) => (current && ids.has(current.nodeId) ? null : current));
  }

  function copySelectedNodes() {
    if (!selectedIds.size) return;
    const ids = new Set(selectedIds);
    const copiedNodes = nodes.filter((node) => ids.has(node.id)).map((node) => ({ ...node }));
    if (!copiedNodes.length) return;
    copiedSelectionRef.current = {
      nodes: copiedNodes,
      connections: connections.filter((connection) => ids.has(connection.from) && ids.has(connection.to)).map((connection) => ({ ...connection })),
    };
  }

  function pasteCopiedNodes() {
    const copied = copiedSelectionRef.current;
    if (!copied?.nodes.length) return;
    const idMap = new Map<string, string>();
    const offset = 36;
    const nextNodes = copied.nodes.map((node) => {
      const nextId = uid(node.type);
      idMap.set(node.id, nextId);
      return {
        ...node,
        id: nextId,
        x: Math.round(node.x + offset),
        y: Math.round(node.y + offset),
        title: node.title,
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
    }));
    setSelectedIds(new Set(nextNodes.map((node) => node.id)));
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
    setImageCrop(null);
    copiedSelectionRef.current = { nodes: nextNodes.map((node) => ({ ...node })), connections: nextConnections.map((connection) => ({ ...connection })) };
  }

  function removeGeneratorInput(connectionId: string) {
    setConnections((current) => current.filter((connection) => connection.id !== connectionId));
  }

  function reorderGeneratorInput(generatorId: string, fromConnectionId: string, imageInsertIndex: number) {
    setConnections((current) => {
      const generatorInputs = current.filter((connection) => connection.to === generatorId);
      const imageInputIds = generatorInputs
        .filter((connection) => {
          const source = nodeMap.get(connection.from);
          return Boolean(source && (source.type === "image" || source.type === "generator") && source.url);
        })
        .map((connection) => connection.id);
      const fromImageIndex = imageInputIds.indexOf(fromConnectionId);
      if (fromImageIndex < 0) return current;
      const nextImageIds = [...imageInputIds];
      const [movedId] = nextImageIds.splice(fromImageIndex, 1);
      const insertIndex = clamp(fromImageIndex < imageInsertIndex ? imageInsertIndex - 1 : imageInsertIndex, 0, nextImageIds.length);
      nextImageIds.splice(insertIndex, 0, movedId);
      const imageOrder = new Map(nextImageIds.map((id, index) => [id, index]));
      const generatorInputOrder = new Map(generatorInputs.map((connection, index) => [connection.id, index]));
      const nextGeneratorInputs = [...generatorInputs].sort((a, b) => {
        const sourceA = nodeMap.get(a.from);
        const sourceB = nodeMap.get(b.from);
        const imageA = Boolean(sourceA && (sourceA.type === "image" || sourceA.type === "generator") && sourceA.url);
        const imageB = Boolean(sourceB && (sourceB.type === "image" || sourceB.type === "generator") && sourceB.url);
        if (imageA && imageB) return (imageOrder.get(a.id) || 0) - (imageOrder.get(b.id) || 0);
        if (imageA !== imageB) return imageA ? 1 : -1;
        return (generatorInputOrder.get(a.id) || 0) - (generatorInputOrder.get(b.id) || 0);
      });
      let inputCursor = 0;
      return current.map((connection) => (connection.to === generatorId ? nextGeneratorInputs[inputCursor++] : connection));
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

  function updateConnectionAction(connectionId: string, clientX: number, clientY: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    setConnectionAction({
      id: connectionId,
      left: clamp(clientX - rect.left, 16, Math.max(16, rect.width - 16)),
      top: clamp(clientY - rect.top, 16, Math.max(16, rect.height - 16)),
    });
  }

  function selectConnection(event: React.PointerEvent<SVGPathElement>, connection: CanvasConnection) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedIds(new Set());
    setSelectedConnectionId(connection.id);
    setHoveredConnectionId(connection.id);
    setContextMenu(null);
    setImageCrop(null);
    setIsZoomMenuOpen(false);
    updateConnectionAction(connection.id, event.clientX, event.clientY);
  }

  function focusConnection(connection: CanvasConnection) {
    const from = nodeMap.get(connection.from);
    const to = nodeMap.get(connection.to);
    if (!from || !to) return;
    setSelectedIds(new Set());
    setSelectedConnectionId(connection.id);
    setHoveredConnectionId(connection.id);
    const point = linkMidpoint(from, to);
    setConnectionAction({
      id: connection.id,
      left: clamp(stageSize.width / 2 + point.x * viewport.scale + viewport.x, 16, Math.max(16, stageSize.width - 16)),
      top: clamp(stageSize.height / 2 + point.y * viewport.scale + viewport.y, 16, Math.max(16, stageSize.height - 16)),
    });
  }

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
    if (event.button === 0 && target.closest(".ic-node, .nodrag")) return;
    event.preventDefault();
    setContextMenu(null);
    setImageCrop(null);
    setIsZoomMenuOpen(false);
    setEditingPromptId("");
    setSelectedIds(new Set());
    setSelectedConnectionId("");
    setConnectionAction(null);
    if (event.button === 1) {
      panRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: viewport,
      };
      setSelectionBox(null);
    } else {
      const start = screenToWorld(event.clientX, event.clientY);
      const rect = stageRef.current?.getBoundingClientRect();
      selectionDragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWorldX: start.x,
        startWorldY: start.y,
      };
      setSelectionBox({ left: rect ? event.clientX - rect.left : 0, top: rect ? event.clientY - rect.top : 0, width: 0, height: 0 });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleStagePointerMove(event: PointerEvent<HTMLDivElement>) {
    const selection = selectionDragRef.current;
    if (selection && selection.pointerId === event.pointerId) {
      event.preventDefault();
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
      setSelectionBox({ left, top, width, height });
      setSelectedIds(new Set(nodes.filter((node) => (
        node.x < maxX
        && node.x + node.w > minX
        && node.y < maxY
        && node.y + node.h > minY
      )).map((node) => node.id)));
      return;
    }
    const pan = panRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      setViewport({
        ...pan.startViewport,
        x: pan.startViewport.x + event.clientX - pan.startClientX,
        y: pan.startViewport.y + event.clientY - pan.startClientY,
      });
      return;
    }
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const clientDx = event.clientX - drag.startClientX;
      const clientDy = event.clientY - drag.startClientY;
      if (!drag.active) {
        const distance = Math.hypot(clientDx, clientDy);
        if (distance < NODE_DRAG_START_THRESHOLD) return;
        drag.active = true;
        dragHistoryRef.current = { nodes, connections };
      }
      event.preventDefault();
      const dx = (event.clientX - drag.startClientX) / viewport.scale;
      const dy = (event.clientY - drag.startClientY) / viewport.scale;
      const draggedNodePositions = new Map(drag.nodes.map((draggedNode) => [draggedNode.id, draggedNode]));
      setNodesWithoutHistory((current) => current.map((currentNode) => {
        const start = draggedNodePositions.get(currentNode.id);
        return start ? { ...currentNode, x: Math.round(start.startX + dx), y: Math.round(start.startY + dy) } : currentNode;
      }));
      return;
    }
    const resize = resizeRef.current;
    if (resize && resize.pointerId === event.pointerId) {
      const node = nodeMap.get(resize.nodeId);
      if (!node) return;
      if (node.type === "image" || node.type === "generator") {
        resizeRef.current = null;
        return;
      }
      const dx = (event.clientX - resize.startClientX) / viewport.scale;
      const dy = (event.clientY - resize.startClientY) / viewport.scale;
      const minW = 180;
      const minH = 140;
      const maxW = 1200;
      const maxH = 900;
      const nextW = clamp(Math.round(resize.startW + dx), minW, maxW);
      const nextH = clamp(Math.round(resize.startH + dy), minH, maxH);
      patchNodeWithoutHistory(resize.nodeId, { w: nextW, h: nextH });
      return;
    }
    const link = linkDraft;
    if (link && link.pointerId === event.pointerId) {
      const point = screenToWorld(event.clientX, event.clientY);
      setLinkDraft({ ...link, x: point.x, y: point.y });
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
    setViewport((current) => ({
      ...current,
      x: -point.x * current.scale,
      y: -point.y * current.scale,
    }));
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
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
    if (selectionDragRef.current?.pointerId === event.pointerId) {
      selectionDragRef.current = null;
      setSelectionBox(null);
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      const previous = dragHistoryRef.current;
      dragRef.current = null;
      dragHistoryRef.current = null;
      if (previous) commitCanvasDocumentChange(previous);
    }
    if (resizeRef.current?.pointerId === event.pointerId) {
      const previous = dragHistoryRef.current;
      resizeRef.current = null;
      dragHistoryRef.current = null;
      if (previous) commitCanvasDocumentChange(previous);
    }
    if (linkDraft?.pointerId === event.pointerId) setLinkDraft(null);
  }

  function handleStageContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".ic-node")) return;
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

  function startNodeDrag(event: PointerEvent<HTMLDivElement>, node: CanvasNode) {
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
    setSelectedIds(dragSelectionIds);
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      nodes: draggedNodes.length ? draggedNodes : [{ id: node.id, startX: node.x, startY: node.y }],
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleNodeDoubleClick(event: React.MouseEvent<HTMLDivElement>, node: CanvasNode) {
    if (node.type !== "prompt") return;
    const target = event.target as HTMLElement;
    if (target.closest(".nodrag, input, textarea, select, button")) return;

    event.preventDefault();
    event.stopPropagation();
    setSelectedIds(new Set([node.id]));
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
    setEditingPromptId(node.id);
  }

  function startNodeResize(event: PointerEvent<HTMLButtonElement>, node: CanvasNode) {
    event.preventDefault();
    event.stopPropagation();
    if (node.type === "image" || node.type === "generator") return;
    resizeRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startW: node.w,
      startH: node.h,
    };
    dragHistoryRef.current = { nodes, connections };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startLink(event: PointerEvent<HTMLButtonElement>, node: CanvasNode) {
    event.preventDefault();
    event.stopPropagation();
    const point = screenToWorld(event.clientX, event.clientY);
    setSelectedConnectionId("");
    setConnectionAction(null);
    setLinkDraft({ pointerId: event.pointerId, from: node.id, x: point.x, y: point.y });
  }

  function finishLink(event: PointerEvent<HTMLElement>, target: CanvasNode) {
    const draft = linkDraft;
    if (!draft || draft.from === target.id) return;
    event.preventDefault();
    event.stopPropagation();
    const from = nodeMap.get(draft.from);
    if (!from || !canConnect(from, target)) {
      setLinkDraft(null);
      return;
    }
    setConnections((current) => current.some((connection) => connection.from === draft.from && connection.to === target.id)
      ? current
      : [...current, { id: uid("link"), from: draft.from, to: target.id }]);
    setLinkDraft(null);
  }

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

  function renderNodeBody(node: CanvasNode) {
    const onPatch = (patch: Partial<CanvasNode>) => patchNode(node.id, patch);
    if (node.type === "image" || node.type === "generator") {
      return (
        <ImageNodeBody
          node={node}
          cropRect={imageCrop?.nodeId === node.id ? imageCrop.rect : null}
          setFileInputRef={(input) => {
            fileInputRefs.current[node.id] = input;
          }}
          onFiles={(files) => {
            if (node.type === "image") handleImageFiles(node.id, files);
          }}
          onPreview={() => openImagePreview(node.id)}
          onStartCropInteraction={(event, mode) => startCropInteraction(event, node.id, mode)}
          onCropPointerMove={handleCropPointerMove}
          onStopCropInteraction={stopCropInteraction}
        />
      );
    }
    if (node.type === "prompt") {
      return (
        <PromptNodeBody
          node={node}
          isEditing={editingPromptId === node.id}
          onEditingChange={(editing) => setEditingPromptId(editing ? node.id : "")}
          onPatch={onPatch}
        />
      );
    }
    return <LoopNodeBody node={node} onPatch={onPatch} />;
  }

  function renderToolbar(node: CanvasNode) {
    const isCropping = imageCrop?.nodeId === node.id;
    if (!selectedIds.has(node.id) && !isCropping) return null;
    return (
      <div className={`ic-node-hover-toolbar nodrag${isCropping ? " ic-node-hover-toolbar--crop" : ""}`}>
        {isCropping ? (
          <>
            <div className={`ic-crop-aspect-menu${cropAspectMenuOpen ? " open" : ""}`} onPointerEnter={() => setCropAspectMenuOpen(true)} onPointerLeave={() => setCropAspectMenuOpen(false)}>
              <button type="button" className="ic-crop-aspect-trigger" aria-label={t("infiniteCanvas.cropAspect")} title={t("infiniteCanvas.cropAspect")} onClick={() => setCropAspectMenuOpen(true)}>
                <Ratio size={14} aria-hidden="true" />
                <span>{imageCrop.aspect === "original" ? t("infiniteCanvas.originalAspect") : imageCrop.aspect === "free" ? t("infiniteCanvas.freeAspect") : imageCrop.aspect}</span>
              </button>
              <div className="ic-crop-aspect-list" role="menu" aria-label={t("infiniteCanvas.cropAspect")}>
                {CROP_ASPECT_OPTIONS.map((option) => (
                  <button key={option.key} type="button" role="menuitemradio" aria-checked={option.key === imageCrop.aspect} onClick={() => changeCropAspect(node.id, option.key)}>
                    <Ratio size={13} aria-hidden="true" />
                    <span>{option.key === "original" ? t("infiniteCanvas.originalAspect") : option.key === "free" ? t("infiniteCanvas.freeAspect") : option.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="ic-node-toolbar-icon" aria-label={t("infiniteCanvas.applyCrop")} title={t("infiniteCanvas.applyCrop")} onClick={() => applyCrop(node.id)}>
              <Check size={15} aria-hidden="true" />
            </button>
            <button type="button" className="ic-node-toolbar-icon ic-node-toolbar-icon--danger" aria-label={t("infiniteCanvas.cancelCrop")} title={t("infiniteCanvas.cancelCrop")} onClick={() => setImageCrop(null)}>
              <X size={15} aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            {node.type === "image" ? (
              <button type="button" aria-label={t("common.actions.uploadImage")} title={t("common.actions.uploadImage")} onClick={() => fileInputRefs.current[node.id]?.click()}>
                <Upload size={14} aria-hidden="true" />
              </button>
            ) : null}
            {(node.type === "image" || node.type === "generator") && node.url ? (
              <>
                <button type="button" aria-label={t("infiniteCanvas.cropImage")} title={t("infiniteCanvas.cropImage")} onClick={() => openImageCrop(node.id)}>
                  <Crop size={14} aria-hidden="true" />
                </button>
                <button type="button" aria-label={t("infiniteCanvas.viewLargeImage")} title={t("infiniteCanvas.viewLargeImage")} onClick={() => openImagePreview(node.id)}>
                  <Eye size={14} aria-hidden="true" />
                </button>
                {node.type === "generator" ? (
                  <button type="button" aria-label={t("infiniteCanvas.downloadImage")} title={t("infiniteCanvas.downloadImage")} disabled={downloadStatus?.nodeId === node.id && downloadStatus.tone === "busy"} onClick={() => downloadNodeImage(node.id)}>
                    <Download size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </>
            ) : null}
            <button type="button" className="ic-node-toolbar-icon--danger" aria-label={t("infiniteCanvas.deleteNode")} title={t("infiniteCanvas.deleteNode")} onClick={() => deleteNode(node.id)}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    );
  }

  function renderImageComposer() {
    const node = selectedId ? nodeMap.get(selectedId) : null;
    if (!node || node.type !== "generator" || imageCrop?.nodeId === node.id) return null;
    const selectedProvider = defaultImageProvider
      || imageProviders.find((provider) => provider.id === node.imageProviderId)
      || null;
    const selectedModel = node.imageModel && selectedProvider?.imageModels.includes(node.imageModel) ? node.imageModel : selectedProvider?.imageModels[0] || "";
    const selectedResolution = IMAGE_RESOLUTION_OPTIONS.includes(node.imageResolution || "1k") ? node.imageResolution || "1k" : "1k";
    const selectedAspectRatio = IMAGE_ASPECT_RATIO_OPTIONS.includes(node.imageAspectRatio || "1:1") ? node.imageAspectRatio || "1:1" : "1:1";
    const inputPreviews = getGeneratorInputPreviews(node.id);
    const promptInputCount = inputPreviews.filter((item) => item.kind === "prompt").length;
    const width = clamp(Math.round(node.w + 260), 520, 720);
    const selectId = (name: string) => `${node.id}:${name}`;
    const sizePanelId = selectId("size");
    const isSizePanelOpen = openImageComposerSelect === sizePanelId;
    const renderComposerSelect = (
      name: string,
      label: string,
      value: string,
      options: Array<{ value: string; label: string }>,
      onChange: (value: string) => void,
      disabled = false,
    ) => {
      const id = selectId(name);
      const selectedOption = options.find((option) => option.value === value) || options[0] || { value: "", label };
      const isOpen = openImageComposerSelect === id && !disabled;
      return (
        <div className={`ic-composer-select${isOpen ? " open" : ""}${disabled ? " disabled" : ""}`}>
          <button
            type="button"
            className="ic-composer-select__trigger"
            aria-label={label}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            disabled={disabled}
            onClick={() => setOpenImageComposerSelect((current) => (current === id ? "" : id))}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpenImageComposerSelect("");
            }}
          >
            <span>{selectedOption.label}</span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
          {isOpen ? (
            <div className="ic-composer-select__menu" role="listbox" aria-label={label}>
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={option.value === selectedOption.value ? "selected" : ""}
                  role="option"
                  aria-selected={option.value === selectedOption.value}
                  onClick={() => {
                    onChange(option.value);
                    setOpenImageComposerSelect("");
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === selectedOption.value ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      );
    };
    const renderSizePanel = () => (
      <div className={`ic-composer-size${isSizePanelOpen ? " open" : ""}`}>
        <button
          type="button"
          className="ic-composer-select__trigger ic-composer-size__trigger"
          aria-label={`${t("infiniteCanvas.resolution")} / ${t("infiniteCanvas.ratio")}`}
          aria-haspopup="dialog"
          aria-expanded={isSizePanelOpen}
          onClick={() => setOpenImageComposerSelect((current) => (current === sizePanelId ? "" : sizePanelId))}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpenImageComposerSelect("");
          }}
        >
          <span>{`${selectedResolution.toUpperCase()} · ${selectedAspectRatio}`}</span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
        {isSizePanelOpen ? (
          <div className="ic-composer-size__panel" role="dialog" aria-label={`${t("infiniteCanvas.resolution")} / ${t("infiniteCanvas.ratio")}`}>
            <div className="ic-composer-size__section">
              <span>{t("infiniteCanvas.resolution")}</span>
              <div className="ic-composer-size__resolution" role="radiogroup" aria-label={t("infiniteCanvas.resolution")}>
                {[
                  { value: "1k", label: t("infiniteCanvas.resolution1k") },
                  { value: "2k", label: t("infiniteCanvas.resolution2k") },
                  { value: "4k", label: t("infiniteCanvas.resolution4k") },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={option.value === selectedResolution ? "selected" : ""}
                    role="radio"
                    aria-checked={option.value === selectedResolution}
                    onClick={() => patchNode(node.id, { imageResolution: option.value as CanvasNode["imageResolution"] })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ic-composer-size__section">
              <span>{t("infiniteCanvas.ratio")}</span>
              <div className="ic-composer-size__ratios" role="radiogroup" aria-label={t("infiniteCanvas.ratio")}>
                {IMAGE_ASPECT_RATIO_OPTIONS.map((ratio) => {
                  const [rawW, rawH] = ratio.split(":").map(Number);
                  const w = rawW || 1;
                  const h = rawH || 1;
                  const isWide = w >= h;
                  return (
                    <button
                      key={ratio}
                      type="button"
                      className={ratio === selectedAspectRatio ? "selected" : ""}
                      role="radio"
                      aria-checked={ratio === selectedAspectRatio}
                      onClick={() => patchNode(node.id, { imageAspectRatio: ratio as CanvasNode["imageAspectRatio"] })}
                    >
                      <i
                        aria-hidden="true"
                        style={{
                          width: isWide ? 18 : Math.max(8, Math.round(18 * w / h)),
                          height: isWide ? Math.max(8, Math.round(18 * h / w)) : 18,
                        }}
                      />
                      <span>{ratio === "1:1" ? t("infiniteCanvas.ratioSquare") : ratio}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );

    return (
      <div
        className="ic-image-composer nodrag nopan nowheel"
        style={{ left: WORLD_CENTER + node.x + node.w / 2, top: WORLD_CENTER + node.y + node.h + 14, width }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (!(event.target as HTMLElement).closest(".ic-composer-select, .ic-composer-size")) setOpenImageComposerSelect("");
        }}
      >
        {inputPreviews.length ? (
          <div
            className={`ic-image-composer__inputs${draggedInputConnectionId ? " sorting" : ""}${inputInsertIndex !== null ? " has-insert" : ""}`}
            aria-label={t("infiniteCanvas.imageComposerParams")}
            style={inputInsertIndex !== null ? {
              "--ic-input-insert-index": inputInsertIndex,
              "--ic-prompt-input-count": promptInputCount,
            } as React.CSSProperties : undefined}
            onDragOver={(event) => {
              if (!draggedInputConnectionId) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              setInputInsertIndex(getImageInputInsertIndex(event.currentTarget, event.clientX));
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setInputInsertIndex(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const connectionId = event.dataTransfer.getData("text/plain");
              reorderGeneratorInput(node.id, connectionId, inputInsertIndex ?? getImageInputInsertIndex(event.currentTarget, event.clientX));
              setDraggedInputConnectionId("");
              setInputInsertIndex(null);
            }}
          >
            {inputPreviews.map((item) => (
              <div
                key={item.connectionId}
                className={`ic-image-composer__input ic-image-composer__input--${item.kind}${draggedInputConnectionId === item.connectionId ? " dragging" : ""}`}
                title={item.title}
                draggable={item.kind === "image"}
                onDragStart={(event) => {
                  if (item.kind !== "image") return;
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", item.connectionId);
                  setDraggedInputConnectionId(item.connectionId);
                  setInputInsertIndex(item.order - 1);
                }}
                onDragEnd={() => {
                  setDraggedInputConnectionId("");
                  setInputInsertIndex(null);
                }}
              >
                {item.kind === "image" ? (
                  <>
                    <img src={item.url} alt={item.title} draggable={false} />
                    <span className="ic-image-composer__input-order">{item.order}</span>
                  </>
                ) : (
                  <>
                    <span>{item.title}</span>
                    <p>{item.text}</p>
                  </>
                )}
                <button
                  type="button"
                  className="ic-image-composer__input-remove"
                  aria-label={t("infiniteCanvas.deleteConnection")}
                  title={t("infiniteCanvas.deleteConnection")}
                  draggable={false}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    removeGeneratorInput(item.connectionId);
                  }}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          className="ic-image-composer__prompt"
          value={node.text || ""}
          placeholder={t("infiniteCanvas.imageComposerPlaceholder")}
          onChange={(event) => patchNode(node.id, { text: event.target.value })}
        />
        <div className="ic-image-composer__bottom">
          <div className="ic-image-composer__params" aria-label={t("infiniteCanvas.imageComposerParams")}>
            {renderComposerSelect(
              "model",
              t("infiniteCanvas.model"),
              selectedModel,
              selectedProvider?.imageModels.length
                ? selectedProvider.imageModels.map((model) => ({ value: model, label: model }))
                : [{ value: "", label: t("settings.noImageModels") }],
              (value) => patchNode(node.id, { imageModel: value, imageProviderId: selectedProvider?.id || "", generationError: "" }),
              !selectedProvider,
            )}
            {renderSizePanel()}
            {renderComposerSelect(
              "auto",
              t("infiniteCanvas.auto"),
              "auto",
              [{ value: "auto", label: t("infiniteCanvas.auto") }],
              () => undefined,
            )}
          </div>
        <button
          type="button"
          className={`ic-image-composer__run${node.running ? " is-stop" : ""}`}
          aria-label={node.running ? "停止生成" : t("infiniteCanvas.run")}
          title={node.running ? "停止生成" : t("infiniteCanvas.run")}
          disabled={!node.running && (!selectedProvider || !selectedModel)}
          onClick={() => (node.running ? stopImageComposer(node.id) : runImageComposer(node.id))}
        >
          {node.running ? <Square size={15} aria-hidden="true" fill="currentColor" /> : <Play size={18} aria-hidden="true" fill="currentColor" />}
        </button>
        </div>
        {node.generationError ? <div className="ic-image-composer__error">{node.generationError}</div> : null}
      </div>
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

  function renderCanvasHome() {
    const selectedHomeCanvas = sortedCanvasProjects.find((project) => project.id === selectedHomeCanvasId) || sortedCanvasProjects[0] || null;
    const formatProjectDate = (timestamp: number) => {
      if (!timestamp) return "--";
      const date = new Date(timestamp);
      return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    };
    return (
      <div className="ic-project-home" aria-label={t("infiniteCanvas.homeAriaLabel")}>
        <div className="ic-project-home__panel">
          <div className="ic-project-home__head">
            <div className="ic-project-home__title">
              <div>
                <strong>{t("infiniteCanvas.homeTitle")}</strong>
                <span>{canvasProjects.length}</span>
              </div>
            </div>
            <div className="ic-project-home__actions">
              <div className="ic-project-sort" role="group" aria-label={t("infiniteCanvas.sortCanvases")}>
                <button type="button" className={canvasSortMode === "recent" ? "active" : ""} onClick={() => setCanvasSortMode("recent")}>{t("infiniteCanvas.sortRecent")}</button>
                <button type="button" className={canvasSortMode === "name" ? "active" : ""} onClick={() => setCanvasSortMode("name")}>{t("infiniteCanvas.sortName")}</button>
              </div>
              <button className="ic-home-icon-button" type="button" title={t("infiniteCanvas.refreshCanvases")} aria-label={t("infiniteCanvas.refreshCanvases")} onClick={() => void refreshCanvasProjects()}>
                <RefreshCw size={17} aria-hidden="true" />
              </button>
              <form
                className="ic-home-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createCanvasProjectFromDraft();
                }}
              >
                <input value={projectDraftTitle} maxLength={80} placeholder={t("infiniteCanvas.canvasNamePlaceholder")} onChange={(event) => setProjectDraftTitle(event.target.value)} />
                <button type="submit">
                  <Plus size={17} aria-hidden="true" />
                  <span>{t("infiniteCanvas.newCanvas")}</span>
                </button>
              </form>
            </div>
          </div>
        <div className="ic-project-card-grid">
          {sortedCanvasProjects.length ? sortedCanvasProjects.map((project) => {
            const isActive = project.id === selectedHomeCanvasId || (!selectedHomeCanvasId && project.id === selectedHomeCanvas?.id);
            const isRenaming = project.id === renamingCanvasId;
            const isConfirmingDelete = project.id === confirmingDeleteCanvasId;
            return (
              <article key={project.id} className={`ic-project-card${isActive ? " active" : ""}${isConfirmingDelete ? " confirming-delete" : ""}`} onClick={() => setSelectedHomeCanvasId(project.id)} onDoubleClick={() => {
                if (!isConfirmingDelete) void openCanvasProject(project.id);
              }}>
                {isRenaming ? (
                  <form
                    className="ic-project-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitRenameCanvasProject(project.id);
                    }}
                  >
                    <input
                      value={renamingTitle}
                      autoFocus
                      maxLength={80}
                      onChange={(event) => setRenamingTitle(event.target.value)}
                      onBlur={() => void submitRenameCanvasProject(project.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setRenamingCanvasId("");
                          setRenamingTitle("");
                        }
                      }}
                    />
                  </form>
                ) : (
                  <>
                    <div className="ic-project-card__actions" onDoubleClick={(event) => event.stopPropagation()}>
                      <button
                        className="ic-project-icon-button"
                        type="button"
                        title={t("infiniteCanvas.renameCanvas")}
                        aria-label={t("infiniteCanvas.renameCanvas")}
                        onClick={(event) => {
                          event.stopPropagation();
                          setRenamingCanvasId(project.id);
                          setRenamingTitle(project.title || "");
                          setConfirmingDeleteCanvasId("");
                        }}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        className="ic-project-icon-button"
                        type="button"
                        title={t("infiniteCanvas.deleteCanvas")}
                        aria-label={t("infiniteCanvas.deleteCanvas")}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedHomeCanvasId(project.id);
                          setConfirmingDeleteCanvasId(project.id);
                        }}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                    <button className="ic-project-card__main" type="button" onClick={() => setSelectedHomeCanvasId(project.id)}>
                      <span className="ic-project-card__icon"><Layers size={18} aria-hidden="true" /></span>
                      <strong>{project.title || t("infiniteCanvas.untitledCanvas")}</strong>
                      <small>{formatProjectDate(project.updatedAt || project.createdAt)}</small>
                    </button>
                    {isConfirmingDelete ? (
                      <div className="ic-project-delete-confirm" role="alert" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                        <span>{t("infiniteCanvas.deleteThisCanvas")}</span>
                        <div>
                          <button type="button" className="ic-project-delete-cancel" onClick={() => setConfirmingDeleteCanvasId("")}>
                            {t("common.actions.cancel")}
                          </button>
                          <button type="button" className="ic-project-delete-confirm__danger" onClick={() => void deleteCanvasProject(project.id)}>
                            {t("common.actions.delete")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </article>
            );
          }) : <div className="ic-project-empty">{t("infiniteCanvas.noCanvases")}</div>}
        </div>
        </div>
      </div>
    );
  }

  return (
    <section className="infinite-canvas-page" aria-label={t("infiniteCanvas.title")}>
      {showCanvasHome ? renderCanvasHome() : null}
      <div
        ref={stageRef}
        className={`ic-workspace ic-stage${panRef.current ? " panning" : ""}${showCanvasHome ? " is-hidden" : ""}`}
        onWheel={handleWheel}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerUp}
        onContextMenu={handleStageContextMenu}
      >
        <button className="ic-back-to-projects nodrag" type="button" onClick={() => setShowCanvasHome(true)}>
          <ChevronDown size={16} aria-hidden="true" />
          <span>{t("infiniteCanvas.backToCanvases")}</span>
        </button>
        <div
          className="ic-canvas-grid"
          style={{
            "--ic-grid-x": `${viewport.x}px`,
            "--ic-grid-y": `${viewport.y}px`,
            "--ic-grid-size": `${22 * viewport.scale}px`,
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
        <div className="ic-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
          <svg className="ic-links" viewBox={`${-WORLD_CENTER} ${-WORLD_CENTER} ${WORLD_SIZE} ${WORLD_SIZE}`}>
            {connections.map((connection) => {
              const from = nodeMap.get(connection.from);
              const to = nodeMap.get(connection.to);
              if (!from || !to) return null;
              const related = selectedIds.has(from.id) || selectedIds.has(to.id);
              const selected = selectedConnectionId === connection.id;
              const hovered = hoveredConnectionId === connection.id;
              const path = linkPath(from, to);
              return (
                <g key={connection.id} className="ic-link-group">
                  <path
                    className="ic-link-hit"
                    d={path}
                    role="button"
                    tabIndex={0}
                    aria-label={t("infiniteCanvas.selectConnection")}
                    onPointerDown={(event) => selectConnection(event, connection)}
                    onPointerEnter={(event) => {
                      setHoveredConnectionId(connection.id);
                      if (selected) updateConnectionAction(connection.id, event.clientX, event.clientY);
                    }}
                    onPointerMove={(event) => {
                      if (selected) updateConnectionAction(connection.id, event.clientX, event.clientY);
                    }}
                    onPointerLeave={() => {
                      setHoveredConnectionId((current) => (current === connection.id ? "" : current));
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      focusConnection(connection);
                    }}
                  />
                  <path className={`ic-link${related || selected || hovered ? " related" : ""}${selected ? " selected" : ""}`} d={path} />
                </g>
              );
            })}
            {linkDraft && nodeMap.get(linkDraft.from) ? <path className="ic-link ic-link--temp" d={tempLinkPath(nodeMap.get(linkDraft.from) as CanvasNode, linkDraft.x, linkDraft.y)} /> : null}
          </svg>
          {nodes.map((node) => {
            const selected = selectedIds.has(node.id);
            const related = connections.some((connection) => selected && (connection.from === node.id || connection.to === node.id));
            return (
              <div
                key={node.id}
                className={`ic-node ic-node--${node.type}${(node.type === "image" || node.type === "generator") && node.url ? " has-image" : ""}${node.running ? " is-running" : ""}${selected ? " selected" : ""}${hoveredId === node.id ? " hovered" : ""}${related ? " related" : ""}${linkDraft?.from === node.id ? " connecting" : ""}`}
                style={{ left: WORLD_CENTER + node.x, top: WORLD_CENTER + node.y, width: node.w, height: node.h }}
                onPointerDown={(event) => startNodeDrag(event, node)}
                onPointerUp={(event) => finishLink(event, node)}
                onDoubleClick={(event) => handleNodeDoubleClick(event, node)}
                onPointerEnter={() => setHoveredId(node.id)}
                onPointerLeave={() => setHoveredId((current) => (current === node.id ? "" : current))}
              >
                {renderToolbar(node)}
                <button className="ic-port ic-port--in nodrag" type="button" title={t("infiniteCanvas.connectHere")} onPointerUp={(event) => finishLink(event, node)}>
                  <Link2 size={13} aria-hidden="true" />
                </button>
                <button className="ic-port ic-port--out nodrag" type="button" title={t("infiniteCanvas.dragLink")} onPointerDown={(event) => startLink(event, node)}>
                  <Link2 size={13} aria-hidden="true" />
                </button>
                {node.type !== "image" && node.type !== "generator" && node.type !== "prompt" ? (
                  <>
                    <div className="ic-node-head">
                      <span className="ic-node-kind">{(() => {
                        const Icon = getNodeDefinition(node.type).icon;
                        return <Icon size={16} aria-hidden="true" />;
                      })()}{getKindLabel(node.type)}</span>
                    </div>
                    <div className="ic-node-title">{node.title}</div>
                  </>
                ) : null}
                {renderNodeBody(node)}
                {selected && !imageCrop && node.type !== "image" && node.type !== "generator" ? <button className="ic-resize-handle nodrag" type="button" aria-label={t("infiniteCanvas.dragResize")} onPointerDown={(event) => startNodeResize(event, node)} /> : null}
              </div>
            );
          })}
          {renderImageComposer()}
        </div>
        {connectionAction && selectedConnectionId === connectionAction.id ? (
          <button
            className="ic-link-delete-button nodrag"
            type="button"
            aria-label={t("infiniteCanvas.deleteConnection")}
            title={t("infiniteCanvas.deleteConnection")}
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
                aria-label={t("infiniteCanvas.minimap")}
                title={t("infiniteCanvas.minimap")}
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
              <button type="button" title={t("infiniteCanvas.zoomOut")} aria-label={t("infiniteCanvas.zoomOut")} onClick={() => zoomBy(0.88)}>
                <ZoomOut size={16} aria-hidden="true" />
              </button>
              <label>
                <input
                  ref={zoomInputRef}
                  aria-label={t("infiniteCanvas.zoomCanvas")}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={zoomInput}
                  onChange={(event) => setZoomInput(event.target.value)}
                  onBlur={() => zoomToPercent(Number(zoomInput))}
                />
                <span>%</span>
              </label>
              <button type="submit" title={t("common.actions.save")} aria-label={t("common.actions.save")}>
                <Check size={16} aria-hidden="true" />
              </button>
              <button type="button" title={t("infiniteCanvas.zoomIn")} aria-label={t("infiniteCanvas.zoomIn")} onClick={() => zoomBy(1.12)}>
                <ZoomIn size={16} aria-hidden="true" />
              </button>
            </form>
          ) : null}
          <div className="ic-control-bar">
            <button type="button" title={t("infiniteCanvas.resetView")} aria-label={t("infiniteCanvas.resetView")} onClick={resetView}>
              <Crosshair size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={isMinimapOpen ? "active" : ""}
              title={t("infiniteCanvas.minimap")}
              aria-label={t("infiniteCanvas.minimap")}
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
              title={t("infiniteCanvas.zoomCanvas")}
              aria-label={t("infiniteCanvas.zoomCanvas")}
              aria-expanded={isZoomMenuOpen}
              onClick={() => {
                setIsZoomMenuOpen((current) => !current);
              }}
            >
              {Math.round(viewport.scale * 100)}%
            </button>
          </div>
        </div>
        {contextMenu ? (
          <div className="ic-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
            {(["generator", "image", "prompt", "loop"] as CanvasNodeType[]).map((type) => {
              const Icon = getNodeDefinition(type).icon;
              return (
                <button key={type} type="button" role="menuitem" onClick={() => addNode(type, { x: contextMenu.worldX, y: contextMenu.worldY })}>
                  <Icon size={15} aria-hidden="true" />
                  <span>{getKindLabel(type)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {(previewNode?.type === "image" || previewNode?.type === "generator") && previewNode.url ? <ImageViewer src={previewNode.url} alt={previewNode.fileName || "canvas image preview"} ariaLabel={t("infiniteCanvas.viewLargeImage")} onClose={() => setImagePreview(null)} /> : null}
      </div>
    </section>
  );
}

export default CanvasPage;
