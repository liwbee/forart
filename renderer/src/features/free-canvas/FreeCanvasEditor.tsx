import {
  DragEvent,
  KeyboardEvent,
  PointerEvent,
  WheelEvent,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ErrorCopyLine } from "../../components/ErrorCopyLine";
import { AppScrollArea } from "../../components/AppScrollArea";
import { ConfirmingDeleteButton } from "../../components/ConfirmingDeleteButton";
import { DraggableList } from "../../components/DraggableList";
import { Button, type ButtonProps } from "../../components/ui/button";
import { Popover, PopoverTrigger } from "../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Download,
  GripVertical,
  Image as ImageIcon,
  Layers,
  Palette,
  RotateCcw,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { SizePresetPicker } from "../../components/SizePresetPicker";
import { cacheBustedLibraryImageUrl } from "../../lib/libraryImageActions";
import { LibraryAssetPickerRail } from "../library-asset-picker/LibraryAssetPickerRail";
import type { LibraryAssetSelection } from "../library-asset-picker/types";
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
import { measureTextLayer, TEXT_LAYER_LINE_HEIGHT } from "./text-layer/measureTextLayer";
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
const DRAG_DISTANCE = 3;
const TEXT_CREATE_MIN_WIDTH = 96;

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

function loadImage(src: string, errorMessage: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(errorMessage));
    image.src = src;
  });
}

function drawImageItem(ctx: CanvasRenderingContext2D, image: HTMLImageElement, item: FreeCanvasImageItem) {
  ctx.drawImage(image, item.x, item.y, item.width, item.height);
}

