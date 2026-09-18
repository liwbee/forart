import { useCallback, useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import type { BatchImageGeneratorItem, NativeCanvasNode, NativeCanvasNodeData } from "../nativeCanvas";
import type { NativeCanvasEdge } from "../nativeCanvas";
import {
  collectAdditionalPromptInputs,
  collectAdditionalImageReferences,
  collectImageGeneratorPrompts,
  collectImageGeneratorReferences,
} from "./imageGenerationInputs";
import { buildPromptWithImageReferenceDocument, imagePromptDocumentFromReferenceText } from "./imagePromptReferences";
import { BATCH_TASK_REFERENCE_EDGE_ID } from "../batch/batchNodeTypes";
import { batchItemPatchChanges } from "../batch/batchItemPatch";
import { isGenerationTaskActive, useGenerationTaskCache } from "./generationTaskCache";
import { activateGenerationHook } from "./generationHookLifecycle";
import {
  createBatchTaskRuntime,
  stopBatchTasks,
  submitBatchTasks,
  type BatchTaskRuntime,
} from "../batch/batchNodeRunner";
import { startBatchGeneration } from "./batchGenerationProviders";

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useNativeBatchImageGeneration({
  canvasId,
  nodes,
  edges,
  patchNodeData,
  t,
}: {
  canvasId: string;
  nodes: NativeCanvasNode[];
  edges: NativeCanvasEdge[];
  patchNodeData: (nodeId: string, patch: Partial<NativeCanvasNodeData>) => void;
  t: TFunction;
}) {
  const mountedRef = useRef(true);
  const taskRuntimeRef = useRef<BatchTaskRuntime | null>(null);
  if (!taskRuntimeRef.current) taskRuntimeRef.current = createBatchTaskRuntime();
  const taskRuntime = taskRuntimeRef.current;
  const runControllers = useRef(new Map<string, AbortController>());
  const pendingItemPatches = useRef(new Map<string, Partial<BatchImageGeneratorItem>>());
  const pendingPatchNodeIds = useRef(new Map<string, string>());
  const watchedTaskIdsRef = useRef(new Set<string>());
  const patchFlushScheduled = useRef(false);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => activateGenerationHook(mountedRef, () => {
    taskRuntime.dispose();
    runControllers.current.forEach((controller) => controller.abort());
    runControllers.current.clear();
  }), [taskRuntime]);

  const patchItem = useCallback((nodeId: string, itemId: string, patch: Partial<BatchImageGeneratorItem>) => {
    const key = `${nodeId}:${itemId}`;
    pendingItemPatches.current.set(key, {
      ...(pendingItemPatches.current.get(key) || {}),
      ...patch,
    });
    pendingPatchNodeIds.current.set(key, nodeId);
    if (patchFlushScheduled.current) return;
    patchFlushScheduled.current = true;
    queueMicrotask(() => {
      patchFlushScheduled.current = false;
      const grouped = new Map<string, Map<string, Partial<BatchImageGeneratorItem>>>();
      pendingItemPatches.current.forEach((itemPatch, pendingKey) => {
        const nodeIdForPatch = pendingPatchNodeIds.current.get(pendingKey) || "";
        const itemIdForPatch = pendingKey.slice(nodeIdForPatch.length + 1);
        const byItem = grouped.get(nodeIdForPatch) || new Map<string, Partial<BatchImageGeneratorItem>>();
        byItem.set(itemIdForPatch, itemPatch);
        grouped.set(nodeIdForPatch, byItem);
      });
      pendingItemPatches.current.clear();
      pendingPatchNodeIds.current.clear();
      grouped.forEach((byItem, nodeIdForPatch) => {
        const node = nodesRef.current.find((item) => item.id === nodeIdForPatch);
        const state = node?.data.batchImageGenerator;
        if (!state) return;
        let changed = false;
        const items = state.items.map((item) => {
          const patch = byItem.get(item.id);
          if (!patch || !batchItemPatchChanges(item, patch)) return item;
          changed = true;
          return { ...item, ...patch };
        });
        // Re-reporting a task result that is already on the item must not republish nodes:
        // the watcher effect below re-registers on every node change, so an unchanged write
        // would bounce between the two halves until React aborts.
        if (!changed) return;
        patchNodeData(nodeIdForPatch, {
          batchImageGenerator: {
            ...state,
            items,
          },
        });
      });
    });
  }, [patchNodeData]);

  const watchItem = useCallback(async (taskId: string, nodeId: string, itemId: string) => {
    if (!mountedRef.current) return;
    try {
      await taskRuntime.watch(taskId, (dto) => {
        if (!mountedRef.current) return;
        if (dto.status !== "succeeded" || !dto.result?.images[0]) {
          patchItem(nodeId, itemId, {
            status: dto.status === "failed" ? "failed" : "pending",
            error: dto.errorMessage || (dto.status === "failed" ? t("infiniteCanvas:generationFailed") : undefined),
          });
          return;
        }
        const image = dto.result.images[0];
        patchItem(nodeId, itemId, {
          status: "completed",
          resultUrl: image.assetUrl,
          resultThumbUrl: image.thumbUrl,
          latestGenerationTaskId: dto.id,
          error: undefined,
          resultFileName: image.fileName,
          resultWidth: image.width,
          resultHeight: image.height,
        });
      });
    } catch (error) {
      if (!mountedRef.current || isAbortError(error)) return;
      patchItem(nodeId, itemId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [patchItem, t, taskRuntime]);

  const runBatchImageGeneration = useCallback(async (nodeId: string, itemId?: string) => {
    const runKey = `${nodeId}:${itemId || "all"}`;
    runControllers.current.get(runKey)?.abort();
    const runController = new AbortController();
    runControllers.current.set(runKey, runController);
    let targets: BatchImageGeneratorItem[] = [];
    try {
      const node = nodesRef.current.find((item) => item.id === nodeId && item.data.kind === "batchImageGenerator");
      const state = node?.data.batchImageGenerator;
      if (!node || !state || !state.items.length || !window.forartGenerationTasks?.startMany) return;

      const connectedPrompt = collectImageGeneratorPrompts(nodeId, nodesRef.current, edges, t("infiniteCanvas:prompt"))
        .map((item) => item.text).filter(Boolean).join("\n\n");
      const additionalPrompt = collectAdditionalPromptInputs(nodeId, nodesRef.current, edges, t("infiniteCanvas:additionalReference"))
        .map((item) => item.text).filter(Boolean).join("\n\n");
      const basePrompt = [String(node.data.text || state.prompt || "").trim(), connectedPrompt]
        .filter(Boolean).join("\n\n");
      if (!basePrompt) return;

      const tasksById = useGenerationTaskCache.getState().tasksById;
      targets = state.items.filter((item) => {
        if (itemId && item.id !== itemId) return false;
        if (!item.sourceUrl) return false;
        const task = item.latestGenerationTaskId ? tasksById[item.latestGenerationTaskId] : undefined;
        return !isGenerationTaskActive(task);
      });
      if (!targets.length) return;

      const primaryReferences = collectImageGeneratorReferences(nodeId, nodesRef.current, edges, t("infiniteCanvas:mainReference"));
      const primary = primaryReferences.map((item) => item.imageUrl);
      const additional = collectAdditionalImageReferences(nodeId, nodesRef.current, edges, t("infiniteCanvas:additionalReference"))
        .map((item) => item.imageUrl);
      const taskReferenceOrder = Math.max(0, Math.min(primary.length, Math.round(Number(state.taskReferenceOrder || 0))));
      const payloadForItem = (item: BatchImageGeneratorItem) => {
        // 上传图是这一轮要处理的目标，和连线端点的主参考区分开，避免 @ 提示词时混淆。
        const taskReference = { edgeId: BATCH_TASK_REFERENCE_EDGE_ID, nodeId, order: taskReferenceOrder, title: t("infiniteCanvas:batchTaskTarget"), mentionLabel: t("infiniteCanvas:batchTaskTarget"), imageUrl: item.sourceUrl!, previewUrl: item.sourceThumbUrl || "" };
        const orderedReferenceInputs = [...primaryReferences];
        orderedReferenceInputs.splice(taskReferenceOrder, 0, taskReference);
        const promptDocument = node.data.imagePromptDocument || imagePromptDocumentFromReferenceText(basePrompt, orderedReferenceInputs);
        const prompt = buildPromptWithImageReferenceDocument({
          document: promptDocument,
          fallbackPrompt: basePrompt,
          additionalPrompt: item.useAdditionalReferences ? additionalPrompt : "",
          references: orderedReferenceInputs,
          labels: {
            instruction: (images) => t("infiniteCanvas:referenceImageInstruction", { images }),
            requestHeader: t("infiniteCanvas:referenceImageRequestHeader"),
          },
        });
        const orderedPrimary = [
          ...primary.slice(0, taskReferenceOrder),
          item.sourceUrl!,
          ...primary.slice(taskReferenceOrder),
        ];
        return {
          prompt,
          promptDocument,
          references: [...orderedPrimary, ...(item.useAdditionalReferences ? additional : [])],
        };
      };

      patchNodeData(nodeId, {
        batchImageGenerator: {
          ...state,
          items: state.items.map((item) => targets.some((target) => target.id === item.id)
            ? { ...item, status: "queued", error: undefined }
            : item),
        },
      });

      const inputs = targets.map((item) => {
        const payload = payloadForItem(item);
        return {
          target: { type: "batchImageGeneratorItem", nodeId, itemId: item.id },
          prompt: payload.prompt,
          referenceImages: payload.references,
          nodeTitle: `${t("infiniteCanvas:batchImageGenerator")} - ${item.sourceFileName || item.id}`,
        };
      });
      await submitBatchTasks({
        items: targets,
        start: () => startBatchGeneration({ canvasId, node, inputs, signal: runController.signal, t }),
        onTaskIds: (items, tasks) => {
          if (!mountedRef.current || runController.signal.aborted) return;
          items.forEach((item, index) => patchItem(nodeId, item.id, {
            status: "running",
            latestGenerationTaskId: tasks[index].id,
            resultDownloadState: undefined,
            resultDownloadedAt: undefined,
          }));
        },
        watch: (task, item) => runController.signal.aborted
          ? Promise.resolve()
          : watchItem(task.id, nodeId, item.id),
        onCountMismatch: () => new Error(t("infiniteCanvas:generationTaskCreateFailed")),
      });
    } catch (error) {
      if (!mountedRef.current || runController.signal.aborted || isAbortError(error)) return;
      const message = error instanceof Error ? error.message : String(error);
      targets.forEach((item) => patchItem(nodeId, item.id, { status: "failed", error: message }));
    } finally {
      if (runControllers.current.get(runKey) === runController) runControllers.current.delete(runKey);
    }
  }, [canvasId, edges, patchItem, patchNodeData, t, taskRuntime, watchItem]);

  const stopBatchImageGeneration = useCallback(async (nodeId: string, itemId?: string) => {
    if (itemId) runControllers.current.get(`${nodeId}:${itemId}`)?.abort();
    else [...runControllers.current.keys()]
      .filter((key) => key.startsWith(`${nodeId}:`))
      .forEach((key) => runControllers.current.get(key)?.abort());

    const node = nodesRef.current.find((item) => item.id === nodeId);
    const state = node?.data.batchImageGenerator;
    const tasksById = useGenerationTaskCache.getState().tasksById;
    const targets = (state?.items || []).filter((item) => {
      if (itemId && item.id !== itemId) return false;
      const task = item.latestGenerationTaskId ? tasksById[item.latestGenerationTaskId] : undefined;
      return Boolean(item.status === "queued" || item.status === "running" || isGenerationTaskActive(task));
    });
    await stopBatchTasks({
      items: targets,
      taskId: (item) => String(item.latestGenerationTaskId || ""),
      isActive: (taskId) => isGenerationTaskActive(useGenerationTaskCache.getState().tasksById[taskId]),
      abort: (taskId) => taskRuntime.abort(taskId),
      stop: (taskId) => window.forartGenerationTasks?.stop(taskId) || Promise.resolve(),
      onStopped: (item) => patchItem(nodeId, item.id, { status: "pending", error: undefined }),
    });
    targets.filter((item) => !item.latestGenerationTaskId).forEach((item) => {
      patchItem(nodeId, item.id, { status: "pending", error: undefined });
    });
  }, [patchItem, taskRuntime]);

  useEffect(() => {
    nodes.forEach((node) => {
      if (node.data.kind !== "batchImageGenerator") return;
      node.data.batchImageGenerator?.items.forEach((item) => {
        const taskId = String(item.latestGenerationTaskId || "");
        if (!taskId) return;
        // A finished task reports its (already applied) result as soon as it is watched
        // again, so re-registering on every node change created an endless write loop.
        // Each task is watched once per mounted canvas.
        if (watchedTaskIdsRef.current.has(taskId)) return;
        watchedTaskIdsRef.current.add(taskId);
        void watchItem(taskId, node.id, item.id);
      });
    });
  }, [nodes, watchItem]);

  return { runBatchImageGeneration, stopBatchImageGeneration };
}
