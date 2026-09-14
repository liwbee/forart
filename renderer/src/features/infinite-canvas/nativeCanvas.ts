import type { Edge, Node, XYPosition } from "@xyflow/react";
import { Bot, FolderKanban, ImageIcon, ImagePlus, ScanSearch, Split, TextCursorInput, Type, type LucideIcon } from "lucide-react";
import type { ActionFissionState } from "./action-fission/actionFissionTypes";
import type { BatchNodeItemBase, BatchNodeStateBase } from "./batch/batchNodeTypes";
export interface BatchImageGeneratorItem extends BatchNodeItemBase { sourceUrl?: string; sourceThumbUrl?: string; sourceFileName?: string; useAdditionalReferences?: boolean; resultUrl?: string; resultThumbUrl?: string; resultFileName?: string; resultWidth?: number; resultHeight?: number; resultDownloadState?: "pending" | "downloaded"; resultDownloadedAt?: number; }
export type BatchImageGeneratorState = BatchNodeStateBase<BatchImageGeneratorItem> & { prompt?: string; taskReferenceOrder?: number };
import {
  getImageGeneratorNodeSize,
  IMAGE_GENERATOR_DEFAULT_SIZE,
  ASSET_LOADER_DEFAULT_SIZE,
} from "./imageNodeSizing";

export { getImageGeneratorNodeSize, getImageNodeSize, getVideoNodeSize } from "./imageNodeSizing";

export type NativeCanvasNodeKind = "imageGenerator" | "batchImageGenerator" | "assetLoader" | "prompt" | "annotation" | "llm" | "smartReverse" | "actionFission" | "group";
export type NativeCanvasAssetType = "image" | "video" | "audio";

export interface NativeGenerationResult {
  url?: string;
  localUrl?: string;
  thumbUrl?: string;
  fileName?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  downloadState?: "pending" | "downloaded";
  downloadedAt?: number;
}

/** Generic media descriptor used by assetLoader nodes. Image-specific consumers
 * should continue using nativeCanvasNodePrimaryImage(). */
export interface NativeCanvasAsset extends NativeGenerationResult {
  assetType: NativeCanvasAssetType;
  mimeType?: string;
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
  /** Legacy grouping marker. New documents use React Flow parentId/groupNode instead. */
  groupId?: string;
  groupColor?: string;
  /** Canonical media fields for assetLoader nodes. */
  assetUrl?: string;
  assetFileName?: string;
  assetThumbUrl?: string;
  assetType?: NativeCanvasAssetType;
  assetMimeType?: string;
  assetNaturalWidth?: number;
  assetNaturalHeight?: number;
  assetDurationMs?: number;
  assetSizeBytes?: number;
  assetLoadState?: "processing" | "error";
  assetLoadError?: string;
  /** Legacy image-loader fields accepted only while migrating old documents. */
  imageUrl?: string;
  imageFileName?: string;
  thumbUrl?: string;
  text?: string;
  smartReverseInstruction?: string;
  smartReverseInstructionDocument?: NativeImagePromptDocument;
  smartReverseProviderId?: string;
  smartReverseModel?: string;
  smartReverseReasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  smartReverseResult?: NativeSmartReverseResult;
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
  /** Runtime-only state while a dropped/pasted asset is being persisted. */
  imageUploadState?: "processing" | "error";
  imageUploadError?: string;
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
  batchImageGenerator?: BatchImageGeneratorState;
}

export type NativeCanvasNode = Node<NativeCanvasNodeData, "canvasNode" | "groupNode">;
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

export interface NativeSmartReverseResult {
  mode: "combined" | "separate";
  relationshipSummary: string;
  assetUses: Array<{ nodeId: string; use: string }>;
  outputs: Array<{
    id: string;
    sourceNodeIds: string[];
    summary: string;
    detailedPrompt: string;
    compactPrompt: string;
    negativePrompt: string;
    preserved: string[];
    avoid: string[];
    uncertainties: string[];
  }>;
  warnings: string[];
}

export function nativeCanvasNodeImages(data: NativeCanvasNodeData): NativeGenerationResult[] {
  if (data.kind === "imageGenerator") {
    return (data.generatedImages || []).filter((result) => result.localUrl || result.url);
  }
  if (data.kind === "actionFission") {
    return (data.actionFission?.rows || []).flatMap((row) => row.resultUrl ? [{
      localUrl: row.resultUrl, thumbUrl: row.resultThumbUrl, fileName: row.resultFileName,
      width: row.resultWidth, height: row.resultHeight,
    }] : []);
  }
  if (data.kind === "batchImageGenerator") return (data.batchImageGenerator?.items || []).flatMap((item) => item.resultUrl ? [{ localUrl: item.resultUrl, thumbUrl: item.resultThumbUrl }] : []);
  if (data.kind !== "assetLoader" || (data.assetType && data.assetType !== "image") || !data.assetUrl) return [];
  return [{
    localUrl: data.assetUrl,
    fileName: data.assetFileName,
    thumbUrl: data.assetThumbUrl,
    width: data.assetNaturalWidth,
    height: data.assetNaturalHeight,
  }];
}

