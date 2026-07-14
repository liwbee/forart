import { useCallback, useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import { isImageProviderConfigured, loadApiSettings, orderedApiProviders } from "../../settings/apiProviders";
import {
  detectImageModelRuleId,
  getImageModelRule,
  normalizeImageModelSizeSelection,
  normalizeImageModelGenerationSelection,
} from "../../settings/imageModelRules";
import type {
  NativeCanvasEdge,
  NativeCanvasNode,
  NativeGenerationTask,
  NativeGenerationTaskStatus,
} from "../nativeCanvas";
import {
  collectImageGeneratorReferences,
  validateImageGeneratorReferences,
} from "./imageGenerationInputs";
import {
  beginGenerationLaunching,
  endGenerationLaunching,
  imageGenerationLaunchKey,
  useGenerationRuntimeStore,
} from "./generationRuntimeStore";
import { activateGenerationHook } from "./generationHookLifecycle";

export const TERMINAL_TASK_STATUSES = new Set<NativeGenerationTaskStatus>([
  "succeeded",
  "failed",
  "interrupted",
  "superseded",
]);

export function isNativeGenerationTaskActive(task: NativeGenerationTask | undefined) {
  return task?.status === "queued" || task?.status === "submitting" || task?.status === "running";
}

export function normalizeGenerationTask(input: unknown): NativeGenerationTask | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<NativeGenerationTask>;
  const targetValue = value.target && typeof value.target === "object" ? value.target : undefined;
  const id = String(value.id || "");
  const canvasId = String(value.canvasId || "");
  const nodeId = String(value.nodeId || targetValue?.nodeId || "");
  if (!id || !canvasId || !nodeId) return null;
  const status = String(value.status || "queued") as NativeGenerationTaskStatus;
  const result = value.result && typeof value.result === "object" ? value.result : undefined;
  return {
    id,
    canvasId,
    nodeId,
    target: targetValue?.type === "actionFissionRow" && String(targetValue.rowId || "")
      ? { type: "actionFissionRow", nodeId, rowId: String(targetValue.rowId) }
      : { type: "imageGenerator", nodeId },
    kind: "image",
    providerId: String(value.providerId || ""),
    model: String(value.model || ""),
    upstreamTaskId: value.upstreamTaskId ? String(value.upstreamTaskId) : undefined,
    status,
    startedAt: Number(value.startedAt || Date.now()),
    runningAt: value.runningAt ? Number(value.runningAt) : undefined,
    updatedAt: Number(value.updatedAt || Date.now()),
    completedAt: value.completedAt ? Number(value.completedAt) : undefined,
    durationMs: value.durationMs ? Number(value.durationMs) : undefined,
    prompt: value.prompt ? String(value.prompt) : undefined,
    referenceImages: Array.isArray(value.referenceImages) ? value.referenceImages.map(String).filter(Boolean) : [],
    resolution: value.resolution ? String(value.resolution) : undefined,
    aspectRatio: value.aspectRatio ? String(value.aspectRatio) : undefined,
    quality: value.quality ? String(value.quality) : undefined,
    imageCount: Number(value.imageCount || 1),
    message: value.message ? String(value.message) : undefined,
    messageCode: value.messageCode ? String(value.messageCode) : undefined,
    messageParams: value.messageParams && typeof value.messageParams === "object"
      ? value.messageParams as Record<string, string | number>
      : undefined,
    error: value.error ? String(value.error) : undefined,
    interruptReason: value.interruptReason === "user_stop"
      || value.interruptReason === "app_restart"
      || value.interruptReason === "provider_lost"
      || value.interruptReason === "superseded"
      ? value.interruptReason
      : undefined,
    result: result ? {
      url: result.url ? String(result.url) : undefined,
      localUrl: result.localUrl ? String(result.localUrl) : undefined,
      thumbUrl: result.thumbUrl ? String(result.thumbUrl) : undefined,
      fileName: result.fileName ? String(result.fileName) : undefined,
      width: Number.isFinite(Number(result.width)) ? Number(result.width) : undefined,
      height: Number.isFinite(Number(result.height)) ? Number(result.height) : undefined,
      results: Array.isArray(result.results) ? result.results.map((item) => ({
        url: item?.url ? String(item.url) : undefined,
        localUrl: item?.localUrl ? String(item.localUrl) : undefined,
        thumbUrl: item?.thumbUrl ? String(item.thumbUrl) : undefined,
        fileName: item?.fileName ? String(item.fileName) : undefined,
        width: Number.isFinite(Number(item?.width)) ? Number(item.width) : undefined,
        height: Number.isFinite(Number(item?.height)) ? Number(item.height) : undefined,
      })) : undefined,
    } : undefined,
  };
}

