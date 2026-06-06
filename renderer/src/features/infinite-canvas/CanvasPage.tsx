import { Check, Crosshair, Crop, Eye, Link2, Map as MapIcon, Play, Ratio, Trash2, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { PointerEvent, WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageViewer } from "../../lib/ImageViewer";
import { CANVAS_STORAGE_KEY, IMAGE_NODE_MAX_HEIGHT, IMAGE_NODE_MAX_WIDTH, IMAGE_NODE_MIN_HEIGHT, IMAGE_NODE_MIN_WIDTH } from "./constants";
import { canConnect } from "./core/rules";
import { planGeneratorRun } from "./core/workflow";
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
import { GroupNodeBody } from "./nodes/GroupNodeBody";
import { ImageNodeBody } from "./nodes/ImageNodeBody";
import { LoopNodeBody } from "./nodes/LoopNodeBody";
import { OutputNodeBody } from "./nodes/OutputNodeBody";
import { PromptNodeBody } from "./nodes/PromptNodeBody";
import { CROP_ASPECT_OPTIONS } from "./constants";
import { createCanvasNode, getNodeDefinition } from "./nodes/registry";
import type { CanvasConnection, CanvasNode, CanvasNodeType, CanvasSnapshot, CropAspectKey, CropInteractionState, ImageDialogState, Viewport } from "./types";

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
const WORLD_SIZE = 4000;
const WORLD_CENTER = WORLD_SIZE / 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 2.4;
const MINIMAP_DEFAULT_WIDTH = 190;
const MINIMAP_DEFAULT_HEIGHT = 128;
const MINIMAP_PADDING = 160;
const FIT_VIEW_PADDING = 0.16;

type StoredCanvasNode = Omit<CanvasNode, "type"> & { type: CanvasNodeType | "generator" };

interface DragState {
  pointerId: number;
  nodeId: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

interface PanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewport: Viewport;
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

function nodeDefaults(type: CanvasNodeType): CanvasNode {
  return createCanvasNode(type, uid(type));
}

function createInitialCanvas(): CanvasSnapshot {
  const prompt = { ...nodeDefaults("prompt"), id: uid("prompt"), x: -470, y: -110, text: "Describe the image, then connect it to an image node." };
  const image = { ...nodeDefaults("image"), id: uid("image"), x: -60, y: -120, text: "" };
  return {
    nodes: [prompt, image],
    connections: [{ id: uid("link"), from: prompt.id, to: image.id }],
    viewport: { x: 0, y: 0, scale: 1 },
  };
}

function normalizeStoredNode(node: StoredCanvasNode): CanvasNode {
  const normalizedType = node.type === "generator" ? "image" : node.type;
  return {
    ...node,
    type: normalizedType,
    title: node.type === "generator" && node.title === "Generator" ? "Image" : node.title,
    url: node.url?.startsWith("blob:") ? "" : node.url,
    imageMode: normalizedType === "image" ? node.imageMode || "generator" : node.imageMode,
  };
}

function readStoredCanvas(): CanvasSnapshot {
  if (typeof window === "undefined") return createInitialCanvas();
  try {
    const rawCanvas = window.localStorage.getItem(CANVAS_STORAGE_KEY);
    if (!rawCanvas) return createInitialCanvas();
    const parsed = JSON.parse(rawCanvas) as { nodes?: StoredCanvasNode[]; connections?: CanvasConnection[]; viewport?: Viewport };
    if (!Array.isArray(parsed.nodes) || !parsed.nodes.length) return createInitialCanvas();
    return {
      nodes: parsed.nodes.map(normalizeStoredNode),
      connections: Array.isArray(parsed.connections) ? parsed.connections : [],
      viewport: parsed.viewport || { x: 0, y: 0, scale: 1 },
    };
  } catch {
    return createInitialCanvas();
  }
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

export function CanvasPage() {
  const { t } = useTranslation();
  const initialRef = useRef(readStoredCanvas());
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const minimapDragRef = useRef<MinimapDragState | null>(null);
  const zoomInputRef = useRef<HTMLInputElement | null>(null);
  const cropInteractionRef = useRef<CropInteractionState | null>(null);
  const [nodes, setNodes] = useState<CanvasNode[]>(initialRef.current.nodes);
  const [connections, setConnections] = useState<CanvasConnection[]>(initialRef.current.connections);
  const [viewport, setViewport] = useState<Viewport>(initialRef.current.viewport);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [minimapSize, setMinimapSize] = useState({ width: MINIMAP_DEFAULT_WIDTH, height: MINIMAP_DEFAULT_HEIGHT });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [hoveredConnectionId, setHoveredConnectionId] = useState("");
  const [connectionAction, setConnectionAction] = useState<{ id: string; left: number; top: number } | null>(null);
  const [hoveredId, setHoveredId] = useState("");
  const [openImagePromptId, setOpenImagePromptId] = useState("");
  const [imagePreview, setImagePreview] = useState<ImageDialogState | null>(null);
  const [imageCrop, setImageCrop] = useState<{ nodeId: string; rect: CanvasSnapshot extends never ? never : ReturnType<typeof initialCropRect>; aspect: CropAspectKey } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const [cropAspectMenuOpen, setCropAspectMenuOpen] = useState(false);
  const [isMinimapOpen, setIsMinimapOpen] = useState(false);
  const [isZoomMenuOpen, setIsZoomMenuOpen] = useState(false);
  const [zoomInput, setZoomInput] = useState(() => String(Math.round(initialRef.current.viewport.scale * 100)));

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0] : "";
  const previewNode = imagePreview ? nodeMap.get(imagePreview.nodeId) : null;
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
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify({ nodes, connections, viewport }));
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [connections, nodes, viewport]);

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
    setOpenImagePromptId((current) => (current && !ids.has(current) ? "" : current));
    setImageCrop((current) => (current && !ids.has(current.nodeId) ? null : current));
    setImagePreview((current) => (current && !ids.has(current.nodeId) ? null : current));
  }, [nodes]);

  useEffect(() => {
    function isEditingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!selectedConnectionId || (event.key !== "Delete" && event.key !== "Backspace")) return;
      if (isEditingTarget(event.target)) return;
      event.preventDefault();
      deleteConnection(selectedConnectionId);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteConnection, selectedConnectionId]);

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
  }, []);

  function getKindLabel(type: CanvasNodeType) {
    return t(`infiniteCanvas.${type}`);
  }

  function getNodeItems(nodeId: string) {
    const node = nodeMap.get(nodeId);
    return (node?.items || []).map((id) => nodeMap.get(id)).filter(Boolean) as CanvasNode[];
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

  async function handleFileChange(nodeId: string, file?: File) {
    if (!file) return;
    setOpenImagePromptId((current) => (current === nodeId ? "" : current));
    const url = URL.createObjectURL(file);
    const dimensions = await readImageDimensions(url);
    const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
    patchNode(nodeId, {
      url,
      fileName: file.name,
      title: file.name,
      imageMode: "asset",
      imageSource: "uploaded",
      text: "",
      imageNaturalWidth: dimensions?.width,
      imageNaturalHeight: dimensions?.height,
      ...nextSize,
    });
  }

  function runGenerator(nodeId: string) {
    const plan = planGeneratorRun(nodeId, nodes, connections, nodeMap, uid("result"));
    if (!plan) return;
    setOpenImagePromptId((current) => (current === nodeId ? "" : current));
    patchNode(nodeId, {
      ...plan.patch,
      generated: [...(nodeMap.get(nodeId)?.generated || []), plan.item],
    });
  }

  function openImagePreview(nodeId: string) {
    const node = nodeMap.get(nodeId);
    if (node?.type !== "image" || !node.url) return;
    setOpenImagePromptId("");
    setImagePreview({ nodeId });
  }

  function openImageCrop(nodeId: string) {
    const node = nodeMap.get(nodeId);
    if (node?.type !== "image" || !node.url) return;
    setOpenImagePromptId("");
    setImageCrop((current) => (current?.nodeId === nodeId ? null : { nodeId, rect: initialCropRect(node), aspect: "free" }));
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
    const nextSize = fitImageNodeSize(result.width, result.height);
    patchNode(nodeId, {
      url: result.url,
      fileName: node.fileName ? `cropped-${node.fileName}` : "cropped-image.png",
      imageNaturalWidth: result.width,
      imageNaturalHeight: result.height,
      ...nextSize,
    });
    setImageCrop(null);
  }

  function deleteNode(nodeId: string) {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setConnections((current) => current.filter((connection) => connection.from !== nodeId && connection.to !== nodeId));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
    setOpenImagePromptId((current) => (current === nodeId ? "" : current));
    setImageCrop((current) => (current?.nodeId === nodeId ? null : current));
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
    setOpenImagePromptId("");
    setImageCrop(null);
    setIsMinimapOpen(false);
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
    if ((event.target as HTMLElement).closest(".nowheel")) return;
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
    if ((event.target as HTMLElement).closest(".ic-node, .ic-context-menu, .nodrag")) return;
    event.preventDefault();
    setContextMenu(null);
    setOpenImagePromptId("");
    setImageCrop(null);
    setIsMinimapOpen(false);
    setIsZoomMenuOpen(false);
    setSelectedIds(new Set());
    setSelectedConnectionId("");
    setConnectionAction(null);
    panRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewport: viewport,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleStagePointerMove(event: PointerEvent<HTMLDivElement>) {
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
      const dx = (event.clientX - drag.startClientX) / viewport.scale;
      const dy = (event.clientY - drag.startClientY) / viewport.scale;
      patchNode(drag.nodeId, { x: Math.round(drag.startX + dx), y: Math.round(drag.startY + dy) });
      return;
    }
    const resize = resizeRef.current;
    if (resize && resize.pointerId === event.pointerId) {
      const node = nodeMap.get(resize.nodeId);
      if (!node) return;
      const dx = (event.clientX - resize.startClientX) / viewport.scale;
      const dy = (event.clientY - resize.startClientY) / viewport.scale;
      const minW = node.type === "image" ? IMAGE_NODE_MIN_WIDTH : 180;
      const minH = node.type === "image" ? IMAGE_NODE_MIN_HEIGHT : 140;
      const maxW = node.type === "image" ? IMAGE_NODE_MAX_WIDTH : 1200;
      const maxH = node.type === "image" ? IMAGE_NODE_MAX_HEIGHT : 900;
      const nextW = clamp(Math.round(resize.startW + dx), minW, maxW);
      const nextH = node.type === "image" ? clamp(Math.round(resize.startH + dx * (resize.startH / resize.startW)), minH, maxH) : clamp(Math.round(resize.startH + dy), minH, maxH);
      patchNode(resize.nodeId, { w: nextW, h: nextH });
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
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
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
    if (event.button !== 0 || (event.target as HTMLElement).closest(".nodrag, button, input, textarea, select")) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedIds(new Set([node.id]));
    setSelectedConnectionId("");
    setConnectionAction(null);
    setContextMenu(null);
    dragRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: node.x,
      startY: node.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startNodeResize(event: PointerEvent<HTMLButtonElement>, node: CanvasNode) {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startW: node.w,
      startH: node.h,
    };
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
    if (node.type === "image") {
      return (
        <ImageNodeBody
          node={node}
          cropRect={imageCrop?.nodeId === node.id ? imageCrop.rect : null}
          isPromptOpen={openImagePromptId === node.id}
          setFileInputRef={(input) => {
            fileInputRefs.current[node.id] = input;
          }}
          onFileChange={(file) => handleFileChange(node.id, file)}
          onPatch={onPatch}
          onRun={() => runGenerator(node.id)}
          onUpload={() => fileInputRefs.current[node.id]?.click()}
          onPreview={() => openImagePreview(node.id)}
          onTogglePrompt={() => {
            if (node.imageMode === "asset") return;
            setOpenImagePromptId((current) => (current === node.id ? "" : node.id));
          }}
          onStartCropInteraction={(event, mode) => startCropInteraction(event, node.id, mode)}
          onCropPointerMove={handleCropPointerMove}
          onStopCropInteraction={stopCropInteraction}
        />
      );
    }
    if (node.type === "prompt") return <PromptNodeBody node={node} onPatch={onPatch} />;
    if (node.type === "output") return <OutputNodeBody node={node} />;
    if (node.type === "group") return <GroupNodeBody node={node} items={getNodeItems(node.id)} getKindLabel={getKindLabel} onPatch={onPatch} />;
    return <LoopNodeBody node={node} onPatch={onPatch} />;
  }

  function renderToolbar(node: CanvasNode) {
    const isCropping = imageCrop?.nodeId === node.id;
    const isGenerator = node.type === "image" && node.imageMode !== "asset";
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
            {isGenerator ? (
              <button type="button" aria-label={t("infiniteCanvas.runGenerator")} title={t("infiniteCanvas.runGenerator")} onClick={() => runGenerator(node.id)}>
                <Play size={14} aria-hidden="true" />
              </button>
            ) : null}
            {node.type === "image" && node.url ? (
              <>
                <button type="button" aria-label={t("infiniteCanvas.cropImage")} title={t("infiniteCanvas.cropImage")} onClick={() => openImageCrop(node.id)}>
                  <Crop size={14} aria-hidden="true" />
                </button>
                <button type="button" aria-label={t("infiniteCanvas.viewLargeImage")} title={t("infiniteCanvas.viewLargeImage")} onClick={() => openImagePreview(node.id)}>
                  <Eye size={14} aria-hidden="true" />
                </button>
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

  return (
    <section className="infinite-canvas-page" aria-label={t("infiniteCanvas.title")}>
      <div
        ref={stageRef}
        className={`ic-workspace ic-stage${panRef.current ? " panning" : ""}`}
        onWheel={handleWheel}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerUp}
        onContextMenu={handleStageContextMenu}
      >
        <div
          className="ic-canvas-grid"
          style={{
            "--ic-grid-x": `${viewport.x}px`,
            "--ic-grid-y": `${viewport.y}px`,
            "--ic-grid-size": `${22 * viewport.scale}px`,
          } as React.CSSProperties}
        />
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
                className={`ic-node ic-node--${node.type}${node.type === "image" && node.url ? " has-image" : ""}${selected ? " selected" : ""}${hoveredId === node.id ? " hovered" : ""}${related ? " related" : ""}${linkDraft?.from === node.id ? " connecting" : ""}`}
                style={{ left: WORLD_CENTER + node.x, top: WORLD_CENTER + node.y, width: node.w, height: node.h }}
                onPointerDown={(event) => startNodeDrag(event, node)}
                onPointerUp={(event) => finishLink(event, node)}
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
                {node.type !== "image" ? (
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
                {selected && !imageCrop ? <button className="ic-resize-handle nodrag" type="button" aria-label={t("infiniteCanvas.dragResize")} onPointerDown={(event) => startNodeResize(event, node)} /> : null}
              </div>
            );
          })}
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
                setIsMinimapOpen(false);
                setIsZoomMenuOpen((current) => !current);
              }}
            >
              {Math.round(viewport.scale * 100)}%
            </button>
          </div>
        </div>
        {contextMenu ? (
          <div className="ic-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
            {(["image", "prompt", "loop", "group", "output"] as CanvasNodeType[]).map((type) => {
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
        {previewNode?.type === "image" && previewNode.url ? <ImageViewer src={previewNode.url} alt={previewNode.fileName || "canvas image preview"} ariaLabel={t("infiniteCanvas.viewLargeImage")} onClose={() => setImagePreview(null)} /> : null}
      </div>
    </section>
  );
}

export default CanvasPage;
