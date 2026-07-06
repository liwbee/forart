import { ImgHTMLAttributes, useEffect, useRef, useState } from "react";

type LazyImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "loading" | "decoding"> & {
  src: string;
  rootMargin?: string;
};

export function LazyImage({ src, rootMargin = "360px", onLoad, onError, style, ...props }: LazyImageProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setReady(false);
    setLoaded(false);
  }, [src]);

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
  }, [ready, rootMargin, src]);

  return (
    <img
      ref={imageRef}
      src={ready ? src : undefined}
      data-src={ready ? undefined : src}
      loading="lazy"
      decoding="async"
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        setLoaded(false);
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
