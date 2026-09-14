import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import type { ImageModelRule } from "../../settings/imageModelRules";
import { canvasPreviewSourceUrl } from "../canvasThumbnails";
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
  nodeId: string;
  order: number;
  title: string;
  imageUrl: string;
  previewUrl: string;
  /** Optional human-facing mention label, e.g. the batch source's 主图. */
  mentionLabel?: string;
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
  if (kind === "prompt" || kind === "llm" || kind === "smartReverse") return "prompt";
  return undefined;
}

export function nextReferenceOrder(
  targetId: string,
  edges: NativeCanvasEdge[],
  inputKind: "referenceImage" | "additionalReferenceImage" = "referenceImage",
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
      const images = typeof nativeCanvasNodeImages === "function"
        ? nativeCanvasNodeImages(source.data)
        : (() => {
          const primary = nativeCanvasNodePrimaryImage(source.data);
          return primary ? [primary] : [];
        })();
      return images.flatMap((image, index) => {
        const imageUrl = String(image.localUrl || image.url || "").trim();
        if (!imageUrl) return [];
        const previewSourceUrl = canvasPreviewSourceUrl(imageUrl, image.thumbUrl);
        return [{
          edgeId: images.length > 1 ? `${edge.id}:${index}` : edge.id,
          nodeId: source.id,
          order: Math.max(1, Number(edge.data?.referenceOrder || 1)) + index / 1000,
          title: images.length > 1 ? `${String(source.data.label || fallbackTitle)} ${index + 1}` : String(source.data.label || fallbackTitle),
          imageUrl: resolveLibraryImageUrl(imageUrl),
          previewUrl: previewSourceUrl ? resolveLibraryImageUrl(previewSourceUrl) : "",
        }];
      });
    })
    .sort((left, right) => left.order - right.order || left.edgeId.localeCompare(right.edgeId));
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
