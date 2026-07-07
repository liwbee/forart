export interface ImageThumbnailResult {
  dataUrl: string;
  width: number;
  height: number;
}

export interface ImageThumbnailOptions {
  scale?: number;
  maxLongEdge?: number;
  minLongEdge?: number;
  quality?: number;
}

const DEFAULT_THUMBNAIL_OPTIONS = {
  scale: 0.5,
  maxLongEdge: 1280,
  minLongEdge: 512,
  quality: 0.78,
};

function isSvgImage(source: { name?: string; type?: string; dataUrl?: string; url?: string }) {
  return source.type === "image/svg+xml"
    || /\.svg(?:$|[?#])/i.test(source.name || "")
    || /^data:image\/svg\+xml/i.test(source.dataUrl || source.url || "");
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load thumbnail source."));
    image.decoding = "async";
    image.src = url;
  });
}

function canvasToWebpDataUrl(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode WebP thumbnail."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Failed to read WebP thumbnail."));
      reader.readAsDataURL(blob);
    }, "image/webp", quality);
  });
}

function targetSize(width: number, height: number, options: Required<ImageThumbnailOptions>) {
  const longEdge = Math.max(width, height);
  if (!Number.isFinite(longEdge) || longEdge <= 0 || longEdge < options.minLongEdge) return null;
  const targetLongEdge = Math.min(Math.round(longEdge * options.scale), options.maxLongEdge);
  if (targetLongEdge >= longEdge) return null;
  const ratio = targetLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export async function createImageThumbnail(
  source: { dataUrl?: string; url?: string; name?: string; type?: string },
  options: ImageThumbnailOptions = {},
): Promise<ImageThumbnailResult | null> {
  if (typeof document === "undefined") return null;
  if (isSvgImage(source)) return null;

  const url = source.dataUrl || source.url || "";
  if (!url) return null;

  const resolvedOptions: Required<ImageThumbnailOptions> = {
    ...DEFAULT_THUMBNAIL_OPTIONS,
    ...options,
  };

  try {
    const image = await loadImage(url);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const size = targetSize(width, height, resolvedOptions);
    if (!size) return null;

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.clearRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);

    return {
      dataUrl: await canvasToWebpDataUrl(canvas, resolvedOptions.quality),
      width: size.width,
      height: size.height,
    };
  } catch {
    return null;
  }
}
