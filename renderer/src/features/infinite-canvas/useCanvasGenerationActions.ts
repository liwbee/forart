import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type { LibtvModelOption } from "../../app/appConfig";
import type { ApiProvider } from "../settings/apiProviders";
import { generateChatWithProvider } from "./core/apiChatGeneration";
import { generateImageWithProvider } from "./core/apiImageGeneration";
import { collectPrompt, collectReferenceImages, collectUpstreamPrompt } from "./core/workflow";
import { IMAGE_ASPECT_RATIO_OPTIONS, IMAGE_RESOLUTION_OPTIONS } from "./constants";
import { fitImageNodeSize, readImageDimensions } from "./imageCrop";
import type { CanvasConnection, CanvasNode } from "./types";

interface SavedCanvasAsset {
  url: string;
  fileName?: string;
  filePath?: string;
}

interface UseCanvasGenerationActionsOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  apiProviders: ApiProvider[];
  defaultImageProviderId: string;
  imageProviders: ApiProvider[];
  defaultChatProvider: ApiProvider | null;
  chatProviders: ApiProvider[];
  lovartProvider: ApiProvider | null;
  patchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  setNodes: (updater: CanvasNode[] | ((current: CanvasNode[]) => CanvasNode[])) => void;
  saveCanvasImageAsset: (source: { url?: string; dataUrl?: string; defaultName?: string; kind: "input" | "output" }) => Promise<SavedCanvasAsset>;
  setLibtvStatus: (status: string) => void;
  t: TFunction;
}

function fitGenerationNodeSize(aspectRatio: string) {
  const [rawW, rawH] = aspectRatio.split(":").map(Number);
  const ratioW = rawW || 1;
  const ratioH = rawH || 1;
  return fitImageNodeSize(ratioW * 1024, ratioH * 1024);
}

