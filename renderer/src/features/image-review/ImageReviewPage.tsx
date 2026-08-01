import { PointerEvent, forwardRef, memo, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type MutableRefObject, type WheelEvent as ReactWheelEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, CircleHelp, FolderOpen, ImageOff, RefreshCw } from "lucide-react";
import { ErrorCopyLine } from "../../components/ErrorCopyLine";
import { SearchInput } from "../../components/SearchInput";
import { VirtualList, type VirtualListController } from "../../components/VirtualList";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Empty, EmptyDescription, EmptyMedia } from "../../components/ui/empty";
import { Field, FieldLabel } from "../../components/ui/field";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../components/ui/hover-card";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";

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
const FOLDER_RULE_DEBOUNCE_MS = 450;
const THUMB_SKELETON_COUNT = 5;

type ThumbScrollMomentum = {
  frame: number;
  lastTime: number;
  velocity: number;
};

type VirtualAxis = "vertical" | "horizontal";

type ProductImagePaneHandle = {
  goImages: (direction: -1 | 1) => void;
};

function useDebouncedValue<TValue>(value: TValue, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);

  return debouncedValue;
}

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

function formatResolution(width: number, height: number) {
  if (!width || !height) return "-";
  return `${width} x ${height}`;
}

function listReviewProducts(modelFolderValue: string, reviewRootPath: string, bridgeUnavailableMessage: string) {
  if (!window.forartReview?.products) return Promise.reject(new Error(bridgeUnavailableMessage));
  return window.forartReview.products({ root: reviewRootPath, modelFolders: modelFolderValue }).then((payload) => sortProducts(payload.products));
}

function loadProductImages(productId: string, modelFolderValue: string, detailFolderValue: string, reviewRootPath: string, bridgeUnavailableMessage: string) {
  if (!window.forartReview?.productImages) return Promise.reject(new Error(bridgeUnavailableMessage));
  return window.forartReview.productImages({
    root: reviewRootPath,
    productId,
    modelFolders: modelFolderValue,
    detailFolders: detailFolderValue,
  }).then((payload) => ({
    ...payload.product,
    modelImages: sortImages(payload.product.modelImages),
    detailImages: sortImages(payload.product.detailImages),
  }));
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button className="review-folder-icon-button" type="button" variant="ghost" size="icon" disabled={loading} onClick={onChoose} aria-label={t("imageReview:choose")}>
              <FolderOpen aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("imageReview:choose")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button className={`review-folder-icon-button${loading ? " is-spinning" : ""}`} type="button" variant="ghost" size="icon" disabled={loading || !selectedRoot} onClick={onScan} aria-label={t("imageReview:refresh")}>
              <RefreshCw aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("imageReview:refresh")}</TooltipContent>
        </Tooltip>
        <HoverCard openDelay={200} closeDelay={100}>
          <HoverCardTrigger asChild>
            <Button className="review-folder-guide-button" type="button" variant="ghost" size="icon" aria-label={t("imageReview:pathGuideTitle")}>
              <CircleHelp aria-hidden="true" />
            </Button>
          </HoverCardTrigger>
          <HoverCardContent className="review-folder-guide-popover" side="bottom" sideOffset={10} align="end" collisionPadding={16}>
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
          </HoverCardContent>
        </HoverCard>
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
  const productVirtualizerRef = useRef<VirtualListController | null>(null);
  const [virtualAxis, setVirtualAxis] = useState<VirtualAxis>("vertical");
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredProducts = normalizedQuery
    ? products.filter((product) => product.id.toLocaleLowerCase().includes(normalizedQuery))
    : products;
  const itemSize = virtualAxis === "vertical" ? PRODUCT_ROW_HEIGHT : PRODUCT_COLUMN_WIDTH;

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
    if (index >= 0) productVirtualizerRef.current?.scrollToIndex(index, { align: "auto" });
  }, [activeProductId, filteredProducts, itemSize, virtualAxis]);

  return (
    <aside className="review-product-list" aria-label={t("imageReview:productList")}>
      <SearchInput
        className="review-product-search"
        value={searchQuery}
        onChange={onSearchChange}
        placeholder={t("imageReview:searchProductId")}
        clearLabel={t("imageReview:clearSearch")}
      />

      <div className="review-product-list-head">
        <strong>{t("imageReview:productId")}</strong>
        <Badge variant="outline">{filteredProducts.length} / {products.length}</Badge>
      </div>

      <VirtualList
        items={filteredProducts}
        estimateSize={itemSize}
        getItemKey={(product) => product.id}
        renderItem={(product) => {
          const isActive = product.id === activeProductId;
          const missingModel = !product.hasModelImages;
          return (
            <Button
              className="review-product-item"
              type="button"
              variant={isActive ? "default" : "outline"}
              aria-current={isActive ? "true" : undefined}
              onClick={() => onSelectProduct(product.id)}
            >
              <strong>{product.id}</strong>
              {missingModel ? <Badge className="review-product-missing-badge" variant="destructive">{t("imageReview:missingModelImage")}</Badge> : null}
            </Button>
          );
        }}
        className={`review-product-items${filteredProducts.length ? "" : " is-empty"}`}
        viewportClassName="review-product-items__viewport"
        viewportRef={listRef}
        virtualizerRef={productVirtualizerRef}
        axis={virtualAxis}
        itemMode="flow"
        overscan={5}
        spacerClassName="review-product-items__spacer"
        trackClassName="review-product-items__virtual"
        scrollbars={virtualAxis === "horizontal" ? "horizontal" : "vertical"}
        empty={(
          <Empty className="review-product-empty">
            <EmptyDescription>{products.length ? t("imageReview:noMatchingProductIds") : t("imageReview:mountReviewFolders")}</EmptyDescription>
          </Empty>
        )}
      />
    </aside>
  );
});

