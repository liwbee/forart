import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ImageWithFallback } from "../../../components/ImageWithFallback";
import { Button } from "../../../components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../../components/ui/resizable";
import { Switch } from "../../../components/ui/switch";
import {
  ImageViewerActionButtons,
  useImageViewerDialog,
  type ImageViewerAction,
  type ImageViewerNavigation,
} from "../../../lib/ImageViewer";
import { ImageViewerSurface, type ImageViewerActivity } from "../../../lib/ImageViewerSurface";
import { cn } from "../../../lib/utils";

export interface ReferenceComparisonViewerReference {
  id: string;
  src: string;
  thumbnailSrc?: string;
  alt: string;
}

interface ReferenceComparisonImageViewerProps {
  src: string;
  alt: string;
  ariaLabel: string;
  onClose: () => void;
  actions: ImageViewerAction[];
  navigation?: ImageViewerNavigation;
  activity?: ImageViewerActivity;
  references?: ReferenceComparisonViewerReference[];
  referenceIndex?: number;
  onReferenceIndexChange?: (index: number) => void;
  comparisonEnabled: boolean;
  comparisonLabel: string;
  onComparisonEnabledChange: (enabled: boolean) => void;
  referencePanelPercent: number;
  onReferencePanelPercentChange: (percent: number) => void;
}

export function ReferenceComparisonImageViewer({
  src,
  alt,
  ariaLabel,
  onClose,
  actions,
  navigation,
  activity,
  references = [],
  referenceIndex = 0,
  onReferenceIndexChange,
  comparisonEnabled,
  comparisonLabel,
  onComparisonEnabledChange,
  referencePanelPercent,
  onReferencePanelPercentChange,
}: ReferenceComparisonImageViewerProps) {
  const { t } = useTranslation();
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const { isClosing, requestClose } = useImageViewerDialog({ sourceKey: src, onClose, navigation });
  const isResizingRef = useRef(false);
  const referenceStripRef = useRef<HTMLDivElement | null>(null);
  const hasNavigation = Boolean(navigation && navigation.total > 1);
  const safeReferenceIndex = Math.min(Math.max(0, referenceIndex), Math.max(0, references.length - 1));
  const reference = references[safeReferenceIndex];
  const showComparison = Boolean(reference && comparisonEnabled);
  const resolutionText = naturalSize.width && naturalSize.height ? `${naturalSize.width} x ${naturalSize.height}` : "";

  useEffect(() => {
    const activeThumbnail = referenceStripRef.current?.querySelector<HTMLElement>("[aria-current='true']");
    activeThumbnail?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [safeReferenceIndex]);

  const isolatePointerEvent = (event: React.SyntheticEvent) => {
    if (isResizingRef.current || (event.target as Element | null)?.closest?.("[data-separator]")) return;
    event.stopPropagation();
  };

  const resultNavigation = hasNavigation && navigation ? (
    <div className="rf-reference-comparison-viewer-result-nav-layer">
      <Button
        className="rf-reference-comparison-viewer-result-nav is-previous"
        type="button"
        variant="ghost"
        size="icon-lg"
        disabled={navigation.index <= 0}
        aria-label={navigation.previousLabel}
        title={navigation.previousLabel}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={navigation.onPrevious}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Button
        className="rf-reference-comparison-viewer-result-nav is-next"
        type="button"
        variant="ghost"
        size="icon-lg"
        disabled={navigation.index >= navigation.total - 1}
        aria-label={navigation.nextLabel}
        title={navigation.nextLabel}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={navigation.onNext}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  ) : null;

  return createPortal(
    <div
      className={cn("image-viewer-backdrop", isClosing && "closing")}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onPointerDown={isolatePointerEvent}
      onPointerUp={isolatePointerEvent}
      onPointerCancel={isolatePointerEvent}
      onWheel={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        className={cn("image-viewer-stage", "rf-reference-comparison-viewer-stage", isClosing && "closing")}
        onClick={(event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget) requestClose();
        }}
      >
        {showComparison && reference ? (
          <div className="rf-reference-comparison-viewer-layout">
            <ResizablePanelGroup
              className="rf-reference-comparison-viewer-panel-group"
              orientation="horizontal"
              defaultLayout={{ reference: referencePanelPercent, result: 100 - referencePanelPercent }}
              onLayoutChanged={(layout, meta) => {
                if (!meta.isUserInteraction) return;
                const nextPercent = layout.reference;
                if (Number.isFinite(nextPercent)) onReferencePanelPercentChange(nextPercent);
              }}
            >
              <ResizablePanel id="reference" defaultSize={`${referencePanelPercent}%`} minSize="20%">
                <div className="rf-reference-comparison-viewer-pane">
                  <ImageViewerSurface src={reference.src} alt={reference.alt} onBlankClick={requestClose} />
                  <div
                    ref={referenceStripRef}
                    className="rf-reference-comparison-viewer-reference-strip"
                    role="group"
                    aria-label={t("infiniteCanvas:referenceImages")}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onWheel={(event) => {
                      const strip = event.currentTarget;
                      if (strip.scrollWidth <= strip.clientWidth) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
                      strip.scrollBy({ left: delta, behavior: "smooth" });
                    }}
                  >
                    {references.map((item, index) => {
                      const active = index === safeReferenceIndex;
                      return (
                        <Button
                          key={item.id}
                          className={cn("rf-reference-comparison-viewer-reference-thumbnail", active && "is-active")}
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={item.alt}
                          aria-current={active ? "true" : undefined}
                          title={item.alt}
                          onClick={() => onReferenceIndexChange?.(index)}
                        >
                          <ImageWithFallback
                            src={item.thumbnailSrc || item.src}
                            fallbackSrc={item.src}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            draggable={false}
                          />
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle
                className="rf-reference-comparison-viewer-handle"
                aria-label={t("infiniteCanvas:resizeReferenceComparison")}
                onPointerDown={() => {
                  isResizingRef.current = true;
                }}
                onPointerUp={() => {
                  isResizingRef.current = false;
                }}
                onPointerCancel={() => {
                  isResizingRef.current = false;
                }}
              />
              <ResizablePanel id="result" defaultSize={`${100 - referencePanelPercent}%`} minSize="20%">
                <div className="rf-reference-comparison-viewer-pane">
                  <ImageViewerSurface src={src} alt={alt} activity={activity} onNaturalSizeChange={setNaturalSize} onBlankClick={requestClose} />
                  {resultNavigation}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        ) : (
          <>
            <ImageViewerSurface src={src} alt={alt} activity={activity} onNaturalSizeChange={setNaturalSize} onBlankClick={requestClose} />
            {resultNavigation}
          </>
        )}

        <div className="image-viewer-top-left" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <Button className="image-viewer-back-button" type="button" variant="ghost" size="icon" aria-label={t("common:actions.back")} title={t("common:actions.back")} onClick={requestClose}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <span className="image-viewer-resolution" aria-live="polite">{resolutionText}</span>
        </div>

        <div className="image-viewer-top-center" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          {hasNavigation && navigation ? <span className="image-viewer-counter">{navigation.index + 1} / {navigation.total}</span> : null}
          {references.length ? (
            <label className="rf-reference-comparison-viewer-toggle">
              <span>{comparisonLabel}</span>
              <Switch size="sm" checked={comparisonEnabled} aria-label={comparisonLabel} onCheckedChange={onComparisonEnabledChange} />
            </label>
          ) : null}
          <ImageViewerActionButtons actions={actions} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
