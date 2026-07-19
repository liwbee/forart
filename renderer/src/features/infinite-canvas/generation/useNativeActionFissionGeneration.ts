import { useCallback, useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import { isImageProviderConfigured, loadApiSettings, orderedApiProviders } from "../../settings/apiProviders";
import { detectImageModelRuleId, getImageModelRule, normalizeImageModelSizeSelection } from "../../settings/imageModelRules";
import {
  actionFissionRowTaskId,
  type ActionFissionRow,
} from "../action-fission/actionFissionTypes";
import {
  actionFissionPrompt,
  actionFissionReferenceImages,
  getActionFissionRunReadiness,
} from "../action-fission/actionFissionRules";
import type { NativeCanvasEdge, NativeCanvasNode } from "../nativeCanvas";
import {
  collectActionFissionAdditionalPrompts,
  collectActionFissionAdditionalReferences,
  collectImageGeneratorReferences,
  validateImageGeneratorReferences,
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
import { deriveLibtvModelCapabilities } from "../libtv-generation/libtvModelSchema";
import {
  isGenerationTaskActive,
  isGenerationTaskTerminal,
  useGenerationTaskCache,
  watchGenerationTask,
} from "./generationTaskCache";

interface UseNativeActionFissionGenerationOptions {
  canvasId: string;
  edges: NativeCanvasEdge[];
  nodes: NativeCanvasNode[];
  patchRow: (nodeId: string, rowId: string, patch: Partial<ActionFissionRow>) => void;
  t: TFunction;
}

export function useNativeActionFissionGeneration({
  canvasId,
  edges,
  nodes,
  patchRow,
  t,
}: UseNativeActionFissionGenerationOptions) {
  const mountedRef = useRef(true);
  const taskControllersRef = useRef(new Map<string, AbortController>());
  const nodeQueueControllersRef = useRef(new Map<string, AbortController>());
  const activeNodeRunsRef = useRef(new Set<string>());
  const thumbnailAttemptsRef = useRef(new Set<string>());
  const handledTerminalVersionsRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!window.easyTool?.ensureCanvasAssetThumbnail) return;
    nodes.forEach((node) => {
      if (node.data.kind !== "actionFission") return;
      node.data.actionFission?.rows.forEach((row) => {
        const resultUrl = row.resultUrl || "";
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

  const watchRowTask = useCallback(async (taskId: string, nodeId: string, rowId: string) => {
    if (!mountedRef.current || !window.forartGenerationTasks?.get || taskControllersRef.current.has(taskId)) return;
    const cachedTask = useGenerationTaskCache.getState().tasksById[taskId];
    if (cachedTask && isGenerationTaskTerminal(cachedTask.status)
      && (handledTerminalVersionsRef.current.get(taskId) || -1) >= cachedTask.version) return;
    const controller = new AbortController();
    const runtimeKey = actionFissionLaunchKey(canvasId, nodeId, rowId);
    taskControllersRef.current.set(taskId, controller);
    try {
      await watchGenerationTask(taskId, controller.signal, (dto) => {
        if (!isGenerationTaskTerminal(dto.status)) return;
        if ((handledTerminalVersionsRef.current.get(dto.id) || -1) >= dto.version) return;
        handledTerminalVersionsRef.current.set(dto.id, dto.version);
        if (dto.status !== "succeeded" || !dto.result?.images.length) return;
        const image = dto.result.images[0];
        patchRow(nodeId, rowId, {
          resultUrl: image.assetUrl,
          resultThumbUrl: image.thumbUrl,
          resultFileName: image.fileName,
          resultWidth: image.width,
          resultHeight: image.height,
          resultDownloadState: "pending",
          resultDownloadedAt: undefined,
        });
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        setGenerationRuntimeError(runtimeKey, error instanceof Error ? error.message : String(error));
      }
    } finally {
      taskControllersRef.current.delete(taskId);
    }
  }, [canvasId, patchRow]);

  const runApiRows = useCallback(async (
    node: NativeCanvasNode,
    rows: ActionFissionRow[],
    primaryReferences: string[],
    additionalReferences: string[],
    connectedPrompt: string,
    additionalPrompts: string[],
  ) => {
    if (!window.forartGenerationTasks?.startMany) throw new Error(t("infiniteCanvas:canvasDesktopRequired"));
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
    const size = normalizeImageModelSizeSelection(rule, node.data.imageResolution, node.data.imageAspectRatio);

    const payloads = rows.map((row) => {
      const references = actionFissionReferenceImages(row, primaryReferences, additionalReferences);
      const referenceError = validateImageGeneratorReferences(rule, references.length);
      if (referenceError === "unsupported") throw new Error(t("infiniteCanvas:imageGenerationReferenceNotSupported"));
      if (referenceError === "tooMany") throw new Error(t("infiniteCanvas:imageGenerationTooManyReferenceImages", { count: rule.maxReferenceImages }));
      const prompt = actionFissionPrompt(row, connectedPrompt, additionalPrompts);
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
    const tasks = await window.forartGenerationTasks.startMany("api", payloads);
    if (tasks.length !== rows.length) throw new Error(t("infiniteCanvas:generationTaskCreateFailed"));
    if (!mountedRef.current) return;
    tasks.forEach((task, index) => patchRow(node.id, rows[index].id, {
      latestGenerationTaskId: task.id,
      resultDownloadState: undefined,
      resultDownloadedAt: undefined,
    }));
    endGenerationLaunching(rows.map((row) => actionFissionLaunchKey(canvasId, node.id, row.id)));
    await Promise.allSettled(tasks.map((task, index) => watchRowTask(task.id, node.id, rows[index].id)));
  }, [canvasId, patchRow, t, watchRowTask]);

  const runLibtvRows = useCallback(async (
    node: NativeCanvasNode,
    rows: ActionFissionRow[],
    primaryReferences: string[],
    additionalReferences: string[],
    connectedPrompt: string,
    additionalPrompts: string[],
    signal: AbortSignal,
  ) => {
    const libtvApi = window.libtv;
    if (!window.forartGenerationTasks?.startMany || !libtvApi) throw new Error(t("infiniteCanvas:libtvUnavailable"));
    const status = await libtvApi.status();
    if (!status.available) throw new Error(status.error || t("infiniteCanvas:libtvUnavailable"));
    const account = await libtvApi.account();
    if (!account.loggedIn) throw new Error(account.error || t("infiniteCanvas:libtvNotLoggedIn"));
    const state = node.data.libtvImageGeneration || {};
    const modelName = String(state.modelName || "").trim();
    if (!modelName) throw new Error(t("infiniteCanvas:libtvModelRequired"));
    const capabilities = deriveLibtvModelCapabilities(await libtvApi.imageModelSchema({ model: modelName }));
    if (!capabilities.supportsReferenceImages) throw new Error(t("infiniteCanvas:imageGenerationReferenceNotSupported"));
    const storedResolution = capabilities.resolutionField === "resolution" ? String(state.resolution || "") : String(state.quality || "");
    const selectedResolution = capabilities.resolutions.includes(storedResolution) ? storedResolution : capabilities.defaultResolution;
    const quality = capabilities.resolutionField === "quality"
      ? selectedResolution
      : capabilities.qualities.includes(String(state.quality || "")) ? String(state.quality) : capabilities.defaultQuality;
    const resolution = capabilities.resolutionField === "resolution" ? selectedResolution : "";
    const aspectRatio = capabilities.aspectRatios.includes(String(state.aspectRatio || ""))
      ? String(state.aspectRatio)
      : capabilities.defaultAspectRatio;
    const referencesByRowId = new Map(rows.map((row) => {
      const references = actionFissionReferenceImages(row, primaryReferences, additionalReferences);
      if (references.length > capabilities.maxReferenceImages) {
        throw new Error(t("infiniteCanvas:imageGenerationTooManyReferenceImages", { count: capabilities.maxReferenceImages }));
      }
      return [row.id, references] as const;
    }));
    const payloads = rows.map((row) => {
      const prompt = actionFissionPrompt(row, connectedPrompt, additionalPrompts);
      if (!prompt) throw new Error(t("infiniteCanvas:promptRequired"));
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
        referenceImages: referencesByRowId.get(row.id)!,
        nodeTitle: `${t("infiniteCanvas:actionFission")} - ${row.selectedActionName || row.id}`,
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      };
    });
    if (signal.aborted) return;
    const tasks = await window.forartGenerationTasks.startMany("libtv", payloads);
    if (tasks.length !== rows.length) throw new Error(t("infiniteCanvas:generationTaskCreateFailed"));
    if (!mountedRef.current) return;
    tasks.forEach((task, index) => patchRow(node.id, rows[index].id, {
      latestGenerationTaskId: task.id,
      resultDownloadState: undefined,
      resultDownloadedAt: undefined,
    }));
    endGenerationLaunching(rows.map((row) => actionFissionLaunchKey(canvasId, node.id, row.id)));
    await Promise.allSettled(tasks.map((task, index) => watchRowTask(task.id, node.id, rows[index].id)));
  }, [canvasId, patchRow, t, watchRowTask]);

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
    const references = collectImageGeneratorReferences(nodeId, nodes, edges, t("infiniteCanvas:referenceImage"));
    const additionalReferences = collectActionFissionAdditionalReferences(nodeId, nodes, edges, t("infiniteCanvas:additionalReference"));
    const additionalPrompts = collectActionFissionAdditionalPrompts(nodeId, nodes, edges, t("infiniteCanvas:additionalReference"));
    const targetRows = rowId ? state.rows.filter((row) => row.id === rowId) : state.rows;
    const runtimeKeys = targetRows.map((row) => actionFissionLaunchKey(canvasId, nodeId, row.id));
    const readiness = getActionFissionRunReadiness(targetRows, references.length);
    if (!readiness.canRun) {
      const message = readiness.missingReference
        ? t("infiniteCanvas:actionFissionConnectReferenceFirst")
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
      if (node.data.imageGenerationBackend === "libtv") {
        await runLibtvRows(
          node,
          targetRows,
          references.map((item) => item.imageUrl),
          additionalReferences.map((item) => item.imageUrl),
          connectedPrompt,
          additionalPrompts.map((item) => item.text),
          queueController.signal,
        );
      } else {
        await runApiRows(
          node,
          targetRows,
          references.map((item) => item.imageUrl),
          additionalReferences.map((item) => item.imageUrl),
          connectedPrompt,
          additionalPrompts.map((item) => item.text),
        );
      }
    } catch (error) {
      if (mountedRef.current) {
        const message = error instanceof Error ? error.message : String(error);
        runtimeKeys.forEach((key) => setGenerationRuntimeError(key, message));
      }
    } finally {
      endGenerationLaunching(runtimeKeys);
      activeNodeRunsRef.current.delete(runKey);
      if (nodeQueueControllersRef.current.get(runKey) === queueController) nodeQueueControllersRef.current.delete(runKey);
    }
  }, [canvasId, edges, nodes, runApiRows, runLibtvRows, t]);

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
      const taskId = actionFissionRowTaskId(row);
      const task = taskId ? useGenerationTaskCache.getState().tasksById[taskId] : undefined;
      if (!taskId || !isGenerationTaskActive(task)) return;
      taskControllersRef.current.get(taskId)?.abort();
      await window.forartGenerationTasks?.stop(taskId);
      clearGenerationRuntimeError(actionFissionLaunchKey(canvasId, nodeId, row.id));
    }));
  }, [canvasId, nodes]);

  useEffect(() => activateGenerationHook(mountedRef, () => {
    taskControllersRef.current.forEach((controller) => controller.abort());
    taskControllersRef.current.clear();
    nodeQueueControllersRef.current.clear();
    activeNodeRunsRef.current.clear();
  }), []);

  return { runActionFission, stopActionFission };
}
