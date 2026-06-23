import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { TFunction } from "i18next";
import type { LibtvModelOption } from "../../app/appConfig";
import type { ApiProvider } from "../settings/apiProviders";
import { generateChatWithProvider } from "./core/apiChatGeneration";
import { fitImageNodeSize, readImageDimensions } from "./imageCrop";
import { buildLlmNodeRequest } from "./llm/llmNodeRequest";
import type { CanvasConnection, CanvasGroup, CanvasNode, CanvasProjectRecord, Viewport } from "./types";
import { useCanvasGenerationPersistence } from "./generation/canvasGenerationPersistence";
import { useImageGenerationActions } from "./generation/useImageGenerationActions";

interface SavedCanvasAsset {
  url: string;
  fileName?: string;
  filePath?: string;
}

interface UseCanvasGenerationActionsOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  groups: CanvasGroup[];
  viewport: Viewport;
  apiProviders: ApiProvider[];
  defaultImageProviderId: string;
  imageProviders: ApiProvider[];
  defaultChatProvider: ApiProvider | null;
  chatProviders: ApiProvider[];
  activeCanvasId: string;
  activeCanvasTitle: string;
  activeProject: CanvasProjectRecord | null;
  activeCanvasIdRef: MutableRefObject<string>;
  patchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  setNodes: (updater: CanvasNode[] | ((current: CanvasNode[]) => CanvasNode[])) => void;
  saveCanvasImageAsset: (source: { url?: string; dataUrl?: string; defaultName?: string; kind: "input" | "output" }) => Promise<SavedCanvasAsset>;
  setLibtvStatus: (status: string) => void;
  t: TFunction;
}

