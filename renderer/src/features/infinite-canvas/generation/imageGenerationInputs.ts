import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import type { ImageModelRule } from "../../settings/imageModelRules";
import { nativeCanvasNodePrimaryImage } from "../nativeCanvas";
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
}

export interface ImageGeneratorPromptInput {
  edgeId: string;
  nodeId: string;
  title: string;
  text: string;
}

export type ReferenceValidationError = "unsupported" | "required" | "tooMany" | null;

export function inputKindForSource(kind: NativeCanvasNodeKind): NativeCanvasInputKind | undefined {
  if (kind === "imageLoader" || kind === "imageGenerator") return "referenceImage";
  if (kind === "prompt" || kind === "llm") return "prompt";
  return undefined;
}

export function nextReferenceOrder(targetId: string, edges: NativeCanvasEdge[]) {
  return edges.reduce((largest, edge) => (
    edge.target === targetId && edge.data?.inputKind === "referenceImage"
      ? Math.max(largest, Number(edge.data.referenceOrder || 0))
      : largest
  ), 0) + 1;
}

export function edgeDataForConnection(
  sourceKind: NativeCanvasNodeKind,
  targetKind: NativeCanvasNodeKind,
  targetId: string,
  edges: NativeCanvasEdge[],
): NativeCanvasEdgeData | undefined {
  if (targetKind !== "imageGenerator" && targetKind !== "actionFission") return undefined;
  const inputKind = inputKindForSource(sourceKind);
  if (!inputKind) return undefined;
  return inputKind === "referenceImage"
    ? { inputKind, referenceOrder: nextReferenceOrder(targetId, edges) }
    : { inputKind };
}

export function collectImageGeneratorReferences(
  targetId: string,
  nodes: NativeCanvasNode[],
  edges: NativeCanvasEdge[],
  fallbackTitle = "",
): ImageGeneratorReferenceInput[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return edges
    .filter((edge) => edge.target === targetId && edge.data?.inputKind === "referenceImage")
    .flatMap((edge) => {
      const source = nodeMap.get(edge.source);
      const primaryImage = source ? nativeCanvasNodePrimaryImage(source.data) : null;
      const imageUrl = String(primaryImage?.localUrl || primaryImage?.url || "").trim();
      if (!source || !imageUrl) return [];
      return [{
        edgeId: edge.id,
        nodeId: source.id,
        order: Math.max(1, Number(edge.data?.referenceOrder || 1)),
        title: String(primaryImage?.fileName || fallbackTitle),
        imageUrl: resolveLibraryImageUrl(imageUrl),
        previewUrl: resolveLibraryImageUrl(String(primaryImage?.thumbUrl || imageUrl)),
      }];
    })
    .sort((left, right) => left.order - right.order || left.edgeId.localeCompare(right.edgeId));
}

export function collectImageGeneratorPrompts(
  targetId: string,
  nodes: NativeCanvasNode[],
  edges: NativeCanvasEdge[],
  fallbackTitle = "",
): ImageGeneratorPromptInput[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return edges
    .filter((edge) => edge.target === targetId && edge.data?.inputKind === "prompt")
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

export function validateImageGeneratorReferences(rule: ImageModelRule, count: number): ReferenceValidationError {
  if (count > 0 && !rule.supportsReferenceImages) return "unsupported";
  if (count === 0 && rule.requiresReferenceImages) return "required";
  if (count > rule.maxReferenceImages) return "tooMany";
  return null;
}
