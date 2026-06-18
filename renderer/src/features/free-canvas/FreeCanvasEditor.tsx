import {
  DragEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  ReactNode,
  WheelEvent,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Download,
  Image as ImageIcon,
  Layers,
  Palette,
  RotateCcw,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import {
  commitFreeCanvasDocumentChange,
  redoFreeCanvasHistory,
  snapshotFreeCanvasDocument,
  undoFreeCanvasHistory,
  useFreeCanvasStore,
} from "./core/freeCanvasStore";
import {
  clamp,
  getCanvasScreenScale,
  getSelectionStageRect,
  hitTestItem,
  normalizeLayerOrder,
  screenToCanvasPoint,
  sortedBackToFront,
  sortedFrontToBack,
} from "./core/geometry";
import type { FreeCanvasEditorItem, FreeCanvasImageItem, FreeCanvasSize, FreeCanvasTextItem, FreeCanvasViewport } from "./types";
import { FreeCanvasTextLayer } from "./text-layer/FreeCanvasTextLayer";
import { measureTextLayer } from "./text-layer/measureTextLayer";
import { FontSizePanel, TextColorPanel } from "./text-layer/TextStylePanel";

const CANVAS_PRESETS = [
  {
    key: "3:4",
    label: "3:4",
    sizes: [
      { key: "1200x1600", label: "1K", width: 1200, height: 1600 },
      { key: "1500x2000", label: "2K", width: 1500, height: 2000 },
      { key: "1800x2400", label: "4K", width: 1800, height: 2400 },
    ],
  },
  {
    key: "1:1",
    label: "1:1",
    sizes: [
      { key: "1200x1200", label: "1K", width: 1200, height: 1200 },
      { key: "1600x1600", label: "2K", width: 1600, height: 1600 },
      { key: "2048x2048", label: "4K", width: 2048, height: 2048 },
    ],
  },
  {
    key: "4:3",
    label: "4:3",
    sizes: [
      { key: "1600x1200", label: "1K", width: 1600, height: 1200 },
      { key: "2000x1500", label: "2K", width: 2000, height: 1500 },
      { key: "2400x1800", label: "4K", width: 2400, height: 1800 },
    ],
  },
  {
    key: "9:16",
    label: "9:16",
    sizes: [
      { key: "720x1280", label: "1K", width: 720, height: 1280 },
      { key: "1080x1920", label: "2K", width: 1080, height: 1920 },
      { key: "1440x2560", label: "4K", width: 1440, height: 2560 },
    ],
  },
  {
    key: "16:9",
    label: "16:9",
    sizes: [
      { key: "1280x720", label: "1K", width: 1280, height: 720 },
      { key: "1920x1080", label: "2K", width: 1920, height: 1080 },
      { key: "2560x1440", label: "4K", width: 2560, height: 1440 },
    ],
  },
] as const;

const VIEWPORT_SCALE_MIN = 0.25;
const VIEWPORT_SCALE_MAX = 4;
const ASSET_RAIL_MIN = 180;
const ASSET_RAIL_MAX = 760;
const ASSET_RAIL_DEFAULT = 320;
const ASSET_PREVIEW_MAX_WIDTH = 360;
const ASSET_PREVIEW_MAX_HEIGHT = 520;
const ASSET_PREVIEW_OFFSET = 18;
const DRAG_DISTANCE = 3;
const TEXT_CREATE_MIN_WIDTH = 96;

export interface ComposerAsset {
  id: string;
  name: string;
  asset_id?: string | null;
  asset_url: string | null;
  updated_at?: string;
}

export interface ComposerAssetChoice {
  id: string;
  name: string;
  asset_id?: string | null;
  asset_url: string | null;
  updated_at?: string;
}

export interface ComposerTag {
  id: string;
  name: string;
}

interface FreeCanvasEditorProps {
  assets: ComposerAsset[];
  tags: ComposerTag[];
  activeTagId: string;
  onTagChange: (tagId: string) => void;
  onOpenTagManager?: () => void;
  onLoadAssetChoices?: (assetId: string) => Promise<ComposerAssetChoice[]>;
  assetTitle?: string;
  railControls?: ReactNode;
  assetAltText: string;
  emptyText: string;
  tagFilterLabel: string;
  cardVariant?: "direct" | "choice";
}

interface AssetHoverPreview {
  src: string;
  x: number;
  y: number;
}

interface AssetChoicePopoverState {
  asset: ComposerAsset;
  x: number;
  y: number;
}

type ActiveTextTool = "fontSize" | "color";
type ActiveCanvasTool = "select" | "text";

type StageInteraction =
  | {
    type: "drag";
    pointerId: number;
    itemId: string;
    startPoint: { x: number; y: number };
    origin: { x: number; y: number };
    didMove: boolean;
    previousDocument: ReturnType<typeof snapshotFreeCanvasDocument>;
  }
  | {
    type: "resize";
    pointerId: number;
    itemId: string;
    startPoint: { x: number; y: number };
    origin: { x: number; y: number; width: number; height: number };
    previousDocument: ReturnType<typeof snapshotFreeCanvasDocument>;
  }
  | {
    type: "pan";
    pointerId: number;
    startClientX: number;
    startClientY: number;
    origin: FreeCanvasViewport;
  }
  | {
    type: "createText";
    pointerId: number;
    startPoint: { x: number; y: number };
    itemId: string;
    didDrag: boolean;
  };

function getAssetUrl(asset: ComposerAsset | ComposerAssetChoice) {
  return asset.asset_url ? `${asset.asset_url}?t=${encodeURIComponent(asset.updated_at || asset.asset_id || asset.id)}` : "";
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load"));
    image.src = src;
  });
}

function drawImageItem(ctx: CanvasRenderingContext2D, image: HTMLImageElement, item: FreeCanvasImageItem) {
  ctx.drawImage(image, item.x, item.y, item.width, item.height);
}

function drawTextItem(ctx: CanvasRenderingContext2D, item: FreeCanvasTextItem) {
  const lineHeight = item.fontSize * 1.25;
  ctx.fillStyle = item.color;
  ctx.font = `${item.fontWeight} ${item.fontSize}px ${item.fontFamily}`;
  ctx.textBaseline = "top";
  ctx.textAlign = item.align;
  const x = item.align === "left" ? item.x : item.align === "right" ? item.x + item.width : item.x + item.width / 2;
  const lines = getCanvasTextLines(ctx, item);
  lines.forEach((line, index) => {
    ctx.fillText(line, x, item.y + index * lineHeight);
  });
}

function getCanvasTextLines(ctx: CanvasRenderingContext2D, item: FreeCanvasTextItem) {
  if (item.autoSize) return item.text.split("\n");
  const maxWidth = Math.max(1, item.width - 12);
  const output: string[] = [];
  item.text.split("\n").forEach((line) => {
    if (!line) {
      output.push("");
      return;
    }
    let currentLine = "";
    Array.from(line).forEach((character) => {
      const nextLine = `${currentLine}${character}`;
      if (currentLine && ctx.measureText(nextLine).width > maxWidth) {
        output.push(currentLine);
        currentLine = character;
      } else {
        currentLine = nextLine;
      }
    });
    output.push(currentLine);
  });
  return output.length ? output : [""];
}

function imageFilesFromTransfer(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.files).filter((file) => file.type.startsWith("image/"));
}

