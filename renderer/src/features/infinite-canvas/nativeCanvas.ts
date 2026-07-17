import type { Edge, Node, XYPosition } from "@xyflow/react";
import { Bot, ImageIcon, ImagePlus, Split, TextCursorInput, type LucideIcon } from "lucide-react";
import type { LibtvGenerationTask } from "../../app/appConfig";
import type { ActionFissionState } from "./action-fission/actionFissionTypes";

export type NativeCanvasNodeKind = "imageGenerator" | "imageLoader" | "prompt" | "llm" | "actionFission";

export type NativeGenerationTaskStatus =
  | "queued"
  | "submitting"
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "superseded";

export interface NativeGenerationResult {
  url?: string;
  localUrl?: string;
  thumbUrl?: string;
  fileName?: string;
  width?: number;
  height?: number;
  downloadState?: "pending" | "downloaded";
  downloadedAt?: number;
}

export interface NativeGenerationTask {
  id: string;
  canvasId: string;
  nodeId: string;
  target:
    | { type: "imageGenerator"; nodeId: string }
    | { type: "actionFissionRow"; nodeId: string; rowId: string };
  kind: "image";
  providerId: string;
  model: string;
  upstreamTaskId?: string;
  status: NativeGenerationTaskStatus;
  startedAt: number;
  runningAt?: number;
  updatedAt: number;
  completedAt?: number;
  durationMs?: number;
  prompt?: string;
  referenceImages?: string[];
  resolution?: string;
  aspectRatio?: string;
  quality?: string;
  imageCount?: number;
  message?: string;
  messageCode?: string;
  messageParams?: Record<string, string | number>;
  error?: string;
  interruptReason?: "user_stop" | "app_restart" | "provider_lost" | "superseded";
  result?: NativeGenerationResult & { results?: NativeGenerationResult[] };
}

export interface NativeCanvasNodeData extends Record<string, unknown> {
  kind: NativeCanvasNodeKind;
  label: string;
  imageUrl?: string;
  thumbUrl?: string;
  text?: string;
  imageProviderId?: string;
  imageModel?: string;
  imageResolution?: string;
  imageAspectRatio?: string;
  imageQuality?: string;
  imageCount?: number;
  generatedImages?: NativeGenerationResult[];
  multiImageExpanded?: boolean;
  multiImageCollapsedSize?: { width: number; height: number };
  imageNaturalWidth?: number;
  imageNaturalHeight?: number;
  generationError?: string;
  generationTaskId?: string;
  generationRemoteTaskId?: string;
  generationTask?: NativeGenerationTask;
  imageGenerationBackend?: "api" | "libtv";
  libtvImageGeneration?: {
    aspectRatio?: string;
    count?: number;
    modelKey?: string;
    modelName?: string;
    quality?: string;
    resolution?: string;
    taskId?: string;
    projectUuid?: string;
    remoteNodeId?: string;
    task?: LibtvGenerationTask;
  };
  actionFission?: ActionFissionState;
}

export type NativeCanvasNode = Node<NativeCanvasNodeData, "canvasNode">;
export type NativeCanvasInputKind = "prompt" | "referenceImage" | "additionalReferenceImage";

export interface NativeCanvasEdgeData extends Record<string, unknown> {
  inputKind?: NativeCanvasInputKind;
  referenceOrder?: number;
}

export type NativeCanvasEdge = Edge<NativeCanvasEdgeData, "default">;

export function nativeCanvasNodePrimaryImage(data: NativeCanvasNodeData): NativeGenerationResult | null {
  if (data.kind === "imageGenerator") {
    const generated = data.generatedImages?.find((result) => result.localUrl || result.url);
    if (generated) return generated;
  }
  if (!data.imageUrl) return null;
  return {
    localUrl: data.imageUrl,
    thumbUrl: data.thumbUrl,
    fileName: data.label,
    width: data.imageNaturalWidth,
    height: data.imageNaturalHeight,
  };
}

