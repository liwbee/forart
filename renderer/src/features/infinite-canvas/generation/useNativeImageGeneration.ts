import { useCallback, useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import { isImageProviderConfigured, loadApiSettings, orderedApiProviders } from "../../settings/apiProviders";
import {
  detectImageModelRuleId,
  getImageModelRule,
  normalizeImageModelSizeSelection,
  normalizeImageModelGenerationSelection,
} from "../../settings/imageModelRules";
import {
  nativeCanvasNodeTaskId,
  type NativeCanvasEdge,
  type NativeCanvasNode,
} from "../nativeCanvas";
import {
  collectImageGeneratorReferences,
  validateImageGeneratorReferences,
} from "./imageGenerationInputs";
import {
  beginGenerationLaunching,
  clearGenerationRuntimeError,
  endGenerationLaunching,
  imageGenerationLaunchKey,
  setGenerationRuntimeError,
  useGenerationRuntimeStore,
} from "./generationRuntimeStore";
import { activateGenerationHook } from "./generationHookLifecycle";
import { isGenerationTaskActive, isGenerationTaskTerminal, useGenerationTaskCache, watchGenerationTask } from "./generationTaskCache";

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

interface UseNativeImageGenerationOptions {
  canvasId: string;
  edges: NativeCanvasEdge[];
  nodes: NativeCanvasNode[];
  patchNodeData: (nodeId: string, patch: Partial<NativeCanvasNode["data"]>) => void;
  t: TFunction;
}

export function useNativeImageGeneration({
  canvasId,
  edges,
  nodes,
  patchNodeData,
  t,
}: UseNativeImageGenerationOptions) {
  const mountedRef = useRef(true);
  const taskControllersRef = useRef(new Map<string, AbortController>());
  const handledTerminalVersionsRef = useRef(new Map<string, number>());

  const watchTask = useCallback(async (taskId: string, nodeId: string) => {
    if (!mountedRef.current || !window.forartGenerationTasks?.get || taskControllersRef.current.has(taskId)) return;
    const cachedTask = useGenerationTaskCache.getState().tasksById[taskId];
    if (cachedTask && isGenerationTaskTerminal(cachedTask.status)
      && (handledTerminalVersionsRef.current.get(taskId) || -1) >= cachedTask.version) return;
    const controller = new AbortController();
    taskControllersRef.current.set(taskId, controller);
    try {
      await watchGenerationTask(taskId, controller.signal, (dto) => {
        if (dto.executorKind !== "api") return;
        if (!isGenerationTaskTerminal(dto.status)) return;
        if ((handledTerminalVersionsRef.current.get(dto.id) || -1) >= dto.version) return;
        handledTerminalVersionsRef.current.set(dto.id, dto.version);
        if (dto.status === "succeeded" && dto.result?.images.length) {
          const images = dto.result.images.map((image) => ({
            url: image.assetUrl,
            localUrl: image.assetUrl,
            thumbUrl: image.thumbUrl,
            fileName: image.fileName,
            width: image.width,
            height: image.height,
            downloadState: "pending" as const,
            downloadedAt: undefined,
          }));
          const primary = images[0];
          patchNodeData(nodeId, {
            label: primary.fileName || "Generated image",
            generatedImages: images,
            imageNaturalWidth: primary.width,
            imageNaturalHeight: primary.height,
            multiImageExpanded: false,
            multiImageCollapsedSize: undefined,
          });
        }
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        setGenerationRuntimeError(imageGenerationLaunchKey(canvasId, nodeId), message);
      }
    } finally {
      taskControllersRef.current.delete(taskId);
    }
  }, [canvasId, patchNodeData]);

  const runImageGeneration = useCallback(async (nodeId: string, options?: { promptOverride?: string }) => {
    const node = nodes.find((item) => item.id === nodeId && item.data.kind === "imageGenerator");
    const currentTaskId = node ? nativeCanvasNodeTaskId(node.data) : "";
    const currentTask = currentTaskId ? useGenerationTaskCache.getState().tasksById[currentTaskId] : undefined;
    if (!node || isGenerationTaskActive(currentTask)) return;
    if (!canvasId || !window.forartGenerationTasks?.start) {
      setGenerationRuntimeError(imageGenerationLaunchKey(canvasId, nodeId), t("infiniteCanvas:canvasDesktopRequired"));
      return;
    }

    const launchKey = imageGenerationLaunchKey(canvasId, nodeId);
    if (useGenerationRuntimeStore.getState().launchingKeys.has(launchKey)) return;
    beginGenerationLaunching([launchKey]);
    clearGenerationRuntimeError(launchKey);
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
        setGenerationRuntimeError(launchKey, t("infiniteCanvas:noImageApiConfigured"));
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
        setGenerationRuntimeError(launchKey, message);
        return;
      }
      const prompt = [String(options?.promptOverride ?? node.data.text ?? "").trim(), collectConnectedPrompt(nodeId, nodes, edges)]
        .filter(Boolean)
        .join("\n\n");
      if (!prompt) {
        setGenerationRuntimeError(launchKey, t("infiniteCanvas:promptRequired"));
        return;
      }

      patchNodeData(nodeId, {
        imageProviderId: provider.id,
        imageModel: model,
        imageResolution: size.resolution,
        imageAspectRatio: size.aspectRatio,
        imageQuality: generationSelection.quality || undefined,
        imageCount: generationSelection.imageCount,
      });
      const task = await window.forartGenerationTasks.start("api", {
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
      });
      if (!task) throw new Error(t("infiniteCanvas:generationTaskCreateFailed"));
      if (!mountedRef.current) return;
      patchNodeData(nodeId, {
        latestGenerationTaskId: task.id,
      });
      endGenerationLaunching([launchKey]);
      await watchTask(task.id, nodeId);
    } catch (error) {
      if (mountedRef.current) setGenerationRuntimeError(launchKey, error instanceof Error ? error.message : String(error));
    } finally {
      endGenerationLaunching([launchKey]);
    }
  }, [canvasId, edges, nodes, patchNodeData, t, watchTask]);

  const stopImageGeneration = useCallback(async (nodeId: string) => {
    const data = nodes.find((node) => node.id === nodeId)?.data;
    const taskId = data ? nativeCanvasNodeTaskId(data) : "";
    const task = taskId ? useGenerationTaskCache.getState().tasksById[taskId] : undefined;
    if (!taskId || !isGenerationTaskActive(task)) return;
    taskControllersRef.current.get(taskId)?.abort();
    try {
      await window.forartGenerationTasks?.stop(taskId);
      clearGenerationRuntimeError(imageGenerationLaunchKey(canvasId, nodeId));
    } catch (error) {
      setGenerationRuntimeError(imageGenerationLaunchKey(canvasId, nodeId), error instanceof Error ? error.message : String(error));
    }
  }, [canvasId, nodes]);

  useEffect(() => {
    nodes.forEach((node) => {
      const taskId = nativeCanvasNodeTaskId(node.data);
      if (taskId) void watchTask(taskId, node.id);
    });
  }, [canvasId, nodes, watchTask]);

  useEffect(() => activateGenerationHook(mountedRef, () => {
    taskControllersRef.current.forEach((controller) => controller.abort());
    taskControllersRef.current.clear();
  }), []);

  return { runImageGeneration, stopImageGeneration };
}
