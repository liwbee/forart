import { useCallback, useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import {
  actionFissionRowTaskId,
  type ActionFissionRow,
} from "../action-fission/actionFissionTypes";
import {
  actionFissionImageGenerationBlocked,
  actionFissionPrompt,
  actionFissionRowLabel,
  actionFissionReferenceImages,
  getActionFissionRunReadiness,
} from "../action-fission/actionFissionRules";
import { ACTION_FISSION_AGENT_TASK } from "../action-fission/actionFissionTypes";
import { actionFissionMode } from "../action-fission/actionFissionState";
import { useCanvasAgent } from "../../canvas-agent";
import type { NativeCanvasEdge, NativeCanvasNode } from "../nativeCanvas";
import {
  collectAdditionalPromptInputs,
  collectAdditionalImageReferences,
  collectImageGeneratorReferences,
} from "./imageGenerationInputs";
import {
  actionFissionLaunchKey,
  beginGenerationLaunching,
  clearGenerationRuntimeError,
  endGenerationLaunching,
  setGenerationRuntimeError,
} from "./generationRuntimeStore";
import { activateGenerationHook } from "./generationHookLifecycle";
import { collectConnectedPrompt } from "./useNativeImageGeneration";
import {
  isGenerationTaskActive,
  isGenerationTaskTerminal,
  useGenerationTaskCache,
} from "./generationTaskCache";
import {
  createBatchTaskRuntime,
  stopBatchTasks,
  submitBatchTasks,
  type BatchTaskRuntime,
} from "../batch/batchNodeRunner";
import { downloadMarkerForTaskResult } from "./generationResultDownloadState";
import { startBatchGeneration } from "./batchGenerationProviders";

interface UseNativeActionFissionGenerationOptions {
  canvasId: string;
  edges: NativeCanvasEdge[];
  nodes: NativeCanvasNode[];
  patchRow: (nodeId: string, rowId: string, patch: Partial<ActionFissionRow>) => void;
  patchRows: (nodeId: string, patches: Array<{ rowId: string; patch: Partial<ActionFissionRow> }>) => void;
  t: TFunction;
}

async function prepareActionFissionReferences(
  primaryReferences: string[],
  additionalReferences: string[],
  signal: AbortSignal,
) {
  const allReferences = [...primaryReferences, ...additionalReferences];
  // Warm local canvas assets while the Agent request is in flight. Provider
  // specific Base64/Multipart/LibTV uploads still happen in the existing
  // Electron generation runner after this snapshot is handed off.
  if (window.easyTool?.ensureCanvasAssetThumbnail) {
    await Promise.all(allReferences.map(async (url) => {
      if (signal.aborted) return;
      try { await window.easyTool!.ensureCanvasAssetThumbnail({ url }); } catch { /* runner reports upload errors */ }
    }));
  }
  return { frozenPrimaryReferences: [...primaryReferences], frozenAdditionalReferences: [...additionalReferences] };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useNativeActionFissionGeneration({
  canvasId,
  edges,
  nodes,
  patchRow,
  patchRows,
  t,
}: UseNativeActionFissionGenerationOptions) {
  const mountedRef = useRef(true);
  const taskRuntimeRef = useRef<BatchTaskRuntime | null>(null);
  if (!taskRuntimeRef.current) taskRuntimeRef.current = createBatchTaskRuntime();
  const taskRuntime = taskRuntimeRef.current;
  const agent = useCanvasAgent();
  // 用 ref 保存最新的 Agent 运行状态，避免回调依赖每次都变化。
  const agentRunsRef = useRef(agent.runs);
  agentRunsRef.current = agent.runs;
  const nodeQueueControllersRef = useRef(new Map<string, AbortController>());
  const activeNodeRunsRef = useRef(new Set<string>());
  const thumbnailAttemptsRef = useRef(new Set<string>());
  const handledTerminalVersionsRef = useRef(new Map<string, number>());
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => activateGenerationHook(mountedRef, () => {
    taskRuntime.dispose();
    nodeQueueControllersRef.current.clear();
    activeNodeRunsRef.current.clear();
  }), [taskRuntime]);

  useEffect(() => {
    if (!window.easyTool?.ensureCanvasAssetThumbnail) return;
    const pending = nodes.flatMap((node) => {
      if (node.data.kind !== "actionFission") return [];
      return (node.data.actionFission?.rows || []).flatMap((row) => {
        const candidates = [
          { field: "resultThumbUrl" as const, sourceUrl: row.resultUrl || "", thumbUrl: row.resultThumbUrl || "" },
          { field: "selectedActionThumbUrl" as const, sourceUrl: row.selectedActionAssetUrl || "", thumbUrl: row.selectedActionThumbUrl || "" },
        ];
        return candidates.flatMap((candidate) => {
          if (!candidate.sourceUrl || candidate.thumbUrl) return [];
          const attemptKey = `${node.id}:${row.id}:${candidate.field}:${candidate.sourceUrl}`;
          if (thumbnailAttemptsRef.current.has(attemptKey)) return [];
          thumbnailAttemptsRef.current.add(attemptKey);
          return [{ nodeId: node.id, rowId: row.id, ...candidate }];
        });
      });
    });
    if (!pending.length) return;

    let nextIndex = 0;
    const worker = async () => {
      while (mountedRef.current) {
        const item = pending[nextIndex++];
        if (!item) return;
        try {
          const thumbnail = await window.easyTool!.ensureCanvasAssetThumbnail({ url: item.sourceUrl });
          if (mountedRef.current && thumbnail.thumbUrl) {
            const currentRow = nodesRef.current
              .find((node) => node.id === item.nodeId && node.data.kind === "actionFission")
              ?.data.actionFission?.rows.find((row) => row.id === item.rowId);
            const currentSourceUrl = item.field === "resultThumbUrl"
              ? currentRow?.resultUrl
              : currentRow?.selectedActionAssetUrl;
            if (currentSourceUrl !== item.sourceUrl) continue;
            patchRow(item.nodeId, item.rowId, item.field === "resultThumbUrl"
              ? { resultThumbUrl: thumbnail.thumbUrl }
              : { selectedActionThumbUrl: thumbnail.thumbUrl });
          }
        } catch {
          // Keep the placeholder when an asset cannot be resolved or thumb generation fails.
        }
      }
    };
    void Promise.all([worker(), worker()]);
  }, [nodes, patchRow]);

  const watchRowTask = useCallback(async (taskId: string, nodeId: string, rowId: string) => {
    if (!mountedRef.current || !window.forartGenerationTasks?.get || taskRuntime.has(taskId)) return;
    const cachedTask = useGenerationTaskCache.getState().tasksById[taskId];
    if (cachedTask && isGenerationTaskTerminal(cachedTask.status)
      && (handledTerminalVersionsRef.current.get(taskId) || -1) >= cachedTask.version) return;
    const runtimeKey = actionFissionLaunchKey(canvasId, nodeId, rowId);
    try {
      await taskRuntime.watch(taskId, (dto) => {
        if ((handledTerminalVersionsRef.current.get(dto.id) || -1) >= dto.version) return;
        handledTerminalVersionsRef.current.set(dto.id, dto.version);
        if (dto.status !== "succeeded" || !dto.result?.images.length) return;
        const image = dto.result.images[0];
        const currentRow = nodesRef.current
          .find((node) => node.id === nodeId && node.data.kind === "actionFission")
          ?.data.actionFission?.rows.find((row) => row.id === rowId);
        const downloadMarker = downloadMarkerForTaskResult(
          currentRow ? actionFissionRowTaskId(currentRow) : "",
          dto.id,
          String(currentRow?.resultUrl || ""),
          image.assetUrl,
          currentRow?.resultDownloadState,
          currentRow?.resultDownloadedAt,
        );
        patchRow(nodeId, rowId, {
          resultUrl: image.assetUrl,
          resultThumbUrl: image.thumbUrl,
          resultFileName: image.fileName,
          resultWidth: image.width,
          resultHeight: image.height,
          resultDownloadState: downloadMarker.downloadState,
          resultDownloadedAt: downloadMarker.downloadedAt,
        });
      });
    } catch (error) {
      if (!isAbortError(error)) {
        setGenerationRuntimeError(runtimeKey, error instanceof Error ? error.message : String(error));
      }
    }
  }, [canvasId, patchRow, taskRuntime]);

  const runRows = useCallback(async (
    node: NativeCanvasNode,
    rows: ActionFissionRow[],
    primaryReferences: string[],
    additionalReferences: string[],
    connectedPrompt: string,
    additionalPrompts: string[],
    signal: AbortSignal,
  ) => {
    const mode = actionFissionMode(node.data.actionFission);
    const inputs = rows.map((row) => ({
      target: { type: "actionFissionRow", nodeId: node.id, rowId: row.id },
      prompt: actionFissionPrompt(row, connectedPrompt, additionalPrompts, mode),
      referenceImages: actionFissionReferenceImages(row, primaryReferences, additionalReferences),
      nodeTitle: `${t("infiniteCanvas:actionFission")} - ${actionFissionRowLabel(row, mode)}`,
    }));
    await submitBatchTasks({
      items: rows,
      start: () => startBatchGeneration({ canvasId, node, inputs, signal, t }),
      onTaskIds: (items, tasks) => {
        if (!mountedRef.current) return;
        patchRows(node.id, tasks.map((task, index) => ({ rowId: items[index].id, patch: { latestGenerationTaskId: task.id, resultDownloadState: undefined, resultDownloadedAt: undefined } })));
        endGenerationLaunching(items.map((row) => actionFissionLaunchKey(canvasId, node.id, row.id)));
      },
      watch: (task, row) => watchRowTask(task.id, node.id, row.id),
      onCountMismatch: () => new Error(t("infiniteCanvas:generationTaskCreateFailed")),
    });
  }, [canvasId, patchRows, t, watchRowTask]);

  useEffect(() => {
    nodes.forEach((node) => {
      if (node.data.kind !== "actionFission") return;
      node.data.actionFission?.rows.forEach((row) => {
        const taskId = actionFissionRowTaskId(row);
        if (taskId) void watchRowTask(taskId, node.id, row.id);
      });
    });
  }, [nodes, watchRowTask]);

  const runActionFission = useCallback(async (nodeId: string, rowId?: string) => {
    const runKey = `${nodeId}:${rowId || "group"}`;
    const nodeRunPrefix = `${nodeId}:`;
    if (activeNodeRunsRef.current.has(runKey)) return;
    if (!rowId && [...activeNodeRunsRef.current].some((key) => key.startsWith(nodeRunPrefix))) return;
    const node = nodes.find((item) => item.id === nodeId && item.data.kind === "actionFission");
    const state = node?.data.actionFission;
    if (!node || !state) return;
    const mode = actionFissionMode(state);
    const references = collectImageGeneratorReferences(nodeId, nodes, edges, t("infiniteCanvas:referenceImage"));
    const additionalReferences = collectAdditionalImageReferences(nodeId, nodes, edges, t("infiniteCanvas:additionalReference"));
    const additionalPrompts = collectAdditionalPromptInputs(nodeId, nodes, edges, t("infiniteCanvas:additionalReference"));
    const targetRows = rowId ? state.rows.filter((row) => row.id === rowId) : state.rows;
    const runtimeKeys = targetRows.map((row) => actionFissionLaunchKey(canvasId, nodeId, row.id));
    // 硬性规则：生成提示词进行中时不允许启动生图（整组、单行、查看器都走这里）。
    const promptGenerationActive = Object.values(agentRunsRef.current).some((run) => (
      run.nodeId === nodeId
      && run.task === ACTION_FISSION_AGENT_TASK
      && run.status === "running"
    ));
    if (actionFissionImageGenerationBlocked({ imageGenerationActive: false, promptGenerationActive })) {
      runtimeKeys.forEach((key) => setGenerationRuntimeError(key, t("infiniteCanvas:actionFissionBlockedByPromptGeneration")));
      return;
    }
    const readiness = getActionFissionRunReadiness(targetRows, references.length, mode);
    if (!readiness.canRun) {
      const message = readiness.missingReference
        ? t("infiniteCanvas:actionFissionConnectReferenceFirst")
        : mode === "agent"
          ? t("infiniteCanvas:actionFissionGeneratePromptFirst")
          : t("infiniteCanvas:actionFissionSelectActionFirst");
      runtimeKeys.forEach((key) => setGenerationRuntimeError(key, message));
      return;
    }
    const tasksById = useGenerationTaskCache.getState().tasksById;
    if (targetRows.some((row) => isGenerationTaskActive(tasksById[actionFissionRowTaskId(row)]))) return;
    const connectedPrompt = collectConnectedPrompt(nodeId, nodes, edges);
    const queueController = new AbortController();
    runtimeKeys.forEach(clearGenerationRuntimeError);
    beginGenerationLaunching(runtimeKeys);
    activeNodeRunsRef.current.add(runKey);
    nodeQueueControllersRef.current.set(runKey, queueController);
    try {
      // Freeze the current inputs before handing them to the generation runner.
      const frozenPrimaryReferences = references.map((item) => item.imageUrl);
      const frozenAdditionalReferences = additionalReferences.map((item) => item.imageUrl);
      const frozenAdditionalPrompts = additionalPrompts.map((item) => item.text);
      const referencePreparation = prepareActionFissionReferences(
        frozenPrimaryReferences,
        frozenAdditionalReferences,
        queueController.signal,
      );
      const prepared = await referencePreparation;
      if (queueController.signal.aborted) return;
      await runRows(
        node,
        targetRows,
        prepared.frozenPrimaryReferences,
        prepared.frozenAdditionalReferences,
        connectedPrompt,
        frozenAdditionalPrompts,
        queueController.signal,
      );
    } catch (error) {
      if (mountedRef.current && !queueController.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        runtimeKeys.forEach((key) => setGenerationRuntimeError(key, message));
      }
    } finally {
      endGenerationLaunching(runtimeKeys);
      activeNodeRunsRef.current.delete(runKey);
      if (nodeQueueControllersRef.current.get(runKey) === queueController) nodeQueueControllersRef.current.delete(runKey);
    }
  }, [canvasId, edges, nodes, runRows, t]);

  const stopActionFission = useCallback(async (nodeId: string, rowId?: string, taskIds?: string[]) => {
    const runPrefix = `${nodeId}:`;
    nodeQueueControllersRef.current.forEach((controller, key) => {
      if ((!rowId && key.startsWith(runPrefix)) || key === `${nodeId}:${rowId}`) controller.abort();
    });
    const selectedTaskIds = taskIds ? new Set(taskIds) : null;
    const rows = nodes.find((node) => node.id === nodeId)?.data.actionFission?.rows || [];
    const targets = rowId ? rows.filter((row) => row.id === rowId) : rows;
    await stopBatchTasks({
      items: targets.filter((row) => !selectedTaskIds || selectedTaskIds.has(actionFissionRowTaskId(row))),
      taskId: actionFissionRowTaskId,
      isActive: (taskId) => isGenerationTaskActive(useGenerationTaskCache.getState().tasksById[taskId]),
      abort: (taskId) => taskRuntime.abort(taskId),
      stop: (taskId) => window.forartGenerationTasks?.stop(taskId) || Promise.resolve(),
      onStopped: (row) => clearGenerationRuntimeError(actionFissionLaunchKey(canvasId, nodeId, row.id)),
    });
  }, [canvasId, nodes, taskRuntime]);

  return { runActionFission, stopActionFission };
}