export function useCanvasGenerationActions({
  nodes,
  connections,
  apiProviders,
  defaultImageProviderId,
  imageProviders,
  defaultChatProvider,
  chatProviders,
  lovartProvider,
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

  const runImageComposer = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "imageGenerator" || node.running) return;
    const provider = apiProviders.find((item) => item.id === node.imageProviderId && item.protocol !== "lovart" && item.protocol !== "gemini")
      || apiProviders.find((item) => item.id === defaultImageProviderId && item.protocol !== "lovart" && item.protocol !== "gemini")
      || imageProviders[0]
      || null;
    const model = node.imageModel && provider?.imageModels.includes(node.imageModel) ? node.imageModel : provider?.imageModels[0] || "";
    const resolution = IMAGE_RESOLUTION_OPTIONS.includes(node.imageResolution || "1k") ? node.imageResolution || "1k" : "1k";
    const aspectRatio = IMAGE_ASPECT_RATIO_OPTIONS.includes(node.imageAspectRatio || "1:1") ? node.imageAspectRatio || "1:1" : "1:1";
    if (!provider || !model) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.noImageApiConfigured") });
      return;
    }

    const prompt = [node.text || "", collectPrompt(node, nodes, connections)].filter(Boolean).join("\n\n").trim();
    const referenceImages = collectReferenceImages(node, nodes, connections);
    if (!prompt) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.promptRequired") });
      return;
    }

    const runningSize = fitGenerationNodeSize(aspectRatio);
    patchNode(nodeId, {
      running: true,
      x: Math.round(node.x + (node.w - runningSize.w) / 2),
      y: Math.round(node.y + (node.h - runningSize.h) / 2),
      ...runningSize,
      generationError: "",
      generationStatus: t("infiniteCanvas.running"),
      imageProviderId: provider.id,
      imageModel: model,
      imageResolution: resolution,
      imageAspectRatio: aspectRatio,
      imageMode: "imageGenerator",
    });

    const abortController = new AbortController();
    generationAbortControllersRef.current[nodeId]?.abort();
    generationAbortControllersRef.current[nodeId] = abortController;

    try {
      const setGenerationStatus = (message: string) => {
        patchNode(nodeId, { generationStatus: message });
      };
      const result = await generateImageWithProvider({ provider, model, prompt, referenceImages, resolution, aspectRatio, onStatus: setGenerationStatus, signal: abortController.signal });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      setGenerationStatus(t("infiniteCanvas.savingImage"));
      const saved = await saveCanvasImageAsset({ url: result.url, defaultName: result.fileName, kind: "output" });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const dimensions = await readImageDimensions(saved.url);
      const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : fitImageNodeSize(result.width || 1024, result.height || 1024);
      setNodes((current) => current.map((currentNode) => {
        if (currentNode.id === nodeId) {
          return {
            ...currentNode,
            url: saved.url,
            fileName: saved.fileName || result.fileName,
            imageProviderId: provider.id,
            imageModel: model,
            imageResolution: resolution,
            imageAspectRatio: aspectRatio,
            imageMode: "imageGenerator",
            imageSource: "generated",
            imageNaturalWidth: dimensions?.width || result.width || 1024,
            imageNaturalHeight: dimensions?.height || result.height || 1024,
            running: false,
            generationError: "",
            generationStatus: "",
            ...nextSize,
          };
        }
        return currentNode;
      }));
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
  }, [apiProviders, connections, defaultImageProviderId, imageProviders, nodeMap, nodes, patchNode, saveCanvasImageAsset, setNodes, t]);

  const stopImageComposer = useCallback((nodeId: string) => {
    generationAbortControllersRef.current[nodeId]?.abort();
    delete generationAbortControllersRef.current[nodeId];
    patchNode(nodeId, {
      running: false,
      generationError: "",
      generationStatus: "",
    });
  }, [patchNode]);

  const runLovartNode = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "lovart" || node.running) return;
    const provider = lovartProvider;
    if (!provider || !provider.accessKey.trim() || !provider.secretKey.trim()) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.lovartNeedsKeys") });
      return;
    }
    const prompt = [node.text || "", collectPrompt(node, nodes, connections)].filter(Boolean).join("\n\n").trim();
    const referenceImages = collectReferenceImages(node, nodes, connections);
    if (!prompt) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.promptRequired") });
      return;
    }

    const abortController = new AbortController();
    generationAbortControllersRef.current[nodeId]?.abort();
    generationAbortControllersRef.current[nodeId] = abortController;
    patchNode(nodeId, {
      running: true,
      imageProviderId: provider.id,
      generationError: "",
      generationStatus: t("infiniteCanvas.lovartSubmitting"),
    });

    try {
      if (!window.lovart?.generate) throw new Error("Lovart bridge is not available.");
      const result = await window.lovart.generate({
        providerId: provider.id,
        prompt,
        referenceImages,
        projectId: node.lovartProjectId,
        threadId: node.lovartThreadId,
        model: node.lovartModel || "",
        unlimited: node.lovartMode === "unlimited",
      });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      patchNode(nodeId, { generationStatus: t("infiniteCanvas.savingImage") });
      const saved = await saveCanvasImageAsset({ url: result.url, defaultName: result.fileName, kind: "output" });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const dimensions = await readImageDimensions(saved.url);
      const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
      setNodes((current) => current.map((currentNode) => {
        if (currentNode.id !== nodeId) return currentNode;
        return {
          ...currentNode,
          url: saved.url,
          fileName: saved.fileName || result.fileName,
          lovartProjectId: result.projectId || currentNode.lovartProjectId,
          lovartThreadId: result.threadId || currentNode.lovartThreadId,
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
  }, [connections, lovartProvider, nodeMap, nodes, patchNode, saveCanvasImageAsset, setNodes, t]);

  const stopLovartNode = useCallback((nodeId: string) => {
    generationAbortControllersRef.current[nodeId]?.abort();
    delete generationAbortControllersRef.current[nodeId];
    patchNode(nodeId, {
      running: false,
      generationError: "",
      generationStatus: "",
    });
  }, [patchNode]);

  const checkLovartNodeStatus = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "lovart") return;
    const provider = lovartProvider;
    if (!provider || !provider.accessKey.trim() || !provider.secretKey.trim()) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.lovartNeedsKeys") });
      return;
    }
    if (!node.lovartThreadId) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.lovartNoThread") });
      return;
    }
    patchNode(nodeId, {
      generationError: "",
      generationStatus: t("infiniteCanvas.lovartCheckingStatus"),
    });
    try {
      if (!window.lovart?.status) throw new Error("Lovart bridge is not available.");
      const result = await window.lovart.status({
        providerId: provider.id,
        threadId: node.lovartThreadId,
      });
      if (result.pendingConfirmation) {
        patchNode(nodeId, {
          running: false,
          generationError: t("infiniteCanvas.lovartNeedsConfirmation"),
          generationStatus: "",
        });
        return;
      }
      if (result.imageUrl) {
        patchNode(nodeId, { generationStatus: t("infiniteCanvas.savingImage") });
        const saved = await saveCanvasImageAsset({ url: result.imageUrl, defaultName: "lovart-image.png", kind: "output" });
        const dimensions = await readImageDimensions(saved.url);
        const nextSize = dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : {};
        setNodes((current) => current.map((currentNode) => {
          if (currentNode.id !== nodeId) return currentNode;
          return {
            ...currentNode,
            url: saved.url,
            fileName: saved.fileName || "lovart-image.png",
            imageSource: "generated",
            imageNaturalWidth: dimensions?.width,
            imageNaturalHeight: dimensions?.height,
            running: false,
            generationError: "",
            generationStatus: "",
            ...nextSize,
          };
        }));
        return;
      }
      patchNode(nodeId, {
        running: /pending|queued|running|processing|submitted|created/i.test(result.status || ""),
        generationError: "",
        generationStatus: t("infiniteCanvas.lovartStatusResult", { status: result.status || t("infiniteCanvas.running") }),
      });
    } catch (error) {
      patchNode(nodeId, {
        running: false,
        generationError: error instanceof Error ? error.message : String(error),
        generationStatus: "",
      });
    }
  }, [lovartProvider, nodeMap, patchNode, saveCanvasImageAsset, setNodes, t]);

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
    const upstreamPrompt = collectUpstreamPrompt(node, nodes, connections).trim();
    const referenceImages = collectReferenceImages(node, nodes, connections);
    if (!upstreamPrompt && !referenceImages.length) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.llmInputRequired") });
      return;
    }
    const instruction = (node.variablePrompt || t("infiniteCanvas.llmDefaultInstruction")).trim();
    const prompt = [
      instruction,
      upstreamPrompt ? `${t("infiniteCanvas.llmInputLabel")}\n${upstreamPrompt}` : "",
      referenceImages.length ? t("infiniteCanvas.llmImageInputHint") : "",
    ].filter(Boolean).join("\n\n");

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
      const text = await generateChatWithProvider({ provider, model, prompt, referenceImages, signal: abortController.signal });
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
    runImageComposer,
    stopImageComposer,
    runLovartNode,
    stopLovartNode,
    checkLovartNodeStatus,
    runLibtvImageNode,
    stopLibtvImageNode,
    syncLibtvImageNode,
    runLlmNode,
    stopLlmNode,
  };
}
