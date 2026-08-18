import { ImgHTMLAttributes, useEffect, useRef, useState } from "react";
import { initialImageSource, nextImageSourceAfterError } from "./imageSourceFallback";

type LazyImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "loading" | "decoding"> & {
  src: string;
  fallbackSrc?: string;
  rootMargin?: string;
};

export function LazyImage({ src, fallbackSrc, rootMargin = "360px", onLoad, onError, style, ...props }: LazyImageProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const primarySource = initialImageSource(src, fallbackSrc);
  const [activeSource, setActiveSource] = useState(primarySource);

  useEffect(() => {
    setReady(false);
    setLoaded(false);
    setActiveSource(primarySource);
  }, [fallbackSrc, primarySource]);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || ready) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setReady(true);
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setReady(true);
      observer.disconnect();
    }, { rootMargin });

    observer.observe(image);
    return () => observer.disconnect();
  }, [activeSource, ready, rootMargin]);

  return (
    <img
      ref={imageRef}
      src={ready ? activeSource : undefined}
      data-src={ready ? undefined : activeSource}
      loading="lazy"
      decoding="async"
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        setLoaded(false);
        const nextSource = nextImageSourceAfterError(activeSource, fallbackSrc);
        if (nextSource) {
          setActiveSource(nextSource);
          return;
        }
        onError?.(event);
      }}
      style={{
        ...style,
        opacity: loaded ? style?.opacity : 0,
        transition: style?.transition || "opacity 180ms ease",
      }}
      {...props}
    />
  );
}
