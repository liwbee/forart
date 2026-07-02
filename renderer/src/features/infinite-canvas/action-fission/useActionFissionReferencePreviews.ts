import { useMemo } from "react";
import { useCanvasStore } from "../canvasStore";
import type { ImageGeneratorInputPreview } from "../composers/composerTypes";
import { collectPrompt } from "../core/workflow";
import { isImageLikeNode } from "../nodePredicates";

export function useActionFissionReferencePreviews(nodeId: string): Extract<ImageGeneratorInputPreview, { kind: "image" }>[] {
  const connections = useCanvasStore((state) => state.connections);
  const nodeLookup = useCanvasStore((state) => state.nodeLookup);

  return useMemo(() => {
    const previews: Extract<ImageGeneratorInputPreview, { kind: "image" }>[] = [];
    connections
      .filter((connection) => connection.to === nodeId)
      .forEach((connection) => {
        const source = nodeLookup.get(connection.from);
        if (!isImageLikeNode(source) || !source.url) return;
        previews.push({
          id: source.id,
          connectionId: connection.id,
          kind: "image",
          order: previews.length + 1,
          title: source.fileName || source.title || source.type,
          url: source.url,
        });
      });
    return previews;
  }, [connections, nodeId, nodeLookup]);
}

export function useActionFissionPromptPreviews(nodeId: string): Extract<ImageGeneratorInputPreview, { kind: "prompt" }>[] {
  const connections = useCanvasStore((state) => state.connections);
  const nodes = useCanvasStore((state) => state.nodes);
  const nodeLookup = useCanvasStore((state) => state.nodeLookup);

  return useMemo(() => {
    const previews: Extract<ImageGeneratorInputPreview, { kind: "prompt" }>[] = [];
    connections
      .filter((connection) => connection.to === nodeId)
      .forEach((connection) => {
        const source = nodeLookup.get(connection.from);
        if (source?.type !== "prompt") return;
        const text = collectPrompt(source, nodes, connections).trim();
        if (!text) return;
        previews.push({
          id: source.id,
          connectionId: connection.id,
          kind: "prompt",
          title: source.title || source.type,
          text,
        });
      });
    return previews;
  }, [connections, nodeId, nodeLookup, nodes]);
}