const ReviewThumbNav = memo(function ReviewThumbNav({
  title,
  images,
  loading,
  activeIndex,
  thumbStripRef,
  onSelectImage,
  onScrollStrip,
  onWheel,
}: {
  title: string;
  images: ReviewImage[];
  loading: boolean;
  activeIndex: number;
  thumbStripRef: MutableRefObject<HTMLDivElement | null>;
  onSelectImage: (index: number) => void;
  onScrollStrip: (direction: -1 | 1) => void;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
}) {
  const { t } = useTranslation();
  const thumbVirtualizerRef = useRef<VirtualListController | null>(null);

  useEffect(() => {
    if (activeIndex >= 0) thumbVirtualizerRef.current?.scrollToIndex(activeIndex, { align: "auto" });
  }, [activeIndex]);

  return (
    <div className="review-thumb-nav">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button className="review-thumb-nav-button" type="button" variant="ghost" size="icon" aria-label={t("imageReview:scrollThumbsLeft")} disabled={loading || !images.length} onClick={() => onScrollStrip(-1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("imageReview:scrollThumbsLeft")}</TooltipContent>
      </Tooltip>
      {loading ? (
        <div className="review-thumb-loading" role="status" aria-live="polite" aria-label={t("common:states.loading")}>
          {Array.from({ length: THUMB_SKELETON_COUNT }, (_, index) => (
            <Skeleton className="review-thumb-skeleton" aria-hidden="true" key={index} />
          ))}
        </div>
      ) : (
        <VirtualList
          items={images}
          estimateSize={THUMB_ITEM_WIDTH}
          getItemKey={(image) => image.id}
          renderItem={(item, index) => (
            <Button
              className={`review-thumb-button${index === activeIndex ? " active" : ""}`}
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("imageReview:viewImage", { name: item.name })}
              aria-current={index === activeIndex ? "true" : undefined}
              onClick={() => onSelectImage(index)}
            >
              <img src={item.url} alt="" loading={index === activeIndex ? "eager" : "lazy"} decoding="async" draggable={false} />
            </Button>
          )}
          className="review-thumb-strip"
          viewportClassName="review-thumb-strip__viewport"
          viewportRef={(node) => { thumbStripRef.current = node; }}
          virtualizerRef={thumbVirtualizerRef}
          axis="horizontal"
          itemMode="flow"
          overscan={8}
          spacerClassName="review-thumb-strip__spacer"
          trackClassName="review-thumb-strip__virtual"
          scrollbars="horizontal"
          ariaLabel={t("imageReview:thumbsLabel", { title })}
          onWheel={onWheel}
          empty={(
            <Empty className="review-thumb-empty">
              <EmptyDescription>{t("imageReview:noImages")}</EmptyDescription>
            </Empty>
          )}
        />
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button className="review-thumb-nav-button" type="button" variant="ghost" size="icon" aria-label={t("imageReview:scrollThumbsRight")} disabled={loading || !images.length} onClick={() => onScrollStrip(1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("imageReview:scrollThumbsRight")}</TooltipContent>
      </Tooltip>
    </div>
  );
}, (previous, next) =>
  previous.title === next.title &&
  previous.images === next.images &&
  previous.loading === next.loading &&
  previous.activeIndex === next.activeIndex
);

const ProductImagePane = memo(forwardRef<ProductImagePaneHandle, {
  title: string;
  folderValue: string;
  images: ReviewImage[];
  loading: boolean;
  resetKey: string;
  onFolderValueChange: (value: string) => void;
}>(function ProductImagePane({
  title,
  folderValue,
  images,
  loading,
  resetKey,
  onFolderValueChange,
}, ref) {
  const { t } = useTranslation();
  const folderInputId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const image = images[activeIndex] || null;
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [imageResolution, setImageResolution] = useState({ width: 0, height: 0 });
  const [photoshopOpening, setPhotoshopOpening] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const thumbStripRef = useRef<HTMLDivElement | null>(null);
  const thumbMomentumRef = useRef<ThumbScrollMomentum>({ frame: 0, lastTime: 0, velocity: 0 });
  const isZoomed = transform.scale > 1.01;

  useEffect(() => {
    setActiveIndex(0);
    setDragStart(null);
    setTransform({ scale: 1, x: 0, y: 0 });
    setImageResolution({ width: 0, height: 0 });
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
    setImageResolution({ width: 0, height: 0 });
  }, [image?.id]);

  useEffect(() => () => stopThumbMomentum(), []);

  function resetView() {
    setTransform({ scale: 1, x: 0, y: 0 });
    setDragStart(null);
  }

  async function openInPhotoshop() {
    if (!image || photoshopOpening) return;
    if (!window.forartReview?.openInPhotoshop) {
      toast.error(t("imageReview:bridgeUnavailable"));
      return;
    }
    setPhotoshopOpening(true);
    try {
      const result = await window.forartReview.openInPhotoshop({ url: image.url });
      if (result.ok) return;
      toast.error(result.reason === "photoshop-not-found"
        ? t("imageReview:photoshopNotFound")
        : result.reason === "image-not-found"
          ? t("imageReview:imageFileNotFound")
          : t("imageReview:photoshopOpenFailed"));
    } catch {
      toast.error(t("imageReview:photoshopOpenFailed"));
    } finally {
      setPhotoshopOpening(false);
    }
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
    const strip = thumbStripRef.current;
    if (!strip) return;
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

  return (
    <section className="review-image-pane" aria-label={title} aria-busy={loading}>
      <div className="review-pane-head">
        <Field className="review-pane-folder-rule">
          <FieldLabel className="sr-only" htmlFor={folderInputId}>{title}</FieldLabel>
          <Input
            id={folderInputId}
            value={folderValue}
            onChange={(event) => onFolderValueChange(event.target.value)}
            placeholder={t("imageReview:examplePlaceholder", { title })}
          />
        </Field>
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
          {loading ? (
            <Skeleton className="review-image-skeleton" role="status" aria-live="polite" aria-label={t("common:states.loading")} />
          ) : image ? (
            <img
              src={image.url}
              alt={image.name}
              loading="eager"
              decoding="async"
              draggable={false}
              onLoad={(event) => {
                setImageResolution({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
              }}
              style={{ transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})` }}
            />
          ) : (
            <Empty className="review-empty-image">
              <EmptyMedia><ImageOff size={34} aria-hidden="true" /></EmptyMedia>
              <EmptyDescription>{t("imageReview:noProductImage", { title })}</EmptyDescription>
            </Empty>
          )}
        </div>
      </div>
      <ReviewThumbNav
        title={title}
        images={images}
        loading={loading}
        activeIndex={activeIndex}
        thumbStripRef={thumbStripRef}
        onSelectImage={selectImage}
        onScrollStrip={scrollThumbStrip}
        onWheel={handleThumbWheel}
      />
      <div className="review-file-meta">
        <dl>
          <div>
            <dt>{t("imageReview:file")}</dt>
            <dd className="review-file-path">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="review-open-photoshop-button"
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!image || photoshopOpening}
                    aria-label={t("imageReview:openInPhotoshop")}
                    onClick={openInPhotoshop}
                  >
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 128 128">
                      <path d="M0 0h128v128H0z" fill="none" />
                      <path fill="#001e36" d="M22.667 1.6h82.666C117.867 1.6 128 11.733 128 24.267v79.466c0 12.534-10.133 22.667-22.667 22.667H22.667C10.133 126.4 0 116.267 0 103.733V24.267C0 11.733 10.133 1.6 22.667 1.6" />
                      <path fill="#31a8ff" d="M45.867 33.333c-1.6 0-3.2 0-4.853.054c-1.654.053-3.201.053-4.641.107c-1.44.053-2.773.053-4.053.106c-1.227.053-2.08.053-2.987.053c-.373 0-.533.213-.533.587v54.88c0 .48.213.694.64.694h10.347c.373-.054.64-.374.586-.747v-17.12c1.013 0 1.76 0 2.294.053c.533.053 1.386.053 2.666.053c4.374 0 8.374-.48 12-1.813c3.467-1.28 6.454-3.52 8.587-6.507q3.2-4.48 3.2-11.36c0-2.4-.426-4.693-1.226-6.933A17 17 0 0 0 64 39.36a19.05 19.05 0 0 0-7.147-4.374c-2.987-1.12-6.613-1.653-10.986-1.653m1.19 10.505c1.9.036 3.75.368 5.476 1.068c1.547.587 2.827 1.654 3.734 3.04a8.8 8.8 0 0 1 1.227 4.748c0 2.346-.534 4.16-1.654 5.493c-1.174 1.333-2.667 2.347-4.373 2.827c-1.974.64-4.054.959-6.134.959h-2.827c-.64 0-1.332-.053-2.079-.106v-17.92c.373-.054 1.12-.107 2.187-.053c1.013-.054 2.239-.054 3.626-.054q.41-.01.817-.002m44.73 2.723c-3.787 0-6.934.586-9.44 1.866c-2.293 1.067-4.267 2.773-5.6 4.906c-1.173 1.974-1.814 4.16-1.814 6.454a11.45 11.45 0 0 0 1.227 5.44a13.8 13.8 0 0 0 4.054 4.533a32.6 32.6 0 0 0 7.573 3.84c2.613 1.013 4.373 1.813 5.227 2.506c.853.694 1.28 1.387 1.28 2.134c0 .96-.587 1.867-1.44 2.24c-.96.48-2.4.747-4.427.747c-2.133 0-4.267-.267-6.294-.8a22.8 22.8 0 0 1-6.613-2.613c-.16-.107-.32-.16-.48-.053c-.16.106-.213.319-.213.479v9.28c-.053.427.213.8.587 1.013a21.5 21.5 0 0 0 5.44 1.707c2.4.48 4.799.693 7.252.693c3.84 0 7.041-.586 9.654-1.706c2.4-.96 4.48-2.613 5.973-4.747a12.4 12.4 0 0 0 2.08-7.093a11.5 11.5 0 0 0-1.226-5.493c-1.014-1.814-2.454-3.307-4.214-4.427a38.6 38.6 0 0 0-8.213-3.894a49 49 0 0 1-3.787-1.76c-.693-.373-1.333-.853-1.813-1.44c-.32-.427-.533-.906-.533-1.386s.16-1.013.426-1.44c.374-.533.96-.907 1.653-1.067c1.014-.266 2.134-.427 3.2-.374c2.027 0 4 .267 5.974.694c1.814.373 3.52.96 5.12 1.814c.213.106.48.106.96 0a.66.66 0 0 0 .267-.534v-8.693c0-.214-.054-.427-.107-.64c-.107-.213-.32-.427-.533-.48A18.8 18.8 0 0 0 98.4 47.04a46 46 0 0 0-6.613-.48z" />
                    </svg>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("imageReview:openInPhotoshop")}</TooltipContent>
              </Tooltip>
              <span title={image?.relativePath || ""}>{image?.relativePath || "-"}</span>
            </dd>
          </div>
          <div>
            <dt>{t("imageReview:resolution")}</dt>
            <dd>{image ? formatResolution(imageResolution.width, imageResolution.height) : "-"}</dd>
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
  const [scannedModelFolderValue, setScannedModelFolderValue] = useState(() => t("imageReview:defaultModelFolder"));
  const initialModelFolderRef = useRef(modelFolderValue);
  const initialDetailFolderRef = useRef(detailFolderValue);
  const [folderLoading, setFolderLoading] = useState(false);
  const [productImagesLoading, setProductImagesLoading] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [productListVersion, setProductListVersion] = useState(0);
  const modelPaneRef = useRef<ProductImagePaneHandle | null>(null);
  const settingsLoadedRef = useRef(false);
  const hasSavedFolderSettingsRef = useRef(false);
  const folderSettingsDirtyRef = useRef(false);
  const debouncedModelFolderValue = useDebouncedValue(modelFolderValue, FOLDER_RULE_DEBOUNCE_MS);
  const debouncedDetailFolderValue = useDebouncedValue(detailFolderValue, FOLDER_RULE_DEBOUNCE_MS);

  const activeProduct = useMemo(
    () => products.find((product) => product.id === activeProductId) || products[0] || null,
    [activeProductId, products],
  );
  const modelImages = productImagesLoading ? [] : activeProduct?.modelImages || [];
  const detailImages = productImagesLoading ? [] : activeProduct?.detailImages || [];
  const productListActiveId = activeProduct?.id || "";
  const activeProductIndex = activeProduct ? products.findIndex((product) => product.id === activeProduct.id) : -1;
  const goModelPaneImages = useCallback((direction: -1 | 1) => {
    modelPaneRef.current?.goImages(direction);
  }, []);
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
    try {
      const nextProducts = await listReviewProducts(debouncedModelFolderValue, rootPath, t("imageReview:bridgeUnavailable"));
      setProductImagesLoading(Boolean(nextProducts.length));
      setProducts(nextProducts);
      setScannedModelFolderValue(debouncedModelFolderValue);
      setActiveProductId((currentProductId) => (nextProducts.some((product) => product.id === currentProductId) ? currentProductId : nextProducts[0]?.id || ""));
      setSearchQuery("");
      setProductListVersion((version) => version + 1);
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : t("imageReview:scanFailed"));
    } finally {
      setFolderLoading(false);
    }
  }, [debouncedModelFolderValue, selectedReviewRoot, t]);
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
      setModelFolderValue(savedModelFolders || initialModelFolderRef.current);
      setScannedModelFolderValue(savedModelFolders || initialModelFolderRef.current);
      setDetailFolderValue(savedDetailFolders || initialDetailFolderRef.current);
      settingsLoadedRef.current = true;
    }

    void loadFolderSettings();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current || hasSavedFolderSettingsRef.current) return;
    const defaultModelFolder = t("imageReview:defaultModelFolder");
    setModelFolderValue(defaultModelFolder);
    setScannedModelFolderValue(defaultModelFolder);
    setDetailFolderValue(t("imageReview:defaultDetailFolder"));
  }, [i18n.language, t]);

  useEffect(() => {
    if (!settingsLoadedRef.current || !folderSettingsDirtyRef.current) return;
    const imageReview = {
      modelFolders: debouncedModelFolderValue.trim(),
      detailFolders: debouncedDetailFolderValue.trim(),
    };
    void window.forartConfig?.saveImageReviewSettings?.(imageReview).then(() => {
      hasSavedFolderSettingsRef.current = Boolean(imageReview.modelFolders || imageReview.detailFolders);
    });
  }, [debouncedDetailFolderValue, debouncedModelFolderValue, t]);

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
        goModelPaneImages(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goModelPaneImages(1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeProduct, goModelPaneImages, goProduct]);

  useEffect(() => {
    if (!activeProductId) return;
    let ignore = false;
    setProductImagesLoading(true);
    loadProductImages(activeProductId, scannedModelFolderValue, debouncedDetailFolderValue, selectedReviewRoot, t("imageReview:bridgeUnavailable"))
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
  }, [activeProductId, debouncedDetailFolderValue, productListVersion, scannedModelFolderValue, selectedReviewRoot, t]);

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
      const result = await window.forartReview?.chooseRoot?.({ title: t("imageReview:chooseDirectory") });
      if (!result || result.canceled || !result.path) return;
      selectReviewRoot(result.path);
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : t("imageReview:readDirectoryFailed"));
    }
  }

  return (
    <section className="image-review-page" aria-labelledby="image-review-title">
      <div className="image-review-header">
        <h1 id="image-review-title" className="library-title image-review-title">
          {t("imageReview:title")}
        </h1>
        <RootFolderPicker
          selectedRoot={selectedReviewRoot}
          loading={folderLoading}
          modelFolderName={modelFolderValue}
          detailFolderName={detailFolderValue}
          onChoose={chooseReviewRoot}
          onScan={refreshReviewDirectory}
        />
        {folderError ? <ErrorCopyLine className="review-directory-error" text={folderError} /> : null}
      </div>

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
              folderValue={modelFolderValue}
              images={modelImages}
              loading={productImagesLoading}
              resetKey={`${activeProduct?.id || ""}:model:${productListVersion}:${productImagesLoading ? "loading" : "ready"}`}
              onFolderValueChange={changeModelFolderValue}
            />
            <ProductImagePane
              title={t("imageReview:detailPaneTitle")}
              folderValue={detailFolderValue}
              images={detailImages}
              loading={productImagesLoading}
              resetKey={`${activeProduct?.id || ""}:detail:${productListVersion}:${productImagesLoading ? "loading" : "ready"}`}
              onFolderValueChange={changeDetailFolderValue}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
