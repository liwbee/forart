import { useEffect, useRef, useState } from "react";
import { cn } from "./utils";

export interface ImageViewerActivity {
  state: "queued" | "running";
  label: string;
}

interface ImageViewerSurfaceProps {
  src: string;
  alt: string;
  activity?: ImageViewerActivity;
  onNaturalSizeChange?: (size: { width: number; height: number }) => void;
  onBlankClick: () => void;
}

export function ImageViewerSurface({ src, alt, activity, onNaturalSizeChange, onBlankClick }: ImageViewerSurfaceProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const loadTokenRef = useRef(0);
  const fittedSourceRef = useRef("");
  const hasUserTransformRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState({ scale: 1, minScale: 0.5, x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () => {
      const bounds = viewport.getBoundingClientRect();
      setViewportSize({ width: bounds.width, height: bounds.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const loadToken = loadTokenRef.current + 1;
    loadTokenRef.current = loadToken;
    fittedSourceRef.current = "";
    hasUserTransformRef.current = false;
    setNaturalSize({ width: 0, height: 0 });
    setIsDragging(false);
    dragRef.current = null;
    onNaturalSizeChange?.({ width: 0, height: 0 });

    const image = new Image();
    image.onload = () => {
      if (loadTokenRef.current !== loadToken) return;
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      setNaturalSize(size);
      onNaturalSizeChange?.(size);
    };
    image.onerror = () => {
      if (loadTokenRef.current !== loadToken) return;
      setNaturalSize({ width: 0, height: 0 });
      onNaturalSizeChange?.({ width: 0, height: 0 });
    };
    image.src = src;
  }, [onNaturalSizeChange, src]);

  useEffect(() => {
    if (!naturalSize.width || !naturalSize.height || !viewportSize.width || !viewportSize.height) return;
    const inset = 24;
    const availableWidth = Math.max(1, viewportSize.width - inset * 2);
    const availableHeight = Math.max(1, viewportSize.height - inset * 2);
    const fitScale = Number(Math.min(
      availableWidth / naturalSize.width,
      availableHeight / naturalSize.height,
      1,
    ).toFixed(3));
    const minScale = Math.min(fitScale, 0.5);
    if (fittedSourceRef.current !== src || !hasUserTransformRef.current) {
      fittedSourceRef.current = src;
      setTransform({
        scale: fitScale,
        minScale,
        x: Math.round((viewportSize.width - naturalSize.width * fitScale) / 2),
        y: Math.round((viewportSize.height - naturalSize.height * fitScale) / 2),
      });
      return;
    }
    setTransform((current) => current.minScale === minScale ? current : { ...current, minScale });
  }, [naturalSize.height, naturalSize.width, src, viewportSize.height, viewportSize.width]);

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const viewportBounds = viewportRef.current?.getBoundingClientRect();
    if (!viewportBounds?.width || !viewportBounds.height) return;
    const pointerX = event.clientX - viewportBounds.left;
    const pointerY = event.clientY - viewportBounds.top;
    const scaleFactor = Math.exp(-event.deltaY * 0.0015);
    hasUserTransformRef.current = true;
    setTransform((current) => {
      const nextScale = Number(Math.max(current.minScale, Math.min(4, current.scale * scaleFactor)).toFixed(3));
      const ratio = nextScale / current.scale;
      return {
        ...current,
        scale: nextScale,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
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
    event.stopPropagation();
    hasUserTransformRef.current = true;
    setTransform((current) => ({
      ...current,
      x: drag.startPanX + event.clientX - drag.startX,
      y: drag.startPanY + event.clientY - drag.startY,
    }));
  }

  function stopDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    setIsDragging(false);
  }

  return (
    <div
      ref={viewportRef}
      className={cn("model-image-viewer-viewport", isDragging && "dragging")}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onBlankClick();
      }}
    >
      {naturalSize.width && naturalSize.height ? (
        <div
          className={cn("model-image-viewer", activity?.state === "running" && "is-generating")}
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
      {activity?.state === "running" ? (
        <div className="model-image-viewer-activity" role="status" aria-live="polite">
          {activity.label}
        </div>
      ) : null}
    </div>
  );
}
