import type { CanvasNode } from "./types";

export function acceptsIncomingConnections(node: CanvasNode) {
  return node.type !== "image" && node.type !== "libtvUpload";
}

export function isImageLikeNode(node: CanvasNode | undefined | null) {
  return node?.type === "image" || node?.type === "libtvUpload" || node?.type === "imageGenerator" || node?.type === "lovart" || node?.type === "libtvImage";
}

export function isLibtvBoundCanvasNode(node: CanvasNode | undefined | null): node is CanvasNode & { libtvProjectId: string; libtvNodeId: string } {
  return Boolean(node && (node.type === "libtvImage" || node.type === "libtvPrompt" || node.type === "libtvUpload") && node.libtvProjectId && node.libtvNodeId);
}
