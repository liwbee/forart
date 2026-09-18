import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import type { ImageModelRule } from "../../settings/imageModelRules";
import { canvasPreviewSourceUrl } from "../canvasThumbnails";
import { collectGroupImageEntries } from "../groupImageAdjustTargets";
import { nativeCanvasNodeImages, nativeCanvasNodePrimaryImage } from "../nativeCanvas";
import type {
  NativeCanvasEdge,
  NativeCanvasEdgeData,
  NativeCanvasInputKind,
  NativeCanvasNode,
  NativeCanvasNodeKind,
} from "../nativeCanvas";

export interface ImageGeneratorReferenceInput {
  edgeId: string;
  /** 这条参考实际来自哪条连线（组/多图展开时 edgeId 是合成 id）。 */
  sourceEdgeId?: string;
  /** 同一条连线内部多张参考图的稳定标识，用于记住排序。 */
  sortKey?: string;
  nodeId: string;
  order: number;
  title: string;
  imageUrl: string;
  previewUrl: string;
  /** Optional human-facing mention label, e.g. the batch source's 主图. */
  mentionLabel?: string;
  /** 由组内容展开出来的参考图：删除任意一条等于断开这个组。 */
  fromGroup?: boolean;
}

export interface ImageGeneratorPromptInput {
  edgeId: string;
  nodeId: string;
  title: string;
  text: string;
}

export type ReferenceValidationError = "unsupported" | "required" | "tooMany" | null;

export function inputKindForSource(kind: NativeCanvasNodeKind): NativeCanvasInputKind | undefined {
  if (kind === "assetLoader" || kind === "imageGenerator") return "referenceImage";
  // 组作为参考图来源：组内所有图片节点都会变成下游的参考图。
  if (kind === "group") return "referenceImage";
  if (kind === "prompt" || kind === "llm" || kind === "smartReverse") return "prompt";
  return undefined;
}

export function nextReferenceOrder(
  targetId: string,
  edges: NativeCanvasEdge[],
  inputKind: "referenceImage" | "additionalReferenceImage" | "batchTargetImage" = "referenceImage",
) {
  return edges.reduce((largest, edge) => (
    edge.target === targetId && edge.data?.inputKind === inputKind
      ? Math.max(largest, Number(edge.data.referenceOrder || 0))
      : largest
  ), 0) + 1;
}

export function edgeDataForConnection(
  sourceKind: NativeCanvasNodeKind,
  targetKind: NativeCanvasNodeKind,
  targetId: string,
  edges: NativeCanvasEdge[],
  targetHandle?: string | null,
): NativeCanvasEdgeData | undefined {
  if (targetKind !== "imageGenerator" && targetKind !== "batchImageGenerator" && targetKind !== "actionFission" && targetKind !== "smartReverse") return undefined;
  const inputKind = inputKindForSource(sourceKind);
  if (!inputKind) return undefined;
  if (targetKind === "smartReverse") {
    return inputKind === "referenceImage"
      ? { inputKind, referenceOrder: nextReferenceOrder(targetId, edges) }
      : { inputKind };
  }
  if (targetHandle === "additional-reference") {
    if (targetKind !== "actionFission" && targetKind !== "batchImageGenerator") return undefined;
    if (inputKind === "referenceImage") {
      return {
          inputKind: "additionalReferenceImage",
          referenceOrder: nextReferenceOrder(targetId, edges, "additionalReferenceImage"),
        };
    }
    return inputKind === "prompt" ? { inputKind: "additionalReferencePrompt" } : undefined;
  }
  // 批量洗图的「传入目标」端口：只接受图片，且这些图不会被当成参考图送给模型。
  if (targetHandle === "batch-import-target") {
    if (targetKind !== "batchImageGenerator") return undefined;
    return inputKind === "referenceImage"
      ? { inputKind: "batchTargetImage", referenceOrder: nextReferenceOrder(targetId, edges, "batchTargetImage") }
      : undefined;
  }
  return inputKind === "referenceImage"
    ? { inputKind, referenceOrder: nextReferenceOrder(targetId, edges) }
    : { inputKind };
}