export function nativeCanvasNodePrimaryImage(data: NativeCanvasNodeData): NativeGenerationResult | null {
  return nativeCanvasNodeImages(data)[0] || null;
}

export function nativeCanvasNodePrimaryAsset(data: NativeCanvasNodeData): NativeCanvasAsset | null {
  if (data.kind !== "assetLoader" || !data.assetUrl) return null;
  return {
    assetType: data.assetType || "image",
    mimeType: data.assetMimeType,
    localUrl: data.assetUrl,
    fileName: data.assetFileName,
    thumbUrl: data.assetThumbUrl,
    width: data.assetNaturalWidth,
    height: data.assetNaturalHeight,
    durationMs: data.assetDurationMs,
  };
}

export interface NativeCanvasNodeResizeConfig {
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
}

interface NativeCanvasNodeDefinition {
  icon: LucideIcon;
  labelKey: "imageGenerator" | "batchImageGenerator" | "assetNode" | "prompt" | "annotation" | "llm" | "smartReverse" | "actionFission" | "group";
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
  batchImageGenerator: {
    icon: ImagePlus,
    labelKey: "batchImageGenerator",
    size: { width: 820, height: 620 },
    acceptsInput: true,
    providesOutput: true,
    resizable: {
      minWidth: 680,
      minHeight: 420,
    },
  },
  assetLoader: {
    icon: ImageIcon,
    labelKey: "assetNode",
    size: ASSET_LOADER_DEFAULT_SIZE,
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
    },
  },
  smartReverse: {
    icon: ScanSearch,
    labelKey: "smartReverse",
    size: { width: 340, height: 300 },
    acceptsInput: true,
    providesOutput: true,
    resizable: { minWidth: 280, minHeight: 240 },
  },
  group: {
    icon: FolderKanban,
    labelKey: "group",
    size: { width: 640, height: 420 },
    acceptsInput: false,
    providesOutput: false,
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
    style: kind === "imageGenerator" && !nodeData.generatedImages?.some((image) => image.localUrl || image.url)
      ? getImageGeneratorNodeSize(nodeData.imageAspectRatio)
      : definition.size,
  };
}

export function createNativeCanvasGroupNode(
  position: XYPosition,
  size: { width: number; height: number },
  label = "",
): NativeCanvasNode {
  return {
    id: `group_${crypto.randomUUID()}`,
    type: "groupNode",
    position,
    data: { kind: "group", label },
    style: size,
    zIndex: 0,
    draggable: true,
    selectable: true,
    connectable: false,
    deletable: true,
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
  if (data.batchImageGenerator) {
    clonedData.batchImageGenerator = {
      ...data.batchImageGenerator,
      items: data.batchImageGenerator.items.map((item) => {
        const clonedItem = { ...item };
        delete clonedItem.latestGenerationTaskId;
        delete clonedItem.status;
        delete clonedItem.error;
        return clonedItem;
      }),
    };
  }

  return clonedData;
}

/**
 * Rebind structured prompt references when a node and its incoming edges are
 * cloned together. References are intentionally left untouched when an edge
 * was not part of the copied payload, so a partial copy remains visibly
 * invalid instead of silently pointing at an unrelated input.
 */
export function remapNativeCanvasNodePromptReferences(
  data: NativeCanvasNodeData,
  edgeIdMap: ReadonlyMap<string, string>,
): NativeCanvasNodeData {
  const clonedData = cloneNativeCanvasNodeData(data);
  const remapDocument = (document: NativeImagePromptDocument | undefined): NativeImagePromptDocument | undefined => {
    if (!document?.root) return document;
    const remapNode = (node: NativeImagePromptSerializedNode): NativeImagePromptSerializedNode => ({
      ...node,
      ...(node.type === "image-reference" && node.edgeId
        ? { edgeId: edgeIdMap.get(node.edgeId) || node.edgeId }
        : {}),
      ...(Array.isArray(node.children)
        ? { children: node.children.map(remapNode) }
        : {}),
    });
    return { ...document, root: remapNode(document.root) };
  };

  if (clonedData.imagePromptDocument) {
    clonedData.imagePromptDocument = remapDocument(clonedData.imagePromptDocument);
  }
  if (clonedData.smartReverseInstructionDocument) {
    clonedData.smartReverseInstructionDocument = remapDocument(clonedData.smartReverseInstructionDocument);
  }
  return clonedData;
}
