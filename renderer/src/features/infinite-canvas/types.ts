import type { ActionFissionState } from "./action-fission/actionFissionTypes";

export type CanvasNodeType = "imageGenerator" | "imageLoader" | "prompt" | "llm" | "actionFission" | "libtvImageGenerator";

export interface LibtvImageGenerationState {
  workspaceId?: string;
  workspaceName?: string;
  projectUuid?: string;
  projectName?: string;
  modelName?: string;
  aspectRatio?: string;
  quality?: string;
  prompt?: string;
  running?: boolean;
  startedAt?: number;
  status?: string;
  error?: string;
  latestRun?: {
    remoteNodeId?: string;
    remoteNodeTitle?: string;
    remoteReferenceNodeIds?: string[];
    remoteReferenceNodeTitles?: string[];
    groupNodeId?: string;
    groupTitle?: string;
    projectUuid?: string;
    projectName?: string;
    resultUrl?: string;
    localUrl?: string;
    createdAt: number;
  };
}

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  url?: string;
  thumbUrl?: string;
  fileName?: string;
  filePath?: string;
  thumbFilePath?: string;
  imageNaturalWidth?: number;
  imageNaturalHeight?: number;
  imageMode?: "imageGenerator" | "asset";
  imageSource?: "generated" | "uploaded";
  outputDownloadState?: "pending" | "downloaded";
  outputDownloadedAt?: number;
  librarySource?: {
    kind: "model" | "outfit" | "action";
    assetId?: string | null;
    entryId?: string;
    name?: string;
  };
  imageProviderId?: string;
  imageGenerationApiType?: "third-party-api" | "libtv-api";
  imageModel?: string;
  imageResolution?: string;
  imageAspectRatio?: string;
  chatProviderId?: string;
  chatModel?: string;
  actionFission?: ActionFissionState;
  libtvImageGeneration?: LibtvImageGenerationState;
  generationError?: string;
  generationStatus?: string;
  generationTask?: CanvasGenerationTask;
  text?: string;
  fixedPrompt?: string;
  variablePrompt?: string;
  running?: boolean;
}

export type CanvasGenerationTaskStatus =
  | "queued"
  | "submitting"
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "superseded";

export type CanvasGenerationInterruptReason = "user_stop" | "app_restart" | "provider_lost" | "superseded";

export interface CanvasGenerationTask {
  id: string;
  canvasId: string;
  nodeId: string;
  target?: CanvasGenerationTarget;
  kind?: "image";
  providerId: string;
  model: string;
  upstreamTaskId?: string;
  status: CanvasGenerationTaskStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  durationMs?: number;
  prompt?: string;
  referenceImages?: string[];
  resolution?: string;
  aspectRatio?: string;
  message?: string;
  error?: string;
  interruptReason?: CanvasGenerationInterruptReason;
  result?: {
    url?: string;
    localUrl?: string;
    fileName?: string;
    width?: number;
    height?: number;
  };
  writeback?: {
    terminalStatus?: CanvasGenerationTaskStatus;
    [key: string]: unknown;
  };
}

export type CanvasGenerationTarget =
  | {
      type: "imageGenerator";
      nodeId: string;
    }
  | {
      type: "actionFissionRow";
      nodeId: string;
      rowId: string;
    };

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

export interface CanvasDocument extends CanvasSnapshot {
  id: string;
  title: string;
  icon?: string;
  canvasType?: "forart";
  projectId?: string;
  color?: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasDocumentRecord {
  id: string;
  title: string;
  icon?: string;
  canvasType?: "forart";
  projectId?: string;
  color?: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
}

export interface CanvasProjectRecord {
  id: string;
  title: string;
  color?: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}
