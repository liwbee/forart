import type { CanvasNode } from "../types";

export function canConnect(from: CanvasNode, to: CanvasNode) {
  if (from.id === to.id) return false;
  if (from.type === "actionFission") return false;
  const forartSources = ["imageGenerator", "imageLoader", "prompt", "llm", "libtvImageGenerator"];
  if (to.type === "imageGenerator") return forartSources.includes(from.type);
  if (to.type === "libtvImageGenerator") return forartSources.includes(from.type);
  if (to.type === "actionFission") return from.type === "imageGenerator" || from.type === "imageLoader" || from.type === "libtvImageGenerator" || from.type === "prompt";
  if (to.type === "llm") return forartSources.includes(from.type);
  return false;
}

export function hasConnection(connections: Array<{ from: string; to: string }>, fromId: string, toId: string) {
  return connections.some((connection) => connection.from === fromId && connection.to === toId);
}
