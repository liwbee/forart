import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";

interface ReferenceImageHoverPreviewProps extends HTMLAttributes<HTMLDivElement> {
  previewSrc: string;
  previewAlt: string;
  children: ReactNode;
}

interface PreviewStyle {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PREVIEW_MAX_WIDTH = 260;
const PREVIEW_MAX_HEIGHT = 320;
const PREVIEW_FALLBACK_WIDTH = 220;
const PREVIEW_FALLBACK_HEIGHT = 220;
const PREVIEW_GAP = 10;
const VIEWPORT_PADDING = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function ReferenceImageHoverPreview({
  previewSrc,
  previewAlt,
  children,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: ReferenceImageHoverPreviewProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<PreviewStyle | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const rawWidth = imageSize?.width || PREVIEW_FALLBACK_WIDTH;
    const rawHeight = imageSize?.height || PREVIEW_FALLBACK_HEIGHT;
    const scale = Math.min(PREVIEW_MAX_WIDTH / rawWidth, PREVIEW_MAX_HEIGHT / rawHeight, 1);
    const width = Math.max(80, Math.round(rawWidth * scale));
    const height = Math.max(80, Math.round(rawHeight * scale));
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
    const left = clamp(rect.left + rect.width / 2 - width / 2, VIEWPORT_PADDING, maxLeft);
    const top = clamp(
      rect.top - PREVIEW_GAP - height,
      VIEWPORT_PADDING,
      Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING),
    );
    setStyle({ left, top, width, height });
  }, [imageSize]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  return (
    <div
      {...props}
      ref={anchorRef}
      onMouseEnter={(event) => {
        if (previewSrc) {
          updatePosition();
          setOpen(true);
        }
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setOpen(false);
        onMouseLeave?.(event);
      }}
      onFocus={(event) => {
        if (previewSrc) {
          updatePosition();
          setOpen(true);
        }
        onFocus?.(event);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        onBlur?.(event);
      }}
    >
      {children}
      {open && style && typeof document !== "undefined" ? createPortal(
        <div
          className="ic-reference-image-preview nodrag nopan nowheel"
          style={{ left: style.left, top: style.top, width: style.width, height: style.height }}
          role="tooltip"
        >
          <img
            src={previewSrc}
            alt={previewAlt}
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              if (!image.naturalWidth || !image.naturalHeight) return;
              setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
            }}
          />
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
