import { forwardRef, useEffect, useState, type ImgHTMLAttributes } from "react";
import { initialImageSource, nextImageSourceAfterError } from "./imageSourceFallback";

interface ImageWithFallbackProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src?: string;
  fallbackSrc?: string;
}

export const ImageWithFallback = forwardRef<HTMLImageElement, ImageWithFallbackProps>(function ImageWithFallback({
  src,
  fallbackSrc,
  onError,
  ...props
}, ref) {
  const primarySource = initialImageSource(src, fallbackSrc);
  const [activeSource, setActiveSource] = useState(primarySource);

  useEffect(() => setActiveSource(primarySource), [fallbackSrc, primarySource]);

  if (!activeSource) return null;
  return (
    <img
      {...props}
      ref={ref}
      src={activeSource}
      onError={(event) => {
        const nextSource = nextImageSourceAfterError(activeSource, fallbackSrc);
        if (nextSource) {
          setActiveSource(nextSource);
          return;
        }
        onError?.(event);
      }}
    />
  );
});