export function collectConnectedPrompt(nodeId: string, nodes: NativeCanvasNode[], edges: NativeCanvasEdge[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  edges
    .filter((edge) => edge.data?.inputKind === "prompt")
    .forEach((edge) => incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge.source]));
  const visited = new Set<string>();

  function visit(currentId: string): string[] {
    if (visited.has(currentId)) return [];
    visited.add(currentId);
    const current = nodeMap.get(currentId);
    if (!current) return [];
    const ownText = current.data.kind === "prompt" || current.data.kind === "llm"
      ? String(current.data.text || "").trim()
      : "";
    return [ownText, ...(incoming.get(currentId) || []).flatMap(visit)].filter(Boolean);
  }

  return (incoming.get(nodeId) || []).flatMap(visit).join("\n\n");
}

export async function getGenerationTaskWithRetry(taskId: string, signal: AbortSignal) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4 && !signal.aborted; attempt += 1) {
    try {
      return await window.easyTool!.getGenerationTask(taskId);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 500 * (2 ** attempt)));
      }
    }
  }
  if (signal.aborted) throw new Error("Interrupted");
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "Generation task polling failed."));
}

interface UseNativeImageGenerationOptions {
  canvasId: string;
  edges: NativeCanvasEdge[];
  nodes: NativeCanvasNode[];
  patchNodeData: (nodeId: string, patch: Partial<NativeCanvasNode["data"]>) => void;
  setNodeImage: (nodeId: string, imageUrl: string, label: string) => void;
  t: TFunction;
}

