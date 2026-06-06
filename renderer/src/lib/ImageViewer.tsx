import { useEffect, useRef, useState } from "react";
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
  const [isDragging, setIsDragging] = useState(false);
  const loadTokenRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  useEffect(() => {
    const loadToken = loadTokenRef.current + 1;
    loadTokenRef.current = loadToken;
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
    };
    image.onerror = () => {
      if (loadTokenRef.current !== loadToken) return;
      setNaturalSize({ width: 0, height: 0 });
      setTransform({ scale: 1, minScale: 0.5, x: 0, y: 0 });
    };
    image.src = src;
  }, [src]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
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
    };
    setIsDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    setTransform((currentTransform) => ({
      ...currentTransform,
      x: drag.startPanX + deltaX,
      y: drag.startPanY + deltaY,
    }));
  }

  function stopDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
  }

  return createPortal(
    <div className="model-image-viewer-backdrop" role="dialog" aria-modal="true" aria-label={ariaLabel || t("shared.imagePreview")}>
      <div className={`model-image-viewer-stage${isDragging ? " dragging" : ""}`} onClick={onClose}>
        <div
          className="model-image-viewer"
          style={{
            width: naturalSize.width || undefined,
            height: naturalSize.height || undefined,
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
        <button
          className="model-image-viewer-close"
          type="button"
          aria-label={t("common.actions.back")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
