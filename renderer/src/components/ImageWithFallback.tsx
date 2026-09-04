import { forwardRef, useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { initialImageSource, nextImageSourceAfterError } from "./imageSourceFallback";

interface ImageWithFallbackProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src?: string;
  fallbackSrc?: string;
  /** Keep the currently visible source until a changed source is loaded. */
  deferSourceChange?: boolean;
}

export const ImageWithFallback = forwardRef<HTMLImageElement, ImageWithFallbackProps>(function ImageWithFallback({
  src,
  fallbackSrc,
  deferSourceChange = false,
  onError,
  ...props
}, ref) {
  const primarySource = initialImageSource(src, fallbackSrc);
  const [activeSource, setActiveSource] = useState(primarySource);
  const activeSourceRef = useRef(activeSource);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const currentSource = activeSourceRef.current;
    if (!deferSourceChange || !currentSource || !primarySource || currentSource === primarySource) {
      activeSourceRef.current = primarySource;
      setActiveSource(primarySource);
      return;
    }

    const requestId = ++requestIdRef.current;
    let canceled = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const decoded = typeof image.decode === "function" ? image.decode() : Promise.resolve();
      void decoded.catch(() => undefined).finally(() => {
        if (canceled || requestId !== requestIdRef.current) return;
        activeSourceRef.current = primarySource;
        setActiveSource(primarySource);
      });
    };
    image.onerror = () => {
      if (canceled || requestId !== requestIdRef.current) return;
      const fallback = nextImageSourceAfterError(primarySource, fallbackSrc);
      if (fallback && fallback !== currentSource) {
        activeSourceRef.current = fallback;
        setActiveSource(fallback);
      }
    };
    image.src = primarySource;
    return () => {
      canceled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [deferSourceChange, fallbackSrc, primarySource]);

  if (!activeSource) return null;
  return (
    <img
      {...props}
      ref={ref}
      src={activeSource}
      onError={(event) => {
        const nextSource = nextImageSourceAfterError(activeSource, fallbackSrc);
        if (nextSource) {
          activeSourceRef.current = nextSource;
          setActiveSource(nextSource);
          return;
        }
        onError?.(event);
      }}
    />
  );
});
