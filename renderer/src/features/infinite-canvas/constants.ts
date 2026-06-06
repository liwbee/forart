import type { CanvasNodeType, CropAspectKey } from "./types";

export const NODE_DEFAULTS: Record<CanvasNodeType, { w: number; h: number; title: string }> = {
  image: { w: 260, h: 300, title: "Image" },
  prompt: { w: 310, h: 220, title: "Prompt" },
  output: { w: 420, h: 300, title: "Output" },
  group: { w: 340, h: 230, title: "Group" },
  loop: { w: 330, h: 270, title: "Loop" },
};

export const CANVAS_STORAGE_KEY = "forart_infinite_canvas_v1";
export const IMAGE_NODE_MIN_WIDTH = 180;
export const IMAGE_NODE_MIN_HEIGHT = 120;
export const IMAGE_NODE_MAX_WIDTH = 560;
export const IMAGE_NODE_MAX_HEIGHT = 440;

export const CROP_ASPECT_OPTIONS: Array<{ key: CropAspectKey; label: string }> = [
  { key: "original", label: "Original ratio" },
  { key: "free", label: "Free ratio" },
  { key: "1:1", label: "1:1" },
  { key: "2:3", label: "2:3" },
  { key: "3:2", label: "3:2" },
  { key: "4:3", label: "4:3" },
  { key: "3:4", label: "3:4" },
  { key: "16:9", label: "16:9" },
  { key: "9:16", label: "9:16" },
];