function hasImageFileDrag(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  if (items.some((item) => item.kind === "file" && (!item.type || item.type.startsWith("image/")))) return true;
  return Array.from(dataTransfer.types || []).includes("Files");
}

function assetPreviewPosition(clientX: number, clientY: number) {
  const margin = 12;
  const viewportWidth = window.innerWidth || ASSET_PREVIEW_MAX_WIDTH;
  const viewportHeight = window.innerHeight || ASSET_PREVIEW_MAX_HEIGHT;
  let x = clientX + ASSET_PREVIEW_OFFSET;
  let y = clientY + ASSET_PREVIEW_OFFSET;

  if (x + ASSET_PREVIEW_MAX_WIDTH > viewportWidth - margin) {
    x = clientX - ASSET_PREVIEW_MAX_WIDTH - ASSET_PREVIEW_OFFSET;
  }
  if (y + ASSET_PREVIEW_MAX_HEIGHT > viewportHeight - margin) {
    y = clientY - ASSET_PREVIEW_MAX_HEIGHT - ASSET_PREVIEW_OFFSET;
  }

  return {
    x: clamp(x, margin, Math.max(margin, viewportWidth - ASSET_PREVIEW_MAX_WIDTH - margin)),
    y: clamp(y, margin, Math.max(margin, viewportHeight - ASSET_PREVIEW_MAX_HEIGHT - margin)),
  };
}

function createImageItem({
  id,
  name,
  assetId,
  src,
  canvasSize,
  point,
  zIndex,
}: {
  id: string;
  name: string;
  assetId: string;
  src: string;
  canvasSize: FreeCanvasSize;
  point?: { x: number; y: number };
  zIndex: number;
}): FreeCanvasImageItem {
  const width = Math.min(430, canvasSize.width * 0.46);
  const height = Math.min(430, canvasSize.height * 0.34);
  return {
    id,
    type: "image",
    assetId,
    name,
    src,
    x: clamp((point?.x ?? canvasSize.width / 2) - width / 2, 0, Math.max(0, canvasSize.width - width)),
    y: clamp((point?.y ?? canvasSize.height / 2) - height / 2, 0, Math.max(0, canvasSize.height - height)),
    width,
    height,
    rotation: 0,
    zIndex,
  };
}

function textDefaults() {
  return {
    text: "",
    fontSize: 72,
    fontFamily: "Arial, sans-serif",
    fontWeight: 700,
    color: "#111827",
    align: "left" as const,
  };
}

function constrainMovedItemPosition(item: FreeCanvasEditorItem, x: number, y: number, canvasSize: FreeCanvasSize) {
  if (item.type === "image") return { x, y };
  return {
    x: clamp(x, 0, Math.max(0, canvasSize.width - item.width)),
    y: clamp(y, 0, Math.max(0, canvasSize.height - item.height)),
  };
}

function AssetHoverPreviewLayer({ preview }: { preview: AssetHoverPreview | null }) {
  if (!preview || typeof document === "undefined") return null;

  return createPortal(
    <div className="free-canvas-editor__asset-preview" style={{ left: `${preview.x}px`, top: `${preview.y}px` }} aria-hidden="true">
      <img src={preview.src} alt="" draggable={false} />
    </div>,
    document.body,
  );
}

