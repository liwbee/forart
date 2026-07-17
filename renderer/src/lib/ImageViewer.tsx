import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Shuffle } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { ImageViewerSurface, type ImageViewerActivity } from "./ImageViewerSurface";
import { cn } from "./utils";

export interface ImageViewerNavigation {
  index: number;
  total: number;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
}

export interface ImageViewerAction {
  id: string;
  label: string;
  icon: "refresh" | "shuffle";
  disabled?: boolean;
  onClick: () => void;
}

interface ImageViewerProps {
  src: string;
  alt: string;
  ariaLabel?: string;
  onClose: () => void;
  navigation?: ImageViewerNavigation;
  actions?: ImageViewerAction[];
  activity?: ImageViewerActivity;
}

function actionIcon(icon: ImageViewerAction["icon"]) {
  if (icon === "shuffle") return <Shuffle data-icon="inline-start" aria-hidden="true" />;
  return <RefreshCw data-icon="inline-start" aria-hidden="true" />;
}

export function ImageViewerActionButtons({ actions }: { actions: ImageViewerAction[] }) {
  return actions.map((action) => (
    <Button
      key={action.id}
      className="model-image-viewer-tool-button"
      type="button"
      variant="ghost"
      aria-label={action.label}
      title={action.label}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      {actionIcon(action.icon)}
      <span className="model-image-viewer-tool-button__label">{action.label}</span>
    </Button>
  ));
}

export function ImageViewer({ src, alt, ariaLabel, onClose, navigation, actions = [], activity }: ImageViewerProps) {
  const { t } = useTranslation();
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const hasNavigation = Boolean(navigation && navigation.total > 1);
  const canNavigatePrevious = Boolean(navigation && navigation.index > 0);
  const canNavigateNext = Boolean(navigation && navigation.index < navigation.total - 1);
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
  }, [navigation, requestClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return createPortal(
    <div
      className={cn("model-image-viewer-backdrop", isClosing && "closing")}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || t("shared:imagePreview")}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
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
        className={cn("model-image-viewer-stage", isClosing && "closing")}
        onClick={(event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget) requestClose();
        }}
      >
        <ImageViewerSurface
          src={src}
          alt={alt}
          activity={activity}
          onNaturalSizeChange={setNaturalSize}
          onBlankClick={requestClose}
        />
        <div className="model-image-viewer-top-left" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <Button className="model-image-viewer-back-button" type="button" variant="ghost" size="icon" aria-label={t("common:actions.back")} title={t("common:actions.back")} onClick={requestClose}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <span className="model-image-viewer-resolution" aria-live="polite">{resolutionText}</span>
        </div>
        {(actions.length || hasNavigation) ? (
          <div className="model-image-viewer-top-center" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            {hasNavigation && navigation ? <span className="model-image-viewer-counter">{navigation.index + 1} / {navigation.total}</span> : null}
            <ImageViewerActionButtons actions={actions} />
          </div>
        ) : null}
        {hasNavigation && navigation ? (
          <>
            <Button className="model-image-viewer-nav model-image-viewer-nav--previous" type="button" variant="ghost" size="icon-lg" disabled={!canNavigatePrevious} aria-label={navigation.previousLabel} title={navigation.previousLabel} onPointerDown={(event) => event.stopPropagation()} onClick={navigation.onPrevious}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button className="model-image-viewer-nav model-image-viewer-nav--next" type="button" variant="ghost" size="icon-lg" disabled={!canNavigateNext} aria-label={navigation.nextLabel} title={navigation.nextLabel} onPointerDown={(event) => event.stopPropagation()} onClick={navigation.onNext}>
              <ChevronRight aria-hidden="true" />
            </Button>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