export interface NativeCanvasNodeResizeConfig {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

interface NativeCanvasNodeDefinition {
  icon: LucideIcon;
  labelKey: "imageGenerator" | "imageNode" | "prompt" | "llm" | "actionFission";
  size: { width: number; height: number };
  acceptsInput: boolean;
  providesOutput: boolean;
  resizable?: NativeCanvasNodeResizeConfig;
}

export const NATIVE_CANVAS_NODE_DEFINITIONS: Record<NativeCanvasNodeKind, NativeCanvasNodeDefinition> = {
  imageGenerator: {
    icon: ImagePlus,
    labelKey: "imageGenerator",
    size: { width: 280, height: 280 },
    acceptsInput: true,
    providesOutput: true,
  },
  imageLoader: {
    icon: ImageIcon,
    labelKey: "imageNode",
    size: { width: 240, height: 320 },
    acceptsInput: false,
    providesOutput: true,
  },
  prompt: {
    icon: TextCursorInput,
    labelKey: "prompt",
    size: { width: 260, height: 160 },
    acceptsInput: false,
    providesOutput: true,
    resizable: {
      minWidth: 180,
      minHeight: 100,
      maxWidth: 640,
      maxHeight: 520,
    },
  },
  llm: {
    icon: Bot,
    labelKey: "llm",
    size: { width: 280, height: 190 },
    acceptsInput: true,
    providesOutput: true,
  },
  actionFission: {
    icon: Split,
    labelKey: "actionFission",
    size: { width: 820, height: 620 },
    acceptsInput: true,
    providesOutput: true,
    resizable: {
      minWidth: 680,
      minHeight: 420,
      maxWidth: 1600,
      maxHeight: 1078,
    },
  },
};

export function getImageNodeSize(naturalWidth: number, naturalHeight: number) {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return NATIVE_CANVAS_NODE_DEFINITIONS.imageLoader.size;
  const targetArea = 240 * 320;
  let scale = Math.sqrt(targetArea / (naturalWidth * naturalHeight));
  if (naturalWidth * scale > 420) scale = 420 / naturalWidth;
  if (naturalHeight * scale > 420) scale = 420 / naturalHeight;
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

export function getImageGeneratorNodeSize(aspectRatio: string | undefined) {
  const match = aspectRatio?.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return NATIVE_CANVAS_NODE_DEFINITIONS.imageGenerator.size;
  const ratioWidth = Number(match[1]);
  const ratioHeight = Number(match[2]);
  if (!(ratioWidth > 0) || !(ratioHeight > 0)) return NATIVE_CANVAS_NODE_DEFINITIONS.imageGenerator.size;

  const targetArea = 280 * 280;
  const ratio = ratioWidth / ratioHeight;
  let width = Math.sqrt(targetArea * ratio);
  let height = width / ratio;
  const maxDimension = Math.max(width, height);
  if (maxDimension > 420) {
    const scale = 420 / maxDimension;
    width *= scale;
    height *= scale;
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

export const NATIVE_CANVAS_NODE_KINDS = Object.keys(NATIVE_CANVAS_NODE_DEFINITIONS) as NativeCanvasNodeKind[];

export function createNativeCanvasNode(
  kind: NativeCanvasNodeKind,
  position: XYPosition,
  data?: Partial<NativeCanvasNodeData>,
): NativeCanvasNode {
  const definition = NATIVE_CANVAS_NODE_DEFINITIONS[kind];
  const nodeData: NativeCanvasNodeData = {
    kind,
    label: "",
    ...data,
  };
  return {
    id: `${kind}_${crypto.randomUUID()}`,
    type: "canvasNode",
    position,
    data: nodeData,
    style: kind === "imageGenerator" && !nodeData.imageUrl
      ? getImageGeneratorNodeSize(nodeData.imageAspectRatio)
      : definition.size,
  };
}

export function cloneNativeCanvasNodeData(data: NativeCanvasNodeData): NativeCanvasNodeData {
  const clonedData = { ...data };
  delete clonedData.generationTask;
  delete clonedData.generationTaskId;
  delete clonedData.generationRemoteTaskId;
  delete clonedData.generationError;

  if (data.libtvImageGeneration) {
    const libtvState = { ...data.libtvImageGeneration };
    delete libtvState.task;
    delete libtvState.taskId;
    delete libtvState.projectUuid;
    delete libtvState.remoteNodeId;
    clonedData.libtvImageGeneration = libtvState;
  }

  if (data.actionFission) {
    clonedData.actionFission = {
      ...data.actionFission,
      status: "",
      error: "",
      rows: data.actionFission.rows.map((row) => {
        const clonedRow = {
          ...row,
          includeActionTagIds: [...row.includeActionTagIds],
          excludeActionTagIds: [...row.excludeActionTagIds],
          categoryGroups: row.categoryGroups?.map((group) => {
            const clonedGroup = { ...group } as typeof group & { fixedActionId?: string };
            delete clonedGroup.fixedActionId;
            return {
              ...clonedGroup,
              includeActionTagIds: [...group.includeActionTagIds],
              excludeActionTagIds: [...group.excludeActionTagIds],
            };
          }),
        };
        delete clonedRow.generationTask;
        delete clonedRow.generationTaskId;
        delete clonedRow.generationRemoteTaskId;
        delete clonedRow.libtvQueued;
        delete clonedRow.libtvRunning;
        delete clonedRow.libtvTask;
        delete clonedRow.libtvTaskId;
        delete clonedRow.libtvProjectUuid;
        delete clonedRow.libtvRemoteNodeId;
        delete clonedRow.error;
        return clonedRow;
      }),
    };
  }

  return clonedData;
}