function drawTextItem(ctx: CanvasRenderingContext2D, item: FreeCanvasTextItem) {
  const lineHeight = item.fontSize * TEXT_LAYER_LINE_HEIGHT;
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

function createImageItem({
  id,
  name,
  src,
  canvasSize,
  point,
  zIndex,
}: {
  id: string;
  name: string;
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
    fontFamily: "\"Noto Sans SC\", sans-serif",
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

function CanvasIconButton({ label, ...props }: ButtonProps & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function FreeCanvasEditor() {
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
  const reorderLayers = useFreeCanvasStore((state) => state.reorderLayers);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [exportError, setExportError] = useState("");
  const [activeTextTool, setActiveTextTool] = useState<{ itemId: string; tool: ActiveTextTool } | null>(null);
  const [activeCanvasTool, setActiveCanvasTool] = useState<ActiveCanvasTool>("select");
  const [editingTextItemId, setEditingTextItemId] = useState("");
  const [canvasAspectKey, setCanvasAspectKey] = useState<string>(CANVAS_PRESETS[0].key);
  const [canvasSizeKey, setCanvasSizeKey] = useState<string>(CANVAS_PRESETS[0].sizes[0].key);
  const [isCanvasSizePanelOpen, setIsCanvasSizePanelOpen] = useState(false);
  const [viewport, setViewport] = useState<FreeCanvasViewport>({ scale: 1, x: 0, y: 0 });
  const [stageSize, setStageSize] = useState<FreeCanvasSize>({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const fileDragDepthRef = useRef(0);
  const interactionRef = useRef<StageInteraction | null>(null);
  const textEditDocumentRef = useRef<ReturnType<typeof snapshotFreeCanvasDocument> | null>(null);
  const textDoubleClickRef = useRef<{ itemId: string; time: number; x: number; y: number } | null>(null);

  const canvasPreset = CANVAS_PRESETS.find((preset) => preset.key === canvasAspectKey) || CANVAS_PRESETS[0];
  const canvasSize = canvasPreset.sizes.find((size) => size.key === canvasSizeKey) || canvasPreset.sizes[0];
  const selectedItem = items.find((item) => item.id === selectedItemId) || null;
  const fontSizeToolOpen = selectedItem?.type === "text" && activeTextTool?.itemId === selectedItem.id && activeTextTool.tool === "fontSize";
  const colorToolOpen = selectedItem?.type === "text" && activeTextTool?.itemId === selectedItem.id && activeTextTool.tool === "color";
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
    if (selectedItemId && !items.some((item) => item.id === selectedItemId)) setSelectedItemId("");
    if (editingTextItemId && !items.some((item) => item.id === editingTextItemId && item.type === "text")) setEditingTextItemId("");
    if (activeTextTool && !items.some((item) => item.id === activeTextTool.itemId && item.type === "text")) setActiveTextTool(null);
  }, [activeTextTool, editingTextItemId, items, selectedItemId]);

  useEffect(() => {
    if (activeTextTool && activeTextTool.itemId !== selectedItemId) setActiveTextTool(null);
  }, [activeTextTool, selectedItemId]);

  function getCanvasPoint(event: { clientX: number; clientY: number }) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return screenToCanvasPoint(event.clientX, event.clientY, rect, canvasSize, canvasFitScale, viewport);
  }

  function addAsset(selection: LibraryAssetSelection, point?: { x: number; y: number }) {
    if (editingTextItemId) stopTextEditing();
    const src = cacheBustedLibraryImageUrl(selection.url, selection.updatedAt || selection.assetId || selection.entryId);
    if (!src) return;
    const maxZIndex = Math.max(...items.map((item) => item.zIndex), 0);
    const item = createImageItem({
      id: `${selection.kind}-${selection.entryId}-${Date.now()}`,
      name: selection.name || "Library image",
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
      name: t("freeCanvasEditor:defaultTextLayer"),
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

  function addDroppedFiles(files: File[], point?: { x: number; y: number }) {
    if (editingTextItemId) stopTextEditing();
    const maxZIndex = Math.max(...items.map((item) => item.zIndex), 0);
    const nextItems = files.map((file, index) => {
      const src = URL.createObjectURL(file);
      objectUrlsRef.current.push(src);
      const offsetPoint = point ? { x: point.x + index * 28, y: point.y + index * 28 } : undefined;
      return createImageItem({
        id: `local-${Date.now()}-${index}`,
        name: file.name || t("freeCanvasEditor:droppedImage"),
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

  function changeTextToolOpen(itemId: string, tool: ActiveTextTool, open: boolean) {
    setActiveTextTool((currentTool) => {
      if (open) return { itemId, tool };
      return currentTool?.itemId === itemId && currentTool.tool === tool ? null : currentTool;
    });
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
      if (activeTextTool) {
        event.preventDefault();
        setActiveTextTool(null);
        return;
      }
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

  async function renderCanvasBlob() {
    const canvas = document.createElement("canvas");
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(t("freeCanvasEditor:canvasContextUnavailable"));
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
        drawImageItem(ctx, await loadImage(item.src, t("freeCanvasEditor:imageLoadFailed")), item);
      } else {
        drawTextItem(ctx, item);
      }
      ctx.restore();
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error(t("freeCanvasEditor:canvasExportUnavailable"));
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

  return (
    <div className="free-canvas-editor" onKeyDown={handleEditorKeyDown}>
      <main className="free-canvas-editor__stage-wrap">
        <div className="free-canvas-editor__stage-toolbar">
          <div className="free-canvas-editor__stage-settings" aria-label={t("freeCanvasEditor:canvasSettings")}>
            <SizePresetPicker
              open={isCanvasSizePanelOpen}
              resolution={canvasSizeKey}
              aspectRatio={canvasAspectKey}
              resolutionOptions={canvasPreset.sizes.map((size) => ({ value: size.key, label: size.label }))}
              aspectRatioOptions={CANVAS_PRESETS.map((preset) => ({ value: preset.key, label: preset.label }))}
              labels={{
                trigger: `${t("freeCanvasEditor:resolution")} / ${t("freeCanvasEditor:aspectRatio")}`,
                resolution: t("freeCanvasEditor:resolution"),
                aspectRatio: t("freeCanvasEditor:aspectRatio"),
              }}
              className="free-canvas-editor__canvas-size"
              triggerClassName="free-canvas-editor__canvas-size-trigger"
              panelClassName="free-canvas-editor__canvas-size-panel"
              aspectRatioClassName="free-canvas-editor__canvas-ratios"
              panelSide="bottom"
              formatTrigger={() => `${canvasSize.label} • ${canvasPreset.label}`}
              onOpenChange={setIsCanvasSizePanelOpen}
              onResolutionChange={changeCanvasSize}
              onAspectRatioChange={changeCanvasAspect}
            />
            <CanvasIconButton
              className="free-canvas-editor__icon-button"
              type="button"
              label={t("freeCanvasEditor:addText")}
              variant={activeCanvasTool === "text" ? "default" : "outline"}
              size="icon"
              aria-pressed={activeCanvasTool === "text"}
              onClick={() => {
                if (editingTextItemId) stopTextEditing();
                setActiveCanvasTool((currentTool) => (currentTool === "text" ? "select" : "text"));
                setActiveTextTool(null);
              }}
            >
              <Type aria-hidden="true" />
            </CanvasIconButton>
            <CanvasIconButton className="free-canvas-editor__icon-button" type="button" label={t("freeCanvasEditor:uploadLocalImage")} variant="outline" size="icon" onClick={() => fileInputRef.current?.click()}>
              <Upload aria-hidden="true" />
            </CanvasIconButton>
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => handleLocalImageInput(event.currentTarget.files)} />
          </div>
          <div className="free-canvas-editor__stage-actions">
            <Button variant="outline" type="button" onClick={resetViewport}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              <span>{Math.round(viewport.scale * 100)}%</span>
            </Button>
            <ConfirmingDeleteButton
              disabled={!items.length}
              label={t("freeCanvasEditor:clear")}
              confirmLabel={t("freeCanvasEditor:confirmClear")}
              cancelLabel={t("common:actions.cancel")}
              resetKey={items.length}
              onDelete={() => {
                clearItems();
                setSelectedItemId("");
                setEditingTextItemId("");
                setActiveTextTool(null);
              }}
            />
            <Button className="free-canvas-editor__copy-button" variant="outline" type="button" disabled={!items.length || copying} onClick={copyCanvasImage}>
              <Copy data-icon="inline-start" aria-hidden="true" />
              <span>{copying ? t("freeCanvasEditor:copying") : t("freeCanvasEditor:copyImage")}</span>
            </Button>
            <Button className="free-canvas-editor__export-button" type="button" disabled={!items.length || exporting} onClick={exportCanvas}>
              <Download data-icon="inline-start" aria-hidden="true" />
              <span>{exporting ? t("freeCanvasEditor:exporting") : t("freeCanvasEditor:exportPng")}</span>
            </Button>
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
          <div className="free-canvas-editor__library-panel" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <LibraryAssetPickerRail onSelect={addAsset} />
          </div>

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
                  aria-label={t("freeCanvasEditor:layer", { name: item.name })}
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
                      editLabel={t("freeCanvasEditor:editText")}
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
                  <span>{t("freeCanvasEditor:dropHint")}</span>
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
                  aria-label={t("infiniteCanvas:dragResize")}
                  title={t("infiniteCanvas:dragResize")}
                  onPointerDown={(event) => startItemResize(event, selectedItem)}
                />
              ) : null}
            </div>
          ) : null}

          {selectedItem && selectedToolbarPosition && editingTextItemId !== selectedItem.id ? (
            <div
              className="free-canvas-editor__floating-toolbar"
              aria-label={t("freeCanvasEditor:layerActions")}
              style={{ left: `${selectedToolbarPosition.x}px`, top: `${selectedToolbarPosition.y}px` }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {selectedItem.type === "text" ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Popover open={fontSizeToolOpen} onOpenChange={(open) => changeTextToolOpen(selectedItem.id, "fontSize", open)}>
                          <PopoverTrigger asChild>
                            <Button type="button" variant={fontSizeToolOpen ? "default" : "ghost"} size="icon-sm" aria-label={t("freeCanvasEditor:fontSize")} aria-pressed={fontSizeToolOpen}>
                              <Type aria-hidden="true" />
                            </Button>
                          </PopoverTrigger>
                          <FontSizePanel item={selectedItem} fontSizeLabel={t("freeCanvasEditor:fontSize")} onFontSizeChange={(fontSize) => updateTextFontSize(selectedItem.id, fontSize)} />
                        </Popover>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t("freeCanvasEditor:fontSize")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Popover open={colorToolOpen} onOpenChange={(open) => changeTextToolOpen(selectedItem.id, "color", open)}>
                          <PopoverTrigger asChild>
                            <Button className="free-canvas-editor__color-tool" type="button" variant={colorToolOpen ? "default" : "ghost"} size="icon-sm" aria-label={t("freeCanvasEditor:textColor")} aria-pressed={colorToolOpen}>
                              <Palette aria-hidden="true" />
                              <span className="free-canvas-editor__toolbar-color" style={{ "--free-canvas-text-color": selectedItem.color } as CSSProperties} />
                            </Button>
                          </PopoverTrigger>
                          <TextColorPanel item={selectedItem} textColorLabel={t("freeCanvasEditor:textColor")} onColorChange={(color) => updateTextItem(selectedItem.id, { color })} />
                        </Popover>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t("freeCanvasEditor:textColor")}</TooltipContent>
                  </Tooltip>
                </>
              ) : null}
              <CanvasIconButton type="button" label={t("freeCanvasEditor:moveLayerUp")} variant="ghost" size="icon-sm" onClick={() => moveLayer(selectedItem.id, "up")}>
                <ArrowUp aria-hidden="true" />
              </CanvasIconButton>
              <CanvasIconButton type="button" label={t("freeCanvasEditor:moveLayerDown")} variant="ghost" size="icon-sm" onClick={() => moveLayer(selectedItem.id, "down")}>
                <ArrowDown aria-hidden="true" />
              </CanvasIconButton>
              <CanvasIconButton type="button" label={t("freeCanvasEditor:bringToFront")} variant="ghost" size="icon-sm" onClick={() => moveLayerToEdge(selectedItem.id, "front")}>
                <ChevronsUp aria-hidden="true" />
              </CanvasIconButton>
              <CanvasIconButton type="button" label={t("freeCanvasEditor:sendToBack")} variant="ghost" size="icon-sm" onClick={() => moveLayerToEdge(selectedItem.id, "back")}>
                <ChevronsDown aria-hidden="true" />
              </CanvasIconButton>
              <CanvasIconButton type="button" label={t("freeCanvasEditor:deleteLayer")} variant="destructive" size="icon-sm" onClick={removeSelectedItem}>
                <Trash2 aria-hidden="true" />
              </CanvasIconButton>
            </div>
          ) : null}

          <aside className="free-canvas-editor__inspector" aria-label={t("freeCanvasEditor:layers")} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <div className="free-canvas-editor__panel-title">
              <Layers size={16} aria-hidden="true" />
              <strong>{t("freeCanvasEditor:layers")}</strong>
            </div>
            <AppScrollArea className="free-canvas-editor__layer-scroll" viewportClassName="free-canvas-editor__layer-scroll-viewport">
              <DraggableList
                items={layerItems}
                getId={(item) => item.id}
                onReorder={(nextItems) => reorderLayers(nextItems.map((item) => item.id))}
                className="free-canvas-editor__layer-list"
                renderItem={(item, { dragHandleProps }) => {
                  const Icon = item.type === "text" ? Type : ImageIcon;
                  return (
                    <div
                      className={`free-canvas-editor__layer-row${selectedItemId === item.id ? " active" : ""}`}
                    >
                      <span className="free-canvas-editor__layer-drag-handle" aria-hidden="true" {...dragHandleProps}>
                        <GripVertical size={13} />
                      </span>
                      <Button type="button" variant="ghost" size="sm" className="free-canvas-editor__layer-select w-full min-w-0 justify-start" onClick={() => setSelectedItemId(item.id)}>
                        <Icon data-icon="inline-start" aria-hidden="true" />
                        <span>{item.name || (item.type === "text" ? t("freeCanvasEditor:textLayer") : t("freeCanvasEditor:imageLayer"))}</span>
                      </Button>
                      <div className="free-canvas-editor__layer-order-actions" aria-label={t("freeCanvasEditor:layerActions")}>
                        <CanvasIconButton type="button" label={t("freeCanvasEditor:moveLayerUp")} variant="ghost" size="icon-sm" onClick={() => moveLayer(item.id, "up")}>
                          <ArrowUp aria-hidden="true" />
                        </CanvasIconButton>
                        <CanvasIconButton type="button" label={t("freeCanvasEditor:moveLayerDown")} variant="ghost" size="icon-sm" onClick={() => moveLayer(item.id, "down")}>
                          <ArrowDown aria-hidden="true" />
                        </CanvasIconButton>
                      </div>
                    </div>
                  );
                }}
              />
            </AppScrollArea>
          </aside>
        </div>
        {exportError ? <ErrorCopyLine className="free-canvas-editor__error" text={t("freeCanvasEditor:exportFailed", { message: exportError })} /> : null}
      </main>

    </div>
  );
}
