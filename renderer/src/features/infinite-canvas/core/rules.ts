import type { CanvasNode } from "../types";

function isLibtvNode(node: CanvasNode) {
  return node.type === "libtvImage" || node.type === "libtvPrompt" || node.type === "libtvUpload";
}

export function canConnect(from: CanvasNode, to: CanvasNode, canvasType: "forart" | "forart-libtv" = "forart") {
  if (from.id === to.id) return false;
  if (canvasType !== "forart-libtv" && (isLibtvNode(from) || isLibtvNode(to))) return false;
  const forartSources = ["imageGenerator", "image", "prompt", "loop", "llm", "libtvImage"];
  const libtvSources = ["libtvImage", "libtvPrompt", "libtvUpload"];
  if (to.type === "imageGenerator") return forartSources.includes(from.type);
  if (to.type === "libtvImage") return libtvSources.includes(from.type);
  if (to.type === "loop") return ["imageGenerator", "image", "prompt", "llm", "libtvImage"].includes(from.type);
  if (to.type === "llm") return forartSources.includes(from.type);
  return false;
}

export function hasConnection(connections: Array<{ from: string; to: string }>, fromId: string, toId: string) {
  return connections.some((connection) => connection.from === fromId && connection.to === toId);
}
