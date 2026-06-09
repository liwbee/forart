import type { CanvasNode } from "../types";

export function canConnect(from: CanvasNode, to: CanvasNode) {
  if (from.id === to.id) return false;
  if (to.type === "generator") return ["generator", "image", "prompt", "loop"].includes(from.type);
  if (to.type === "image") return ["generator", "image"].includes(from.type);
  if (to.type === "loop") return ["generator", "image", "prompt"].includes(from.type);
  return false;
}

export function hasConnection(connections: Array<{ from: string; to: string }>, fromId: string, toId: string) {
  return connections.some((connection) => connection.from === fromId && connection.to === toId);
}
