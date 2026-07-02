import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type { TFunction } from "i18next";
import type { ApiProvider } from "../settings/apiProviders";
import { generateChatWithProvider } from "./core/apiChatGeneration";
import { buildLlmNodeRequest } from "./llm/llmNodeRequest";
import type { CanvasConnection, CanvasDocumentRecord, CanvasGroup, CanvasNode, Viewport } from "./types";
import { useCanvasGenerationPersistence } from "./generation/canvasGenerationPersistence";
import { useImageGenerationActions } from "./generation/useImageGenerationActions";
import { useGenerationTaskWriteback } from "./generation/generationTaskWriteback";

interface UseCanvasGenerationActionsOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  groups: CanvasGroup[];
  viewport: Viewport;
  apiProviders: ApiProvider[];
  imageProviders: ApiProvider[];
  defaultChatProvider: ApiProvider | null;
  chatProviders: ApiProvider[];
  activeCanvasId: string;
  activeCanvasTitle: string;
  activeProject: CanvasDocumentRecord | null;
  activeCanvasIdRef: MutableRefObject<string>;
  patchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  setNodes: (updater: CanvasNode[] | ((current: CanvasNode[]) => CanvasNode[])) => void;
  t: TFunction;
}

export function useCanvasGenerationActions({
  nodes,
  connections,
  groups,
  viewport,
  apiProviders,
  imageProviders,
  defaultChatProvider,
  chatProviders,
  activeCanvasId,
  activeCanvasTitle,
  activeProject,
  activeCanvasIdRef,
  patchNode,
  setNodes,
  t,
}: UseCanvasGenerationActionsOptions) {
  const generationAbortControllersRef = useRef<Record<string, AbortController>>({});
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const { persistActiveGenerationNode } = useCanvasGenerationPersistence({
    activeCanvasTitle,
    activeProject,
    connections,
    groups,
    viewport,
    activeCanvasIdRef,
    setNodes,
  });
  const { writebackGenerationTask } = useGenerationTaskWriteback({
    nodes,
    activeCanvasTitle,
    activeProject,
    activeCanvasIdRef,
    connections,
    groups,
    viewport,
    setNodes,
    t,
  });
  const {
    resumeImageGenerationTasks,
    runImageComposer,
    stopImageComposer,
  } = useImageGenerationActions({
    nodes,
    connections,
    apiProviders,
    imageProviders,
    activeCanvasId,
    patchNode,
    persistActiveGenerationNode,
    writebackGenerationTask,
    t,
  });

  const runLlmNode = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "llm" || node.running) return;
    const provider = apiProviders.find((item) => item.id === node.chatProviderId)
      || defaultChatProvider
      || chatProviders[0]
      || null;
    const model = node.chatModel && provider?.chatModels.includes(node.chatModel) ? node.chatModel : provider?.chatModels[0] || "";
    if (!provider || !model) {
      patchNode(nodeId, { generationError: t("infiniteCanvas:noChatApiConfigured") });
      return;
    }
    const request = buildLlmNodeRequest({ node, nodes, connections, t });
    if (!request.hasInput) {
      patchNode(nodeId, { generationError: t("infiniteCanvas:llmInputRequired") });
      return;
    }

    const abortController = new AbortController();
    generationAbortControllersRef.current[nodeId]?.abort();
    generationAbortControllersRef.current[nodeId] = abortController;
    patchNode(nodeId, {
      running: true,
      chatProviderId: provider.id,
      chatModel: model,
      generationError: "",
      generationStatus: t("infiniteCanvas:llmRunning"),
    });

    try {
      const text = await generateChatWithProvider({ provider, model, prompt: request.prompt, referenceImages: request.referenceImages, signal: abortController.signal });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      patchNode(nodeId, {
        text,
        running: false,
        generationError: "",
        generationStatus: "",
        chatProviderId: provider.id,
        chatModel: model,
      });
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      patchNode(nodeId, {
        running: false,
        generationError: isAbort ? "" : error instanceof Error ? error.message : String(error),
        generationStatus: "",
      });
    } finally {
      if (generationAbortControllersRef.current[nodeId] === abortController) {
        delete generationAbortControllersRef.current[nodeId];
      }
    }
  }, [apiProviders, chatProviders, connections, defaultChatProvider, nodeMap, nodes, patchNode, t]);

  const stopLlmNode = useCallback((nodeId: string) => {
    generationAbortControllersRef.current[nodeId]?.abort();
    delete generationAbortControllersRef.current[nodeId];
    patchNode(nodeId, { running: false, generationError: "", generationStatus: "" });
  }, [patchNode]);

  return {
    resumeImageGenerationTasks,
    writebackGenerationTask,
    runImageComposer,
    stopImageComposer,
    runLlmNode,
    stopLlmNode,
  };
}