function collectReferenceInputs(
  targetId: string,
  nodes: NativeCanvasNode[],
  edges: NativeCanvasEdge[],
  inputKind: "referenceImage" | "additionalReferenceImage",
  fallbackTitle = "",
): ImageGeneratorReferenceInput[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return edges
    .filter((edge) => edge.target === targetId && edge.data?.inputKind === inputKind)
    .flatMap((edge) => {
      const source = nodeMap.get(edge.source);
      if (!source) return [];
      const sources = orderReferenceSourceImages(referenceSourceImages(source, nodes), edge.data?.referenceImageOrder);
      return sources.flatMap((entry, index) => {
        const imageUrl = String(entry.image.localUrl || entry.image.url || "").trim();
        if (!imageUrl) return [];
        const previewSourceUrl = canvasPreviewSourceUrl(imageUrl, entry.image.thumbUrl);
        const label = entry.label || fallbackTitle;
        return [{
          edgeId: sources.length > 1 ? `${edge.id}:${entry.nodeId}:${entry.imageIndex}` : edge.id,
          sourceEdgeId: edge.id,
          ...(sources.length > 1 ? { sortKey: referenceImageSortKey(entry.nodeId, entry.imageIndex) } : {}),
          nodeId: entry.nodeId,
          order: Math.max(1, Number(edge.data?.referenceOrder || 1)) + index / 1000,
          title: entry.imageCount > 1 ? `${label} ${entry.imageIndex + 1}` : label,
          imageUrl: resolveLibraryImageUrl(imageUrl),
          previewUrl: previewSourceUrl ? resolveLibraryImageUrl(previewSourceUrl) : "",
          ...(entry.fromGroup ? { fromGroup: true } : {}),
        }];
      });
    })
    .sort((left, right) => left.order - right.order || left.edgeId.localeCompare(right.edgeId));
}

/** 同一条连线内多张参考图的稳定标识。 */
export function referenceImageSortKey(nodeId: string, imageIndex: number) {
  return `${nodeId}#${imageIndex}`;
}

/** 按边里记住的顺序重排参考图；没记过的排在后面，并保持默认阅读顺序。 */
function orderReferenceSourceImages(
  entries: ReferenceSourceImage[],
  storedOrder: string[] | undefined,
): ReferenceSourceImage[] {
  if (!storedOrder?.length || entries.length < 2) return entries;
  const rank = new Map(storedOrder.map((key, index) => [key, index]));
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftRank = rank.get(referenceImageSortKey(left.entry.nodeId, left.entry.imageIndex)) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(referenceImageSortKey(right.entry.nodeId, right.entry.imageIndex)) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.index - right.index;
    })
    .map((item) => item.entry);
}

interface ReferenceSourceImage {
  nodeId: string;
  label: string;
  image: {
    localUrl?: string;
    url?: string;
    thumbUrl?: string;
    fileName?: string;
    width?: number;
    height?: number;
  };
  imageIndex: number;
  imageCount: number;
  /** 组内图片：删除任意一条等于断开这个组。 */
  fromGroup: boolean;
}

/**
 * 一条连线来源能贡献的参考图：
 * - 普通节点：它自己的全部结果图；
 * - 组节点：组内所有图片节点的全部结果图（按画布阅读顺序，含嵌套子组）。
 */
function referenceSourceImages(source: NativeCanvasNode, nodes: NativeCanvasNode[]): ReferenceSourceImage[] {
  const isGroup = source.type === "groupNode" || source.data.kind === "group";
  if (isGroup) {
    return collectGroupImageEntries(nodes, source.id).map((entry) => ({
      nodeId: entry.node.id,
      label: String(entry.node.data.label || "").trim(),
      image: entry.image,
      imageIndex: entry.imageIndex,
      imageCount: entry.imageCount,
      fromGroup: true,
    }));
  }
  const images = typeof nativeCanvasNodeImages === "function"
    ? nativeCanvasNodeImages(source.data)
    : (() => {
      const primary = nativeCanvasNodePrimaryImage(source.data);
      return primary ? [primary] : [];
    })();
  return images.map((image, imageIndex) => ({
    nodeId: source.id,
    label: String(source.data.label || "").trim(),
    image,
    imageIndex,
    imageCount: images.length,
    fromGroup: false,
  }));
}

