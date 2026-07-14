import { useCallback, useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import type { LibtvGenerationTask } from "../../../app/appConfig";
import type { NativeCanvasEdge, NativeCanvasNode } from "../nativeCanvas";
import { collectImageGeneratorReferences } from "../generation/imageGenerationInputs";
import {
  beginGenerationLaunching,
  endGenerationLaunching,
  imageGenerationLaunchKey,
  useGenerationRuntimeStore,
} from "../generation/generationRuntimeStore";
import { activateGenerationHook } from "../generation/generationHookLifecycle";
import { deriveLibtvModelCapabilities } from "./libtvModelSchema";

export function isNativeLibtvTaskActive(task: LibtvGenerationTask | undefined) {
  return task?.status === "queued" || task?.status === "preparing" || task?.status === "uploading" || task?.status === "running";
}

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
  setNodeImage: (nodeId: string, imageUrl: string, label: string) => void;
  t: TFunction;
}

export function useNativeLibtvGeneration({
  canvasId,
  edges,
  nodes,
  patchNodeData,
  setNodeImage,
  t,
}: UseNativeLibtvGenerationOptions) {
  const mountedRef = useRef(true);
  const pollingControllersRef = useRef(new Map<string, AbortController>());

  const patchLibtvState = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    const current = nodes.find((node) => node.id === nodeId)?.data.libtvImageGeneration || {};
    patchNodeData(nodeId, { libtvImageGeneration: { ...current, ...patch } });
  }, [nodes, patchNodeData]);

  const pollTask = useCallback(async (taskId: string, nodeId: string) => {
    if (!mountedRef.current || !window.libtv?.getImageTask || pollingControllersRef.current.has(taskId)) return;
    const controller = new AbortController();
    pollingControllersRef.current.set(taskId, controller);
    try {
      while (!controller.signal.aborted) {
        let task = await window.libtv.getImageTask(taskId);
        if (!task) {
          const state = nodes.find((node) => node.id === nodeId)?.data.libtvImageGeneration;
          if (state?.taskId === taskId && state.projectUuid && state.remoteNodeId && window.libtv.recoverImageTask) {
            task = await window.libtv.recoverImageTask({
              canvasId,
              nodeId,
              taskId,
              target: { type: "imageGenerator", nodeId },
              projectUuid: state.projectUuid,
              remoteNodeId: state.remoteNodeId,
            });
          }
        }
        if (!task) {
          patchLibtvState(nodeId, {
            task: undefined,
            taskId: undefined,
            projectUuid: undefined,
            remoteNodeId: undefined,
            error: t("infiniteCanvas:generationInterruptedUnexpected"),
          });
          return;
        }
        const active = isNativeLibtvTaskActive(task);
        patchLibtvState(nodeId, {
          task,
          taskId: active ? task.id : undefined,
          projectUuid: active ? task.projectUuid : undefined,
          remoteNodeId: active ? task.remoteNodeId : undefined,
          error: task.status === "failed" ? task.error || "LibTV generation failed." : "",
        });
        if (task.status === "succeeded") {
          if (task.result?.localUrl) {
            setNodeImage(nodeId, task.result.localUrl, task.result.fileName || "LibTV generated image");
          }
          return;
        }
        if (task.status === "failed" || task.status === "interrupted") return;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        patchLibtvState(nodeId, { error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      pollingControllersRef.current.delete(taskId);
    }
  }, [canvasId, nodes, patchLibtvState, setNodeImage, t]);

  const runLibtvGeneration = useCallback(async (nodeId: string, options?: { promptOverride?: string }) => {
    const node = nodes.find((item) => item.id === nodeId && item.data.kind === "imageGenerator");
    const state = node?.data.libtvImageGeneration || {};
    if (!node || state.taskId || isNativeLibtvTaskActive(state.task)) return;
    if (!canvasId || !window.libtv?.startImageTask) {
      patchLibtvState(nodeId, { error: t("infiniteCanvas:libtvUnavailable") });
      return;
    }

    const launchKey = imageGenerationLaunchKey(canvasId, nodeId);
    if (useGenerationRuntimeStore.getState().launchingKeys.has(launchKey)) return;
    beginGenerationLaunching([launchKey]);
    try {
      const status = await window.libtv.status();
      if (!status.available) throw new Error(status.error || t("infiniteCanvas:libtvUnavailable"));
      const account = await window.libtv.account();
      if (!account.loggedIn) throw new Error(account.error || t("infiniteCanvas:libtvNotLoggedIn"));
      const modelName = String(state.modelName || "").trim();
      if (!modelName) throw new Error(t("infiniteCanvas:libtvModelRequired"));
      const schema = await window.libtv.imageModelSchema({ model: modelName });
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
      patchLibtvState(nodeId, { quality, resolution: resolution || undefined, aspectRatio, count, error: "" });
      const task = await window.libtv.startImageTask({
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
      if (!mountedRef.current) return;
      patchLibtvState(nodeId, { task, taskId: task.id, error: "" });
      endGenerationLaunching([launchKey]);
      await pollTask(task.id, nodeId);
    } catch (error) {
      if (mountedRef.current) patchLibtvState(nodeId, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      endGenerationLaunching([launchKey]);
    }
  }, [canvasId, edges, nodes, patchLibtvState, pollTask, t]);

  const stopLibtvGeneration = useCallback(async (nodeId: string) => {
    const state = nodes.find((node) => node.id === nodeId)?.data.libtvImageGeneration;
    const task = state?.task;
    const taskId = task?.id || state?.taskId;
    if (!taskId || (task && !isNativeLibtvTaskActive(task))) return;
    pollingControllersRef.current.get(taskId)?.abort();
    try {
      const stopped = await window.libtv?.stopImageTask?.(taskId);
      patchLibtvState(nodeId, {
        task: stopped || (task ? { ...task, status: "interrupted" } : undefined),
        taskId: undefined,
        projectUuid: undefined,
        remoteNodeId: undefined,
        error: "",
      });
    } catch (error) {
      patchLibtvState(nodeId, { error: error instanceof Error ? error.message : String(error) });
    }
  }, [nodes, patchLibtvState]);

  useEffect(() => {
    nodes.forEach((node) => {
      const task = node.data.libtvImageGeneration?.task;
      if (node.data.imageGenerationBackend === "libtv" && task?.canvasId === canvasId && isNativeLibtvTaskActive(task)) {
        void pollTask(task.id, node.id);
      } else if (node.data.imageGenerationBackend === "libtv" && node.data.libtvImageGeneration?.taskId) {
        void pollTask(node.data.libtvImageGeneration.taskId, node.id);
      }
    });
  }, [canvasId, nodes, pollTask]);

  useEffect(() => activateGenerationHook(mountedRef, () => {
    pollingControllersRef.current.forEach((controller) => controller.abort());
    pollingControllersRef.current.clear();
  }), []);

  return { runLibtvGeneration, stopLibtvGeneration };
}
