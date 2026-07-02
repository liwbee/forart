import type { ImageModelRule } from "../../settings/imageModelRules";
import { collectPrompt } from "../core/workflow";
import { isImageLikeNode } from "../nodePredicates";
import type { CanvasConnection, CanvasNode } from "../types";
import { BASE_PUBLIC_REFERENCE_LIMIT } from "./actionFissionTypes";

export function effectivePublicReferenceLimit(rule: ImageModelRule | null | undefined) {
  return Math.min(BASE_PUBLIC_REFERENCE_LIMIT, rule?.maxReferenceImages ?? BASE_PUBLIC_REFERENCE_LIMIT);
}

export function collectDirectActionFissionReferenceImages(node: CanvasNode, nodes: CanvasNode[], connections: CanvasConnection[]) {
  const nodeById = new Map(nodes.map((item) => [item.id, item]));
  const seenUrls = new Set<string>();
  const results: string[] = [];
  connections
    .filter((connection) => connection.to === node.id)
    .forEach((connection) => {
      const source = nodeById.get(connection.from);
      if (!isImageLikeNode(source) || !source.url) return;
      const url = source.url.trim();
      if (!url || seenUrls.has(url)) return;
      seenUrls.add(url);
      results.push(url);
    });
  return results;
}

export function collectDirectActionFissionPrompt(node: CanvasNode, nodes: CanvasNode[], connections: CanvasConnection[]) {
  return connections
    .filter((connection) => connection.to === node.id)
    .map((connection) => nodes.find((item) => item.id === connection.from))
    .filter((source): source is CanvasNode => source?.type === "prompt")
    .map((source) => collectPrompt(source, nodes, connections).trim())
    .filter(Boolean)
    .join("\n\n");
}

export function countDirectActionFissionImageConnections(nodeId: string, nodes: CanvasNode[], connections: CanvasConnection[]) {
  const nodeById = new Map(nodes.map((item) => [item.id, item]));
  return connections
    .filter((connection) => connection.to === nodeId)
    .filter((connection) => {
      const source = nodeById.get(connection.from);
      return isImageLikeNode(source);
    })
    .length;
}

export function validatePublicReferenceCount(count: number, rule: ImageModelRule | null | undefined) {
  const limit = effectivePublicReferenceLimit(rule);
  return {
    valid: count <= limit,
    limit,
  };
}

export function validateTotalReferenceCount(count: number, rule: ImageModelRule | null | undefined) {
  const limit = rule?.maxReferenceImages ?? BASE_PUBLIC_REFERENCE_LIMIT;
  return {
    valid: count <= limit,
    limit,
  };
}
