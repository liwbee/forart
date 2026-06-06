import type { CanvasNode } from "../types";

export function canConnect(from: CanvasNode, to: CanvasNode) {
  if (from.id === to.id) return false;
  if (to.type === "output") return from.type === "image";
  if (from.type === "image") return to.type === "image";
  if (to.type === "image") return ["image", "prompt", "group", "loop", "output"].includes(from.type);
  if (to.type === "loop") return ["image", "prompt", "group"].includes(from.type);
  return false;
}

export function hasConnection(connections: Array<{ from: string; to: string }>, fromId: string, toId: string) {
  return connections.some((connection) => connection.from === fromId && connection.to === toId);
}
