import { Images } from "lucide-react";
import { ImageWithFallback } from "../../../components/ImageWithFallback";
import { cn } from "../../../lib/utils";
import { canvasPreviewSourceUrl } from "../canvasThumbnails";

export function GenerationMediaPreview({ src, thumbSrc, alt, preferOriginal = false, className, onClick, onKeyDown }: {
  src?: string;
  thumbSrc?: string;
  alt: string;
  preferOriginal?: boolean;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const original = src || "";
  const preview = canvasPreviewSourceUrl(original, thumbSrc, preferOriginal);
  const fallback = preferOriginal ? (thumbSrc || original) : original;
  const viewable = Boolean(original);
  return (
    <div className={cn(className, viewable && "is-viewable")} role={viewable ? "button" : undefined} tabIndex={viewable ? 0 : undefined} aria-label={viewable ? alt : undefined} onClick={onClick} onKeyDown={onKeyDown}>
      {preview ? <ImageWithFallback src={preview} fallbackSrc={fallback} deferSourceChange alt={alt} loading="lazy" decoding="async" draggable={false} /> : <Images aria-hidden="true" />}
    </div>
  );
}
