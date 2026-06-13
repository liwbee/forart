import type { CanvasGroup, CanvasNode } from "./types";

export const WORLD_SIZE = 4000;
export const WORLD_CENTER = WORLD_SIZE / 2;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function linkPath(from: CanvasNode, to: CanvasNode) {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const dx = Math.max(80, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function linkMidpoint(from: CanvasNode, to: CanvasNode) {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const dx = Math.max(80, Math.abs(x2 - x1) * 0.45);
  const c1x = x1 + dx;
  const c2x = x2 - dx;
  return {
    x: (x1 + 3 * c1x + 3 * c2x + x2) / 8,
    y: (y1 + 3 * y1 + 3 * y2 + y2) / 8,
  };
}

export function tempLinkPath(from: CanvasNode, x2: number, y2: number) {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const dx = Math.max(80, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function getGroupBounds(group: CanvasGroup) {
  if (!Number.isFinite(group.x) || !Number.isFinite(group.y) || !Number.isFinite(group.w) || !Number.isFinite(group.h)) return null;
  return {
    x: group.x,
    y: group.y,
    width: Math.max(1, group.w),
    height: Math.max(1, group.h),
  };
}