export function useCanvasGenerationActions({
  nodes,
  connections,
  groups,
  viewport,
  apiProviders,
  defaultImageProviderId,
  imageProviders,
  defaultChatProvider,
  chatProviders,
  activeCanvasId,
  activeCanvasTitle,
  activeProject,
  activeCanvasIdRef,
  patchNode,
  setNodes,
  saveCanvasImageAsset,
  setLibtvStatus,
  t,
}: UseCanvasGenerationActionsOptions) {
  const [libtvModels, setLibtvModels] = useState<LibtvModelOption[]>([]);
  const [libtvModelsLoading, setLibtvModelsLoading] = useState(false);
  const generationAbortControllersRef = useRef<Record<string, AbortController>>({});
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const { patchGenerationNode, persistActiveGenerationNode } = useCanvasGenerationPersistence({
    activeCanvasTitle,
    activeProject,
    connections,
    groups,
    viewport,
    activeCanvasIdRef,
    setNodes,
  });
  const {
    resumeImageGenerationTasks,
    runImageComposer,
    stopImageComposer,
  } = useImageGenerationActions({
    nodes,
    connections,
    apiProviders,
    defaultImageProviderId,
    imageProviders,
    activeCanvasId,
    patchNode,
    saveCanvasImageAsset,
    patchGenerationNode,
    persistActiveGenerationNode,
    t,
  });

  const refreshLibtvModels = useCallback(async () => {
    if (!window.libtv?.imageModels || libtvModelsLoading) return;
    setLibtvModelsLoading(true);
    try {
      const result = await window.libtv.imageModels();
      setLibtvModels(result.models || []);
    } catch (error) {
      setLibtvStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLibtvModelsLoading(false);
    }
  }, [libtvModelsLoading, setLibtvStatus]);

  useEffect(() => {
    if (!window.libtv?.imageModels) return;
    void refreshLibtvModels();
  }, [refreshLibtvModels]);

  const runLibtvImageNode = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "libtvImage" || node.running) return;
    if (!window.libtv?.runImageNode) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.libtvBridgeUnavailable") });
      return;
    }
    if (!node.libtvProjectId || !node.libtvNodeId) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.libtvMissingBinding") });
      return;
    }
    patchNode(nodeId, { generationError: "", generationStatus: t("infiniteCanvas.libtvSubmitting"), running: true });
    try {
      const result = await window.libtv.runImageNode({
        projectId: node.libtvProjectId,
        nodeId: node.libtvNodeId,
      });
      if (!result.url) {
        patchNode(nodeId, { running: false, generationStatus: "", generationError: t("infiniteCanvas.libtvNoImageResult") });
        return;
      }
      patchNode(nodeId, { generationStatus: t("infiniteCanvas.savingImage") });
      const saved = await saveCanvasImageAsset({ url: result.url, defaultName: result.fileName || "libtv-image.png", kind: "output" });
      const dimensions = await readImageDimensions(saved.url);
      const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
      setNodes((current) => current.map((currentNode) => {
        if (currentNode.id !== nodeId) return currentNode;
        return {
          ...currentNode,
          url: saved.url,
          fileName: saved.fileName || result.fileName || "libtv-image.png",
          libtvOriginalUrl: result.url,
          imageSource: "generated",
          imageNaturalWidth: dimensions?.width,
          imageNaturalHeight: dimensions?.height,
          running: false,
          generationError: "",
          generationStatus: "",
          ...nextSize,
        };
      }));
    } catch (error) {
      patchNode(nodeId, {
        running: false,
        generationError: error instanceof Error ? error.message : String(error),
        generationStatus: "",
      });
    }
  }, [nodeMap, patchNode, saveCanvasImageAsset, setNodes, t]);

  const stopLibtvImageNode = useCallback((nodeId: string) => {
    patchNode(nodeId, {
      running: false,
      generationError: "",
      generationStatus: "",
    });
  }, [patchNode]);

  const syncLibtvImageNode = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "libtvImage" || !window.libtv?.syncNode) return;
    if (!node.libtvProjectId || !node.libtvNodeId) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.libtvMissingBinding") });
      return;
    }
    patchNode(nodeId, { generationError: "", generationStatus: t("infiniteCanvas.libtvSyncing") });
    try {
      const result = await window.libtv.syncNode({ projectId: node.libtvProjectId, nodeId: node.libtvNodeId });
      if (!result.url) {
        patchNode(nodeId, { generationStatus: "", generationError: t("infiniteCanvas.libtvNoImageResult") });
        return;
      }
      const saved = await saveCanvasImageAsset({ url: result.url, defaultName: result.fileName || "libtv-image.png", kind: "output" });
      const dimensions = await readImageDimensions(saved.url);
      const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
      setNodes((current) => current.map((currentNode) => {
        if (currentNode.id !== nodeId) return currentNode;
        return {
          ...currentNode,
          url: saved.url,
          fileName: saved.fileName || result.fileName || "libtv-image.png",
          libtvOriginalUrl: result.url,
          imageSource: "generated",
          imageNaturalWidth: dimensions?.width,
          imageNaturalHeight: dimensions?.height,
          generationError: "",
          generationStatus: "",
          ...nextSize,
        };
      }));
    } catch (error) {
      patchNode(nodeId, {
        generationError: error instanceof Error ? error.message : String(error),
        generationStatus: "",
      });
    }
  }, [nodeMap, patchNode, saveCanvasImageAsset, setNodes, t]);

  const runLlmNode = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "llm" || node.running) return;
    const provider = apiProviders.find((item) => item.id === node.chatProviderId)
      || defaultChatProvider
      || chatProviders[0]
      || null;
    const model = node.chatModel && provider?.chatModels.includes(node.chatModel) ? node.chatModel : provider?.chatModels[0] || "";
    if (!provider || !model) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.noChatApiConfigured") });
      return;
    }
    const request = buildLlmNodeRequest({ node, nodes, connections, t });
    if (!request.hasInput) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.llmInputRequired") });
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
      generationStatus: t("infiniteCanvas.llmRunning"),
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
    libtvModels,
    libtvModelsLoading,
    refreshLibtvModels,
    resumeImageGenerationTasks,
    runImageComposer,
    stopImageComposer,
    runLibtvImageNode,
    stopLibtvImageNode,
    syncLibtvImageNode,
    runLlmNode,
    stopLlmNode,
  };
}
