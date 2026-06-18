import type { FreeCanvasEditorItem, FreeCanvasSize, FreeCanvasViewport } from "../types";

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeLayerOrder(items: FreeCanvasEditorItem[]) {
  return items.map((item, index) => ({ ...item, zIndex: index + 1 }) as FreeCanvasEditorItem);
}

export function sortedBackToFront(items: FreeCanvasEditorItem[]) {
  return [...items].sort((left, right) => left.zIndex - right.zIndex);
}

export function sortedFrontToBack(items: FreeCanvasEditorItem[]) {
  return [...items].sort((left, right) => right.zIndex - left.zIndex);
}

export function getCanvasScreenScale(fitScale: number, viewport: FreeCanvasViewport) {
  return fitScale * viewport.scale;
}

export function screenToCanvasPoint(
  clientX: number,
  clientY: number,
  stageRect: DOMRect,
  canvasSize: FreeCanvasSize,
  fitScale: number,
  viewport: FreeCanvasViewport,
) {
  const scale = getCanvasScreenScale(fitScale, viewport) || 1;
  return {
    x: (clientX - stageRect.left - stageRect.width / 2 - viewport.x) / scale + canvasSize.width / 2,
    y: (clientY - stageRect.top - stageRect.height / 2 - viewport.y) / scale + canvasSize.height / 2,
  };
}

export function canvasPointToStagePoint(
  point: { x: number; y: number },
  stageSize: FreeCanvasSize,
  canvasSize: FreeCanvasSize,
  fitScale: number,
  viewport: FreeCanvasViewport,
) {
  const scale = getCanvasScreenScale(fitScale, viewport);
  return {
    x: stageSize.width / 2 + viewport.x + (point.x - canvasSize.width / 2) * scale,
    y: stageSize.height / 2 + viewport.y + (point.y - canvasSize.height / 2) * scale,
  };
}

export function getItemBounds(item: FreeCanvasEditorItem) {
  return {
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    centerX: item.x + item.width / 2,
    centerY: item.y + item.height / 2,
  };
}

export function pointInItem(item: FreeCanvasEditorItem, point: { x: number; y: number }, margin = 0) {
  const bounds = getItemBounds(item);
  const radians = -(item.rotation * Math.PI) / 180;
  const dx = point.x - bounds.centerX;
  const dy = point.y - bounds.centerY;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians) + bounds.width / 2;
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians) + bounds.height / 2;
  return (
    localX >= -margin
    && localY >= -margin
    && localX <= bounds.width + margin
    && localY <= bounds.height + margin
  );
}

export function hitTestItem(items: FreeCanvasEditorItem[], point: { x: number; y: number }, margin = 4) {
  return sortedFrontToBack(items).find((item) => pointInItem(item, point, margin)) || null;
}

export function getSelectionStageRect(
  item: FreeCanvasEditorItem,
  stageSize: FreeCanvasSize,
  canvasSize: FreeCanvasSize,
  fitScale: number,
  viewport: FreeCanvasViewport,
) {
  const topLeft = canvasPointToStagePoint({ x: item.x, y: item.y }, stageSize, canvasSize, fitScale, viewport);
  const scale = getCanvasScreenScale(fitScale, viewport);
  return {
    left: topLeft.x,
    top: topLeft.y,
    width: item.width * scale,
    height: item.height * scale,
    centerX: topLeft.x + (item.width * scale) / 2,
    rotation: item.rotation,
  };
}