export function collectImageGeneratorReferences(
  targetId: string,
  nodes: NativeCanvasNode[],
  edges: NativeCanvasEdge[],
  fallbackTitle = "",
) {
  return collectReferenceInputs(targetId, nodes, edges, "referenceImage", fallbackTitle);
}

export function collectSmartReverseReferences(
  targetId: string,
  nodes: NativeCanvasNode[],
  edges: NativeCanvasEdge[],
  fallbackTitle = "",
) {
  return collectReferenceInputs(targetId, nodes, edges, "referenceImage", fallbackTitle);
}

export function collectAdditionalImageReferences(
  targetId: string,
  nodes: NativeCanvasNode[],
  edges: NativeCanvasEdge[],
  fallbackTitle = "",
) {
  return collectReferenceInputs(targetId, nodes, edges, "additionalReferenceImage", fallbackTitle);
}

export interface BatchImportTargetImage {
  edgeId: string;
  nodeId: string;
  title: string;
  imageUrl: string;
  previewUrl: string;
  fileName: string;
  width: number;
  height: number;
}

/**
 * 批量洗图「传入目标」端口连进来的图片。
 * 允许多条边；组/多图节点会展开成多张。这些图**不参与参考图**，只用来一键传成卡片。
 */
export function collectBatchTargetImages(
  targetId: string,
  nodes: NativeCanvasNode[],
  edges: NativeCanvasEdge[],
  fallbackTitle = "",
): BatchImportTargetImage[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return edges
    .filter((edge) => edge.target === targetId && edge.data?.inputKind === "batchTargetImage")
    .flatMap((edge) => {
      const source = nodeMap.get(edge.source);
      if (!source) return [];
      const sources = orderReferenceSourceImages(referenceSourceImages(source, nodes), edge.data?.referenceImageOrder);
      return sources.flatMap((entry) => {
        const imageUrl = String(entry.image.localUrl || entry.image.url || "").trim();
        if (!imageUrl) return [];
        const previewSourceUrl = canvasPreviewSourceUrl(imageUrl, entry.image.thumbUrl);
        const label = entry.label || fallbackTitle;
        return [{
          edgeId: edge.id,
          nodeId: entry.nodeId,
          title: entry.imageCount > 1 ? `${label} ${entry.imageIndex + 1}` : label,
          imageUrl: resolveLibraryImageUrl(imageUrl),
          previewUrl: previewSourceUrl ? resolveLibraryImageUrl(previewSourceUrl) : "",
          fileName: String(entry.image.fileName || "").trim() || label,
          width: Math.max(0, Number(entry.image.width || 0)),
          height: Math.max(0, Number(entry.image.height || 0)),
        }];
      });
    });
}

function collectPromptInputs(
  targetId: string,
  nodes: NativeCanvasNode[],
  edges: NativeCanvasEdge[],
  inputKind: "prompt" | "additionalReferencePrompt",
  fallbackTitle = "",
): ImageGeneratorPromptInput[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return edges
    .filter((edge) => edge.target === targetId && edge.data?.inputKind === inputKind)
    .flatMap((edge) => {
      const source = nodeMap.get(edge.source);
      if (!source) return [];
      return [{
        edgeId: edge.id,
        nodeId: source.id,
        title: fallbackTitle,
        text: String(source.data.text || "").trim(),
      }];
    });
}

export function collectImageGeneratorPrompts(
  targetId: string,
  nodes: NativeCanvasNode[],
  edges: NativeCanvasEdge[],
  fallbackTitle = "",
) {
  return collectPromptInputs(targetId, nodes, edges, "prompt", fallbackTitle);
}

export function collectAdditionalPromptInputs(
  targetId: string,
  nodes: NativeCanvasNode[],
  edges: NativeCanvasEdge[],
  fallbackTitle = "",
) {
  return collectPromptInputs(targetId, nodes, edges, "additionalReferencePrompt", fallbackTitle);
}

export function validateImageGeneratorReferences(rule: ImageModelRule, count: number): ReferenceValidationError {
  if (count > 0 && !rule.supportsReferenceImages) return "unsupported";
  if (count === 0 && rule.requiresReferenceImages) return "required";
  if (count > rule.maxReferenceImages) return "tooMany";
  return null;
}
