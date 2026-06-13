import type { CanvasNodeType, CropAspectKey } from "./types";

export const NODE_DEFAULTS: Record<CanvasNodeType, { w: number; h: number; title: string }> = {
  imageGenerator: { w: 300, h: 400, title: "Image Generation" },
  image: { w: 300, h: 400, title: "Image" },
  prompt: { w: 310, h: 220, title: "Prompt" },
  loop: { w: 330, h: 270, title: "Loop" },
  llm: { w: 340, h: 300, title: "LLM Model" },
  lovart: { w: 300, h: 400, title: "Lovart" },
  libtvImage: { w: 300, h: 400, title: "LibTV Image" },
  libtvPrompt: { w: 310, h: 220, title: "LibTV Prompt" },
  libtvUpload: { w: 300, h: 400, title: "LibTV Upload" },
};

export const IMAGE_NODE_MIN_WIDTH = 180;
export const IMAGE_NODE_MIN_HEIGHT = 120;
export const IMAGE_NODE_MAX_WIDTH = 560;
export const IMAGE_NODE_MAX_HEIGHT = 440;

export const IMAGE_RESOLUTION_OPTIONS = ["1k", "2k", "4k"] as const;
export const IMAGE_ASPECT_RATIO_OPTIONS = ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16"] as const;

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
