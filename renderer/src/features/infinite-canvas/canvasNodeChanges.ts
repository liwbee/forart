import type { NativeCanvasNode } from "./nativeCanvas";

/**
 * Compare the parts of a node that React Flow's change stream can write.
 *
 * A change that leaves its node byte-for-byte identical must not republish the nodes
 * array: React Flow's StoreUpdater re-adopts every array it receives, which re-renders
 * the canvas and can bounce a measurement change back and forth until React aborts with
 * "Maximum update depth exceeded".
 */
export function sameCanvasNodeRuntime(before: NativeCanvasNode, after: NativeCanvasNode) {
  if (before === after) return true;
  if (before.selected !== after.selected) return false;
  if (before.dragging !== after.dragging) return false;
  if (before.hidden !== after.hidden) return false;
  if (before.position.x !== after.position.x || before.position.y !== after.position.y) return false;
  return sameDimension(before, after, "width") && sameDimension(before, after, "height");
}

function readDimension(node: NativeCanvasNode, dimension: "width" | "height") {
  const style = node.style && typeof node.style === "object" ? node.style as Record<string, unknown> : {};
  return [
    Number(node[dimension] || 0),
    Number(node.measured?.[dimension] || 0),
    Number(style[dimension] || 0),
  ].join(":");
}

function sameDimension(before: NativeCanvasNode, after: NativeCanvasNode, dimension: "width" | "height") {
  return readDimension(before, dimension) === readDimension(after, dimension);
}
