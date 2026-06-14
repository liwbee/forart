import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface ImageViewerProps {
  src: string;
  alt: string;
  ariaLabel?: string;
  onClose: () => void;
}

export function ImageViewer({ src, alt, ariaLabel, onClose }: ImageViewerProps) {
  const { t } = useTranslation();
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState({ scale: 1, minScale: 0.5, x: 0, y: 0 });
  const [isReady, setIsReady] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const loadTokenRef = useRef(0);
  const closeTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null>(null);
  const suppressBackdropClickRef = useRef(false);

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
    const loadToken = loadTokenRef.current + 1;
    loadTokenRef.current = loadToken;
    setIsReady(false);
    setIsClosing(false);
    setNaturalSize({ width: 0, height: 0 });
    setTransform({ scale: 1, minScale: 0.5, x: 0, y: 0 });
    setIsDragging(false);
    dragRef.current = null;

    const image = new Image();
    image.onload = () => {
      if (loadTokenRef.current !== loadToken) return;
      const viewportPadding = 96;
      const maxWidth = Math.max(320, window.innerWidth - viewportPadding);
      const maxHeight = Math.max(240, window.innerHeight - viewportPadding);
      const fitScale = Number(Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1).toFixed(3));
      setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
      setTransform({
        scale: fitScale,
        minScale: Math.min(fitScale, 0.5),
        x: Math.round((window.innerWidth - image.naturalWidth * fitScale) / 2),
        y: Math.round((window.innerHeight - image.naturalHeight * fitScale) / 2),
      });
      setIsReady(true);
    };
    image.onerror = () => {
      if (loadTokenRef.current !== loadToken) return;
      setNaturalSize({ width: 0, height: 0 });
      setTransform({ scale: 1, minScale: 0.5, x: 0, y: 0 });
      setIsReady(false);
    };
    image.src = src;
  }, [src]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const stageRect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!stageRect?.width || !stageRect.height) return;
    const pointerX = event.clientX - stageRect.left;
    const pointerY = event.clientY - stageRect.top;
    const scaleFactor = Math.exp(-event.deltaY * 0.0015);
    setTransform((currentTransform) => {
      const nextScale = Number(Math.max(currentTransform.minScale, Math.min(4, currentTransform.scale * scaleFactor)).toFixed(3));
      const ratio = nextScale / currentTransform.scale;
      return {
        ...currentTransform,
        scale: nextScale,
        x: pointerX - (pointerX - currentTransform.x) * ratio,
        y: pointerY - (pointerY - currentTransform.y) * ratio,
      };
    });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: transform.x,
      startPanY: transform.y,
      moved: false,
    };
    setIsDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) drag.moved = true;
    setTransform((currentTransform) => ({
      ...currentTransform,
      x: drag.startPanX + deltaX,
      y: drag.startPanY + deltaY,
    }));
  }

  function stopDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    suppressBackdropClickRef.current = drag.moved;
    if (drag.moved) {
      window.setTimeout(() => {
        suppressBackdropClickRef.current = false;
      }, 0);
    }
    dragRef.current = null;
    setIsDragging(false);
  }

  function handleBlankClick(event: React.MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.target !== event.currentTarget) return;
    if (suppressBackdropClickRef.current) {
      suppressBackdropClickRef.current = false;
      return;
    }
    requestClose();
  }

  function isolateViewerEvent(event: React.SyntheticEvent) {
    event.stopPropagation();
  }

  function blockViewerWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function blockViewerContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  return createPortal(
    <div
      className={`model-image-viewer-backdrop${isClosing ? " closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || t("shared.imagePreview")}
      onPointerDown={isolateViewerEvent}
      onPointerMove={isolateViewerEvent}
      onPointerUp={isolateViewerEvent}
      onPointerCancel={isolateViewerEvent}
      onWheel={blockViewerWheel}
      onContextMenu={blockViewerContextMenu}
      onClick={handleBlankClick}
    >
      <div
        className={`model-image-viewer-stage${isDragging ? " dragging" : ""}${isClosing ? " closing" : ""}`}
        onPointerDown={isolateViewerEvent}
        onPointerMove={isolateViewerEvent}
        onPointerUp={isolateViewerEvent}
        onPointerCancel={isolateViewerEvent}
        onWheel={blockViewerWheel}
        onContextMenu={blockViewerContextMenu}
        onClick={handleBlankClick}
      >
        {isReady ? (
          <div
            className="model-image-viewer"
            style={{
              width: naturalSize.width,
              height: naturalSize.height,
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
            }}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
            onClick={(event) => event.stopPropagation()}
          >
            <img src={src} alt={alt} draggable={false} onDragStart={(event) => event.preventDefault()} />
          </div>
        ) : null}
        <button
          className="model-image-viewer-close"
          type="button"
          aria-label={t("common.actions.back")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            requestClose();
          }}
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
