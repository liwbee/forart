import {
  DragEvent,
  ReactNode,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  WheelEvent,
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
  ChevronsDown,
  ChevronsUp,
  Download,
  Layers,
  Plus,
  Copy,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

const CANVAS_WIDTH = 1800;
const CANVAS_HEIGHT = 2400;
const VIEWPORT_SCALE_MIN = 0.45;
const VIEWPORT_SCALE_MAX = 3;
const ASSET_RAIL_MIN = 180;
const ASSET_RAIL_MAX = 760;
const ASSET_RAIL_DEFAULT = 320;
const ASSET_PREVIEW_MAX_WIDTH = 360;
const ASSET_PREVIEW_MAX_HEIGHT = 520;
const ASSET_PREVIEW_OFFSET = 18;

interface ComposerItem {
  id: string;
  assetId: string;
  name: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  zIndex: number;
}

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

interface FreeCanvasComposerProps {
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
  canvasEmptyText: string;
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getAssetUrl(asset: ComposerAsset) {
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

function drawContainedImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const ratio = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * ratio;
  const drawHeight = image.naturalHeight * ratio;
  ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
}

function normalizeLayerOrder(orderedItems: ComposerItem[]) {
  return orderedItems.map((item, index) => ({ ...item, zIndex: index + 1 }));
}

function itemDisplaySize(item: ComposerItem) {
  return {
    width: item.width * item.scale,
    height: item.height * item.scale,
  };
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

function AssetHoverPreviewLayer({ preview }: { preview: AssetHoverPreview | null }) {
  if (!preview || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="outfit-composer__asset-preview"
      style={{
        left: `${preview.x}px`,
        top: `${preview.y}px`,
      }}
      aria-hidden="true"
    >
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
  onClose,
}: {
  state: AssetChoicePopoverState | null;
  choices: ComposerAssetChoice[];
  loading: boolean;
  error: string;
  emptyText: string;
  onSelect: (choice: ComposerAssetChoice) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!state || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="outfit-composer__choice-popover"
      role="dialog"
      aria-label={t("outfitComposer.imageChoices", { name: state.asset.name })}
      style={{ left: `${state.x}px`, top: `${state.y}px` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="outfit-composer__choice-grid">
        {loading ? <div className="outfit-composer__choice-empty">{t("outfitComposer.loadingImages")}</div> : null}
        {error ? <div className="outfit-composer__choice-empty">{t("outfitComposer.loadFailed", { message: error })}</div> : null}
        {!loading && !error && !choices.length ? <div className="outfit-composer__choice-empty">{emptyText}</div> : null}
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

export function FreeCanvasComposer({
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
  canvasEmptyText,
  tagFilterLabel,
  cardVariant = "direct",
}: FreeCanvasComposerProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ComposerItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [exportError, setExportError] = useState("");
  const [assetHoverPreview, setAssetHoverPreview] = useState<AssetHoverPreview | null>(null);
  const [choicePopover, setChoicePopover] = useState<AssetChoicePopoverState | null>(null);
  const [assetChoices, setAssetChoices] = useState<ComposerAssetChoice[]>([]);
  const [assetChoicesLoading, setAssetChoicesLoading] = useState(false);
  const [assetChoicesError, setAssetChoicesError] = useState("");
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const [assetRailWidth, setAssetRailWidth] = useState(ASSET_RAIL_DEFAULT);
  const [isResizingRail, setIsResizingRail] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const fileDragDepthRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    itemId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    itemId: string;
    startClientX: number;
    startClientY: number;
    startScale: number;
    startX: number;
    startY: number;
    itemWidth: number;
    itemHeight: number;
    canvasRectWidth: number;
    canvasRectHeight: number;
  } | null>(null);
  const railResizeRef = useRef<{
    pointerId: number;
    startClientX: number;
    startWidth: number;
  } | null>(null);

  const selectedItem = items.find((item) => item.id === selectedItemId) || null;
  const sortedItems = useMemo(() => [...items].sort((left, right) => left.zIndex - right.zIndex), [items]);
  const selectedToolbarPosition = (() => {
    if (!selectedItem || !canvasRef.current || !stageRef.current) return null;
    const canvasWidth = canvasRef.current.offsetWidth;
    const canvasHeight = canvasRef.current.offsetHeight;
    const stageWidth = stageRef.current.clientWidth;
    const stageHeight = stageRef.current.clientHeight;
    const displaySize = itemDisplaySize(selectedItem);
    return {
      x: stageWidth / 2 + viewport.x + (selectedItem.x / CANVAS_WIDTH - 0.5) * canvasWidth * viewport.scale,
      y: stageHeight / 2 + viewport.y + ((selectedItem.y - displaySize.height / 2) / CANVAS_HEIGHT - 0.5) * canvasHeight * viewport.scale,
    };
  })();

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

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
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

  function updateItem(itemId: string, patch: Partial<ComposerItem>) {
    setItems((currentItems) => currentItems.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
  }

  function updateAssetHoverPreview(event: ReactMouseEvent<HTMLButtonElement>, src: string) {
    const position = assetPreviewPosition(event.clientX, event.clientY);
    setAssetHoverPreview({ src, ...position });
  }

  function addAsset(asset: ComposerAsset) {
    const src = getAssetUrl(asset);
    if (!src) return;
    const index = items.length;
    const maxZIndex = Math.max(...items.map((item) => item.zIndex), 0);
    const item: ComposerItem = {
      id: `${asset.id}-${Date.now()}`,
      assetId: asset.id,
      name: asset.name || assetAltText,
      src,
      x: CANVAS_WIDTH / 2 + (index % 5) * 28,
      y: CANVAS_HEIGHT / 2 + (index % 5) * 28,
      width: 430,
      height: 430,
      scale: 1,
      rotation: 0,
      zIndex: maxZIndex + 1,
    };
    setItems((currentItems) => [...currentItems, item]);
    setSelectedItemId(item.id);
  }

  function addChoiceAsset(choice: ComposerAssetChoice, fallbackName: string) {
    addAsset({
      id: choice.id,
      name: choice.name || fallbackName,
      asset_id: choice.asset_id,
      asset_url: choice.asset_url,
      updated_at: choice.updated_at,
    });
    setChoicePopover(null);
  }

  async function openAssetChoices(event: ReactMouseEvent<HTMLButtonElement>, asset: ComposerAsset) {
    if (!onLoadAssetChoices) return;
    event.stopPropagation();
    setAssetHoverPreview(null);
    const rect = event.currentTarget.getBoundingClientRect();
    const popoverWidth = 360;
    const popoverHeight = 420;
    const margin = 12;
    const x = clamp(rect.right + 10, margin, Math.max(margin, window.innerWidth - popoverWidth - margin));
    const y = clamp(rect.top, margin, Math.max(margin, window.innerHeight - popoverHeight - margin));
    setChoicePopover({ asset, x, y });
    setAssetChoices([]);
    setAssetChoicesError("");
    setAssetChoicesLoading(true);
    try {
      const choices = await onLoadAssetChoices(asset.id);
      setAssetChoices(choices);
    } catch (error) {
      setAssetChoicesError(error instanceof Error ? error.message : String(error));
    } finally {
      setAssetChoicesLoading(false);
    }
  }

  function addDroppedFiles(files: File[]) {
    if (!files.length) return;
    const maxZIndex = Math.max(...items.map((item) => item.zIndex), 0);
    const nextItems = files.map((file, index) => {
      const src = URL.createObjectURL(file);
      objectUrlsRef.current.push(src);
      return {
        id: `file-${Date.now()}-${index}`,
        assetId: "",
        name: file.name || t("outfitComposer.droppedImage"),
        src,
        x: CANVAS_WIDTH / 2 + index * 28,
        y: CANVAS_HEIGHT / 2 + index * 28,
        width: 430,
        height: 430,
        scale: 1,
        rotation: 0,
        zIndex: maxZIndex + index + 1,
      };
    });
    setItems((currentItems) => [...currentItems, ...nextItems]);
    setSelectedItemId(nextItems[nextItems.length - 1]?.id || "");
  }

  function removeSelectedItem() {
    if (!selectedItem) return;
    setItems((currentItems) => currentItems.filter((item) => item.id !== selectedItem.id));
    setSelectedItemId("");
  }

  function moveLayer(direction: "up" | "down") {
    if (!selectedItem) return;
    setItems((currentItems) => {
      const orderedItems = [...currentItems].sort((left, right) => left.zIndex - right.zIndex);
      const selectedIndex = orderedItems.findIndex((item) => item.id === selectedItem.id);
      if (selectedIndex < 0) return currentItems;
      const targetIndex = selectedIndex + (direction === "up" ? 1 : -1);
      if (targetIndex < 0 || targetIndex >= orderedItems.length) return currentItems;
      const nextItems = [...orderedItems];
      [nextItems[selectedIndex], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[selectedIndex]];
      return normalizeLayerOrder(nextItems);
    });
  }

  function moveLayerToEdge(edge: "front" | "back") {
    if (!selectedItem) return;
    setItems((currentItems) => {
      const orderedItems = [...currentItems].sort((left, right) => left.zIndex - right.zIndex);
      const selectedIndex = orderedItems.findIndex((item) => item.id === selectedItem.id);
      if (selectedIndex < 0) return currentItems;
      const [item] = orderedItems.splice(selectedIndex, 1);
      if (!item) return currentItems;
      if (edge === "front") {
        orderedItems.push(item);
      } else {
        orderedItems.unshift(item);
      }
      return normalizeLayerOrder(orderedItems);
    });
  }

  function handleImageLoad(itemId: string, image: HTMLImageElement) {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const item = items.find((currentItem) => currentItem.id === itemId);
    if (!item || item.width === image.naturalWidth && item.height === image.naturalHeight) return;
    const targetWidth = CANVAS_WIDTH * 0.46;
    const targetHeight = CANVAS_HEIGHT * 0.34;
    const fitScale = Math.min(targetWidth / image.naturalWidth, targetHeight / image.naturalHeight, 1);
    updateItem(itemId, {
      width: image.naturalWidth,
      height: image.naturalHeight,
      scale: Number(fitScale.toFixed(3)),
    });
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>, item: ComposerItem) {
    if (event.button === 1) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedItemId(item.id);
    dragRef.current = {
      pointerId: event.pointerId,
      itemId: item.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: item.x,
      startY: item.y,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !rect?.width) return;
    event.preventDefault();
    const deltaX = ((event.clientX - drag.startClientX) / rect.width) * CANVAS_WIDTH;
    const deltaY = ((event.clientY - drag.startClientY) / rect.height) * CANVAS_HEIGHT;
    updateItem(drag.itemId, {
      x: clamp(drag.startX + deltaX, 0, CANVAS_WIDTH),
      y: clamp(drag.startY + deltaY, 0, CANVAS_HEIGHT),
    });
  }

  function stopDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
  }

  function startItemResize(event: PointerEvent<HTMLSpanElement>, item: ComposerItem) {
    if (event.button !== 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedItemId(item.id);
    resizeRef.current = {
      pointerId: event.pointerId,
      itemId: item.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScale: item.scale,
      startX: item.x,
      startY: item.y,
      itemWidth: item.width,
      itemHeight: item.height,
      canvasRectWidth: rect.width,
      canvasRectHeight: rect.height,
    };
  }

  function handleResizeMove(event: PointerEvent<HTMLSpanElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const startDisplayWidth = resize.itemWidth * resize.startScale;
    const startDisplayHeight = resize.itemHeight * resize.startScale;
    const deltaX = ((event.clientX - resize.startClientX) / resize.canvasRectWidth) * CANVAS_WIDTH;
    const deltaY = ((event.clientY - resize.startClientY) / resize.canvasRectHeight) * CANVAS_HEIGHT;
    const widthScale = (startDisplayWidth + deltaX) / resize.itemWidth;
    const heightScale = (startDisplayHeight + deltaY) / resize.itemHeight;
    const nextScale = clamp(Math.max(widthScale, heightScale), 0.2, 4);
    const nextDisplayWidth = resize.itemWidth * nextScale;
    const nextDisplayHeight = resize.itemHeight * nextScale;
    updateItem(resize.itemId, {
      scale: Number(nextScale.toFixed(3)),
      x: resize.startX + (nextDisplayWidth - startDisplayWidth) / 2,
      y: resize.startY + (nextDisplayHeight - startDisplayHeight) / 2,
    });
  }

  function stopResize(event: PointerEvent<HTMLSpanElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resizeRef.current = null;
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
    if (fileDragDepthRef.current === 0) setIsFileDropActive(false);
  }

  function handleStageDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasImageFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current = 0;
    setIsFileDropActive(false);
    const files = imageFilesFromTransfer(event.dataTransfer);
    if (!files.length) return;
    addDroppedFiles(files);
  }

  function handleStageWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const pointerX = event.clientX - rect.left - rect.width / 2;
    const pointerY = event.clientY - rect.top - rect.height / 2;
    const scaleFactor = Math.exp(-event.deltaY * 0.0012);
    setViewport((currentViewport) => {
      const nextScale = clamp(currentViewport.scale * scaleFactor, VIEWPORT_SCALE_MIN, VIEWPORT_SCALE_MAX);
      const ratio = nextScale / currentViewport.scale;
      return {
        scale: Number(nextScale.toFixed(3)),
        x: pointerX - (pointerX - currentViewport.x) * ratio,
        y: pointerY - (pointerY - currentViewport.y) * ratio,
      };
    });
  }

  function handleStagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button === 0 && event.target === event.currentTarget) {
      setSelectedItemId("");
      return;
    }
    if (event.button !== 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: viewport.x,
      startY: viewport.y,
    };
    setIsPanning(true);
  }

  function handleStagePointerMove(event: PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    setViewport((currentViewport) => ({
      ...currentViewport,
      x: pan.startX + event.clientX - pan.startClientX,
      y: pan.startY + event.clientY - pan.startClientY,
    }));
  }

  function stopStagePan(event: PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    setIsPanning(false);
  }

  function resetViewport() {
    setViewport({ scale: 1, x: 0, y: 0 });
  }

  function startRailResize(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    railResizeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: assetRailWidth,
    };
    setIsResizingRail(true);
  }

  function handleRailResizeMove(event: PointerEvent<HTMLButtonElement>) {
    const resize = railResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    setAssetRailWidth(clamp(resize.startWidth + event.clientX - resize.startClientX, ASSET_RAIL_MIN, ASSET_RAIL_MAX));
  }

  function stopRailResize(event: PointerEvent<HTMLButtonElement>) {
    const resize = railResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    railResizeRef.current = null;
    setIsResizingRail(false);
  }

  function handleRailResizeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") {
      setAssetRailWidth(ASSET_RAIL_MIN);
      return;
    }
    if (event.key === "End") {
      setAssetRailWidth(ASSET_RAIL_MAX);
      return;
    }
    const step = event.shiftKey ? 64 : 20;
    setAssetRailWidth((currentWidth) => clamp(currentWidth + (event.key === "ArrowRight" ? step : -step), ASSET_RAIL_MIN, ASSET_RAIL_MAX));
  }

  function handleItemKeyDown(event: KeyboardEvent<HTMLButtonElement>, item: ComposerItem) {
    const step = event.shiftKey ? 24 : 8;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      setItems((currentItems) => currentItems.filter((currentItem) => currentItem.id !== item.id));
      setSelectedItemId("");
      return;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    updateItem(item.id, {
      x: item.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
      y: item.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
    });
  }

  async function renderCanvasBlob() {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Cannot create canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    for (const item of sortedItems) {
      const image = await loadImage(item.src);
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate((item.rotation * Math.PI) / 180);
      ctx.scale(item.scale, item.scale);
      drawContainedImage(ctx, image, item.width, item.height);
      ctx.restore();
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Render failed");
    return blob;
  }

  async function exportCanvas() {
    if (!items.length) return;
    setExporting(true);
    setExportError("");
    try {
      const blob = await renderCanvasBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `outfit-composition-${Date.now()}.png`;
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
    if (!items.length) return;
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      setExportError(t("outfitComposer.copyUnsupported"));
      return;
    }
    setCopying(true);
    setExportError("");
    try {
      const blob = await renderCanvasBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setCopying(false);
    }
  }

  return (
    <div
      className={`outfit-composer${isResizingRail ? " resizing-rail" : ""}`}
      style={{ gridTemplateColumns: `${assetRailWidth}px 8px minmax(0, 1fr)` }}
      onDragEnter={handleStageDragEnter}
      onDragOver={handleStageDragOver}
      onDragLeave={handleStageDragLeave}
      onDrop={handleStageDrop}
    >
      <aside className="outfit-composer__asset-rail" aria-label={assetTitle || tagFilterLabel}>
        {assetTitle || onOpenTagManager ? (
          <div className="outfit-composer__rail-head">
            {assetTitle ? <strong>{assetTitle}</strong> : <span />}
            {onOpenTagManager ? (
              <button type="button" aria-label={t("common.labels.manageTags")} title={t("common.labels.manageTags")} onClick={onOpenTagManager}>
                <SlidersHorizontal size={18} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}

        {railControls ? <div className="outfit-composer__rail-controls">{railControls}</div> : null}

        <div className="outfit-composer__tag-row" aria-label={tagFilterLabel}>
          <button className={activeTagId ? "" : "active"} type="button" onClick={() => onTagChange("")}>
            {t("common.labels.all")}
          </button>
          {tags.map((tag) => (
            <button key={tag.id} className={activeTagId === tag.id ? "active" : ""} type="button" onClick={() => onTagChange(tag.id)}>
              {tag.name}
            </button>
          ))}
        </div>

        <div className="outfit-composer__asset-list">
          {assets.map((asset) => {
            const src = getAssetUrl(asset);
            const isChoiceCard = cardVariant === "choice";
            return (
              <button
                key={asset.id}
                className={`outfit-composer__asset${isChoiceCard ? " outfit-composer__asset--named" : ""}`}
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
                {src ? (
                  <img src={src} alt={asset.name || assetAltText} loading="lazy" draggable={false} />
                ) : (
                  <span className={isChoiceCard ? "outfit-composer__asset-placeholder" : ""}>{t("common.empty.noImage")}</span>
                )}
                {isChoiceCard ? <span className="outfit-composer__asset-name">{asset.name || assetAltText}</span> : null}
              </button>
            );
          })}
          {!assets.length ? <div className="outfit-composer__empty">{emptyText}</div> : null}
        </div>

      </aside>

      <button
        className="outfit-composer__rail-resizer"
        type="button"
        role="separator"
        aria-label={t("outfitComposer.resizeRail", { title: assetTitle || tagFilterLabel })}
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

      <main className="outfit-composer__stage-wrap">
        <div className="outfit-composer__stage-toolbar">
          <div className="outfit-composer__stage-meta">
            <strong>{t("outfitComposer.canvasTitle")}</strong>
            <span>{CANVAS_WIDTH} x {CANVAS_HEIGHT}</span>
          </div>
          <div className="outfit-composer__stage-actions">
            <button className="button secondary" type="button" onClick={resetViewport}>
              <span>{Math.round(viewport.scale * 100)}%</span>
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={!items.length}
              onClick={() => {
                setItems([]);
                setSelectedItemId("");
              }}
            >
              <X size={18} aria-hidden="true" />
              <span>{t("outfitComposer.clear")}</span>
            </button>
            <button className="button secondary outfit-composer__copy-button" type="button" disabled={!items.length || copying} onClick={copyCanvasImage}>
              <Copy size={18} aria-hidden="true" />
              <span>{copying ? t("outfitComposer.copying") : t("outfitComposer.copyImage")}</span>
            </button>
            <button className="button primary outfit-composer__export-button" type="button" disabled={!items.length || exporting} onClick={exportCanvas}>
              <Download size={18} aria-hidden="true" />
              <span>{exporting ? t("outfitComposer.exporting") : t("outfitComposer.exportPng")}</span>
            </button>
          </div>
        </div>

        <div
          ref={stageRef}
          className={`outfit-composer__stage-scroll${isPanning ? " panning" : ""}`}
          onWheel={handleStageWheel}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={stopStagePan}
          onPointerCancel={stopStagePan}
          onAuxClick={(event) => event.preventDefault()}
          onDragEnter={handleStageDragEnter}
          onDragOver={handleStageDragOver}
          onDragLeave={handleStageDragLeave}
          onDrop={handleStageDrop}
        >
          <div className="outfit-composer__canvas-shell" style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})` }}>
            <div ref={canvasRef} className={`outfit-composer__canvas${isFileDropActive ? " drag-active" : ""}`} onPointerDown={() => setSelectedItemId("")}>
              {sortedItems.map((item) => {
                const selected = item.id === selectedItemId;
                const displaySize = itemDisplaySize(item);
                return (
                  <button
                    key={item.id}
                    className={`outfit-composer__canvas-item${selected ? " selected" : ""}`}
                    type="button"
                    aria-label={t("outfitComposer.layer", { name: item.name })}
                    style={{
                      left: `${(item.x / CANVAS_WIDTH) * 100}%`,
                      top: `${(item.y / CANVAS_HEIGHT) * 100}%`,
                      width: `${(displaySize.width / CANVAS_WIDTH) * 100}%`,
                      height: `${(displaySize.height / CANVAS_HEIGHT) * 100}%`,
                      zIndex: item.zIndex,
                      transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 1) event.stopPropagation();
                      handlePointerDown(event, item);
                    }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={stopDrag}
                    onPointerCancel={stopDrag}
                    onKeyDown={(event) => handleItemKeyDown(event, item)}
                  >
                    <img
                      src={item.src}
                      alt=""
                      width={item.width}
                      height={item.height}
                      draggable={false}
                      decoding="sync"
                      onLoad={(event) => handleImageLoad(item.id, event.currentTarget)}
                    />
                    {selected ? (
                      <span
                        className="outfit-composer__resize-handle"
                        role="presentation"
                        onPointerDown={(event) => startItemResize(event, item)}
                        onPointerMove={handleResizeMove}
                        onPointerUp={stopResize}
                        onPointerCancel={stopResize}
                      />
                    ) : null}
                  </button>
                );
              })}
              {!items.length ? (
                <div className="outfit-composer__canvas-empty">
                  <Layers size={32} aria-hidden="true" />
                  <span>{canvasEmptyText}</span>
                </div>
              ) : null}
              {isFileDropActive ? (
                <div className="outfit-composer__drop-hint">
                  <Layers size={34} aria-hidden="true" />
                  <span>{t("outfitComposer.dropHint")}</span>
                </div>
              ) : null}
            </div>
          </div>
          {selectedItem && selectedToolbarPosition ? (
              <div
                className="outfit-composer__floating-toolbar"
                aria-label={t("outfitComposer.layerActions")}
                style={{
                  left: `${selectedToolbarPosition.x}px`,
                  top: `${selectedToolbarPosition.y}px`,
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button type="button" aria-label={t("outfitComposer.moveLayerUp")} title={t("outfitComposer.moveLayerUp")} onClick={() => moveLayer("up")}>
                  <ArrowUp size={16} aria-hidden="true" />
                </button>
                <button type="button" aria-label={t("outfitComposer.moveLayerDown")} title={t("outfitComposer.moveLayerDown")} onClick={() => moveLayer("down")}>
                  <ArrowDown size={16} aria-hidden="true" />
                </button>
                <button type="button" aria-label={t("outfitComposer.bringToFront")} title={t("outfitComposer.bringToFront")} onClick={() => moveLayerToEdge("front")}>
                  <ChevronsUp size={16} aria-hidden="true" />
                </button>
                <button type="button" aria-label={t("outfitComposer.sendToBack")} title={t("outfitComposer.sendToBack")} onClick={() => moveLayerToEdge("back")}>
                  <ChevronsDown size={16} aria-hidden="true" />
                </button>
                <button className="danger" type="button" aria-label={t("outfitComposer.deleteLayer")} title={t("outfitComposer.deleteLayer")} onClick={removeSelectedItem}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            ) : null}
        </div>
        {exportError ? <div className="outfit-composer__error">{t("outfitComposer.exportFailed", { message: exportError })}</div> : null}
      </main>
      <AssetHoverPreviewLayer preview={assetHoverPreview} />
      <AssetChoicePopover
        state={choicePopover}
        choices={assetChoices}
        loading={assetChoicesLoading}
        error={assetChoicesError}
        emptyText={t("outfitComposer.noModelImages")}
        onSelect={(choice) => addChoiceAsset(choice, choicePopover?.asset.name || assetAltText)}
        onClose={() => setChoicePopover(null)}
      />
    </div>
  );
}
