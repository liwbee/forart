import type { Edge, Node, XYPosition } from "@xyflow/react";
import { Bot, ImageIcon, ImagePlus, Split, TextCursorInput, Type, type LucideIcon } from "lucide-react";
import type { ActionFissionState } from "./action-fission/actionFissionTypes";
import {
  getImageGeneratorNodeSize,
  getImageNodeSize,
  IMAGE_GENERATOR_DEFAULT_SIZE,
  IMAGE_LOADER_DEFAULT_SIZE,
} from "./imageNodeSizing";

export { getImageGeneratorNodeSize, getImageNodeSize } from "./imageNodeSizing";

export type NativeCanvasNodeKind = "imageGenerator" | "imageLoader" | "prompt" | "annotation" | "llm" | "actionFission";

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

export interface NativeCanvasAnnotationStyle {
  color?: string;
  fontSize?: number;
  bold?: boolean;
  textAlign?: "left" | "center" | "right";
}

export interface NativeImagePromptSerializedNode extends Record<string, unknown> {
  type: string;
  version?: number;
  children?: NativeImagePromptSerializedNode[];
  text?: string;
  edgeId?: string;
}

export interface NativeImagePromptDocument {
  root: NativeImagePromptSerializedNode;
}

export interface ImageGenerationRunOptions {
  promptOverride?: string;
  promptDocumentOverride?: NativeImagePromptDocument;
  negativePromptOverride?: string;
}

export interface NativeCanvasNodeData extends Record<string, unknown> {
  kind: NativeCanvasNodeKind;
  label: string;
  imageUrl?: string;
  thumbUrl?: string;
  text?: string;
  imagePromptDocument?: NativeImagePromptDocument;
  annotationStyle?: NativeCanvasAnnotationStyle;
  imageProviderId?: string;
  imageModel?: string;
  imageResolution?: string;
  imageAspectRatio?: string;
  imageCustomSize?: string;
  imageQuality?: string;
  imageCount?: number;
  imageNegativePrompt?: string;
  imagePromptExtend?: boolean;
  imagePromptExtendMode?: "direct" | "agent";
  generatedImages?: NativeGenerationResult[];
  multiImageExpanded?: boolean;
  multiImageCollapsedSize?: { width: number; height: number };
  imageNaturalWidth?: number;
  imageNaturalHeight?: number;
  latestGenerationTaskId?: string;
  imageGenerationBackend?: "api" | "libtv";
  libtvImageGeneration?: {
    aspectRatio?: string;
    count?: number;
    modelKey?: string;
    modelName?: string;
    quality?: string;
    resolution?: string;
  };
  actionFission?: ActionFissionState;
}

export type NativeCanvasNode = Node<NativeCanvasNodeData, "canvasNode">;
export type NativeCanvasInputKind =
  | "prompt"
  | "referenceImage"
  | "additionalReferenceImage"
  | "additionalReferencePrompt";

export interface NativeCanvasEdgeData extends Record<string, unknown> {
  inputKind?: NativeCanvasInputKind;
  referenceOrder?: number;
}

export type NativeCanvasEdge = Edge<NativeCanvasEdgeData, "default">;

export function nativeCanvasNodeTaskId(data: NativeCanvasNodeData) {
  return String(data.latestGenerationTaskId || "");
}

export function nativeCanvasNodePrimaryImage(data: NativeCanvasNodeData): NativeGenerationResult | null {
  if (data.kind === "imageGenerator") {
    const generated = data.generatedImages?.find((result) => result.localUrl || result.url);
    if (generated) return generated;
  }
  if (!data.imageUrl) return null;
  return {
    localUrl: data.imageUrl,
    thumbUrl: data.thumbUrl,
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
  labelKey: "imageGenerator" | "imageNode" | "prompt" | "annotation" | "llm" | "actionFission";
  size: { width: number; height: number };
  acceptsInput: boolean;
  providesOutput: boolean;
  resizable?: NativeCanvasNodeResizeConfig;
}

export const NATIVE_CANVAS_NODE_DEFINITIONS: Record<NativeCanvasNodeKind, NativeCanvasNodeDefinition> = {
  imageGenerator: {
    icon: ImagePlus,
    labelKey: "imageGenerator",
    size: IMAGE_GENERATOR_DEFAULT_SIZE,
    acceptsInput: true,
    providesOutput: true,
  },
  imageLoader: {
    icon: ImageIcon,
    labelKey: "imageNode",
    size: IMAGE_LOADER_DEFAULT_SIZE,
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
  annotation: {
    icon: Type,
    labelKey: "annotation",
    size: { width: 64, height: 40 },
    acceptsInput: false,
    providesOutput: false,
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
  delete clonedData.latestGenerationTaskId;

  if (data.actionFission) {
    clonedData.actionFission = {
      ...data.actionFission,
      rows: data.actionFission.rows.map((row) => {
        const clonedRow = {
          ...row,
          categoryGroups: row.categoryGroups.map((group) => ({
            ...group,
            includeActionTagIds: [...group.includeActionTagIds],
            excludeActionTagIds: [...group.excludeActionTagIds],
          })),
        } as typeof row & Record<string, unknown>;
        delete clonedRow.latestGenerationTaskId;
        return clonedRow;
      }),
    };
  }

  return clonedData;
}
