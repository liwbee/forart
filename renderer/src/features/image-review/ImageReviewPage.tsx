import { PointerEvent, forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type WheelEvent as ReactWheelEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleCheck, CircleHelp, Flag, FolderOpen, ImageOff, RefreshCw, Save, Search, X } from "lucide-react";

type ImageGroupKey = "model" | "detail";

interface ReviewImage {
  id: string;
  name: string;
  relativePath: string;
  url: string;
  size: number;
  lastModified: number;
}

interface ReviewProduct {
  id: string;
  hasModelImages: boolean;
  modelImages: ReviewImage[];
  detailImages: ReviewImage[];
  unknownImages: ReviewImage[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const WHEEL_LINE_HEIGHT = 40;
const THUMB_WHEEL_IMMEDIATE_RATIO = 0.28;
const THUMB_WHEEL_VELOCITY_RATIO = 0.012;
const THUMB_WHEEL_FRICTION = 0.9;
const THUMB_WHEEL_MAX_VELOCITY = 3.2;
const THUMB_WHEEL_STOP_VELOCITY = 0.02;
const PRODUCT_ROW_HEIGHT = 80;
const PRODUCT_COLUMN_WIDTH = 208;
const THUMB_ITEM_WIDTH = 66;

type ThumbScrollMomentum = {
  frame: number;
  lastTime: number;
  velocity: number;
};

type VirtualAxis = "vertical" | "horizontal";

function useVirtualWindow(
  containerRef: MutableRefObject<HTMLDivElement | null>,
  itemCount: number,
  itemSize: number,
  axis: VirtualAxis,
  buffer = 4,
) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [viewportSize, setViewportSize] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    function measure() {
      if (!containerRef.current) return;
      setViewportSize(axis === "vertical" ? containerRef.current.clientHeight : containerRef.current.clientWidth);
      setScrollOffset(axis === "vertical" ? containerRef.current.scrollTop : containerRef.current.scrollLeft);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [axis, containerRef]);

  const visibleRange = useMemo(() => {
    if (!itemCount || !itemSize || !viewportSize) return { start: 0, end: Math.min(itemCount, buffer * 2 + 1) };
    const firstVisible = Math.floor(scrollOffset / itemSize);
    const visibleCount = Math.ceil(viewportSize / itemSize);
    const start = Math.max(0, firstVisible - buffer);
    const end = Math.min(itemCount, firstVisible + visibleCount + buffer);
    return { start, end };
  }, [buffer, itemCount, itemSize, scrollOffset, viewportSize]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollOffset(axis === "vertical" ? event.currentTarget.scrollTop : event.currentTarget.scrollLeft);
  }, [axis]);

  return {
    ...visibleRange,
    onScroll,
    totalSize: itemCount * itemSize,
  };
}

function scrollVirtualItemIntoView(container: HTMLDivElement | null, index: number, itemSize: number, axis: VirtualAxis) {
  if (!container || index < 0) return;
  const start = index * itemSize;
  const end = start + itemSize;
  const viewportStart = axis === "vertical" ? container.scrollTop : container.scrollLeft;
  const viewportSize = axis === "vertical" ? container.clientHeight : container.clientWidth;
  const viewportEnd = viewportStart + viewportSize;
  let nextOffset = viewportStart;

  if (start < viewportStart) nextOffset = start;
  else if (end > viewportEnd) nextOffset = Math.max(0, end - viewportSize);
  else return;

  if (axis === "vertical") container.scrollTop = nextOffset;
  else container.scrollLeft = nextOffset;
}

type ProductImagePaneHandle = {
  goImages: (direction: -1 | 1) => void;
};

function sortImages(images: ReviewImage[]) {
  return [...images].sort((a, b) => collator.compare(a.relativePath || a.name, b.relativePath || b.name));
}

function sortProducts(products: ReviewProduct[]) {
  return [...products].sort((a, b) => collator.compare(a.id, b.id));
}

