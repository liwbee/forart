import type { Modifier } from "@dnd-kit/core";

export const restrictCanvasTabDragToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});
