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
  const pollingControllersRef = useRef(new Map<string, AbortController>());

  const patchLibtvState = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    const current = nodes.find((node) => node.id === nodeId)?.data.libtvImageGeneration || {};
    patchNodeData(nodeId, { libtvImageGeneration: { ...current, ...patch } });
  }, [nodes, patchNodeData]);

  const pollTask = useCallback(async (taskId: string, nodeId: string) => {
    if (!window.libtv?.getImageTask || pollingControllersRef.current.has(taskId)) return;
    const controller = new AbortController();
    pollingControllersRef.current.set(taskId, controller);
    try {
      while (!controller.signal.aborted) {
        const task = await window.libtv.getImageTask(taskId);
        if (!task) {
          patchLibtvState(nodeId, {
            task: undefined,
            error: t("infiniteCanvas:generationInterruptedUnexpected"),
          });
          return;
        }
        patchLibtvState(nodeId, { task, error: task.status === "failed" ? task.error || "LibTV generation failed." : "" });
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
  }, [patchLibtvState, setNodeImage, t]);

  const runLibtvGeneration = useCallback(async (nodeId: string, options?: { promptOverride?: string }) => {
    const node = nodes.find((item) => item.id === nodeId && item.data.kind === "imageGenerator");
    const state = node?.data.libtvImageGeneration || {};
    if (!node || isNativeLibtvTaskActive(state.task)) return;
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
      patchLibtvState(nodeId, { task, error: "" });
      endGenerationLaunching([launchKey]);
      await pollTask(task.id, nodeId);
    } catch (error) {
      patchLibtvState(nodeId, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      endGenerationLaunching([launchKey]);
    }
  }, [canvasId, edges, nodes, patchLibtvState, pollTask, t]);

  const stopLibtvGeneration = useCallback(async (nodeId: string) => {
    const task = nodes.find((node) => node.id === nodeId)?.data.libtvImageGeneration?.task;
    if (!task || !isNativeLibtvTaskActive(task)) return;
    pollingControllersRef.current.get(task.id)?.abort();
    try {
      const stopped = await window.libtv?.stopImageTask?.(task.id);
      patchLibtvState(nodeId, { task: stopped || { ...task, status: "interrupted" }, error: "" });
    } catch (error) {
      patchLibtvState(nodeId, { error: error instanceof Error ? error.message : String(error) });
    }
  }, [nodes, patchLibtvState]);

  useEffect(() => {
    nodes.forEach((node) => {
      const task = node.data.libtvImageGeneration?.task;
      if (node.data.imageGenerationBackend === "libtv" && task?.canvasId === canvasId && isNativeLibtvTaskActive(task)) {
        void pollTask(task.id, node.id);
      }
    });
  }, [canvasId, nodes, pollTask]);

  useEffect(() => () => {
    pollingControllersRef.current.forEach((controller) => controller.abort());
    pollingControllersRef.current.clear();
  }, []);

  return { runLibtvGeneration, stopLibtvGeneration };
}
