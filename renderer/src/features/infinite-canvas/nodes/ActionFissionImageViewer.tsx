import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../../components/ui/resizable";
import { Switch } from "../../../components/ui/switch";
import {
  ImageViewer,
  ImageViewerActionButtons,
  type ImageViewerAction,
  type ImageViewerNavigation,
} from "../../../lib/ImageViewer";
import { ImageViewerSurface, type ImageViewerActivity } from "../../../lib/ImageViewerSurface";
import { cn } from "../../../lib/utils";

interface ActionFissionViewerReference {
  src: string;
  alt: string;
  navigation: ImageViewerNavigation;
}

interface ActionFissionImageViewerProps {
  kind: "result" | "action";
  src: string;
  alt: string;
  ariaLabel: string;
  onClose: () => void;
  actions: ImageViewerAction[];
  navigation?: ImageViewerNavigation;
  activity?: ImageViewerActivity;
  reference?: ActionFissionViewerReference;
  comparisonEnabled: boolean;
  comparisonLabel: string;
  onComparisonEnabledChange: (enabled: boolean) => void;
  referencePanelPercent: number;
  onReferencePanelPercentChange: (percent: number) => void;
}

export function ActionFissionImageViewer({
  kind,
  src,
  alt,
  ariaLabel,
  onClose,
  actions,
  navigation,
  activity,
  reference,
  comparisonEnabled,
  comparisonLabel,
  onComparisonEnabledChange,
  referencePanelPercent,
  onReferencePanelPercentChange,
}: ActionFissionImageViewerProps) {
  const { t } = useTranslation();
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const isResizingRef = useRef(false);
  const hasNavigation = Boolean(navigation && navigation.total > 1);
  const showComparison = Boolean(reference && comparisonEnabled);
  const resolutionText = naturalSize.width && naturalSize.height ? `${naturalSize.width} x ${naturalSize.height}` : "";

  const requestClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 180);
  }, [isClosing, onClose]);

  useEffect(() => {
    setIsClosing(false);
  }, [src]);

  useEffect(() => {
    if (kind !== "result") return;
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        requestClose();
        return;
      }
      if (!navigation || navigation.total <= 1) return;
      if (event.key === "ArrowLeft" && navigation.index > 0) {
        event.preventDefault();
        navigation.onPrevious();
        return;
      }
      if (event.key === "ArrowRight" && navigation.index < navigation.total - 1) {
        event.preventDefault();
        navigation.onNext();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [kind, navigation, requestClose]);

  useEffect(() => {
    if (kind !== "result") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      document.body.style.overflow = previousOverflow;
    };
  }, [kind]);

  if (kind === "action") {
    return (
      <ImageViewer
        src={src}
        alt={alt}
        ariaLabel={ariaLabel}
        onClose={onClose}
        actions={actions}
        navigation={navigation}
      />
    );
  }

  const isolatePointerEvent = (event: React.SyntheticEvent) => {
    if (isResizingRef.current || (event.target as Element | null)?.closest?.("[data-separator]")) return;
    event.stopPropagation();
  };

  const resultNavigation = hasNavigation && navigation ? (
    <div className="rf-action-fission-viewer-result-nav-layer">
      <Button
        className="rf-action-fission-viewer-result-nav is-previous"
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
        className="rf-action-fission-viewer-result-nav is-next"
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
      className={cn("model-image-viewer-backdrop", isClosing && "closing")}
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
        className={cn("model-image-viewer-stage", "rf-action-fission-viewer-stage", isClosing && "closing")}
        onClick={(event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget) requestClose();
        }}
      >
        {showComparison && reference ? (
          <div className="rf-action-fission-viewer-layout">
            <ResizablePanelGroup
              className="rf-action-fission-viewer-panel-group"
              orientation="horizontal"
              defaultLayout={{ reference: referencePanelPercent, result: 100 - referencePanelPercent }}
              onLayoutChanged={(layout, meta) => {
                if (!meta.isUserInteraction) return;
                const nextPercent = layout.reference;
                if (Number.isFinite(nextPercent)) onReferencePanelPercentChange(nextPercent);
              }}
            >
              <ResizablePanel id="reference" defaultSize={`${referencePanelPercent}%`} minSize="20%">
                <div className="rf-action-fission-viewer-pane">
                  <ImageViewerSurface src={reference.src} alt={reference.alt} onBlankClick={requestClose} />
                  <div className="rf-action-fission-viewer-reference-nav" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={reference.navigation.index <= 0} aria-label={reference.navigation.previousLabel} title={reference.navigation.previousLabel} onClick={reference.navigation.onPrevious}>
                      <ChevronLeft aria-hidden="true" />
                    </Button>
                    <span>{reference.navigation.index + 1} / {reference.navigation.total}</span>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={reference.navigation.index >= reference.navigation.total - 1} aria-label={reference.navigation.nextLabel} title={reference.navigation.nextLabel} onClick={reference.navigation.onNext}>
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle
                className="rf-action-fission-viewer-handle"
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
                <div className="rf-action-fission-viewer-pane">
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

        <div className="model-image-viewer-top-left" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <Button className="model-image-viewer-back-button" type="button" variant="ghost" size="icon" aria-label={t("common:actions.back")} title={t("common:actions.back")} onClick={requestClose}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <span className="model-image-viewer-resolution" aria-live="polite">{resolutionText}</span>
        </div>

        <div className="model-image-viewer-top-center" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          {hasNavigation && navigation ? <span className="model-image-viewer-counter">{navigation.index + 1} / {navigation.total}</span> : null}
          {reference ? (
            <label className="rf-action-fission-viewer-toggle">
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