function formatBytes(size: number) {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function listReviewProducts(modelFolderValue: string, reviewRootPath: string) {
  if (!window.forartReview?.products) return Promise.reject(new Error("Image review bridge is not available."));
  return window.forartReview.products({ root: reviewRootPath, modelFolders: modelFolderValue }).then((payload) => sortProducts(payload.products));
}

function loadProductImages(productId: string, modelFolderValue: string, detailFolderValue: string, reviewRootPath: string) {
  if (!window.forartReview?.productImages) return Promise.reject(new Error("Image review bridge is not available."));
  return window.forartReview.productImages({
    root: reviewRootPath,
    productId,
    modelFolders: modelFolderValue,
    detailFolders: detailFolderValue,
  }).then((payload) => ({
    ...payload.product,
    modelImages: sortImages(payload.product.modelImages),
    detailImages: sortImages(payload.product.detailImages),
    unknownImages: sortImages(payload.product.unknownImages),
  }));
}

function saveReviewIssue(image: ReviewImage, issue: string, reviewRootPath: string) {
  if (!window.forartReview?.saveIssue) return Promise.reject(new Error("Image review bridge is not available."));
  return window.forartReview.saveIssue({ root: reviewRootPath, path: image.relativePath, issue });
}

function loadReviewIssue(image: ReviewImage, reviewRootPath: string) {
  if (!window.forartReview?.loadIssue) return Promise.reject(new Error("Image review bridge is not available."));
  return window.forartReview.loadIssue({ root: reviewRootPath, path: image.relativePath }).then((payload) => payload.issue);
}

function reviewRootDisplayName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function RootFolderPicker({
  selectedRoot,
  loading,
  modelFolderName,
  detailFolderName,
  onChoose,
  onScan,
}: {
  selectedRoot: string;
  loading: boolean;
  modelFolderName: string;
  detailFolderName: string;
  onChoose: () => void;
  onScan: () => void;
}) {
  const { t } = useTranslation();
  const displayName = reviewRootDisplayName(selectedRoot);

  return (
    <div className="review-folder-picker review-folder-picker--root">
      <span className="review-folder-current" title={selectedRoot || ""}>
        {displayName || t("imageReview:choosePathFirst")}
      </span>
      <div className="review-folder-actions">
        <button className="review-folder-icon-button" type="button" disabled={loading} onClick={onChoose} aria-label={t("imageReview:choose")} title={t("imageReview:choose")}>
          <FolderOpen size={18} aria-hidden="true" />
        </button>
        <button className={`review-folder-icon-button${loading ? " is-spinning" : ""}`} type="button" disabled={loading || !selectedRoot} onClick={onScan} aria-label={t("imageReview:refresh")} title={t("imageReview:refresh")}>
          <RefreshCw size={18} aria-hidden="true" />
        </button>
        <div className="review-folder-guide">
          <button className="button secondary review-folder-guide-button" type="button" aria-label={t("imageReview:pathGuideTitle")}>
            <CircleHelp size={18} aria-hidden="true" />
          </button>
          <div className="review-folder-guide-popover" role="tooltip">
            <div className="review-folder-guide-tree" aria-label={t("imageReview:pathGuideStructureLabel")}>
              <div className="review-folder-guide-node review-folder-guide-node--root">
                <span>{t("imageReview:pathGuideRootFolder")}</span>
              </div>
              <div className="review-folder-guide-branch">
                <div className="review-folder-guide-node">
                  <span>{t("imageReview:pathGuideProductFolder")}</span>
                </div>
                <div className="review-folder-guide-children">
                  <div className="review-folder-guide-node review-folder-guide-node--model">
                    <span>{modelFolderName || t("imageReview:defaultModelFolder")}</span>
                  </div>
                  <div className="review-folder-guide-node review-folder-guide-node--detail">
                    <span>{detailFolderName || t("imageReview:defaultDetailFolder")}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ProductList = memo(function ProductList({
  products,
  activeProductId,
  searchQuery,
  onSearchChange,
  onSelectProduct,
}: {
  products: ReviewProduct[];
  activeProductId: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelectProduct: (productId: string) => void;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [virtualAxis, setVirtualAxis] = useState<VirtualAxis>("vertical");
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredProducts = normalizedQuery
    ? products.filter((product) => product.id.toLocaleLowerCase().includes(normalizedQuery))
    : products;
  const itemSize = virtualAxis === "vertical" ? PRODUCT_ROW_HEIGHT : PRODUCT_COLUMN_WIDTH;
  const virtual = useVirtualWindow(listRef, filteredProducts.length, itemSize, virtualAxis, 5);
  const visibleProducts = filteredProducts.slice(virtual.start, virtual.end);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    function updateAxis() {
      if (!listRef.current) return;
      const styles = window.getComputedStyle(listRef.current);
      setVirtualAxis(styles.gridAutoFlow === "column" ? "horizontal" : "vertical");
    }

    updateAxis();
    const observer = new ResizeObserver(updateAxis);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const index = filteredProducts.findIndex((product) => product.id === activeProductId);
    scrollVirtualItemIntoView(listRef.current, index, itemSize, virtualAxis);
  }, [activeProductId, filteredProducts, itemSize, virtualAxis]);

  return (
    <aside className="review-product-list" aria-label={t("imageReview:productList")}>
      <div className="review-product-search">
        <Search size={17} aria-hidden="true" />
        <input value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} placeholder={t("imageReview:searchProductId")} aria-label={t("imageReview:searchProductId")} />
        {searchQuery ? (
          <button type="button" aria-label={t("imageReview:clearSearch")} onClick={() => onSearchChange("")}>
            <X size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="review-product-list-head">
        <strong>{t("imageReview:productId")}</strong>
        <span>{filteredProducts.length} / {products.length}</span>
      </div>

      <div className={`review-product-items scrollbar-thin-stable${filteredProducts.length ? "" : " is-empty"}`} ref={listRef} onScroll={virtual.onScroll}>
        {filteredProducts.length ? (
          <div
            className="review-product-items__spacer"
            style={virtualAxis === "vertical" ? { height: virtual.totalSize } : { width: virtual.totalSize }}
          >
            <div
              className="review-product-items__virtual"
              style={virtualAxis === "vertical"
                ? { transform: `translateY(${virtual.start * itemSize}px)` }
                : { transform: `translateX(${virtual.start * itemSize}px)` }}
            >
          {visibleProducts.map((product) => {
            const isActive = product.id === activeProductId;
            const missingModel = !product.hasModelImages;
            return (
              <button
                key={product.id}
                className={isActive ? "active" : ""}
                type="button"
                aria-current={isActive ? "true" : undefined}
                onClick={() => onSelectProduct(product.id)}
              >
                <strong>{product.id}</strong>
                {missingModel ? <em>{t("imageReview:missingModelImage")}</em> : null}
              </button>
            );
          })}
            </div>
          </div>
        ) : (
          <div className="review-pair-empty">{products.length ? t("imageReview:noMatchingProductIds") : t("imageReview:mountReviewFolders")}</div>
        )}
      </div>
    </aside>
  );
});

const ReviewThumbNav = memo(function ReviewThumbNav({
  title,
  group,
  images,
  activeIndex,
  thumbStripRef,
  activeThumbRef,
  onActivate,
  onSelectImage,
  onScrollStrip,
  onWheel,
}: {
  title: string;
  group: ImageGroupKey;
  images: ReviewImage[];
  activeIndex: number;
  thumbStripRef: MutableRefObject<HTMLDivElement | null>;
  activeThumbRef: MutableRefObject<HTMLButtonElement | null>;
  onActivate: (group: ImageGroupKey) => void;
  onSelectImage: (index: number) => void;
  onScrollStrip: (direction: -1 | 1) => void;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
}) {
  const { t } = useTranslation();
  const virtual = useVirtualWindow(thumbStripRef, images.length, THUMB_ITEM_WIDTH, "horizontal", 8);
  const visibleImages = images.slice(virtual.start, virtual.end);

  useEffect(() => {
    scrollVirtualItemIntoView(thumbStripRef.current, activeIndex, THUMB_ITEM_WIDTH, "horizontal");
  }, [activeIndex, thumbStripRef]);

  return (
    <div className="review-thumb-nav">
      <button
        className="review-thumb-nav-button"
        type="button"
        aria-label={t("imageReview:scrollThumbsLeft")}
        disabled={!images.length}
        onClick={() => {
          onActivate(group);
          onScrollStrip(-1);
        }}
      >
        <ChevronLeft size={24} aria-hidden="true" />
      </button>
      <div
        className="review-thumb-strip scrollbar-thin"
        ref={(node) => { thumbStripRef.current = node; }}
        aria-label={t("imageReview:thumbsLabel", { title })}
        onScroll={virtual.onScroll}
        onWheel={onWheel}
      >
        <div className="review-thumb-strip__spacer" style={{ width: virtual.totalSize }}>
          <div className="review-thumb-strip__virtual" style={{ transform: `translateX(${virtual.start * THUMB_ITEM_WIDTH}px)` }}>
        {visibleImages.map((item, offset) => {
          const index = virtual.start + offset;
          return (
            <button
              key={item.id}
              ref={index === activeIndex ? (node) => { activeThumbRef.current = node; } : undefined}
              className={index === activeIndex ? "active" : ""}
              type="button"
              aria-label={t("imageReview:viewImage", { name: item.name })}
              aria-current={index === activeIndex ? "true" : undefined}
              onClick={() => {
                onActivate(group);
                onSelectImage(index);
              }}
            >
              <img src={item.url} alt="" loading={index === activeIndex ? "eager" : "lazy"} decoding="async" draggable={false} />
            </button>
          );
        })}
          </div>
        </div>
        {!images.length ? <div className="review-thumb-empty">{t("imageReview:noImages")}</div> : null}
      </div>
      <button
        className="review-thumb-nav-button"
        type="button"
        aria-label={t("imageReview:scrollThumbsRight")}
        disabled={!images.length}
        onClick={() => {
          onActivate(group);
          onScrollStrip(1);
        }}
      >
        <ChevronRight size={24} aria-hidden="true" />
      </button>
    </div>
  );
}, (previous, next) =>
  previous.title === next.title &&
  previous.group === next.group &&
  previous.images === next.images &&
  previous.activeIndex === next.activeIndex
);

const ProductImagePane = memo(forwardRef<ProductImagePaneHandle, {
  title: string;
  group: ImageGroupKey;
  isActive: boolean;
  folderValue: string;
  images: ReviewImage[];
  resetKey: string;
  onFolderValueChange: (value: string) => void;
  onActivate: (group: ImageGroupKey) => void;
  onReportIssue: (image: ReviewImage, issue: string) => Promise<void>;
  onLoadIssue: (image: ReviewImage) => Promise<string>;
}>(function ProductImagePane({
  title,
  group,
  isActive,
  folderValue,
  images,
  resetKey,
  onFolderValueChange,
  onActivate,
  onReportIssue,
  onLoadIssue,
}, ref) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const image = images[activeIndex] || null;
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [issueEditorOpen, setIssueEditorOpen] = useState(false);
  const [issueText, setIssueText] = useState("");
  const [issueError, setIssueError] = useState("");
  const [issueSaving, setIssueSaving] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const checkPanelRef = useRef<HTMLDivElement | null>(null);
  const thumbStripRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);
  const thumbMomentumRef = useRef<ThumbScrollMomentum>({ frame: 0, lastTime: 0, velocity: 0 });
  const isZoomed = transform.scale > 1.01;

  useEffect(() => {
    setActiveIndex(0);
    setDragStart(null);
    setTransform({ scale: 1, x: 0, y: 0 });
  }, [resetKey]);

  useEffect(() => {
    const maxIndex = Math.max(0, images.length - 1);
    if (activeIndex > maxIndex) setActiveIndex(maxIndex);
  }, [activeIndex, images.length]);

  useImperativeHandle(
    ref,
    () => ({
      goImages(direction) {
        setActiveIndex((currentIndex) => {
          const maxIndex = Math.max(0, images.length - 1);
          return Math.max(0, Math.min(maxIndex, currentIndex + direction));
        });
      },
    }),
    [images.length],
  );

  useEffect(() => {
    setDragStart(null);
  }, [image?.id]);

  useEffect(() => {
    setIssueEditorOpen(false);
    setIssueText("");
    setIssueError("");
    setIssueSaving(false);
  }, [image?.id]);

  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeIndex, images]);

  useEffect(() => {
    if (!issueEditorOpen) return;

    function handleOutsidePointerDown(event: globalThis.PointerEvent) {
      if (issueSaving) return;
      const target = event.target as Node | null;
      if (target && checkPanelRef.current?.contains(target)) return;
      setIssueEditorOpen(false);
      setIssueError("");
    }

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [issueEditorOpen, issueSaving]);

  useEffect(() => () => stopThumbMomentum(), []);

  function resetView() {
    setTransform({ scale: 1, x: 0, y: 0 });
    setDragStart(null);
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const scaleFactor = Math.exp(-event.deltaY * 0.0015);
    setTransform((current) => {
      const nextScale = Number(Math.max(1, Math.min(5, current.scale * scaleFactor)).toFixed(3));
      if (nextScale === 1) return { scale: 1, x: 0, y: 0 };
      const ratio = nextScale / current.scale;
      return {
        scale: nextScale,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
      };
    });
  }

  function scrollThumbStrip(direction: -1 | 1) {
    const strip = thumbStripRef.current;
    if (!strip) return;
    stopThumbMomentum();
    strip.scrollBy({ left: direction * Math.max(240, strip.clientWidth * 0.82), behavior: "smooth" });
  }

  const selectImage = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  function getWheelDelta(event: ReactWheelEvent<HTMLDivElement>, strip: HTMLDivElement) {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * WHEEL_LINE_HEIGHT;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * strip.clientWidth;
    return event.deltaY;
  }

  function stopThumbMomentum() {
    const momentum = thumbMomentumRef.current;
    if (momentum.frame) cancelAnimationFrame(momentum.frame);
    momentum.frame = 0;
    momentum.lastTime = 0;
    momentum.velocity = 0;
  }

  function scrollThumbTo(strip: HTMLDivElement, left: number) {
    const maxScrollLeft = strip.scrollWidth - strip.clientWidth;
    strip.scrollLeft = Math.max(0, Math.min(maxScrollLeft, left));
  }

  function runThumbMomentum(strip: HTMLDivElement, timestamp: number) {
    const momentum = thumbMomentumRef.current;
    const maxScrollLeft = strip.scrollWidth - strip.clientWidth;
    if (maxScrollLeft <= 0) {
      stopThumbMomentum();
      return;
    }

    const elapsed = momentum.lastTime ? Math.min(32, timestamp - momentum.lastTime) : 16;
    momentum.lastTime = timestamp;
    const atStart = strip.scrollLeft <= 0;
    const atEnd = strip.scrollLeft >= maxScrollLeft;
    if (Math.abs(momentum.velocity) < THUMB_WHEEL_STOP_VELOCITY || (momentum.velocity < 0 && atStart) || (momentum.velocity > 0 && atEnd)) {
      stopThumbMomentum();
      return;
    }

    scrollThumbTo(strip, strip.scrollLeft + momentum.velocity * elapsed);
    momentum.velocity *= Math.pow(THUMB_WHEEL_FRICTION, elapsed / 16.67);
    momentum.frame = requestAnimationFrame((nextTimestamp) => runThumbMomentum(strip, nextTimestamp));
  }

  function handleThumbWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const strip = event.currentTarget;
    const horizontalDelta = Math.abs(event.deltaX);
    const verticalDelta = Math.abs(event.deltaY);
    if (event.ctrlKey || (horizontalDelta > 0 && horizontalDelta > verticalDelta * 1.2)) return;

    const maxScrollLeft = strip.scrollWidth - strip.clientWidth;
    if (maxScrollLeft <= 0) return;

    const delta = getWheelDelta(event, strip);
    const canScroll = delta > 0 ? strip.scrollLeft < maxScrollLeft : strip.scrollLeft > 0;
    if (!canScroll) return;

    event.preventDefault();
    scrollThumbTo(strip, strip.scrollLeft + delta * THUMB_WHEEL_IMMEDIATE_RATIO);

    const momentum = thumbMomentumRef.current;
    momentum.velocity = Math.max(
      -THUMB_WHEEL_MAX_VELOCITY,
      Math.min(THUMB_WHEEL_MAX_VELOCITY, momentum.velocity + delta * THUMB_WHEEL_VELOCITY_RATIO),
    );
    if (!momentum.frame) momentum.frame = requestAnimationFrame((timestamp) => runThumbMomentum(strip, timestamp));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    onActivate(group);
    const target = event.target as Node | null;
    if (target && checkPanelRef.current?.contains(target)) return;
    if (!image || !isZoomed) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: transform.x, panY: transform.y });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    event.preventDefault();
    setTransform((current) => ({
      ...current,
      x: dragStart.panX + event.clientX - dragStart.x,
      y: dragStart.panY + event.clientY - dragStart.y,
    }));
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragStart?.pointerId === event.pointerId) {
      setDragStart(null);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function openIssueEditor() {
    if (!image) return;
    onActivate(group);
    setIssueError("");
    setIssueEditorOpen(true);
    try {
      const existingIssue = await onLoadIssue(image);
      setIssueText(existingIssue === t("imageReview:pass") ? "" : existingIssue);
    } catch {
      setIssueText("");
      setIssueError(t("imageReview:loadExistingIssueFailed"));
    }
  }

  async function saveCurrentIssue(issue: string) {
    if (!image) return;
    const nextIssue = issue.trim();
    if (!nextIssue) {
      setIssueError(t("imageReview:issueRequired"));
      return;
    }

    setIssueSaving(true);
    setIssueError("");
    try {
      await onReportIssue(image, nextIssue);
      setIssueEditorOpen(false);
      setIssueText(nextIssue);
    } catch {
      setIssueError(t("imageReview:saveFailed"));
    } finally {
      setIssueSaving(false);
    }
  }

  async function approveCurrentImage() {
    if (!image) return;
    onActivate(group);
    setIssueSaving(true);
    setIssueError("");
    try {
      await onReportIssue(image, t("imageReview:pass"));
      setIssueEditorOpen(false);
      setIssueText("");
      if (activeIndex < images.length - 1) setActiveIndex(activeIndex + 1);
    } catch {
      setIssueError(t("imageReview:saveFailed"));
    } finally {
      setIssueSaving(false);
    }
  }

  return (
    <section className={`review-image-pane${isActive ? " active" : ""}`} aria-label={title} onFocusCapture={() => onActivate(group)}>
      <div className="review-pane-head">
        <label className="review-pane-folder-rule">
          <input
            value={folderValue}
            onChange={(event) => onFolderValueChange(event.target.value)}
            onFocus={() => onActivate(group)}
            placeholder={t("imageReview:examplePlaceholder", { title })}
          />
        </label>
      </div>
      <div
        className={`review-image-stage${isZoomed ? " zoomed" : ""}${dragStart ? " dragging" : ""}`}
        onWheel={handleWheel}
        onDoubleClick={resetView}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="review-image-frame" ref={frameRef}>
          {image ? (
            <img
              src={image.url}
              alt={image.name}
              loading="eager"
              decoding="async"
              draggable={false}
              style={{ transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})` }}
            />
          ) : (
            <div className="review-empty-image">
              <ImageOff size={34} aria-hidden="true" />
              <span>{t("imageReview:noProductImage", { title })}</span>
            </div>
          )}
        </div>
        {group === "model" ? (
          <div className="review-check-panel" ref={checkPanelRef}>
            {issueEditorOpen ? (
              <div className="review-issue-editor">
                <textarea
                  value={issueText}
                  onChange={(event) => {
                    setIssueText(event.target.value);
                    if (issueError) setIssueError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    if (!issueSaving) void saveCurrentIssue(issueText);
                  }}
                  autoFocus
                  rows={3}
                  placeholder={t("imageReview:issuePlaceholder")}
                />
                <button className="review-issue-save-button" type="button" disabled={!image || issueSaving} onClick={() => saveCurrentIssue(issueText)}>
                  <Save size={14} aria-hidden="true" />
                  <span>{issueSaving ? t("common:states.saving") : t("common:actions.save")}</span>
                </button>
              </div>
            ) : null}
            {issueError ? <span className="review-report-error">{issueError}</span> : null}
            <div className="review-check-actions">
              <button className="button review-check-button review-check-button--issue" type="button" disabled={!image || issueSaving} onClick={openIssueEditor}>
                <Flag size={15} aria-hidden="true" />
                <span>{t("imageReview:reportIssue")}</span>
              </button>
              <button className="button review-check-button review-check-button--approve" type="button" disabled={!image || issueSaving} onClick={approveCurrentImage}>
                <CircleCheck size={15} aria-hidden="true" />
                <span>{t("imageReview:approve")}</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <ReviewThumbNav
        title={title}
        group={group}
        images={images}
        activeIndex={activeIndex}
        thumbStripRef={thumbStripRef}
        activeThumbRef={activeThumbRef}
        onActivate={onActivate}
        onSelectImage={selectImage}
        onScrollStrip={scrollThumbStrip}
        onWheel={handleThumbWheel}
      />
      <div className="review-file-meta">
        <dl>
          <div>
            <dt>{t("imageReview:file")}</dt>
            <dd title={image?.relativePath || ""}>{image?.relativePath || "-"}</dd>
          </div>
          <div>
            <dt>{t("imageReview:size")}</dt>
            <dd>{image ? formatBytes(image.size) : "-"}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}));

export function ImageReviewPage() {
  const { i18n, t } = useTranslation();
  const [selectedReviewRoot, setSelectedReviewRoot] = useState("");
  const [products, setProducts] = useState<ReviewProduct[]>([]);
  const [activeProductId, setActiveProductId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [modelFolderValue, setModelFolderValue] = useState(() => t("imageReview:defaultModelFolder"));
  const [detailFolderValue, setDetailFolderValue] = useState(() => t("imageReview:defaultDetailFolder"));
  const [activeImageGroup, setActiveImageGroup] = useState<ImageGroupKey>("detail");
  const [folderLoading, setFolderLoading] = useState(false);
  const [productImagesLoading, setProductImagesLoading] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [productListVersion, setProductListVersion] = useState(0);
  const modelPaneRef = useRef<ProductImagePaneHandle | null>(null);
  const detailPaneRef = useRef<ProductImagePaneHandle | null>(null);
  const settingsLoadedRef = useRef(false);
  const hasSavedFolderSettingsRef = useRef(false);
  const folderSettingsDirtyRef = useRef(false);

  const activeProduct = useMemo(
    () => products.find((product) => product.id === activeProductId) || products[0] || null,
    [activeProductId, products],
  );
  const modelImages = productImagesLoading ? [] : activeProduct?.modelImages || [];
  const detailImages = productImagesLoading ? [] : activeProduct?.detailImages || [];
  const productListActiveId = activeProduct?.id || "";
  const activeProductIndex = activeProduct ? products.findIndex((product) => product.id === activeProduct.id) : -1;
  const activateGroup = useCallback((group: ImageGroupKey) => {
    setActiveImageGroup((currentGroup) => (currentGroup === group ? currentGroup : group));
  }, []);
  const goActivePaneImages = useCallback((direction: -1 | 1) => {
    const pane = activeImageGroup === "model" ? modelPaneRef.current : detailPaneRef.current;
    pane?.goImages(direction);
  }, [activeImageGroup]);
  const changeModelFolderValue = useCallback((value: string) => {
    folderSettingsDirtyRef.current = true;
    setModelFolderValue(value);
  }, []);
  const changeDetailFolderValue = useCallback((value: string) => {
    folderSettingsDirtyRef.current = true;
    setDetailFolderValue(value);
  }, []);
  const scanReviewDirectory = useCallback(async (rootPath = selectedReviewRoot) => {
    setFolderError("");
    if (!rootPath) {
      setProducts([]);
      setActiveProductId("");
      setFolderError(t("imageReview:rootRequired"));
      return;
    }
    setFolderLoading(true);
    setProducts((currentProducts) =>
      currentProducts.map((product) => ({
        ...product,
        hasModelImages: false,
        modelImages: [],
        detailImages: [],
        unknownImages: [],
      })),
    );
    try {
      const nextProducts = await listReviewProducts(modelFolderValue, rootPath);
      setProducts(nextProducts);
      setActiveProductId((currentProductId) => (nextProducts.some((product) => product.id === currentProductId) ? currentProductId : nextProducts[0]?.id || ""));
      setSearchQuery("");
      setProductListVersion((version) => version + 1);
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : t("imageReview:scanFailed"));
    } finally {
      setFolderLoading(false);
    }
  }, [modelFolderValue, selectedReviewRoot]);
  const goProduct = useCallback((direction: -1 | 1) => {
    if (!products.length || activeProductIndex < 0) return;
    const nextIndex = Math.max(0, Math.min(products.length - 1, activeProductIndex + direction));
    setActiveProductId(products[nextIndex].id);
  }, [activeProductIndex, products]);
  const refreshReviewDirectory = useCallback(async () => {
    await scanReviewDirectory();
  }, [scanReviewDirectory]);

  useEffect(() => {
    let ignore = false;

    async function loadFolderSettings() {
      const settings = await window.forartConfig?.loadImageReviewSettings?.().catch(() => null);
      if (ignore) return;
      const savedModelFolders = String(settings?.modelFolders || "").trim();
      const savedDetailFolders = String(settings?.detailFolders || "").trim();
      hasSavedFolderSettingsRef.current = Boolean(savedModelFolders || savedDetailFolders);
      folderSettingsDirtyRef.current = false;
      setModelFolderValue(savedModelFolders || t("imageReview:defaultModelFolder"));
      setDetailFolderValue(savedDetailFolders || t("imageReview:defaultDetailFolder"));
      settingsLoadedRef.current = true;
    }

    void loadFolderSettings();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current || hasSavedFolderSettingsRef.current) return;
    setModelFolderValue(t("imageReview:defaultModelFolder"));
    setDetailFolderValue(t("imageReview:defaultDetailFolder"));
  }, [i18n.language, t]);

  useEffect(() => {
    if (!settingsLoadedRef.current || !folderSettingsDirtyRef.current) return;
    const timeout = window.setTimeout(() => {
      const imageReview = {
        modelFolders: modelFolderValue.trim(),
        detailFolders: detailFolderValue.trim(),
      };
      void window.forartConfig?.saveImageReviewSettings?.(imageReview).then(() => {
        hasSavedFolderSettingsRef.current = Boolean(imageReview.modelFolders || imageReview.detailFolders);
      });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [detailFolderValue, modelFolderValue]);

  useEffect(() => {
    if (!selectedReviewRoot) return;
    void scanReviewDirectory(selectedReviewRoot);
  }, [scanReviewDirectory, selectedReviewRoot]);

  useEffect(() => {
    if (!products.length) {
      setActiveProductId("");
      return;
    }
    if (!activeProductId || !products.some((product) => product.id === activeProductId)) {
      setActiveProductId(products[0].id);
    }
  }, [activeProductId, products]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (!activeProduct) return;

      if (event.key === "ArrowUp") {
        event.preventDefault();
        goProduct(-1);
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        goProduct(1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goActivePaneImages(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goActivePaneImages(1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeProduct, goActivePaneImages, goProduct]);

  useEffect(() => {
    if (!activeProductId) return;
    let ignore = false;
    setProductImagesLoading(true);
    loadProductImages(activeProductId, modelFolderValue, detailFolderValue, selectedReviewRoot)
      .then((loadedProduct) => {
        if (ignore) return;
        setProducts((currentProducts) => currentProducts.map((product) => (product.id === loadedProduct.id ? loadedProduct : product)));
      })
      .catch(() => {
        if (!ignore) setFolderError(t("imageReview:readProductImagesFailed"));
      })
      .finally(() => {
        if (!ignore) setProductImagesLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [activeProductId, detailFolderValue, modelFolderValue, productListVersion, selectedReviewRoot]);

  function selectReviewRoot(rootPath: string) {
    setSelectedReviewRoot(rootPath);
    setActiveProductId("");
    setSearchQuery("");
    setProducts([]);
    setFolderError("");
  }

  async function chooseReviewRoot() {
    setFolderError("");
    try {
      const result = await window.forartConfig?.chooseDirectory({ title: t("imageReview:chooseDirectory") });
      if (!result || result.canceled || !result.path) return;
      selectReviewRoot(result.path);
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : t("imageReview:readDirectoryFailed"));
    }
  }

  const reportIssue = useCallback(async (image: ReviewImage, issue: string) => {
    await saveReviewIssue(image, issue, selectedReviewRoot);
  }, [selectedReviewRoot]);

  const loadIssue = useCallback(async (image: ReviewImage) => {
    return loadReviewIssue(image, selectedReviewRoot);
  }, [selectedReviewRoot]);

  return (
    <section className="image-review-page" aria-labelledby="image-review-title">
      <div className="image-review-header">
        <div>
          <h1 id="image-review-title" className="model-library-title">
            {t("imageReview:title")}
          </h1>
        </div>
        <RootFolderPicker
          selectedRoot={selectedReviewRoot}
          loading={folderLoading}
          modelFolderName={modelFolderValue}
          detailFolderName={detailFolderValue}
          onChoose={chooseReviewRoot}
          onScan={refreshReviewDirectory}
        />
        {folderError ? <span className="review-directory-error">{folderError}</span> : null}
      </div>

      <div className="image-review-shell">
        <div className="review-main review-main--products">
          <ProductList
            products={products}
            activeProductId={productListActiveId}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelectProduct={setActiveProductId}
          />

          <div className="review-product-workspace">
            <div className="review-product-head">
              <div>
                <span>{t("imageReview:currentProduct")}</span>
                <strong>{activeProduct?.id || t("common:labels.notSelected")}</strong>
              </div>
            </div>

            <div className="review-compare">
              <ProductImagePane
                ref={modelPaneRef}
                title={t("imageReview:modelPaneTitle")}
                group="model"
                isActive={activeImageGroup === "model"}
                folderValue={modelFolderValue}
                images={modelImages}
                resetKey={`${activeProduct?.id || ""}:model:${productListVersion}:${productImagesLoading ? "loading" : "ready"}`}
                onFolderValueChange={changeModelFolderValue}
                onActivate={activateGroup}
                onReportIssue={reportIssue}
                onLoadIssue={loadIssue}
              />
              <ProductImagePane
                ref={detailPaneRef}
                title={t("imageReview:detailPaneTitle")}
                group="detail"
                isActive={activeImageGroup === "detail"}
                folderValue={detailFolderValue}
                images={detailImages}
                resetKey={`${activeProduct?.id || ""}:detail:${productListVersion}:${productImagesLoading ? "loading" : "ready"}`}
                onFolderValueChange={changeDetailFolderValue}
                onActivate={activateGroup}
                onReportIssue={reportIssue}
                onLoadIssue={loadIssue}
              />
            </div>
          </div>
        </div>

        <div className="review-bottom-bar">
          <button className="button secondary" type="button" disabled={!activeProduct || activeProductIndex <= 0} onClick={() => goProduct(-1)}>
            <ChevronUp size={18} aria-hidden="true" />
            <span>{t("imageReview:previousProduct")}</span>
          </button>
          <span className="review-key-hint">{t("imageReview:keyHint")}</span>
          <button className="button primary" type="button" disabled={!activeProduct || activeProductIndex >= products.length - 1} onClick={() => goProduct(1)}>
            <span>{t("imageReview:nextProduct")}</span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
