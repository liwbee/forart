export type CanvasNodeType = "image" | "prompt" | "output" | "group" | "loop";

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  url?: string;
  fileName?: string;
  imageNaturalWidth?: number;
  imageNaturalHeight?: number;
  imageMode?: "generator" | "asset";
  imageSource?: "generated" | "uploaded";
  text?: string;
  count?: number;
  mode?: "serial" | "batch";
  fixedPrompt?: string;
  variablePrompt?: string;
  generated?: OutputItem[];
  items?: string[];
  running?: boolean;
}

export interface OutputItem {
  id: string;
  title: string;
  prompt: string;
  createdAt: number;
}

export interface CanvasConnection {
  id: string;
  from: string;
  to: string;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ImageDialogState {
  nodeId: string;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CropAspectKey = "original" | "free" | "1:1" | "2:3" | "3:2" | "4:3" | "3:4" | "16:9" | "9:16";

export interface ImageCropState {
  nodeId: string;
  rect: CropRect;
  aspect: CropAspectKey;
}

export interface CropInteractionState {
  pointerId: number;
  nodeId: string;
  mode: "move" | "resize";
  startClientX: number;
  startClientY: number;
  startRect: CropRect;
}

export interface CanvasSnapshot {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  viewport: Viewport;
}
