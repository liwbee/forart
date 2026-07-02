import { useCallback, useMemo, useRef } from "react";
import type { TFunction } from "i18next";
import type { ApiProvider } from "../../settings/apiProviders";
import { collectPrompt, collectReferenceImages } from "../core/workflow";
import { fitImageNodeSize } from "../imageCrop";
import type { CanvasConnection, CanvasGenerationTask, CanvasNode } from "../types";
import { generationTaskRuntimeKey, isGenerationTaskActive } from "./generationTaskRuntime";
import { createLocalGenerationTask, getLocalGenerationTask, resumeLocalGenerationTask, stopLocalGenerationTasksForNode, updateLocalGenerationTask, waitForLocalGenerationTask } from "./generationTaskRegistry";
import { detectImageModelRuleId, getImageModelRule, normalizeImageModelSizeSelection } from "../../settings/imageModelRules";
import { collectGenerationTasksFromNodes } from "./nodeGenerationTaskAnchors";

interface UseImageGenerationActionsOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  apiProviders: ApiProvider[];
  imageProviders: ApiProvider[];
  activeCanvasId: string;
  patchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  persistActiveGenerationNode: (canvasId: string, nodeId: string, patch: Partial<CanvasNode>) => Promise<void>;
  writebackGenerationTask: (task: CanvasGenerationTask) => Promise<void>;
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
  imageProviders,
  activeCanvasId,
  patchNode,
  persistActiveGenerationNode,
  writebackGenerationTask,
  t,
}: UseImageGenerationActionsOptions) {
  const generationAbortControllersRef = useRef<Record<string, AbortController>>({});
  const activeGenerationTaskKeysRef = useRef<Set<string>>(new Set());
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const resumeImageGenerationTask = useCallback(async (task: CanvasGenerationTask) => {
    if (task.target?.type && task.target.type !== "imageGenerator") return;
    if (!isGenerationTaskActive(task)) return;
    const taskKey = generationTaskRuntimeKey(task);
    if (activeGenerationTaskKeysRef.current.has(taskKey)) return;
    const provider = apiProviders.find((item) => item.id === task.providerId && supportsStandardImageGeneration(item));
    if (!provider) {
      const interruptedTask = await updateLocalGenerationTask(task.id, {
        status: "interrupted",
        error: t("infiniteCanvas:noImageApiConfigured"),
        interruptReason: "provider_lost",
        updatedAt: Date.now(),
      });
      await writebackGenerationTask(interruptedTask || {
        ...task,
        status: "interrupted",
        error: t("infiniteCanvas:noImageApiConfigured"),
        interruptReason: "provider_lost",
        updatedAt: Date.now(),
      });
      return;
    }
    activeGenerationTaskKeysRef.current.add(taskKey);
    try {
      const localTask = await getLocalGenerationTask(task.id);
      if (localTask && isGenerationTaskActive(localTask)) {
        patchNode(task.nodeId, { generationTask: localTask });
      }
      await resumeLocalGenerationTask(task.id, { ...task, provider, model: task.model, modelRule: getImageModelRule(provider.modelRules.image[task.model] || detectImageModelRuleId(task.model)) });
      const completedTask = await waitForLocalGenerationTask(task.id, (nextTask) => {
        patchNode(task.nodeId, { generationTask: nextTask });
      });
      if (completedTask.status !== "succeeded" || !completedTask.result?.localUrl) {
        throw new Error(completedTask.error || "Image generation failed.");
      }
      await writebackGenerationTask(completedTask);
    } catch (error) {
      const failedTask = await updateLocalGenerationTask(task.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      });
      await writebackGenerationTask(failedTask || {
        ...task,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      });
    } finally {
      activeGenerationTaskKeysRef.current.delete(taskKey);
    }
  }, [apiProviders, patchNode, t, writebackGenerationTask]);

  const resumeImageGenerationTasks = useCallback((canvasNodes: CanvasNode[]) => {
    collectGenerationTasksFromNodes(canvasNodes).forEach((task) => {
      if ((task.target?.type === "imageGenerator" || !task.target) && isGenerationTaskActive(task)) {
        void resumeImageGenerationTask(task);
      }
    });
  }, [resumeImageGenerationTask]);

  const runImageComposer = useCallback(async (nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node || node.type !== "imageGenerator") return;
    if (!activeCanvasId) {
      patchNode(nodeId, { generationError: t("infiniteCanvas:canvasDesktopRequired") });
      return;
    }
    if (isGenerationTaskActive(node.generationTask)) return;
    const provider = apiProviders.find((item) => item.id === node.imageProviderId && supportsStandardImageGeneration(item))
      || imageProviders[0]
      || null;
    const model = node.imageModel && provider?.imageModels.includes(node.imageModel) ? node.imageModel : provider?.imageModels[0] || "";
    if (!provider || !model) {
      patchNode(nodeId, { generationError: t("infiniteCanvas:noImageApiConfigured") });
      return;
    }
    const modelRule = getImageModelRule(provider.modelRules.image[model] || detectImageModelRuleId(model));
    const normalizedSize = normalizeImageModelSizeSelection(modelRule, node.imageResolution, node.imageAspectRatio);
    const { resolution, aspectRatio } = normalizedSize;

    const prompt = [node.text || "", collectPrompt(node, nodes, connections)].filter(Boolean).join("\n\n").trim();
    const referenceImages = collectReferenceImages(node, nodes, connections);
    if (!prompt) {
      patchNode(nodeId, { generationError: t("infiniteCanvas:promptRequired") });
      return;
    }

    const runningSize = fitGenerationNodeSize(aspectRatio);
    const taskStartedAt = Date.now();
    let taskBase: CanvasGenerationTask = {
      id: `${activeCanvasId}:${nodeId}:${taskStartedAt}`,
      canvasId: activeCanvasId,
      nodeId,
      target: { type: "imageGenerator", nodeId },
      kind: "image",
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
    taskBase = await createLocalGenerationTask({
      ...taskBase,
      provider,
      modelRule,
    } as CanvasGenerationTask & { provider: ApiProvider; modelRule: unknown });
    const initialTaskKey = generationTaskRuntimeKey(taskBase);
    let upstreamTaskKey = "";
    activeGenerationTaskKeysRef.current.add(initialTaskKey);
    await persistActiveGenerationNode(activeCanvasId, nodeId, {
      x: Math.round(node.x + (node.w - runningSize.w) / 2),
      y: Math.round(node.y + (node.h - runningSize.h) / 2),
      ...runningSize,
      generationError: "",
      imageProviderId: provider.id,
      imageModel: model,
      imageResolution: resolution,
      imageAspectRatio: aspectRatio,
      imageMode: "imageGenerator",
      outputDownloadState: undefined,
      outputDownloadedAt: undefined,
      generationTask: taskBase,
    });

    const abortController = new AbortController();
    generationAbortControllersRef.current[nodeId]?.abort();
    generationAbortControllersRef.current[nodeId] = abortController;

    try {
      const completedTask = await waitForLocalGenerationTask(taskBase.id, (nextTask) => {
        patchNode(nodeId, { generationTask: nextTask });
        if (nextTask.upstreamTaskId && !upstreamTaskKey) {
          upstreamTaskKey = `${activeCanvasId}:${nodeId}:${nextTask.upstreamTaskId}`;
          activeGenerationTaskKeysRef.current.delete(initialTaskKey);
          activeGenerationTaskKeysRef.current.add(upstreamTaskKey);
          void persistActiveGenerationNode(activeCanvasId, nodeId, { generationTask: nextTask });
        }
      }, abortController.signal);
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (completedTask.status !== "succeeded" || !completedTask.result?.localUrl) {
        throw new Error(completedTask.error || "Image generation failed.");
      }
      await writebackGenerationTask(completedTask);
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      const terminalTask = await updateLocalGenerationTask(taskBase.id, {
        status: isAbort ? "interrupted" : "failed",
        error: isAbort ? "" : error instanceof Error ? error.message : String(error),
        interruptReason: isAbort ? "user_stop" : undefined,
        updatedAt: Date.now(),
      });
      await writebackGenerationTask(terminalTask || {
        ...taskBase,
        status: isAbort ? "interrupted" : "failed",
        error: isAbort ? "" : error instanceof Error ? error.message : String(error),
        interruptReason: isAbort ? "user_stop" : undefined,
        updatedAt: Date.now(),
      });
    } finally {
      activeGenerationTaskKeysRef.current.delete(initialTaskKey);
      if (upstreamTaskKey) activeGenerationTaskKeysRef.current.delete(upstreamTaskKey);
      if (generationAbortControllersRef.current[nodeId] === abortController) {
        delete generationAbortControllersRef.current[nodeId];
      }
    }
  }, [activeCanvasId, apiProviders, connections, imageProviders, nodeMap, nodes, patchNode, persistActiveGenerationNode, t, writebackGenerationTask]);

  const stopImageComposer = useCallback((nodeId: string) => {
    generationAbortControllersRef.current[nodeId]?.abort();
    delete generationAbortControllersRef.current[nodeId];
    if (activeCanvasId) {
      void (async () => {
        await stopLocalGenerationTasksForNode(activeCanvasId, nodeId);
      })();
    }
    patchNode(nodeId, {
      generationError: "",
      generationTask: undefined,
    });
  }, [activeCanvasId, patchNode]);

  return {
    resumeImageGenerationTasks,
    runImageComposer,
    stopImageComposer,
  };
}
