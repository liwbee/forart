import type { NativeCanvasNode } from "./nativeCanvas";
import { nativeCanvasNodePrimaryAsset, nativeCanvasNodePrimaryImage } from "./nativeCanvas";

export interface CanvasThumbnailTarget {
  nodeId: string;
  sourceUrl: string;
}

/**
 * Canvas previews always render the derived thumbnail and only fall back to the
 * original when no thumbnail exists. Loading full-resolution originals into the
 * canvas keeps hundreds of megabytes of decoded image data alive in the
 * renderer, which never comes back until the window is reloaded.
 */
export function canvasPreviewSourceUrl(originalUrl: unknown, thumbnailUrl: unknown): string {
  const original = String(originalUrl || "").trim();
  const thumbnail = String(thumbnailUrl || "").trim();
  return thumbnail || original;
}

export function collectMissingCanvasThumbnailTargets(nodes: NativeCanvasNode[]): CanvasThumbnailTarget[] {
  return nodes.flatMap((node) => {
    const images = node.data.kind === "assetLoader"
      ? [node.data.assetType === "video" ? nativeCanvasNodePrimaryAsset(node.data) : nativeCanvasNodePrimaryImage(node.data)]
      : node.data.kind === "imageGenerator"
        ? (node.data.generatedImages || [])
        : [];
    return images.flatMap((image) => {
      const sourceUrl = String(image?.localUrl || image?.url || "").trim();
      return sourceUrl && !image?.thumbUrl ? [{ nodeId: node.id, sourceUrl }] : [];
    });
  });
}

export function applyCanvasNodeThumbnail(
  nodes: NativeCanvasNode[],
  nodeId: string,
  sourceUrl: string,
  thumbUrl: string,
): NativeCanvasNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node;
    if (node.data.kind === "assetLoader") {
      const currentUrl = String(node.data.assetUrl || "");
      return currentUrl === sourceUrl ? { ...node, data: { ...node.data, assetThumbUrl: thumbUrl } } : node;
    }
    if (node.data.kind !== "imageGenerator") return node;
    return {
      ...node,
      data: {
        ...node.data,
        generatedImages: node.data.generatedImages?.map((result) => {
          const resultUrl = String(result.localUrl || result.url || "");
          return resultUrl === sourceUrl ? { ...result, thumbUrl } : result;
        }),
      },
    };
  });
}
