import { useCallback, useMemo, useRef } from "react";
import type { TFunction } from "i18next";
import type { ApiProvider } from "../../settings/apiProviders";
import { generateImageWithProvider, recoverImageGenerationTask } from "../core/apiImageGeneration";
import { collectPrompt, collectReferenceImages } from "../core/workflow";
import { IMAGE_ASPECT_RATIO_OPTIONS, IMAGE_RESOLUTION_OPTIONS } from "../constants";
import { fitImageNodeSize } from "../imageCrop";
import type { CanvasConnection, CanvasGenerationTask, CanvasNode } from "../types";
import { applyImageGenerationResult } from "./imageGenerationResult";
import { generationTaskRuntimeKey, isRecoverableImageGenerationTask } from "./generationTaskRuntime";

interface SavedCanvasAsset {
  url: string;
  fileName?: string;
  filePath?: string;
}

interface UseImageGenerationActionsOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  apiProviders: ApiProvider[];
  defaultImageProviderId: string;
  imageProviders: ApiProvider[];
  activeCanvasId: string;
  patchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  saveCanvasImageAsset: (source: { url?: string; dataUrl?: string; defaultName?: string; kind: "input" | "output" }) => Promise<SavedCanvasAsset>;
  patchGenerationNode: (canvasId: string, nodeId: string, resolvePatch: (node: CanvasNode) => Partial<CanvasNode>) => Promise<void>;
  persistActiveGenerationNode: (canvasId: string, nodeId: string, patch: Partial<CanvasNode>) => void;
  t: TFunction;
}

function fitGenerationNodeSize(aspectRatio: string) {
  const [rawW, rawH] = aspectRatio.split(":").map(Number);
  const ratioW = rawW || 1;
  const ratioH = rawH || 1;
  return fitImageNodeSize(ratioW * 1024, ratioH * 1024);
}

function supportsStandardImageGeneration(provider: ApiProvider) {
  return provider.protocol !== "gemini";
}

