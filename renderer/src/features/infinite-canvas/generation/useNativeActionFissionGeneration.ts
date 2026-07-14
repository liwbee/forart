import { useCallback, useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import { isImageProviderConfigured, loadApiSettings, orderedApiProviders } from "../../settings/apiProviders";
import { detectImageModelRuleId, getImageModelRule, normalizeImageModelSizeSelection } from "../../settings/imageModelRules";
import type { ActionFissionRow, ActionFissionState } from "../action-fission/actionFissionTypes";
import { getActionFissionRunReadiness } from "../action-fission/actionFissionRules";
import type { NativeCanvasEdge, NativeCanvasNode } from "../nativeCanvas";
import { collectImageGeneratorReferences, validateImageGeneratorReferences } from "./imageGenerationInputs";
import {
  actionFissionLaunchKey,
  beginGenerationLaunching,
  endGenerationLaunching,
} from "./generationRuntimeStore";
import { activateGenerationHook } from "./generationHookLifecycle";
import {
  collectConnectedPrompt,
  getGenerationTaskWithRetry,
  isNativeGenerationTaskActive,
  normalizeGenerationTask,
  TERMINAL_TASK_STATUSES,
} from "./useNativeImageGeneration";
import { deriveLibtvModelCapabilities } from "../libtv-generation/libtvModelSchema";
import { isNativeLibtvTaskActive } from "../libtv-generation/useNativeLibtvGeneration";

interface UseNativeActionFissionGenerationOptions {
  canvasId: string;
  edges: NativeCanvasEdge[];
  nodes: NativeCanvasNode[];
  patchRow: (nodeId: string, rowId: string, patch: Partial<ActionFissionRow>) => void;
  patchState: (nodeId: string, patch: Partial<ActionFissionState>) => void;
  t: TFunction;
}

function rowPrompt(row: ActionFissionRow, connectedPrompt: string) {
  return [String(row.selectedActionPrompt || "").trim(), connectedPrompt].filter(Boolean).join("\n\n");
}

export function useNativeActionFissionGeneration({
  canvasId,
  edges,
  nodes,
  patchRow,
  patchState,
  t,
}: UseNativeActionFissionGenerationOptions) {
  const mountedRef = useRef(true);
  const apiControllersRef = useRef(new Map<string, AbortController>());
  const libtvControllersRef = useRef(new Map<string, AbortController>());
  const nodeQueueControllersRef = useRef(new Map<string, AbortController>());
  const activeNodeRunsRef = useRef(new Set<string>());
  const thumbnailAttemptsRef = useRef(new Set<string>());
  const recoveringApiRowsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!window.easyTool?.ensureCanvasAssetThumbnail) return;
    nodes.forEach((node) => {
      if (node.data.kind !== "actionFission") return;
      node.data.actionFission?.rows.forEach((row) => {
        const resultUrl = row.resultUrl || row.generationTask?.result?.localUrl || row.generationTask?.result?.url || "";
        if (!resultUrl) return;
        const attemptKey = `${node.id}:${row.id}:${resultUrl}`;
        if (thumbnailAttemptsRef.current.has(attemptKey)) return;
        thumbnailAttemptsRef.current.add(attemptKey);
        void window.easyTool!.ensureCanvasAssetThumbnail({ url: resultUrl })
          .then((thumbnail) => {
            if (thumbnail.thumbUrl) patchRow(node.id, row.id, { resultThumbUrl: thumbnail.thumbUrl });
          })
          .catch(() => undefined);
      });
    });
  }, [nodes, patchRow]);

  const pollApiRow = useCallback(async (taskId: string, nodeId: string, rowId: string) => {
    if (!mountedRef.current || !window.easyTool?.getGenerationTask || apiControllersRef.current.has(taskId)) return;
    const controller = new AbortController();
    apiControllersRef.current.set(taskId, controller);
    try {
      while (!controller.signal.aborted) {
        const task = normalizeGenerationTask(await getGenerationTaskWithRetry(taskId, controller.signal));
        if (!task) throw new Error(t("infiniteCanvas:generationTaskNotFound"));
        const terminal = TERMINAL_TASK_STATUSES.has(task.status);
        patchRow(nodeId, rowId, {
          generationTask: task,
          generationTaskId: terminal ? undefined : task.id,
          generationRemoteTaskId: terminal ? undefined : task.upstreamTaskId,
          error: task.status === "failed" ? task.error || t("infiniteCanvas:generationFailed") : "",
          ...(terminal && task.status === "succeeded" ? {
            resultUrl: task.result?.localUrl || task.result?.url,
            resultFileName: task.result?.fileName,
            resultWidth: task.result?.width,
            resultHeight: task.result?.height,
            resultDownloadState: "pending" as const,
            resultDownloadedAt: undefined,
          } : {}),
        });
        if (terminal) return;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
      }
    } catch (error) {
      if (!controller.signal.aborted) patchRow(nodeId, rowId, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      apiControllersRef.current.delete(taskId);
    }
  }, [patchRow, t]);

  const recoverApiRow = useCallback(async (node: NativeCanvasNode, row: ActionFissionRow) => {
    const recoveryKey = `${node.id}:${row.id}`;
    if (recoveringApiRowsRef.current.has(recoveryKey)) return;
    recoveringApiRowsRef.current.add(recoveryKey);
    try {
      let task = row.generationTaskId && window.easyTool?.getGenerationTask
        ? normalizeGenerationTask(await window.easyTool.getGenerationTask(row.generationTaskId))
        : null;
      if (!task && row.generationRemoteTaskId && window.easyTool?.recoverGenerationTask) {
        const settings = await loadApiSettings();
        const provider = settings.providers.find((item) => item.id === node.data.imageProviderId);
        const model = String(node.data.imageModel || "");
        if (!provider || !model) throw new Error(t("infiniteCanvas:noImageApiConfigured"));
        task = normalizeGenerationTask(await window.easyTool.recoverGenerationTask({
          canvasId,
          nodeId: node.id,
          rowId: row.id,
          target: { type: "actionFissionRow", nodeId: node.id, rowId: row.id },
          upstreamTaskId: row.generationRemoteTaskId,
          providerId: provider.id,
          provider,
          model,
          status: "running",
        }));
      }
      if (!task) {
        patchRow(node.id, row.id, {
          generationTaskId: undefined,
          generationRemoteTaskId: undefined,
          error: t("infiniteCanvas:generationInterruptedUnexpected"),
        });
        return;
      }
      patchRow(node.id, row.id, {
        generationTask: task,
        generationTaskId: TERMINAL_TASK_STATUSES.has(task.status) ? undefined : task.id,
        generationRemoteTaskId: TERMINAL_TASK_STATUSES.has(task.status) ? undefined : task.upstreamTaskId,
      });
      await pollApiRow(task.id, node.id, row.id);
    } catch (error) {
      patchRow(node.id, row.id, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      recoveringApiRowsRef.current.delete(recoveryKey);
    }
  }, [canvasId, patchRow, pollApiRow, t]);

  const runApiRows = useCallback(async (node: NativeCanvasNode, rows: ActionFissionRow[], references: string[], connectedPrompt: string) => {
    if (!window.easyTool?.createGenerationTasks) throw new Error(t("infiniteCanvas:canvasDesktopRequired"));
    const settings = await loadApiSettings();
    const providers = orderedApiProviders(settings.providers, settings.providerOrder).filter(isImageProviderConfigured);
    const provider = providers.find((item) => item.id === node.data.imageProviderId)
      || providers.find((item) => item.id === settings.defaultImageProviderId)
      || providers[0];
    const model = provider?.imageModels.includes(String(node.data.imageModel || ""))
      ? String(node.data.imageModel)
      : provider?.imageModels[0] || "";
    if (!provider || !model) throw new Error(t("infiniteCanvas:noImageApiConfigured"));
    const rule = getImageModelRule(provider.modelRules.image[model] || detectImageModelRuleId(model));
    const referenceError = validateImageGeneratorReferences(rule, references.length);
    if (referenceError === "unsupported") throw new Error(t("infiniteCanvas:imageGenerationReferenceNotSupported"));
    if (referenceError === "tooMany") throw new Error(t("infiniteCanvas:imageGenerationTooManyReferenceImages", { count: rule.maxReferenceImages }));
    const size = normalizeImageModelSizeSelection(rule, node.data.imageResolution, node.data.imageAspectRatio);

    const payloads = rows.map((row) => {
      const prompt = rowPrompt(row, connectedPrompt);
      if (!prompt) throw new Error(t("infiniteCanvas:promptRequired"));
      return {
          canvasId,
          nodeId: node.id,
          target: { type: "actionFissionRow", nodeId: node.id, rowId: row.id },
          kind: "image",
          providerId: provider.id,
          provider,
          model,
          modelRule: rule,
          prompt,
          referenceImages: references,
          resolution: size.resolution,
          aspectRatio: size.aspectRatio,
          quality: node.data.imageQuality,
          imageCount: 1,
          status: "submitting",
      };
    });
    const tasks = (await window.easyTool.createGenerationTasks(payloads))
      .map(normalizeGenerationTask);
    if (tasks.some((task) => !task)) throw new Error(t("infiniteCanvas:generationTaskCreateFailed"));
    if (!mountedRef.current) return;
    const normalizedTasks = tasks.filter((task): task is NonNullable<typeof task> => Boolean(task));
    normalizedTasks.forEach((task, index) => {
      const row = rows[index];
      patchRow(node.id, row.id, {
        generationTask: task,
        generationTaskId: task.id,
        error: "",
        resultDownloadState: undefined,
        resultDownloadedAt: undefined,
      });
    });
    endGenerationLaunching(rows.map((row) => actionFissionLaunchKey(canvasId, node.id, row.id)));
    await Promise.allSettled(normalizedTasks.map((task, index) => pollApiRow(task.id, node.id, rows[index].id)));
  }, [canvasId, patchRow, pollApiRow, t]);

  const pollLibtvRow = useCallback(async (taskId: string, nodeId: string, rowId: string) => {
    if (!mountedRef.current || !window.libtv?.getImageTask || libtvControllersRef.current.has(taskId)) return;
    const controller = new AbortController();
    libtvControllersRef.current.set(taskId, controller);
    try {
      while (!controller.signal.aborted) {
        const task = await window.libtv.getImageTask(taskId);
        if (!task) throw new Error(t("infiniteCanvas:generationTaskNotFound"));
        const active = isNativeLibtvTaskActive(task);
        patchRow(nodeId, rowId, {
          libtvTask: task,
          libtvTaskId: active ? task.id : undefined,
          libtvProjectUuid: active ? task.projectUuid : undefined,
          libtvRemoteNodeId: active ? task.remoteNodeId : undefined,
          libtvQueued: task.status === "queued" || task.status === "preparing" || task.status === "uploading",
          libtvRunning: task.status === "running",
          error: task.status === "failed" ? task.error || t("infiniteCanvas:generationFailed") : "",
          ...(!active && task.status === "succeeded" ? {
            resultUrl: task.result?.localUrl || task.result?.url,
            resultFileName: task.result?.fileName,
            resultDownloadState: "pending" as const,
            resultDownloadedAt: undefined,
          } : {}),
        });
        if (!active) return;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
      }
    } catch (error) {
      if (!controller.signal.aborted) patchRow(nodeId, rowId, { libtvQueued: false, libtvRunning: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      libtvControllersRef.current.delete(taskId);
    }
  }, [patchRow, t]);

  const recoverLibtvRow = useCallback(async (node: NativeCanvasNode, row: ActionFissionRow) => {
    if (!row.libtvTaskId || !window.libtv?.recoverImageTask) return;
    const recoveryKey = `libtv:${node.id}:${row.id}`;
    if (recoveringApiRowsRef.current.has(recoveryKey)) return;
    recoveringApiRowsRef.current.add(recoveryKey);
    try {
      let task = await window.libtv.getImageTask(row.libtvTaskId);
      if (!task) {
        task = await window.libtv.recoverImageTask({
          canvasId,
          nodeId: node.id,
          rowId: row.id,
          taskId: row.libtvTaskId,
          target: { type: "actionFissionRow", nodeId: node.id, rowId: row.id },
          projectUuid: row.libtvProjectUuid,
          remoteNodeId: row.libtvRemoteNodeId,
        });
      }
      if (!task) {
        patchRow(node.id, row.id, {
          libtvTaskId: undefined,
          libtvQueued: false,
          libtvRunning: false,
          error: t("infiniteCanvas:generationInterruptedUnexpected"),
        });
        return;
      }
      patchRow(node.id, row.id, { libtvTask: task, libtvTaskId: isNativeLibtvTaskActive(task) ? task.id : undefined });
      await pollLibtvRow(task.id, node.id, row.id);
    } catch (error) {
      patchRow(node.id, row.id, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      recoveringApiRowsRef.current.delete(recoveryKey);
    }
  }, [canvasId, patchRow, pollLibtvRow, t]);

  useEffect(() => {
    nodes.forEach((node) => {
      if (node.data.kind !== "actionFission") return;
      node.data.actionFission?.rows.forEach((row) => {
        if (node.data.imageGenerationBackend === "libtv") {
          if (isNativeLibtvTaskActive(row.libtvTask)) void pollLibtvRow(row.libtvTask!.id, node.id, row.id);
          else if (row.libtvTaskId) void recoverLibtvRow(node, row);
        } else if (isNativeGenerationTaskActive(row.generationTask)) {
          void pollApiRow(row.generationTask!.id, node.id, row.id);
        } else if (row.generationTaskId || row.generationRemoteTaskId) {
          void recoverApiRow(node, row);
        }
      });
    });
  }, [nodes, pollApiRow, pollLibtvRow, recoverApiRow, recoverLibtvRow]);

  const runLibtvRows = useCallback(async (node: NativeCanvasNode, rows: ActionFissionRow[], references: string[], connectedPrompt: string, signal: AbortSignal) => {
    if (!window.libtv?.startImageTasks) throw new Error(t("infiniteCanvas:libtvUnavailable"));
    const status = await window.libtv.status();
    if (!status.available) throw new Error(status.error || t("infiniteCanvas:libtvUnavailable"));
    const account = await window.libtv.account();
    if (!account.loggedIn) throw new Error(account.error || t("infiniteCanvas:libtvNotLoggedIn"));
    const state = node.data.libtvImageGeneration || {};
    const modelName = String(state.modelName || "").trim();
    if (!modelName) throw new Error(t("infiniteCanvas:libtvModelRequired"));
    const capabilities = deriveLibtvModelCapabilities(await window.libtv.imageModelSchema({ model: modelName }));
    if (!capabilities.supportsReferenceImages) throw new Error(t("infiniteCanvas:imageGenerationReferenceNotSupported"));
    if (references.length > capabilities.maxReferenceImages) {
      throw new Error(t("infiniteCanvas:imageGenerationTooManyReferenceImages", { count: capabilities.maxReferenceImages }));
    }
    const storedResolution = capabilities.resolutionField === "resolution" ? String(state.resolution || "") : String(state.quality || "");
    const selectedResolution = capabilities.resolutions.includes(storedResolution) ? storedResolution : capabilities.defaultResolution;
    const quality = capabilities.resolutionField === "quality"
      ? selectedResolution
      : capabilities.qualities.includes(String(state.quality || "")) ? String(state.quality) : capabilities.defaultQuality;
    const resolution = capabilities.resolutionField === "resolution" ? selectedResolution : "";
    const aspectRatio = capabilities.aspectRatios.includes(String(state.aspectRatio || ""))
      ? String(state.aspectRatio)
      : capabilities.defaultAspectRatio;

    rows.forEach((row) => patchRow(node.id, row.id, {
      libtvQueued: true,
      libtvRunning: false,
      error: "",
    }));

    const payloads = rows.map((row) => {
      const prompt = rowPrompt(row, connectedPrompt);
      if (!prompt) {
        throw new Error(t("infiniteCanvas:promptRequired"));
      }
      return {
        canvasId,
        nodeId: node.id,
        target: { type: "actionFissionRow" as const, nodeId: node.id, rowId: row.id },
        queueKey: `${canvasId}:${node.id}`,
        prompt,
        modelName,
        count: 1,
        quality,
        resolution,
        aspectRatio,
        referenceImages: references,
        nodeTitle: `${t("infiniteCanvas:actionFission")} - ${row.selectedActionName || row.id}`,
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      };
    });
    if (signal.aborted) return;
    const tasks = await window.libtv.startImageTasks(payloads);
    if (!mountedRef.current) return;
    tasks.forEach((task, index) => patchRow(node.id, rows[index].id, {
      libtvTask: task,
      libtvTaskId: task.id,
      libtvQueued: true,
      error: "",
    }));
    endGenerationLaunching(rows.map((row) => actionFissionLaunchKey(canvasId, node.id, row.id)));
    await Promise.all(tasks.map((task, index) => pollLibtvRow(task.id, node.id, rows[index].id)));
  }, [canvasId, patchRow, pollLibtvRow, t]);

  const runActionFission = useCallback(async (nodeId: string, rowId?: string) => {
    const runKey = `${nodeId}:${rowId || "group"}`;
    const nodeRunPrefix = `${nodeId}:`;
    if (activeNodeRunsRef.current.has(runKey)) return;
    if (!rowId && [...activeNodeRunsRef.current].some((key) => key.startsWith(nodeRunPrefix))) return;
    const node = nodes.find((item) => item.id === nodeId && item.data.kind === "actionFission");
    const state = node?.data.actionFission;
    if (!node || !state) return;
    const references = collectImageGeneratorReferences(nodeId, nodes, edges, t("infiniteCanvas:referenceImage"));
    const targetRows = rowId ? state.rows.filter((row) => row.id === rowId) : state.rows;
    const readiness = getActionFissionRunReadiness(targetRows, references.length);
    if (!readiness.canRun) {
      patchState(nodeId, { error: readiness.missingReference
        ? t("infiniteCanvas:actionFissionConnectReferenceFirst")
        : t("infiniteCanvas:actionFissionSelectActionFirst") });
      return;
    }
    if (targetRows.some((row) => isNativeGenerationTaskActive(row.generationTask) || row.libtvTaskId || isNativeLibtvTaskActive(row.libtvTask))) return;
    const connectedPrompt = collectConnectedPrompt(nodeId, nodes, edges);
    const queueController = new AbortController();
    const launchKeys = targetRows.map((row) => actionFissionLaunchKey(canvasId, nodeId, row.id));
    beginGenerationLaunching(launchKeys);
    activeNodeRunsRef.current.add(runKey);
    nodeQueueControllersRef.current.set(runKey, queueController);
    patchState(nodeId, { error: "", status: "" });
    try {
      if (node.data.imageGenerationBackend === "libtv") {
        await runLibtvRows(node, targetRows, references.map((item) => item.imageUrl), connectedPrompt, queueController.signal);
      } else {
        await runApiRows(node, targetRows, references.map((item) => item.imageUrl), connectedPrompt);
      }
    } catch (error) {
      if (mountedRef.current) patchState(nodeId, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      endGenerationLaunching(launchKeys);
      if (mountedRef.current) targetRows.forEach((row) => patchRow(nodeId, row.id, { libtvQueued: false }));
      activeNodeRunsRef.current.delete(runKey);
      if (nodeQueueControllersRef.current.get(runKey) === queueController) nodeQueueControllersRef.current.delete(runKey);
      if (mountedRef.current) patchState(nodeId, { status: "" });
    }
  }, [canvasId, edges, nodes, patchRow, patchState, runApiRows, runLibtvRows, t]);

  const stopActionFission = useCallback(async (nodeId: string, rowId?: string) => {
    if (!rowId) {
      const prefix = `${nodeId}:`;
      nodeQueueControllersRef.current.forEach((controller, key) => {
        if (key.startsWith(prefix)) controller.abort();
      });
    }
    const rows = nodes.find((node) => node.id === nodeId)?.data.actionFission?.rows || [];
    const targets = rowId ? rows.filter((row) => row.id === rowId) : rows;
    await Promise.allSettled(targets.map(async (row) => {
      const apiTaskId = row.generationTask?.id || row.generationTaskId;
      if (apiTaskId) {
        apiControllersRef.current.get(apiTaskId)?.abort();
        const stopped = normalizeGenerationTask(await window.easyTool?.stopGenerationTask?.(apiTaskId));
        patchRow(nodeId, row.id, {
          generationTask: stopped || (row.generationTask ? { ...row.generationTask, status: "interrupted", updatedAt: Date.now() } : undefined),
          generationTaskId: undefined,
          generationRemoteTaskId: undefined,
          error: "",
        });
      } else if (row.generationRemoteTaskId) {
        await window.easyTool?.stopGenerationTasksForTarget?.(canvasId, { type: "actionFissionRow", nodeId, rowId: row.id });
        patchRow(nodeId, row.id, { generationRemoteTaskId: undefined, error: "" });
      }
      const libtvTaskId = row.libtvTask?.id || row.libtvTaskId;
      if (libtvTaskId) {
        libtvControllersRef.current.get(libtvTaskId)?.abort();
        const stopped = await window.libtv?.stopImageTask?.(libtvTaskId);
        patchRow(nodeId, row.id, {
          libtvTask: stopped || (row.libtvTask ? { ...row.libtvTask, status: "interrupted" } : undefined),
          libtvTaskId: undefined,
          libtvProjectUuid: undefined,
          libtvRemoteNodeId: undefined,
          libtvQueued: false,
          libtvRunning: false,
          error: "",
        });
      }
    }));
    patchState(nodeId, { status: "" });
  }, [canvasId, nodes, patchRow, patchState]);

  useEffect(() => activateGenerationHook(mountedRef, () => {
    apiControllersRef.current.forEach((controller) => controller.abort());
    libtvControllersRef.current.forEach((controller) => controller.abort());
    apiControllersRef.current.clear();
    libtvControllersRef.current.clear();
    nodeQueueControllersRef.current.clear();
    activeNodeRunsRef.current.clear();
    recoveringApiRowsRef.current.clear();
  }), []);

  return { runActionFission, stopActionFission };
}
