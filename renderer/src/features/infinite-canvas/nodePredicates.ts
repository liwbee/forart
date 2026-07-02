import type { CanvasNode } from "./types";

type ImageLikeCanvasNode = CanvasNode & { type: "imageLoader" | "imageGenerator" | "libtvImageGenerator" };

export function acceptsIncomingConnections(node: CanvasNode) {
  return node.type !== "imageLoader";
}

export function isImageLikeNode(node: CanvasNode | undefined | null): node is ImageLikeCanvasNode {
  return node?.type === "imageLoader" || node?.type === "imageGenerator" || node?.type === "libtvImageGenerator";
}