function AssetChoicePopover({
  state,
  choices,
  loading,
  error,
  emptyText,
  onSelect,
}: {
  state: AssetChoicePopoverState | null;
  choices: ComposerAssetChoice[];
  loading: boolean;
  error: string;
  emptyText: string;
  onSelect: (choice: ComposerAssetChoice) => void;
}) {
  const { t } = useTranslation();
  if (!state || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="free-canvas-editor__choice-popover"
      role="dialog"
      aria-label={t("freeCanvasEditor.imageChoices", { name: state.asset.name })}
      style={{ left: `${state.x}px`, top: `${state.y}px` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="free-canvas-editor__choice-grid">
        {loading ? <div className="free-canvas-editor__choice-empty">{t("freeCanvasEditor.loadingImages")}</div> : null}
        {error ? <div className="free-canvas-editor__choice-empty">{t("freeCanvasEditor.loadFailed", { message: error })}</div> : null}
        {!loading && !error && !choices.length ? <div className="free-canvas-editor__choice-empty">{emptyText}</div> : null}
        {!loading && !error ? choices.map((choice) => {
          const src = getAssetUrl(choice);
          return (
            <button key={choice.id} type="button" disabled={!src} onClick={() => onSelect(choice)}>
              {src ? <img src={src} alt={choice.name} loading="lazy" draggable={false} /> : <span>{t("common.empty.noImage")}</span>}
            </button>
          );
        }) : null}
      </div>
    </div>,
    document.body,
  );
}

export function FreeCanvasEditor({
  assets,
  tags,
  activeTagId,
  onTagChange,
  onOpenTagManager,
  onLoadAssetChoices,
  assetTitle,
  railControls,
  assetAltText,
  emptyText,
  tagFilterLabel,
  cardVariant = "direct",
}: FreeCanvasEditorProps) {
  const { t } = useTranslation();
  const items = useFreeCanvasStore((state) => state.items);
  const addItem = useFreeCanvasStore((state) => state.addItem);
  const patchItem = useFreeCanvasStore((state) => state.patchItem);
  const patchItemWithoutHistory = useFreeCanvasStore((state) => state.patchItemWithoutHistory);
  const setItems = useFreeCanvasStore((state) => state.setItems);
  const deleteItems = useFreeCanvasStore((state) => state.deleteItems);
  const clearItems = useFreeCanvasStore((state) => state.clearItems);
  const moveLayer = useFreeCanvasStore((state) => state.moveLayer);
  const moveLayerToEdge = useFreeCanvasStore((state) => state.moveLayerToEdge);
  const reorderLayer = useFreeCanvasStore((state) => state.reorderLayer);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [exportError, setExportError] = useState("");
  const [assetHoverPreview, setAssetHoverPreview] = useState<AssetHoverPreview | null>(null);
  const [choicePopover, setChoicePopover] = useState<AssetChoicePopoverState | null>(null);
  const [assetChoices, setAssetChoices] = useState<ComposerAssetChoice[]>([]);
  const [assetChoicesLoading, setAssetChoicesLoading] = useState(false);
  const [assetChoicesError, setAssetChoicesError] = useState("");
  const [activeTextTool, setActiveTextTool] = useState<{ itemId: string; tool: ActiveTextTool } | null>(null);
  const [activeCanvasTool, setActiveCanvasTool] = useState<ActiveCanvasTool>("select");
  const [editingTextItemId, setEditingTextItemId] = useState("");
  const [draggingLayerId, setDraggingLayerId] = useState("");
  const [layerDropTarget, setLayerDropTarget] = useState<{ itemId: string; position: "before" | "after" } | null>(null);
  const [canvasAspectKey, setCanvasAspectKey] = useState<string>(CANVAS_PRESETS[0].key);
  const [canvasSizeKey, setCanvasSizeKey] = useState<string>(CANVAS_PRESETS[0].sizes[0].key);
  const [isCanvasSizePanelOpen, setIsCanvasSizePanelOpen] = useState(false);
  const [viewport, setViewport] = useState<FreeCanvasViewport>({ scale: 1, x: 0, y: 0 });
  const [stageSize, setStageSize] = useState<FreeCanvasSize>({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const [assetRailWidth, setAssetRailWidth] = useState(ASSET_RAIL_DEFAULT);
  const [isResizingRail, setIsResizingRail] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasSizePanelRef = useRef<HTMLDivElement | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const fileDragDepthRef = useRef(0);
  const interactionRef = useRef<StageInteraction | null>(null);
  const textEditDocumentRef = useRef<ReturnType<typeof snapshotFreeCanvasDocument> | null>(null);
  const textDoubleClickRef = useRef<{ itemId: string; time: number; x: number; y: number } | null>(null);
  const railResizeRef = useRef<{ pointerId: number; startClientX: number; startWidth: number } | null>(null);

  const canvasPreset = CANVAS_PRESETS.find((preset) => preset.key === canvasAspectKey) || CANVAS_PRESETS[0];
  const canvasSize = canvasPreset.sizes.find((size) => size.key === canvasSizeKey) || canvasPreset.sizes[0];
  const selectedItem = items.find((item) => item.id === selectedItemId) || null;
  const sortedItems = useMemo(() => sortedBackToFront(items), [items]);
  const layerItems = useMemo(() => sortedFrontToBack(items), [items]);
  const canvasFitScale = (() => {
    if (!stageSize.width || !stageSize.height) return 1;
    const horizontalPadding = stageSize.width > 920 ? 348 : 36;
    const verticalPadding = stageSize.width > 920 ? 52 : 36;
    const availableWidth = Math.max(240, stageSize.width - horizontalPadding);
    const availableHeight = Math.max(240, stageSize.height - verticalPadding);
    return Math.min(availableWidth / canvasSize.width, availableHeight / canvasSize.height, 1);
  })();
  const canvasScreenScale = getCanvasScreenScale(canvasFitScale, viewport);
  const selectedOverlayRect = selectedItem ? getSelectionStageRect(selectedItem, stageSize, canvasSize, canvasFitScale, viewport) : null;
  const selectedToolbarPosition = selectedOverlayRect ? { x: selectedOverlayRect.centerX, y: selectedOverlayRect.top } : null;

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!isCanvasSizePanelOpen) return;

    function closeCanvasSizePanel(event: globalThis.PointerEvent) {
      const target = event.target as Node | null;
      if (target && canvasSizePanelRef.current?.contains(target)) return;
      setIsCanvasSizePanelOpen(false);
    }

    function closeCanvasSizePanelByKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setIsCanvasSizePanelOpen(false);
    }

    window.addEventListener("pointerdown", closeCanvasSizePanel);
    window.addEventListener("keydown", closeCanvasSizePanelByKey);
    return () => {
      window.removeEventListener("pointerdown", closeCanvasSizePanel);
      window.removeEventListener("keydown", closeCanvasSizePanelByKey);
    };
  }, [isCanvasSizePanelOpen]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    function updateStageSize(target: HTMLDivElement) {
      const rect = target.getBoundingClientRect();
      setStageSize({ width: rect.width, height: rect.height });
    }
    updateStageSize(stage);
    const resizeObserver = new ResizeObserver(() => updateStageSize(stage));
    resizeObserver.observe(stage);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!choicePopover) return;
    function closeChoicePopover() {
      setChoicePopover(null);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") closeChoicePopover();
    }
    window.addEventListener("pointerdown", closeChoicePopover);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeChoicePopover);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [choicePopover]);

  useEffect(() => {
    setChoicePopover(null);
    setAssetChoices([]);
    setAssetChoicesError("");
  }, [assets]);

  useEffect(() => {
    if (selectedItemId && !items.some((item) => item.id === selectedItemId)) setSelectedItemId("");
    if (editingTextItemId && !items.some((item) => item.id === editingTextItemId && item.type === "text")) setEditingTextItemId("");
    if (activeTextTool && !items.some((item) => item.id === activeTextTool.itemId && item.type === "text")) setActiveTextTool(null);
  }, [activeTextTool, editingTextItemId, items, selectedItemId]);

  useEffect(() => {
    if (activeTextTool && activeTextTool.itemId !== selectedItemId) setActiveTextTool(null);
  }, [activeTextTool, selectedItemId]);

  useEffect(() => {
    if (!isResizingRail) return;
    function handlePointerMove(event: globalThis.PointerEvent) {
      const resize = railResizeRef.current;
      if (!resize) return;
      setAssetRailWidth(clamp(resize.startWidth + event.clientX - resize.startClientX, ASSET_RAIL_MIN, ASSET_RAIL_MAX));
    }
    function stopPointerResize() {
      railResizeRef.current = null;
      setIsResizingRail(false);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopPointerResize);
    window.addEventListener("pointercancel", stopPointerResize);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopPointerResize);
      window.removeEventListener("pointercancel", stopPointerResize);
    };
  }, [isResizingRail]);

  function getCanvasPoint(event: { clientX: number; clientY: number }) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return screenToCanvasPoint(event.clientX, event.clientY, rect, canvasSize, canvasFitScale, viewport);
  }

  function updateAssetHoverPreview(event: ReactMouseEvent<HTMLButtonElement>, src: string) {
    setAssetHoverPreview({ src, ...assetPreviewPosition(event.clientX, event.clientY) });
  }

  function addAsset(asset: ComposerAsset | ComposerAssetChoice, fallbackName = assetAltText, point?: { x: number; y: number }) {
    if (editingTextItemId) stopTextEditing();
    const src = getAssetUrl(asset);
    if (!src) return;
    const maxZIndex = Math.max(...items.map((item) => item.zIndex), 0);
    const item = createImageItem({
      id: `${asset.id}-${Date.now()}`,
      assetId: asset.id,
      name: asset.name || fallbackName,
      src,
      canvasSize,
      point,
      zIndex: maxZIndex + 1,
    });
    addItem(item);
    setSelectedItemId(item.id);
    setEditingTextItemId("");
    setActiveCanvasTool("select");
  }

  function addTextItem(options: {
    point?: { x: number; y: number };
    width?: number;
    text?: string;
    autoSize?: boolean;
    edit?: boolean;
  } = {}) {
    const maxZIndex = Math.max(...items.map((item) => item.zIndex), 0);
    const defaults = textDefaults();
    const text = options.text ?? defaults.text;
    const autoSize = options.autoSize ?? !options.width;
    const width = options.width ? clamp(options.width, TEXT_CREATE_MIN_WIDTH, canvasSize.width) : undefined;
    const textSize = measureTextLayer({
      text,
      fontSize: defaults.fontSize,
      fontFamily: defaults.fontFamily,
      fontWeight: defaults.fontWeight,
      autoSize,
      width,
    });
    const origin = options.point || {
      x: canvasSize.width / 2 - textSize.width / 2,
      y: canvasSize.height / 2 - textSize.height / 2,
    };
    const item: FreeCanvasTextItem = {
      id: `text-${Date.now()}`,
      type: "text",
      assetId: "text",
      name: t("freeCanvasEditor.defaultTextLayer"),
      text,
      x: clamp(origin.x, 0, Math.max(0, canvasSize.width - textSize.width)),
      y: clamp(origin.y, 0, Math.max(0, canvasSize.height - textSize.height)),
      width: textSize.width,
      height: textSize.height,
      rotation: 0,
      zIndex: maxZIndex + 1,
      fontSize: defaults.fontSize,
      fontFamily: defaults.fontFamily,
      fontWeight: defaults.fontWeight,
      color: defaults.color,
      align: defaults.align,
      autoSize,
    };
    addItem(item);
    setSelectedItemId(item.id);
    if (options.edit ?? true) {
      textEditDocumentRef.current = snapshotFreeCanvasDocument();
      setEditingTextItemId(item.id);
    }
    return item;
  }

  async function openAssetChoices(event: ReactMouseEvent<HTMLButtonElement>, asset: ComposerAsset) {
    if (!onLoadAssetChoices) return;
    event.stopPropagation();
    setAssetHoverPreview(null);
    const rect = event.currentTarget.getBoundingClientRect();
    const popoverWidth = 360;
    const popoverHeight = 420;
    const margin = 12;
    setChoicePopover({
      asset,
      x: clamp(rect.right + 10, margin, Math.max(margin, window.innerWidth - popoverWidth - margin)),
      y: clamp(rect.top, margin, Math.max(margin, window.innerHeight - popoverHeight - margin)),
    });
    setAssetChoices([]);
    setAssetChoicesError("");
    setAssetChoicesLoading(true);
    try {
      setAssetChoices(await onLoadAssetChoices(asset.id));
    } catch (error) {
      setAssetChoicesError(error instanceof Error ? error.message : String(error));
    } finally {
      setAssetChoicesLoading(false);
    }
  }

  function addDroppedFiles(files: File[], point?: { x: number; y: number }) {
    if (editingTextItemId) stopTextEditing();
    const maxZIndex = Math.max(...items.map((item) => item.zIndex), 0);
    const nextItems = files.map((file, index) => {
      const src = URL.createObjectURL(file);
      objectUrlsRef.current.push(src);
      const offsetPoint = point ? { x: point.x + index * 28, y: point.y + index * 28 } : undefined;
      return createImageItem({
        id: `local-${Date.now()}-${index}`,
        assetId: file.name || `local-${index}`,
        name: file.name || t("freeCanvasEditor.droppedImage"),
        src,
        canvasSize,
        point: offsetPoint,
        zIndex: maxZIndex + index + 1,
      });
    });
    if (!nextItems.length) return;
    setItems((currentItems) => normalizeLayerOrder([...sortedBackToFront(currentItems), ...nextItems]));
    setSelectedItemId(nextItems[nextItems.length - 1].id);
    setEditingTextItemId("");
    setActiveCanvasTool("select");
  }

  function handleLocalImageInput(files: FileList | null) {
    const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    addDroppedFiles(imageFiles);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function changeCanvasAspect(nextAspectKey: string) {
    const nextPreset = CANVAS_PRESETS.find((preset) => preset.key === nextAspectKey) || CANVAS_PRESETS[0];
    setCanvasAspectKey(nextAspectKey);
    setCanvasSizeKey(nextPreset.sizes[0].key);
    setViewport({ scale: 1, x: 0, y: 0 });
  }

  function changeCanvasSize(nextSizeKey: string) {
    setCanvasSizeKey(nextSizeKey);
    setViewport({ scale: 1, x: 0, y: 0 });
  }

  function updateTextItem(itemId: string, patch: Partial<FreeCanvasTextItem>) {
    const item = items.find((currentItem) => currentItem.id === itemId);
    if (!item || item.type !== "text") return;
    const nextItem = { ...item, ...patch } as FreeCanvasTextItem;
    const measuredSize = measureTextLayer(nextItem);
    patchItem(itemId, {
      ...patch,
      width: nextItem.autoSize === false && patch.width ? patch.width : measuredSize.width,
      height: measuredSize.height,
    } as Partial<FreeCanvasEditorItem>);
  }

  function updateTextItemWithoutHistory(itemId: string, patch: Partial<FreeCanvasTextItem>) {
    const item = useFreeCanvasStore.getState().itemLookup.get(itemId);
    if (!item || item.type !== "text") return;
    const nextItem = { ...item, ...patch } as FreeCanvasTextItem;
    const measuredSize = measureTextLayer(nextItem);
    patchItemWithoutHistory(itemId, {
      ...patch,
      width: nextItem.autoSize === false && patch.width ? patch.width : measuredSize.width,
      height: measuredSize.height,
    } as Partial<FreeCanvasEditorItem>);
  }

  function updateTextFontSize(itemId: string, fontSize: number) {
    updateTextItem(itemId, { fontSize });
  }

  function handleTextLayerMeasure(itemId: string, size: { width: number; height: number }) {
    const item = items.find((currentItem) => currentItem.id === itemId);
    if (!item || item.type !== "text") return;
    if (Math.abs(item.width - size.width) <= 0.5 && Math.abs(item.height - size.height) <= 0.5) return;
    patchItemWithoutHistory(itemId, { width: size.width, height: size.height } as Partial<FreeCanvasEditorItem>);
  }

  function startTextEditing(item: FreeCanvasTextItem) {
    setSelectedItemId(item.id);
    textEditDocumentRef.current = snapshotFreeCanvasDocument();
    setEditingTextItemId(item.id);
    setActiveTextTool(null);
    setActiveCanvasTool("select");
  }

  function stopTextEditing() {
    const item = useFreeCanvasStore.getState().itemLookup.get(editingTextItemId);
    if (item?.type === "text" && !item.text.trim()) {
      deleteItems([item.id]);
      textEditDocumentRef.current = null;
      setEditingTextItemId("");
      return;
    }
    if (textEditDocumentRef.current) {
      commitFreeCanvasDocumentChange(textEditDocumentRef.current);
    }
    textEditDocumentRef.current = null;
    setEditingTextItemId("");
  }

  function removeSelectedItem() {
    if (!selectedItemId) return;
    deleteItems([selectedItemId]);
    setSelectedItemId("");
    setEditingTextItemId("");
    setActiveTextTool(null);
  }

  function handleStagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    const stage = stageRef.current;
    const point = getCanvasPoint(event);
    if (!stage || !point) return;
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);

    if (event.button === 1 || event.altKey || event.currentTarget.classList.contains("panning")) {
      interactionRef.current = {
        type: "pan",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        origin: viewport,
      };
      setIsPanning(true);
      return;
    }

    if (editingTextItemId) {
      const editingItem = items.find((item) => item.id === editingTextItemId);
      if (editingItem && hitTestItem([editingItem], point, 0)) return;
      stopTextEditing();
    }

    const hitItem = hitTestItem(items, point, 4 / Math.max(canvasScreenScale, 0.01));
    if (hitItem?.type === "text") {
      const now = Date.now();
      const previousClick = textDoubleClickRef.current;
      const maxDistance = 8 / Math.max(canvasScreenScale, 0.01);
      const isDoubleClick = Boolean(
        previousClick
        && previousClick.itemId === hitItem.id
        && now - previousClick.time < 420
        && Math.hypot(point.x - previousClick.x, point.y - previousClick.y) <= maxDistance,
      );
      textDoubleClickRef.current = { itemId: hitItem.id, time: now, x: point.x, y: point.y };
      if (isDoubleClick) {
        textDoubleClickRef.current = null;
        interactionRef.current = null;
        startTextEditing(hitItem);
        return;
      }
    } else {
      textDoubleClickRef.current = null;
    }

    if (activeCanvasTool === "text" && !hitItem) {
      const textItem = addTextItem({
        point,
        width: TEXT_CREATE_MIN_WIDTH,
        autoSize: true,
        edit: false,
      });
      if (!textItem) return;
      setSelectedItemId(textItem.id);
      interactionRef.current = {
        type: "createText",
        pointerId: event.pointerId,
        startPoint: point,
        itemId: textItem.id,
        didDrag: false,
      };
      return;
    }

    if (!hitItem) {
      setSelectedItemId("");
      setActiveTextTool(null);
      return;
    }

    setSelectedItemId(hitItem.id);
    interactionRef.current = {
      type: "drag",
      pointerId: event.pointerId,
      itemId: hitItem.id,
      startPoint: point,
      origin: { x: hitItem.x, y: hitItem.y },
      didMove: false,
      previousDocument: snapshotFreeCanvasDocument(),
    };
  }

  function handleStagePointerMove(event: PointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.type === "pan") {
      setViewport({
        ...interaction.origin,
        x: interaction.origin.x + event.clientX - interaction.startClientX,
        y: interaction.origin.y + event.clientY - interaction.startClientY,
      });
      return;
    }

    const point = getCanvasPoint(event);
    if (!point) return;
    if (interaction.type === "drag") {
      const deltaX = point.x - interaction.startPoint.x;
      const deltaY = point.y - interaction.startPoint.y;
      if (!interaction.didMove && Math.hypot(deltaX, deltaY) < DRAG_DISTANCE / Math.max(canvasScreenScale, 0.01)) return;
      interaction.didMove = true;
      const item = useFreeCanvasStore.getState().itemLookup.get(interaction.itemId);
      if (!item) return;
      patchItemWithoutHistory(
        interaction.itemId,
        constrainMovedItemPosition(item, interaction.origin.x + deltaX, interaction.origin.y + deltaY, canvasSize) as Partial<FreeCanvasEditorItem>,
      );
      return;
    }

    if (interaction.type === "createText") {
      const deltaX = point.x - interaction.startPoint.x;
      const deltaY = point.y - interaction.startPoint.y;
      if (!interaction.didDrag && Math.hypot(deltaX, deltaY) < DRAG_DISTANCE / Math.max(canvasScreenScale, 0.01)) return;
      interaction.didDrag = true;
      const left = Math.min(interaction.startPoint.x, point.x);
      const top = Math.min(interaction.startPoint.y, point.y);
      const width = Math.max(TEXT_CREATE_MIN_WIDTH, Math.abs(deltaX));
      const item = items.find((currentItem) => currentItem.id === interaction.itemId);
      if (!item || item.type !== "text") return;
      const measured = measureTextLayer({
        text: item.text,
        fontSize: item.fontSize,
        fontFamily: item.fontFamily,
        fontWeight: item.fontWeight,
        autoSize: false,
        width,
      });
      patchItemWithoutHistory(interaction.itemId, {
        x: clamp(left, 0, Math.max(0, canvasSize.width - measured.width)),
        y: clamp(top, 0, Math.max(0, canvasSize.height - measured.height)),
        width: clamp(measured.width, TEXT_CREATE_MIN_WIDTH, canvasSize.width),
        height: measured.height,
        autoSize: false,
      } as Partial<FreeCanvasEditorItem>);
      return;
    }

    const item = items.find((currentItem) => currentItem.id === interaction.itemId);
    if (!item) return;
    const deltaX = point.x - interaction.startPoint.x;
    const deltaY = point.y - interaction.startPoint.y;
    const nextWidth = Math.max(24, interaction.origin.width + deltaX);
    const nextHeight = item.type === "image"
      ? Math.max(24, interaction.origin.height + deltaY)
      : Math.max(20, interaction.origin.height + deltaY);
    if (item.type === "image") {
      const scaleX = nextWidth / Math.max(1, interaction.origin.width);
      const scaleY = nextHeight / Math.max(1, interaction.origin.height);
      const scale = Math.max(scaleX, scaleY);
      patchItemWithoutHistory(interaction.itemId, {
        width: Math.max(24, interaction.origin.width * scale),
        height: Math.max(24, interaction.origin.height * scale),
      } as Partial<FreeCanvasEditorItem>);
    } else {
      patchItemWithoutHistory(interaction.itemId, {
        width: clamp(nextWidth, 24, canvasSize.width - item.x),
        height: clamp(nextHeight, 20, canvasSize.height - item.y),
        autoSize: false,
      } as Partial<FreeCanvasEditorItem>);
    }
  }

  function stopStageInteraction(event: PointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.type === "drag" || interaction.type === "resize") {
      commitFreeCanvasDocumentChange(interaction.previousDocument);
    }
    if (interaction.type === "createText") {
      textEditDocumentRef.current = snapshotFreeCanvasDocument();
      setEditingTextItemId(interaction.itemId);
      setActiveCanvasTool("select");
    }
    interactionRef.current = null;
    setIsPanning(false);
  }

  function startItemResize(event: PointerEvent<HTMLButtonElement>, item: FreeCanvasEditorItem) {
    const point = getCanvasPoint(event);
    if (!point || !stageRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    stageRef.current.setPointerCapture(event.pointerId);
    interactionRef.current = {
      type: "resize",
      pointerId: event.pointerId,
      itemId: item.id,
      startPoint: point,
      origin: { x: item.x, y: item.y, width: item.width, height: item.height },
      previousDocument: snapshotFreeCanvasDocument(),
    };
  }

  function handleStageWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = event.clientX - rect.left - rect.width / 2;
    const pointerY = event.clientY - rect.top - rect.height / 2;
    const scaleFactor = Math.exp(-event.deltaY * 0.0012);
    setViewport((currentViewport) => {
      const nextScale = clamp(currentViewport.scale * scaleFactor, VIEWPORT_SCALE_MIN, VIEWPORT_SCALE_MAX);
      const ratio = nextScale / currentViewport.scale;
      return {
        scale: nextScale,
        x: pointerX - (pointerX - currentViewport.x) * ratio,
        y: pointerY - (pointerY - currentViewport.y) * ratio,
      };
    });
  }

  function resetViewport() {
    setViewport({ scale: 1, x: 0, y: 0 });
  }

  function handleStageDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasImageFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current += 1;
    setIsFileDropActive(true);
  }

  function handleStageDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasImageFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleStageDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!hasImageFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (!fileDragDepthRef.current) setIsFileDropActive(false);
  }

  function handleStageDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasImageFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current = 0;
    setIsFileDropActive(false);
    addDroppedFiles(imageFilesFromTransfer(event.dataTransfer), getCanvasPoint(event) || undefined);
  }

  function handleItemKeyDown(event: KeyboardEvent<HTMLDivElement>, item: FreeCanvasEditorItem) {
    if (editingTextItemId) return;
    if (event.key === "Enter" && item.type === "text") {
      event.preventDefault();
      startTextEditing(item);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteItems([item.id]);
      return;
    }
    const step = event.shiftKey ? 24 : 8;
    const keyDelta: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const delta = keyDelta[event.key];
    if (!delta) return;
    event.preventDefault();
    patchItem(item.id, constrainMovedItemPosition(item, item.x + delta.x, item.y + delta.y, canvasSize) as Partial<FreeCanvasEditorItem>);
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      if (editingTextItemId) return;
      if (activeCanvasTool !== "select") {
        event.preventDefault();
        setActiveCanvasTool("select");
        return;
      }
      if (selectedItemId) {
        event.preventDefault();
        setSelectedItemId("");
        setActiveTextTool(null);
      }
      return;
    }
    if (editingTextItemId) return;
    const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey;
    const isRedo = (event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey));
    if (isUndo) {
      event.preventDefault();
      undoFreeCanvasHistory();
      return;
    }
    if (isRedo) {
      event.preventDefault();
      redoFreeCanvasHistory();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedItemId) {
      event.preventDefault();
      removeSelectedItem();
    }
  }

  function startRailResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    railResizeRef.current = { pointerId: event.pointerId, startClientX: event.clientX, startWidth: assetRailWidth };
    setIsResizingRail(true);
  }

  function handleRailResizeMove(event: PointerEvent<HTMLButtonElement>) {
    const resize = railResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setAssetRailWidth(clamp(resize.startWidth + event.clientX - resize.startClientX, ASSET_RAIL_MIN, ASSET_RAIL_MAX));
  }

  function stopRailResize(event: PointerEvent<HTMLButtonElement>) {
    const resize = railResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    railResizeRef.current = null;
    setIsResizingRail(false);
  }

  function handleRailResizeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (event.key === "Home") setAssetRailWidth(ASSET_RAIL_MIN);
    else if (event.key === "End") setAssetRailWidth(ASSET_RAIL_MAX);
    else {
      const step = event.shiftKey ? 64 : 20;
      setAssetRailWidth((currentWidth) => clamp(currentWidth + (event.key === "ArrowRight" ? step : -step), ASSET_RAIL_MIN, ASSET_RAIL_MAX));
    }
  }

  async function renderCanvasBlob() {
    const canvas = document.createElement("canvas");
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const item of sortedBackToFront(items)) {
      ctx.save();
      const centerX = item.x + item.width / 2;
      const centerY = item.y + item.height / 2;
      ctx.translate(centerX, centerY);
      ctx.rotate((item.rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
      if (item.type === "image") {
        drawImageItem(ctx, await loadImage(item.src), item);
      } else {
        drawTextItem(ctx, item);
      }
      ctx.restore();
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Canvas export failed");
    return blob;
  }

  async function exportCanvas() {
    setExporting(true);
    setExportError("");
    try {
      const blob = await renderCanvasBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `free-canvas-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  async function copyCanvasImage() {
    if (!("ClipboardItem" in window)) {
      setExportError(t("freeCanvasEditor.copyUnsupported"));
      return;
    }
    setCopying(true);
    setExportError("");
    try {
      const blob = await renderCanvasBlob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setCopying(false);
    }
  }

  function updateLayerDropTarget(event: DragEvent<HTMLDivElement>, targetItemId: string) {
    if (!draggingLayerId || draggingLayerId === targetItemId) {
      setLayerDropTarget(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setLayerDropTarget({ itemId: targetItemId, position: event.clientY < rect.top + rect.height / 2 ? "before" : "after" });
  }

  return (
    <div
      className={`free-canvas-editor${isResizingRail ? " resizing-rail" : ""}`}
      style={{ "--free-canvas-asset-rail-width": `${assetRailWidth}px` } as CSSProperties}
      onKeyDown={handleEditorKeyDown}
    >
      <aside className="free-canvas-editor__asset-rail" aria-label={assetTitle || tagFilterLabel}>
        <div className="free-canvas-editor__rail-head">
          <strong>{assetTitle || tagFilterLabel}</strong>
          {onOpenTagManager ? (
            <button type="button" aria-label={tagFilterLabel} title={tagFilterLabel} onClick={onOpenTagManager}>
              <Layers size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {railControls ? <div className="free-canvas-editor__rail-controls">{railControls}</div> : null}
        <div className="free-canvas-editor__tag-row" aria-label={tagFilterLabel}>
          <button type="button" className={!activeTagId ? "active" : ""} onClick={() => onTagChange("")}>
            {t("common.empty.all")}
          </button>
          {tags.map((tag) => (
            <button key={tag.id} type="button" className={activeTagId === tag.id ? "active" : ""} onClick={() => onTagChange(tag.id)}>
              {tag.name}
            </button>
          ))}
        </div>
        <div className="free-canvas-editor__asset-list">
          {assets.map((asset) => {
            const src = getAssetUrl(asset);
            const isChoiceCard = cardVariant === "choice";
            return (
              <button
                key={asset.id}
                className={`free-canvas-editor__asset${isChoiceCard ? " free-canvas-editor__asset--named" : ""}`}
                type="button"
                disabled={!isChoiceCard && !src}
                onClick={(event) => {
                  if (isChoiceCard) {
                    openAssetChoices(event, asset);
                    return;
                  }
                  addAsset(asset);
                }}
                onMouseEnter={(event) => {
                  if (!isChoiceCard && src) updateAssetHoverPreview(event, src);
                }}
                onMouseMove={(event) => {
                  if (!isChoiceCard && src) updateAssetHoverPreview(event, src);
                }}
                onMouseLeave={() => setAssetHoverPreview(null)}
                onBlur={() => setAssetHoverPreview(null)}
              >
                {src ? <img src={src} alt={asset.name || assetAltText} loading="lazy" draggable={false} /> : <span className={isChoiceCard ? "free-canvas-editor__asset-placeholder" : ""}>{t("common.empty.noImage")}</span>}
                {isChoiceCard ? <span className="free-canvas-editor__asset-name">{asset.name || assetAltText}</span> : null}
              </button>
            );
          })}
          {!assets.length ? <div className="free-canvas-editor__empty">{emptyText}</div> : null}
        </div>
      </aside>

      <button
        className="free-canvas-editor__rail-resizer"
        type="button"
        role="separator"
        aria-label={t("freeCanvasEditor.resizeRail", { title: assetTitle || tagFilterLabel })}
        aria-orientation="vertical"
        aria-valuemin={ASSET_RAIL_MIN}
        aria-valuemax={ASSET_RAIL_MAX}
        aria-valuenow={assetRailWidth}
        onPointerDown={startRailResize}
        onPointerMove={handleRailResizeMove}
        onPointerUp={stopRailResize}
        onPointerCancel={stopRailResize}
        onKeyDown={handleRailResizeKeyDown}
      />

      <main className="free-canvas-editor__stage-wrap">
        <div className="free-canvas-editor__stage-toolbar">
          <div className="free-canvas-editor__stage-settings" aria-label={t("freeCanvasEditor.canvasSettings")}>
            <div ref={canvasSizePanelRef} className={`ic-composer-size free-canvas-editor__canvas-size${isCanvasSizePanelOpen ? " open" : ""}`}>
              <button
                type="button"
                className="ic-composer-select__trigger ic-composer-size__trigger free-canvas-editor__canvas-size-trigger"
                aria-label={`${t("freeCanvasEditor.resolution")} / ${t("freeCanvasEditor.aspectRatio")}`}
                aria-haspopup="dialog"
                aria-expanded={isCanvasSizePanelOpen}
                onClick={() => setIsCanvasSizePanelOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setIsCanvasSizePanelOpen(false);
                }}
              >
                <span>{`${canvasSize.label} / ${canvasPreset.label}`}</span>
                <ChevronDown size={18} aria-hidden="true" />
              </button>
              {isCanvasSizePanelOpen ? (
                <div className="ic-composer-size__panel free-canvas-editor__canvas-size-panel" role="dialog" aria-label={`${t("freeCanvasEditor.resolution")} / ${t("freeCanvasEditor.aspectRatio")}`}>
                  <div className="ic-composer-size__section">
                    <span>{t("freeCanvasEditor.resolution")}</span>
                    <div className="ic-composer-size__resolution" role="radiogroup" aria-label={t("freeCanvasEditor.resolution")}>
                      {canvasPreset.sizes.map((size) => (
                        <button
                          key={size.key}
                          type="button"
                          className={size.key === canvasSizeKey ? "selected" : ""}
                          role="radio"
                          aria-checked={size.key === canvasSizeKey}
                          onClick={() => changeCanvasSize(size.key)}
                        >
                          {size.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ic-composer-size__section">
                    <span>{t("freeCanvasEditor.aspectRatio")}</span>
                    <div className="ic-composer-size__ratios free-canvas-editor__canvas-ratios" role="radiogroup" aria-label={t("freeCanvasEditor.aspectRatio")}>
                      {CANVAS_PRESETS.map((preset) => {
                        const [rawW, rawH] = preset.key.split(":").map(Number);
                        const w = rawW || 1;
                        const h = rawH || 1;
                        const isWide = w >= h;
                        return (
                          <button
                            key={preset.key}
                            type="button"
                            className={preset.key === canvasAspectKey ? "selected" : ""}
                            role="radio"
                            aria-checked={preset.key === canvasAspectKey}
                            onClick={() => changeCanvasAspect(preset.key)}
                          >
                            <i
                              aria-hidden="true"
                              style={{
                                width: isWide ? 18 : Math.max(8, Math.round(18 * w / h)),
                                height: isWide ? Math.max(8, Math.round(18 * h / w)) : 18,
                              }}
                            />
                            <span>{preset.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <button
              className={`button secondary free-canvas-editor__icon-button${activeCanvasTool === "text" ? " active" : ""}`}
              type="button"
              aria-label={t("freeCanvasEditor.addText")}
              title={t("freeCanvasEditor.addText")}
              aria-pressed={activeCanvasTool === "text"}
              onClick={() => {
                if (editingTextItemId) stopTextEditing();
                setActiveCanvasTool((currentTool) => (currentTool === "text" ? "select" : "text"));
                setActiveTextTool(null);
              }}
            >
              <Type size={18} aria-hidden="true" />
            </button>
            <button className="button secondary free-canvas-editor__icon-button" type="button" aria-label={t("freeCanvasEditor.uploadLocalImage")} title={t("freeCanvasEditor.uploadLocalImage")} onClick={() => fileInputRef.current?.click()}>
              <Upload size={18} aria-hidden="true" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => handleLocalImageInput(event.currentTarget.files)} />
          </div>
          <div className="free-canvas-editor__stage-actions">
            <button className="button secondary" type="button" onClick={resetViewport}>
              <RotateCcw size={16} aria-hidden="true" />
              <span>{Math.round(viewport.scale * 100)}%</span>
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={!items.length}
              onClick={() => {
                clearItems();
                setSelectedItemId("");
              }}
            >
              <X size={18} aria-hidden="true" />
              <span>{t("freeCanvasEditor.clear")}</span>
            </button>
            <button className="button secondary free-canvas-editor__copy-button" type="button" disabled={!items.length || copying} onClick={copyCanvasImage}>
              <Copy size={18} aria-hidden="true" />
              <span>{copying ? t("freeCanvasEditor.copying") : t("freeCanvasEditor.copyImage")}</span>
            </button>
            <button className="button primary free-canvas-editor__export-button" type="button" disabled={!items.length || exporting} onClick={exportCanvas}>
              <Download size={18} aria-hidden="true" />
              <span>{exporting ? t("freeCanvasEditor.exporting") : t("freeCanvasEditor.exportPng")}</span>
            </button>
          </div>
        </div>

        <div
          ref={stageRef}
          className={`free-canvas-editor__stage-scroll${isPanning ? " panning" : ""}${activeCanvasTool === "text" ? " text-tool" : ""}`}
          tabIndex={0}
          onWheel={handleStageWheel}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={stopStageInteraction}
          onPointerCancel={stopStageInteraction}
          onAuxClick={(event) => event.preventDefault()}
          onDragEnter={handleStageDragEnter}
          onDragOver={handleStageDragOver}
          onDragLeave={handleStageDragLeave}
          onDrop={handleStageDrop}
        >
          <div
            className="free-canvas-editor__canvas-shell"
            style={{
              width: `${canvasSize.width}px`,
              height: `${canvasSize.height}px`,
              transform: `translate(-50%, -50%) translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${canvasScreenScale})`,
            } as CSSProperties}
          >
            <div className={`free-canvas-editor__canvas${isFileDropActive ? " drag-active" : ""}`}>
              {sortedItems.map((item) => (
                <div
                  key={item.id}
                  className={`free-canvas-editor__canvas-item${item.type === "text" ? " free-canvas-editor__canvas-item--text" : ""}${selectedItemId === item.id ? " selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={t("freeCanvasEditor.layer", { name: item.name })}
                  style={{
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    width: `${item.width}px`,
                    height: `${item.height}px`,
                    zIndex: item.zIndex,
                    transform: `rotate(${item.rotation}deg)`,
                  }}
                  onKeyDown={(event) => handleItemKeyDown(event, item)}
                >
                  {item.type === "image" ? (
                    <img
                      src={item.src}
                      alt=""
                      draggable={false}
                      decoding="sync"
                      onLoad={(event) => {
                        const image = event.currentTarget;
                        if (!image.naturalWidth || !image.naturalHeight) return;
                        const currentItem = useFreeCanvasStore.getState().itemLookup.get(item.id);
                        if (!currentItem || currentItem.type !== "image" || currentItem.naturalWidth) return;
                        const maxWidth = canvasSize.width * 0.46;
                        const maxHeight = canvasSize.height * 0.34;
                        const fitScale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
                        patchItemWithoutHistory(item.id, {
                          naturalWidth: image.naturalWidth,
                          naturalHeight: image.naturalHeight,
                          width: Math.max(24, image.naturalWidth * fitScale),
                          height: Math.max(24, image.naturalHeight * fitScale),
                        } as Partial<FreeCanvasEditorItem>);
                      }}
                    />
                  ) : (
                    <FreeCanvasTextLayer
                      item={item}
                      editing={editingTextItemId === item.id}
                      editLabel={t("freeCanvasEditor.editText")}
                      onTextChange={(text) => updateTextItemWithoutHistory(item.id, { text })}
                      onMeasureChange={(size) => handleTextLayerMeasure(item.id, size)}
                      onStopEditing={stopTextEditing}
                    />
                  )}
                </div>
              ))}
              {isFileDropActive ? (
                <div className="free-canvas-editor__drop-hint">
                  <Layers size={34} aria-hidden="true" />
                  <span>{t("freeCanvasEditor.dropHint")}</span>
                </div>
              ) : null}
            </div>
          </div>

          {selectedItem && selectedOverlayRect && editingTextItemId !== selectedItem.id ? (
            <div
              className="free-canvas-editor__selection-overlay"
              style={{
                left: `${selectedOverlayRect.left}px`,
                top: `${selectedOverlayRect.top}px`,
                width: `${selectedOverlayRect.width}px`,
                height: `${selectedOverlayRect.height}px`,
                transform: `rotate(${selectedOverlayRect.rotation}deg)`,
              }}
            >
              <span className="free-canvas-editor__selection-frame" aria-hidden="true" />
              {selectedItem.type === "image" ? (
                <button
                  className="free-canvas-editor__resize-handle"
                  type="button"
                  aria-label={t("infiniteCanvas.dragResize")}
                  title={t("infiniteCanvas.dragResize")}
                  onPointerDown={(event) => startItemResize(event, selectedItem)}
                />
              ) : null}
            </div>
          ) : null}

          {selectedItem && selectedToolbarPosition && editingTextItemId !== selectedItem.id ? (
            <div
              className="free-canvas-editor__floating-toolbar"
              aria-label={t("freeCanvasEditor.layerActions")}
              style={{ left: `${selectedToolbarPosition.x}px`, top: `${selectedToolbarPosition.y}px` }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {selectedItem.type === "text" ? (
                <>
                  <button
                    type="button"
                    className={activeTextTool?.itemId === selectedItem.id && activeTextTool.tool === "fontSize" ? "active" : ""}
                    aria-label={t("freeCanvasEditor.fontSize")}
                    title={t("freeCanvasEditor.fontSize")}
                    onClick={() => setActiveTextTool((currentTool) => (currentTool?.itemId === selectedItem.id && currentTool.tool === "fontSize" ? null : { itemId: selectedItem.id, tool: "fontSize" }))}
                  >
                    <Type size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={`free-canvas-editor__color-tool${activeTextTool?.itemId === selectedItem.id && activeTextTool.tool === "color" ? " active" : ""}`}
                    aria-label={t("freeCanvasEditor.textColor")}
                    title={t("freeCanvasEditor.textColor")}
                    onClick={() => setActiveTextTool((currentTool) => (currentTool?.itemId === selectedItem.id && currentTool.tool === "color" ? null : { itemId: selectedItem.id, tool: "color" }))}
                  >
                    <Palette size={16} aria-hidden="true" />
                    <span className="free-canvas-editor__toolbar-color" style={{ "--free-canvas-text-color": selectedItem.color } as CSSProperties} />
                  </button>
                </>
              ) : null}
              <button type="button" aria-label={t("freeCanvasEditor.moveLayerUp")} title={t("freeCanvasEditor.moveLayerUp")} onClick={() => moveLayer(selectedItem.id, "up")}>
                <ArrowUp size={16} aria-hidden="true" />
              </button>
              <button type="button" aria-label={t("freeCanvasEditor.moveLayerDown")} title={t("freeCanvasEditor.moveLayerDown")} onClick={() => moveLayer(selectedItem.id, "down")}>
                <ArrowDown size={16} aria-hidden="true" />
              </button>
              <button type="button" aria-label={t("freeCanvasEditor.bringToFront")} title={t("freeCanvasEditor.bringToFront")} onClick={() => moveLayerToEdge(selectedItem.id, "front")}>
                <ChevronsUp size={16} aria-hidden="true" />
              </button>
              <button type="button" aria-label={t("freeCanvasEditor.sendToBack")} title={t("freeCanvasEditor.sendToBack")} onClick={() => moveLayerToEdge(selectedItem.id, "back")}>
                <ChevronsDown size={16} aria-hidden="true" />
              </button>
              <button className="danger" type="button" aria-label={t("freeCanvasEditor.deleteLayer")} title={t("freeCanvasEditor.deleteLayer")} onClick={removeSelectedItem}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
              {selectedItem.type === "text" && activeTextTool?.itemId === selectedItem.id && activeTextTool.tool === "fontSize" ? (
                <FontSizePanel item={selectedItem} fontSizeLabel={t("freeCanvasEditor.fontSize")} onFontSizeChange={(fontSize) => updateTextFontSize(selectedItem.id, fontSize)} />
              ) : null}
              {selectedItem.type === "text" && activeTextTool?.itemId === selectedItem.id && activeTextTool.tool === "color" ? (
                <TextColorPanel item={selectedItem} textColorLabel={t("freeCanvasEditor.textColor")} onColorChange={(color) => updateTextItem(selectedItem.id, { color })} />
              ) : null}
            </div>
          ) : null}

          <aside className="free-canvas-editor__inspector" aria-label={t("freeCanvasEditor.layers")} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <div className="free-canvas-editor__panel-title">
              <Layers size={16} aria-hidden="true" />
              <strong>{t("freeCanvasEditor.layers")}</strong>
            </div>
            <div className="free-canvas-editor__layer-list">
              {layerItems.map((item) => {
                const Icon = item.type === "text" ? Type : ImageIcon;
                return (
                  <div
                    key={item.id}
                    className={`free-canvas-editor__layer-row${selectedItemId === item.id ? " active" : ""}${draggingLayerId === item.id ? " dragging" : ""}${layerDropTarget?.itemId === item.id ? ` drop-${layerDropTarget.position}` : ""}`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.id);
                      setDraggingLayerId(item.id);
                      setSelectedItemId(item.id);
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      updateLayerDropTarget(event, item.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      updateLayerDropTarget(event, item.id);
                    }}
                    onDragLeave={() => setLayerDropTarget((currentTarget) => (currentTarget?.itemId === item.id ? null : currentTarget))}
                    onDrop={(event) => {
                      event.preventDefault();
                      const draggedItemId = event.dataTransfer.getData("text/plain") || draggingLayerId;
                      reorderLayer(draggedItemId, item.id, layerDropTarget?.itemId === item.id ? layerDropTarget.position : "before");
                      setDraggingLayerId("");
                      setLayerDropTarget(null);
                    }}
                    onDragEnd={() => {
                      setDraggingLayerId("");
                      setLayerDropTarget(null);
                    }}
                  >
                    <button type="button" className="free-canvas-editor__layer-select" onClick={() => setSelectedItemId(item.id)}>
                      <Icon size={15} aria-hidden="true" />
                      <span>{item.name || (item.type === "text" ? t("freeCanvasEditor.textLayer") : t("freeCanvasEditor.imageLayer"))}</span>
                    </button>
                    <div className="free-canvas-editor__layer-order-actions" aria-label={t("freeCanvasEditor.layerActions")}>
                      <button type="button" aria-label={t("freeCanvasEditor.moveLayerUp")} title={t("freeCanvasEditor.moveLayerUp")} onClick={() => moveLayer(item.id, "up")}>
                        <ArrowUp size={14} aria-hidden="true" />
                      </button>
                      <button type="button" aria-label={t("freeCanvasEditor.moveLayerDown")} title={t("freeCanvasEditor.moveLayerDown")} onClick={() => moveLayer(item.id, "down")}>
                        <ArrowDown size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
        {exportError ? <div className="free-canvas-editor__error">{t("freeCanvasEditor.exportFailed", { message: exportError })}</div> : null}
      </main>

      <AssetHoverPreviewLayer preview={assetHoverPreview} />
      <AssetChoicePopover
        state={choicePopover}
        choices={assetChoices}
        loading={assetChoicesLoading}
        error={assetChoicesError}
        emptyText={t("freeCanvasEditor.noModelImages")}
        onSelect={(choice) => {
          addAsset(choice, choicePopover?.asset.name || assetAltText);
          setChoicePopover(null);
        }}
      />
    </div>
  );
}
