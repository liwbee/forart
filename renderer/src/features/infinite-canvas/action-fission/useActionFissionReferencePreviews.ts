import { useMemo } from "react";
import { useCanvasStore } from "../canvasStore";
import type { ImageGeneratorInputPreview } from "../composers/composerTypes";
import { collectPrompt } from "../core/workflow";
import { isImageLikeNode } from "../nodePredicates";
import type { CanvasConnection } from "../types";

type ImagePreviewItem = Extract<ImageGeneratorInputPreview, { kind: "image" }>;
type PromptPreviewItem = Extract<ImageGeneratorInputPreview, { kind: "prompt" }>;

function connectedInputSignature(connections: CanvasConnection[], nodeId: string) {
  return JSON.stringify(connections.filter((connection) => connection.to === nodeId).map((connection) => [connection.id, connection.from]));
}

function parseConnectedInputs(signature: string): Array<[string, string]> {
  if (!signature) return [];
  try {
    const input = JSON.parse(signature) as unknown;
    if (!Array.isArray(input)) return [];
    return input.flatMap((item) => {
      if (!Array.isArray(item) || item.length < 2) return [];
      const connectionId = typeof item[0] === "string" ? item[0] : "";
      const fromId = typeof item[1] === "string" ? item[1] : "";
      return connectionId && fromId ? [[connectionId, fromId] as [string, string]] : [];
    });
  } catch {
    return [];
  }
}

function parsePreviewItems<T>(signature: string): T[] {
  if (!signature) return [];
  try {
    const input = JSON.parse(signature) as unknown;
    return Array.isArray(input) ? input as T[] : [];
  } catch {
    return [];
  }
}

export function useActionFissionReferencePreviews(nodeId: string): ImagePreviewItem[] {
  const connectionSignature = useCanvasStore((state) => connectedInputSignature(state.connections, nodeId));
  const connectedInputs = useMemo(() => parseConnectedInputs(connectionSignature), [connectionSignature]);
  const previewSignature = useCanvasStore((state) => JSON.stringify(connectedInputs.flatMap(([connectionId, fromId]) => {
    const source = state.nodeLookup.get(fromId);
    if (!isImageLikeNode(source) || !source.url) return [];
    return [{
      id: source.id,
      connectionId,
      kind: "image",
      order: 0,
      title: source.fileName || source.title || source.type,
      url: source.thumbUrl || source.url,
    } satisfies Omit<ImagePreviewItem, "order"> & { order: number }];
  }).map((item, index) => ({ ...item, order: index + 1 }))));

  return useMemo(() => parsePreviewItems<ImagePreviewItem>(previewSignature), [previewSignature]);
}

export function useActionFissionPromptPreviews(nodeId: string): PromptPreviewItem[] {
  const connectionSignature = useCanvasStore((state) => connectedInputSignature(state.connections, nodeId));
  const connectedInputs = useMemo(() => parseConnectedInputs(connectionSignature), [connectionSignature]);
  const previewSignature = useCanvasStore((state) => JSON.stringify(connectedInputs.flatMap(([connectionId, fromId]) => {
    const source = state.nodeLookup.get(fromId);
    if (source?.type !== "prompt") return [];
    const text = collectPrompt(source, state.nodes, state.connections).trim();
    if (!text) return [];
    return [{
      id: source.id,
      connectionId,
      kind: "prompt",
      title: source.title || source.type,
      text,
    } satisfies PromptPreviewItem];
  })));

  return useMemo(() => parsePreviewItems<PromptPreviewItem>(previewSignature), [previewSignature]);
}