export function useImageGenerationActions({
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
}: UseImageGenerationActionsOptions) {
  const generationAbortControllersRef = useRef<Record<string, AbortController>>({});
  const activeGenerationTaskKeysRef = useRef<Set<string>>(new Set());
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const applyResult = useCallback((options: {
    canvasId: string;
    nodeId: string;
    provider: ApiProvider;
    model: string;
    resolution?: CanvasNode["imageResolution"];
    aspectRatio?: CanvasNode["imageAspectRatio"];
    result: { url: string; fileName: string; width?: number; height?: number };
    task?: CanvasGenerationTask;
    signal?: AbortSignal;
  }) => applyImageGenerationResult({
    ...options,
    saveCanvasImageAsset,
    patchGenerationNode,
  }), [patchGenerationNode, saveCanvasImageAsset]);

  const resumeImageGenerationTask = useCallback(async (node: CanvasNode) => {
    const task = node.generationTask;
    if (!isRecoverableImageGenerationTask(task)) return;
    const taskKey = generationTaskRuntimeKey(task);
    if (activeGenerationTaskKeysRef.current.has(taskKey)) return;
    const provider = apiProviders.find((item) => item.id === task.providerId && supportsStandardImageGeneration(item));
    if (!provider) {
      await patchGenerationNode(task.canvasId, task.nodeId, () => ({
        running: false,
        generationStatus: "",
        generationError: t("infiniteCanvas.noImageApiConfigured"),
        generationTask: { ...task, status: "interrupted", error: t("infiniteCanvas.noImageApiConfigured"), updatedAt: Date.now() },
      }));
      return;
    }
    activeGenerationTaskKeysRef.current.add(taskKey);
    await patchGenerationNode(task.canvasId, task.nodeId, (currentNode) => ({
      running: true,
      generationError: "",
      generationStatus: currentNode.generationStatus || t("infiniteCanvas.running"),
      generationTask: { ...(currentNode.generationTask || task), status: "running", updatedAt: Date.now() },
    }));
    try {
      const result = await recoverImageGenerationTask({
        provider,
        taskId: task.upstreamTaskId,
        onStatus: (message) => {
          void patchGenerationNode(task.canvasId, task.nodeId, (currentNode) => ({
            generationStatus: message,
            generationTask: currentNode.generationTask ? { ...currentNode.generationTask, status: "running", updatedAt: Date.now() } : task,
          }));
        },
      });
      await applyResult({
        canvasId: task.canvasId,
        nodeId: task.nodeId,
        provider,
        model: task.model,
        resolution: task.resolution,
        aspectRatio: task.aspectRatio as CanvasNode["imageAspectRatio"],
        result,
        task,
      });
    } catch (error) {
      await patchGenerationNode(task.canvasId, task.nodeId, (currentNode) => ({
        running: false,
        generationStatus: "",
        generationError: error instanceof Error ? error.message : String(error),
        generationTask: currentNode.generationTask ? {
          ...currentNode.generationTask,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          updatedAt: Date.now(),
        } : task,
      }));
    } finally {
      activeGenerationTaskKeysRef.current.delete(taskKey);
    }
  }, [apiProviders, applyResult, patchGenerationNode, t]);

  const resumeImageGenerationTasks = useCallback((canvasNodes: CanvasNode[]) => {
    canvasNodes.forEach((node) => {
      if (node.type === "imageGenerator" && node.generationTask?.upstreamTaskId) {
        void resumeImageGenerationTask(node);
      }
    });
  }, [resumeImageGenerationTask]);

  const runImageComposer = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "imageGenerator" || node.running) return;
    if (!activeCanvasId) {
      patchNode(nodeId, { generationError: t("infiniteCanvas.canvasDesktopRequired") });
      return;
    }
    const provider = apiProviders.find((item) => item.id === node.imageProviderId && supportsStandardImageGeneration(item))
      || apiProviders.find((item) => item.id === defaultImageProviderId && supportsStandardImageGeneration(item))
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
    const taskStartedAt = Date.now();
    const taskBase: CanvasGenerationTask = {
      id: `${activeCanvasId}:${nodeId}:${taskStartedAt}`,
      canvasId: activeCanvasId,
      nodeId,
      providerId: provider.id,
      model,
      status: "submitting",
      startedAt: taskStartedAt,
      updatedAt: taskStartedAt,
      prompt,
      referenceImages,
      resolution,
      aspectRatio,
    };
    const initialTaskKey = generationTaskRuntimeKey(taskBase);
    let upstreamTaskKey = "";
    activeGenerationTaskKeysRef.current.add(initialTaskKey);
    persistActiveGenerationNode(activeCanvasId, nodeId, {
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
      generationTask: taskBase,
    });

    const abortController = new AbortController();
    generationAbortControllersRef.current[nodeId]?.abort();
    generationAbortControllersRef.current[nodeId] = abortController;

    try {
      const setGenerationStatus = (message: string) => {
        void patchGenerationNode(activeCanvasId, nodeId, (currentNode) => ({
          generationStatus: message,
          generationTask: currentNode.generationTask ? { ...currentNode.generationTask, status: "running", updatedAt: Date.now() } : taskBase,
        }));
      };
      const result = await generateImageWithProvider({
        provider,
        model,
        prompt,
        referenceImages,
        resolution,
        aspectRatio,
        onStatus: setGenerationStatus,
        onTaskId: (upstreamTaskId) => {
          upstreamTaskKey = `${activeCanvasId}:${nodeId}:${upstreamTaskId}`;
          activeGenerationTaskKeysRef.current.delete(initialTaskKey);
          activeGenerationTaskKeysRef.current.add(upstreamTaskKey);
          void patchGenerationNode(activeCanvasId, nodeId, (currentNode) => ({
            generationTask: {
              ...(currentNode.generationTask || taskBase),
              upstreamTaskId,
              status: "running",
              updatedAt: Date.now(),
            },
          }));
        },
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      setGenerationStatus(t("infiniteCanvas.savingImage"));
      await applyResult({
        canvasId: activeCanvasId,
        nodeId,
        provider,
        model,
        resolution,
        aspectRatio,
        result,
        task: taskBase,
        signal: abortController.signal,
      });
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      await patchGenerationNode(activeCanvasId, nodeId, (currentNode) => ({
        running: false,
        generationError: isAbort ? "" : error instanceof Error ? error.message : String(error),
        generationStatus: "",
        generationTask: currentNode.generationTask ? {
          ...currentNode.generationTask,
          status: isAbort ? "interrupted" : "failed",
          error: isAbort ? "" : error instanceof Error ? error.message : String(error),
          updatedAt: Date.now(),
        } : undefined,
      }));
    } finally {
      activeGenerationTaskKeysRef.current.delete(initialTaskKey);
      if (upstreamTaskKey) activeGenerationTaskKeysRef.current.delete(upstreamTaskKey);
      if (generationAbortControllersRef.current[nodeId] === abortController) {
        delete generationAbortControllersRef.current[nodeId];
      }
    }
  }, [activeCanvasId, apiProviders, applyResult, connections, defaultImageProviderId, imageProviders, nodeMap, nodes, patchGenerationNode, patchNode, persistActiveGenerationNode, t]);

  const stopImageComposer = useCallback((nodeId: string) => {
    generationAbortControllersRef.current[nodeId]?.abort();
    delete generationAbortControllersRef.current[nodeId];
    patchNode(nodeId, {
      running: false,
      generationError: "",
      generationStatus: "",
    });
  }, [patchNode]);

  return {
    resumeImageGenerationTasks,
    runImageComposer,
    stopImageComposer,
  };
}