export function useNativeImageGeneration({
  canvasId,
  edges,
  nodes,
  patchNodeData,
  setNodeImage,
  t,
}: UseNativeImageGenerationOptions) {
  const mountedRef = useRef(true);
  const pollingControllersRef = useRef(new Map<string, AbortController>());
  const recoveringRemoteTasksRef = useRef(new Set<string>());

  const pollTask = useCallback(async (taskId: string, nodeId: string) => {
    if (!mountedRef.current || !window.easyTool?.getGenerationTask || pollingControllersRef.current.has(taskId)) return;
    const controller = new AbortController();
    pollingControllersRef.current.set(taskId, controller);
    try {
      while (!controller.signal.aborted) {
        let task = normalizeGenerationTask(await getGenerationTaskWithRetry(taskId, controller.signal));
        if (!task) {
          const nodeAnchor = nodes.find((node) => node.id === nodeId)?.data.generationTask;
          const anchor = nodeAnchor;
          if (!anchor?.upstreamTaskId || !window.easyTool.resumeGenerationTask) {
            if (anchor) {
              const interruptedTask: NativeGenerationTask = {
                ...anchor,
                status: "interrupted",
                interruptReason: "app_restart",
                error: t("infiniteCanvas:generationInterruptedUnexpected"),
                updatedAt: Date.now(),
              };
              patchNodeData(nodeId, {
                generationTask: interruptedTask,
                generationTaskId: undefined,
                generationError: interruptedTask.error,
              });
              return;
            }
            throw new Error(t("infiniteCanvas:generationTaskNotFound"));
          }
          const settings = await loadApiSettings();
          const provider = settings.providers.find((item) => item.id === anchor.providerId);
          if (!provider) {
            const interruptedTask: NativeGenerationTask = {
              ...anchor,
              status: "interrupted",
              interruptReason: "provider_lost",
              error: t("infiniteCanvas:noImageApiConfigured"),
              updatedAt: Date.now(),
            };
            patchNodeData(nodeId, {
              generationTask: interruptedTask,
              generationTaskId: undefined,
              generationError: interruptedTask.error,
            });
            return;
          }
          const modelRule = getImageModelRule(provider.modelRules.image[anchor.model] || detectImageModelRuleId(anchor.model));
          task = normalizeGenerationTask(await window.easyTool.resumeGenerationTask(taskId, {
            ...anchor,
            provider,
            model: anchor.model,
            modelRule,
          }));
          if (!task) throw new Error(t("infiniteCanvas:generationInterruptedUnexpected"));
        }
        patchNodeData(nodeId, {
          generationTask: task,
          generationTaskId: TERMINAL_TASK_STATUSES.has(task.status) ? undefined : task.id,
          generationRemoteTaskId: TERMINAL_TASK_STATUSES.has(task.status)
            ? undefined
            : task.upstreamTaskId || nodes.find((node) => node.id === nodeId)?.data.generationRemoteTaskId,
          generationError: task.status === "failed" ? task.error || t("infiniteCanvas:generationFailed") : "",
        });
        if (TERMINAL_TASK_STATUSES.has(task.status)) {
          if (task.status === "succeeded" && task.result?.localUrl) {
            setNodeImage(nodeId, task.result.localUrl, task.result.fileName || "Generated image");
            patchNodeData(nodeId, {
              generatedImages: (task.result.results?.length ? task.result.results : [task.result]).map((result) => ({
                ...result,
                downloadState: "pending",
                downloadedAt: undefined,
              })),
              multiImageExpanded: false,
              multiImageCollapsedSize: undefined,
            });
          }
          return;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        const anchor = nodes.find((node) => node.id === nodeId)?.data.generationTask;
        patchNodeData(nodeId, {
          generationTask: anchor ? {
            ...anchor,
            status: "interrupted",
            interruptReason: "app_restart",
            error: message,
            updatedAt: Date.now(),
          } : undefined,
          generationTaskId: undefined,
          generationError: message,
        });
      }
    } finally {
      pollingControllersRef.current.delete(taskId);
    }
  }, [nodes, patchNodeData, setNodeImage, t]);

  const recoverGenerationTask = useCallback(async (nodeId: string, remoteTaskId: string) => {
    if (!window.easyTool?.recoverGenerationTask || recoveringRemoteTasksRef.current.has(remoteTaskId)) return;
    recoveringRemoteTasksRef.current.add(remoteTaskId);
    try {
      const node = nodes.find((item) => item.id === nodeId && item.data.kind === "imageGenerator");
      if (!node) return;
      const settings = await loadApiSettings();
      const provider = settings.providers.find((item) => item.id === node.data.imageProviderId);
      const model = String(node.data.imageModel || "");
      if (!provider || !model) {
        patchNodeData(nodeId, { generationError: t("infiniteCanvas:noImageApiConfigured") });
        return;
      }
      const modelRule = getImageModelRule(provider.modelRules.image[model] || detectImageModelRuleId(model));
      const task = normalizeGenerationTask(await window.easyTool.recoverGenerationTask({
        canvasId,
        nodeId,
        upstreamTaskId: remoteTaskId,
        providerId: provider.id,
        provider,
        model,
        modelRule,
      }));
      if (!task) throw new Error(t("infiniteCanvas:generationInterruptedUnexpected"));
      patchNodeData(nodeId, { generationTask: task, generationTaskId: task.id, generationRemoteTaskId: remoteTaskId, generationError: "" });
      await pollTask(task.id, nodeId);
    } catch (error) {
      patchNodeData(nodeId, { generationError: error instanceof Error ? error.message : String(error) });
    } finally {
      recoveringRemoteTasksRef.current.delete(remoteTaskId);
    }
  }, [canvasId, nodes, patchNodeData, pollTask, t]);

  const runImageGeneration = useCallback(async (nodeId: string, options?: { promptOverride?: string }) => {
    const node = nodes.find((item) => item.id === nodeId && item.data.kind === "imageGenerator");
    if (!node || node.data.generationTaskId || isNativeGenerationTaskActive(node.data.generationTask)) return;
    if (!canvasId || !window.easyTool?.createGenerationTask) {
      patchNodeData(nodeId, { generationError: t("infiniteCanvas:canvasDesktopRequired") });
      return;
    }

    const launchKey = imageGenerationLaunchKey(canvasId, nodeId);
    if (useGenerationRuntimeStore.getState().launchingKeys.has(launchKey)) return;
    beginGenerationLaunching([launchKey]);
    try {
      const settings = await loadApiSettings();
      const providers = orderedApiProviders(settings.providers, settings.providerOrder)
        .filter(isImageProviderConfigured);
      const provider = providers.find((item) => item.id === node.data.imageProviderId)
        || providers.find((item) => item.id === settings.defaultImageProviderId)
        || providers[0];
      const model = provider?.imageModels.includes(node.data.imageModel || "")
        ? node.data.imageModel || ""
        : provider?.imageModels[0] || "";
      if (!provider || !model) {
        patchNodeData(nodeId, { generationError: t("infiniteCanvas:noImageApiConfigured") });
        return;
      }

      const modelRule = getImageModelRule(provider.modelRules.image[model] || detectImageModelRuleId(model));
      const size = normalizeImageModelSizeSelection(modelRule, node.data.imageResolution, node.data.imageAspectRatio);
      const referenceInputs = collectImageGeneratorReferences(nodeId, nodes, edges, t("infiniteCanvas:referenceImage"));
      const generationSelection = normalizeImageModelGenerationSelection(
        modelRule,
        node.data.imageQuality,
        node.data.imageCount,
        referenceInputs.length,
      );
      if (provider.protocol === "gemini") generationSelection.imageCount = 1;
      const referenceError = validateImageGeneratorReferences(modelRule, referenceInputs.length);
      if (referenceError) {
        const message = referenceError === "unsupported"
          ? t("infiniteCanvas:imageGenerationReferenceNotSupported")
          : referenceError === "required"
            ? t("infiniteCanvas:imageGenerationMissingReferenceImage")
            : t("infiniteCanvas:imageGenerationTooManyReferenceImages", { count: modelRule.maxReferenceImages });
        patchNodeData(nodeId, { generationError: message });
        return;
      }
      const prompt = [String(options?.promptOverride ?? node.data.text ?? "").trim(), collectConnectedPrompt(nodeId, nodes, edges)]
        .filter(Boolean)
        .join("\n\n");
      if (!prompt) {
        patchNodeData(nodeId, { generationError: t("infiniteCanvas:promptRequired") });
        return;
      }

      patchNodeData(nodeId, {
        generationError: "",
        imageProviderId: provider.id,
        imageModel: model,
        imageResolution: size.resolution,
        imageAspectRatio: size.aspectRatio,
        imageQuality: generationSelection.quality || undefined,
        imageCount: generationSelection.imageCount,
      });
      const task = normalizeGenerationTask(await window.easyTool.createGenerationTask({
        canvasId,
        nodeId,
        target: { type: "imageGenerator", nodeId },
        kind: "image",
        providerId: provider.id,
        provider,
        model,
        modelRule,
        prompt,
        referenceImages: referenceInputs.map((item) => item.imageUrl),
        resolution: size.resolution,
        aspectRatio: size.aspectRatio,
        quality: generationSelection.quality || undefined,
        imageCount: generationSelection.imageCount,
        status: "submitting",
      }));
      if (!task) throw new Error(t("infiniteCanvas:generationTaskCreateFailed"));
      if (!mountedRef.current) return;
      patchNodeData(nodeId, { generationTask: task, generationTaskId: task.id, generationError: "" });
      endGenerationLaunching([launchKey]);
      await pollTask(task.id, nodeId);
    } catch (error) {
      if (mountedRef.current) patchNodeData(nodeId, { generationError: error instanceof Error ? error.message : String(error) });
    } finally {
      endGenerationLaunching([launchKey]);
    }
  }, [canvasId, edges, nodes, patchNodeData, pollTask, t]);

  const stopImageGeneration = useCallback(async (nodeId: string) => {
    const data = nodes.find((node) => node.id === nodeId)?.data;
    const task = data?.generationTask;
    const taskId = task?.id || data?.generationTaskId;
    if (!taskId || (task && !isNativeGenerationTaskActive(task))) return;
    pollingControllersRef.current.get(taskId)?.abort();
    try {
      const stopped = normalizeGenerationTask(await window.easyTool?.stopGenerationTask?.(taskId));
      patchNodeData(nodeId, {
        generationTask: stopped || (task ? { ...task, status: "interrupted", updatedAt: Date.now() } : undefined),
        generationTaskId: undefined,
        generationError: "",
      });
    } catch (error) {
      patchNodeData(nodeId, { generationError: error instanceof Error ? error.message : String(error) });
    }
  }, [nodes, patchNodeData]);

  useEffect(() => {
    nodes.forEach((node) => {
      const task = node.data.generationTask;
      if (task?.canvasId === canvasId && isNativeGenerationTaskActive(task)) {
        void pollTask(task.id, node.id);
      } else if (node.data.generationTaskId) {
        void pollTask(node.data.generationTaskId, node.id);
      } else if (node.data.generationRemoteTaskId) {
        void recoverGenerationTask(node.id, node.data.generationRemoteTaskId);
      }
    });
  }, [canvasId, nodes, pollTask, recoverGenerationTask]);

  useEffect(() => activateGenerationHook(mountedRef, () => {
    pollingControllersRef.current.forEach((controller) => controller.abort());
    pollingControllersRef.current.clear();
    recoveringRemoteTasksRef.current.clear();
  }), []);

  return { runImageGeneration, stopImageGeneration };
}
