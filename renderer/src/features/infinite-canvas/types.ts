export type CanvasNodeType = "imageGenerator" | "image" | "prompt" | "llm" | "libtvImage" | "libtvPrompt" | "libtvUpload";

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
  filePath?: string;
  imageNaturalWidth?: number;
  imageNaturalHeight?: number;
  imageMode?: "imageGenerator" | "asset";
  imageSource?: "generated" | "uploaded";
  librarySource?: {
    kind: "model" | "outfit" | "action";
    assetId?: string | null;
    entryId?: string;
    name?: string;
  };
  imageProviderId?: string;
  imageModel?: string;
  imageResolution?: "1k" | "2k" | "4k";
  imageAspectRatio?: "1:1" | "2:3" | "3:2" | "4:3" | "3:4" | "16:9" | "9:16";
  chatProviderId?: string;
  chatModel?: string;
  libtvProjectId?: string;
  libtvNodeId?: string;
  libtvModel?: string;
  libtvModelName?: string;
  libtvResolution?: "1k" | "2k" | "4k";
  libtvAspectRatio?: "1:1" | "2:3" | "3:2" | "4:3" | "3:4" | "16:9" | "9:16";
  libtvOriginalUrl?: string;
  generationError?: string;
  generationStatus?: string;
  generationTask?: CanvasGenerationTask;
  text?: string;
  fixedPrompt?: string;
  variablePrompt?: string;
  running?: boolean;
}

export interface CanvasGenerationTask {
  id: string;
  canvasId: string;
  nodeId: string;
  providerId: string;
  model: string;
  upstreamTaskId?: string;
  status: "submitting" | "running" | "succeeded" | "failed" | "interrupted";
  startedAt: number;
  updatedAt: number;
  prompt?: string;
  referenceImages?: string[];
  resolution?: "1k" | "2k" | "4k";
  aspectRatio?: string;
  error?: string;
}

export interface CanvasConnection {
  id: string;
  from: string;
  to: string;
}

export interface CanvasGroup {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  nodeIds: string[];
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
  groups: CanvasGroup[];
  viewport: Viewport;
}

export interface CanvasProject extends CanvasSnapshot {
  id: string;
  title: string;
  icon?: string;
  canvasType?: "forart" | "forart-libtv";
  source?: "forart" | "libtv";
  libtvProjectId?: string;
  libtvProjectName?: string;
  color?: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasProjectRecord {
  id: string;
  title: string;
  icon?: string;
  canvasType?: "forart" | "forart-libtv";
  source?: "forart" | "libtv";
  libtvProjectId?: string;
  libtvProjectName?: string;
  color?: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
}
