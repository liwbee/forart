import { useCallback, useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import { nativeCanvasNodeTaskId, type NativeCanvasEdge, type NativeCanvasNode } from "../nativeCanvas";
import { collectImageGeneratorReferences } from "../generation/imageGenerationInputs";
import {
  beginGenerationLaunching,
  clearGenerationRuntimeError,
  endGenerationLaunching,
  imageGenerationLaunchKey,
  setGenerationRuntimeError,
  useGenerationRuntimeStore,
} from "../generation/generationRuntimeStore";
import { activateGenerationHook } from "../generation/generationHookLifecycle";
import { deriveLibtvModelCapabilities } from "./libtvModelSchema";
import {
  isGenerationTaskActive,
  isGenerationTaskTerminal,
  useGenerationTaskCache,
  watchGenerationTask,
} from "../generation/generationTaskCache";

function collectConnectedPrompt(nodeId: string, nodes: NativeCanvasNode[], edges: NativeCanvasEdge[]) {
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

interface UseNativeLibtvGenerationOptions {
  canvasId: string;
  edges: NativeCanvasEdge[];
  nodes: NativeCanvasNode[];
  patchNodeData: (nodeId: string, patch: Partial<NativeCanvasNode["data"]>) => void;
  t: TFunction;
}

export function useNativeLibtvGeneration({
  canvasId,
  edges,
  nodes,
  patchNodeData,
  t,
}: UseNativeLibtvGenerationOptions) {
  const mountedRef = useRef(true);
  const taskControllersRef = useRef(new Map<string, AbortController>());
  const handledTerminalVersionsRef = useRef(new Map<string, number>());

  const patchLibtvState = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    const current = nodes.find((node) => node.id === nodeId)?.data.libtvImageGeneration || {};
    const cleanCurrent = { ...current } as Record<string, unknown>;
    delete cleanCurrent.error;
    patchNodeData(nodeId, {
      libtvImageGeneration: { ...cleanCurrent, ...patch },
    });
  }, [nodes, patchNodeData]);

  const watchTask = useCallback(async (taskId: string, nodeId: string) => {
    if (!mountedRef.current || !window.forartGenerationTasks?.get || taskControllersRef.current.has(taskId)) return;
    const cachedTask = useGenerationTaskCache.getState().tasksById[taskId];
    if (cachedTask && isGenerationTaskTerminal(cachedTask.status)
      && (handledTerminalVersionsRef.current.get(taskId) || -1) >= cachedTask.version) return;
    const controller = new AbortController();
    taskControllersRef.current.set(taskId, controller);
    try {
      await watchGenerationTask(taskId, controller.signal, (dto) => {
        if (dto.executorKind !== "libtv") return;
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
            label: primary.fileName || "LibTV generated image",
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
        setGenerationRuntimeError(imageGenerationLaunchKey(canvasId, nodeId), error instanceof Error ? error.message : String(error));
      }
    } finally {
      taskControllersRef.current.delete(taskId);
    }
  }, [canvasId, patchNodeData]);

  const runLibtvGeneration = useCallback(async (nodeId: string, options?: { promptOverride?: string }) => {
    const node = nodes.find((item) => item.id === nodeId && item.data.kind === "imageGenerator");
    const state = node?.data.libtvImageGeneration || {};
    const currentTaskId = node ? nativeCanvasNodeTaskId(node.data) : "";
    const currentTask = currentTaskId ? useGenerationTaskCache.getState().tasksById[currentTaskId] : undefined;
    if (!node || isGenerationTaskActive(currentTask)) return;
    const libtvApi = window.libtv;
    if (!canvasId || !window.forartGenerationTasks?.start || !libtvApi) {
      setGenerationRuntimeError(imageGenerationLaunchKey(canvasId, nodeId), t("infiniteCanvas:libtvUnavailable"));
      return;
    }

    const launchKey = imageGenerationLaunchKey(canvasId, nodeId);
    if (useGenerationRuntimeStore.getState().launchingKeys.has(launchKey)) return;
    beginGenerationLaunching([launchKey]);
    clearGenerationRuntimeError(launchKey);
    try {
      const status = await libtvApi.status();
      if (!status.available) throw new Error(status.error || t("infiniteCanvas:libtvUnavailable"));
      const account = await libtvApi.account();
      if (!account.loggedIn) throw new Error(account.error || t("infiniteCanvas:libtvNotLoggedIn"));
      const modelName = String(state.modelName || "").trim();
      if (!modelName) throw new Error(t("infiniteCanvas:libtvModelRequired"));
      const schema = await libtvApi.imageModelSchema({ model: modelName });
      const capabilities = deriveLibtvModelCapabilities(schema);
      const references = collectImageGeneratorReferences(nodeId, nodes, edges, t("infiniteCanvas:referenceImage"));
      if (!capabilities.supportsReferenceImages && references.length) {
        throw new Error(t("infiniteCanvas:imageGenerationReferenceNotSupported"));
      }
      if (references.length > capabilities.maxReferenceImages) {
        throw new Error(t("infiniteCanvas:imageGenerationTooManyReferenceImages", { count: capabilities.maxReferenceImages }));
      }
      const prompt = [String(options?.promptOverride ?? node.data.text ?? "").trim(), collectConnectedPrompt(nodeId, nodes, edges)]
        .filter(Boolean)
        .join("\n\n");
      if (!prompt) throw new Error(t("infiniteCanvas:promptRequired"));
      const storedResolution = capabilities.resolutionField === "resolution"
        ? String(state.resolution || "")
        : String(state.quality || "");
      const selectedResolution = capabilities.resolutions.includes(storedResolution)
        ? storedResolution
        : capabilities.defaultResolution;
      const selectedQuality = capabilities.qualities.includes(String(state.quality || ""))
        ? String(state.quality)
        : capabilities.defaultQuality;
      const resolution = capabilities.resolutionField === "resolution" ? selectedResolution : "";
      const quality = capabilities.resolutionField === "quality" ? selectedResolution : selectedQuality;
      const aspectRatio = capabilities.aspectRatios.includes(String(state.aspectRatio || ""))
        ? String(state.aspectRatio)
        : capabilities.defaultAspectRatio;
      const storedCount = String(state.count || "");
      const count = Number(capabilities.imageCounts.includes(storedCount)
        ? storedCount
        : capabilities.defaultImageCount);
      patchLibtvState(nodeId, { quality, resolution: resolution || undefined, aspectRatio, count });
      const task = await window.forartGenerationTasks.start("libtv", {
        canvasId,
        nodeId,
        target: { type: "imageGenerator", nodeId },
        prompt,
        modelName,
        count,
        quality,
        resolution,
        aspectRatio,
        referenceImages: references.map((reference) => reference.imageUrl),
        nodeTitle: t("infiniteCanvas:imageGenerator"),
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      });
      if (!task) throw new Error(t("infiniteCanvas:generationTaskCreateFailed"));
      if (!mountedRef.current) return;
      patchNodeData(nodeId, {
        latestGenerationTaskId: task.id,
        libtvImageGeneration: {
          ...state,
          quality,
          resolution: resolution || undefined,
          aspectRatio,
          count,
        },
      });
      endGenerationLaunching([launchKey]);
      await watchTask(task.id, nodeId);
    } catch (error) {
      if (mountedRef.current) setGenerationRuntimeError(launchKey, error instanceof Error ? error.message : String(error));
    } finally {
      endGenerationLaunching([launchKey]);
    }
  }, [canvasId, edges, nodes, patchLibtvState, patchNodeData, t, watchTask]);

  const stopLibtvGeneration = useCallback(async (nodeId: string) => {
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
      if (node.data.imageGenerationBackend !== "libtv") return;
      const taskId = nativeCanvasNodeTaskId(node.data);
      if (taskId) {
        void watchTask(taskId, node.id);
      }
    });
  }, [canvasId, nodes, watchTask]);

  useEffect(() => activateGenerationHook(mountedRef, () => {
    taskControllersRef.current.forEach((controller) => controller.abort());
    taskControllersRef.current.clear();
  }), []);

  return { runLibtvGeneration, stopLibtvGeneration };
}
