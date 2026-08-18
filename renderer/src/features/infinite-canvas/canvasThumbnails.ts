import type { NativeCanvasNode } from "./nativeCanvas";
import { nativeCanvasNodePrimaryImage } from "./nativeCanvas";

export interface CanvasThumbnailTarget {
  nodeId: string;
  sourceUrl: string;
}

/** Prefer the derived thumbnail, but keep small/SVG/failed thumbnails visible. */
export function canvasPreviewSourceUrl(originalUrl: unknown, thumbnailUrl: unknown): string {
  return String(thumbnailUrl || originalUrl || "").trim();
}

export function collectMissingCanvasThumbnailTargets(nodes: NativeCanvasNode[]): CanvasThumbnailTarget[] {
  return nodes.flatMap((node) => {
    const images = node.data.kind === "imageLoader"
      ? [nativeCanvasNodePrimaryImage(node.data)]
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
    if (node.data.kind === "imageLoader") {
      const currentUrl = String(node.data.imageUrl || "");
      return currentUrl === sourceUrl ? { ...node, data: { ...node.data, thumbUrl } } : node;
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
