import { PointerEvent, forwardRef, memo, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type MutableRefObject, type WheelEvent as ReactWheelEvent } from "react";
import { useTranslation } from "react-i18next";
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
            <dd title={image?.relativePath || ""}>{image?.relativePath || "-"}</dd>
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
