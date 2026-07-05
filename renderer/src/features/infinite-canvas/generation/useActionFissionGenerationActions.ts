import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type { TFunction } from "i18next";
import type { ApiProvider } from "../../settings/apiProviders";
import { detectImageModelRuleId, getImageModelRule, normalizeImageModelSizeSelection } from "../../settings/imageModelRules";
import type { ActionEntry, ActionTag } from "../../action-library/types";
import { actionPatchFromEntry, selectActionForRow } from "../action-fission/actionFissionActions";
import { normalizeActionFissionState, patchActionFissionRow, updateActionFissionState } from "../action-fission/actionFissionState";
import { collectDirectActionFissionPrompt, collectDirectActionFissionReferenceImages, validatePublicReferenceCount, validateTotalReferenceCount } from "../action-fission/actionFissionReferences";
import type { ActionFissionRow, ActionFissionState } from "../action-fission/actionFissionTypes";
import type { CanvasConnection, CanvasDocumentRecord, CanvasGenerationTask, CanvasGroup, CanvasNode, Viewport } from "../types";
import { createLocalGenerationTask, getLocalGenerationTask, resumeLocalGenerationTask, stopLocalGenerationTasksForNode, stopLocalGenerationTasksForTarget, updateLocalGenerationTask, waitForLocalGenerationTask } from "./generationTaskRegistry";
import { collectGenerationTasksFromNodes } from "./nodeGenerationTaskAnchors";
import { isGenerationTaskActive } from "./generationTaskRuntime";
import { ensureLibtvReadyProject, generateLibtvBatch, listLibtvImageModels, listLibtvWorkspaces } from "../libtv-generation/libtvGenerationApi";
import { readImageDimensions } from "../imageCrop";
import { sanitizeCanvasNodesForSave } from "../canvasSerialization";

type StateUpdater<T> = T | ((current: T) => T);

interface UseActionFissionGenerationActionsOptions {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  apiProviders: ApiProvider[];
  defaultImageProviderId: string;
  defaultImageApiType: "third-party-api" | "libtv-api";
  imageProviders: ApiProvider[];
  libtvReady: boolean;
  libtvUnavailableMessage: string;
  activeCanvasId: string;
  activeCanvasTitle: string;
  activeProject: CanvasDocumentRecord | null;
  activeCanvasIdRef: MutableRefObject<string>;
  groups: CanvasGroup[];
  viewport: Viewport;
  patchNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  setNodes: (updater: StateUpdater<CanvasNode[]>) => void;
  writebackGenerationTask: (task: CanvasGenerationTask) => Promise<void>;
  t: TFunction;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function supportsStandardImageGeneration(provider: ApiProvider) {
  return provider.protocol === "openai" || provider.protocol === "compatible" || provider.protocol === "gemini";
}

function taskRuntimeKey(task: CanvasGenerationTask) {
  const target = task.target?.type === "actionFissionRow" ? `${task.target.nodeId}:${task.target.rowId}` : task.nodeId;
  return task.upstreamTaskId ? `${task.canvasId}:${target}:${task.upstreamTaskId}` : task.id;
}

function patchNodeActionFission(
  setNodes: (updater: StateUpdater<CanvasNode[]>) => void,
  nodeId: string,
  updater: (state: ActionFissionState) => ActionFissionState,
) {
  setNodes((current) => current.map((node) => (
    node.id === nodeId
      ? { ...node, actionFission: updateActionFissionState(node, updater) }
      : node
  )));
}

function patchRowInState(rowId: string, patch: Partial<ActionFissionRow>) {
  return (state: ActionFissionState) => patchActionFissionRow(state, rowId, patch);
}

function patchRowGenerationTaskInNode(setNodes: (updater: StateUpdater<CanvasNode[]>) => void, nodeId: string, rowId: string, task?: CanvasGenerationTask) {
  patchNodeActionFission(setNodes, nodeId, patchRowInState(rowId, { generationTask: task }));
}

function normalizeLibtvQuality(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  if (text === '4k') return '4K';
  if (text === '2k') return '2K';
  return '1K';
}

function matchesLibtvModel(model: { modelName?: string; modelKey?: string }, modelName: string) {
  return (model.modelName || model.modelKey) === modelName;
}

export function useActionFissionGenerationActions({
  nodes,
  connections,
  apiProviders,
  defaultImageProviderId,
  defaultImageApiType,
  imageProviders,
  libtvReady,
  libtvUnavailableMessage,
  activeCanvasId,
  activeCanvasTitle,
  activeProject,
  activeCanvasIdRef,
  groups,
  viewport,
  patchNode,
  setNodes,
  writebackGenerationTask,
  t,
}: UseActionFissionGenerationActionsOptions) {
  const abortControllersRef = useRef<Record<string, AbortController>>({});
  const activeTaskKeysRef = useRef<Set<string>>(new Set());
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const saveActiveNodes = useCallback(async (nextNodes: CanvasNode[]) => {
    if (!activeCanvasId || activeCanvasIdRef.current !== activeCanvasId || !window.easyTool?.saveCanvas) return;
    await window.easyTool.saveCanvas(activeCanvasId, {
      title: activeCanvasTitle,
      icon: activeProject?.icon,
      canvasType: activeProject?.canvasType,
      nodes: sanitizeCanvasNodesForSave(nextNodes),
      connections,
      groups,
      viewport,
    });
  }, [activeCanvasId, activeCanvasIdRef, activeCanvasTitle, activeProject, connections, groups, viewport]);

  const getProviderForNode = useCallback((state: ActionFissionState) => {
    return apiProviders.find((item) => item.id === state.providerId && supportsStandardImageGeneration(item))
      || apiProviders.find((item) => item.id === defaultImageProviderId && supportsStandardImageGeneration(item))
      || imageProviders[0]
      || null;
  }, [apiProviders, defaultImageProviderId, imageProviders]);

  const getApiTypeForState = useCallback((state: ActionFissionState) => {
    return state.providerId || state.model || state.apiType === "libtv-api"
      ? state.apiType || "third-party-api"
      : defaultImageApiType;
  }, [defaultImageApiType]);

  const runLibtvActionFissionRows = useCallback(async (
    nodeId: string,
    rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>,
    preselectedActions = new Map<string, ActionEntry>(),
  ) => {
    const node = nodeMap.get(nodeId);
    if (!node) return;
    const sourceState = normalizeActionFissionState(node.actionFission);
    if (!libtvReady) {
      patchNodeActionFission(setNodes, nodeId, (state) => ({ ...state, error: libtvUnavailableMessage }));
      return;
    }
    const workspaceId = String(sourceState.libtvWorkspaceId || "").trim();
    const modelName = String(sourceState.libtvModelName || "").trim();
    if (!workspaceId) {
      patchNodeActionFission(setNodes, nodeId, (state) => ({ ...state, error: t("infiniteCanvas:libtvWorkspaceRequired") }));
      return;
    }
    if (!modelName) {
      patchNodeActionFission(setNodes, nodeId, (state) => ({ ...state, error: t("infiniteCanvas:libtvModelRequired") }));
      return;
    }

    const publicReferences = collectDirectActionFissionReferenceImages(node, nodes, connections);
    const upstreamPrompt = collectDirectActionFissionPrompt(node, nodes, connections);
    const publicValidation = validatePublicReferenceCount(publicReferences.length, null);
    if (!publicValidation.valid) {
      patchNodeActionFission(setNodes, nodeId, (state) => ({ ...state, error: t("infiniteCanvas:actionFissionTooManyPublicReferences", { count: publicValidation.limit }) }));
      return;
    }
    const jobs: Array<{ id: string; prompt: string; modelName: string; aspectRatio: string; quality: string; referenceImages: string[]; nodeTitle: string; x: number; y: number }> = [];
    const preparedRows = new Map<string, ActionFissionRow>();
    let nextRows = sourceState.rows.map((row) => ({ ...row }));

    for (const rowData of rowsData) {
      const rowIndex = nextRows.findIndex((row) => row.id === rowData.rowId);
      let row = rowIndex >= 0 ? nextRows[rowIndex] : null;
      if (!row || row.libtvRunning) continue;
      if (!row.selectedActionPrompt) {
        const selection = preselectedActions.has(row.id)
          ? null
          : selectActionForRow({ row, rows: nextRows, actions: rowData.actions, tags: rowData.tags });
        const action = preselectedActions.get(row.id) || selection?.action || null;
        if (!action) {
          nextRows[rowIndex] = {
            ...row,
            error: selection?.reason === "noCandidatesAfterRules"
              ? t("infiniteCanvas:actionFissionNoSwitchableAction")
              : t("infiniteCanvas:actionFissionNoCandidates"),
          };
          continue;
        }
        row = { ...row, ...actionPatchFromEntry(action) };
        nextRows[rowIndex] = row;
      }
      const prompt = [row.selectedActionPrompt?.trim() || "", upstreamPrompt].filter(Boolean).join("\n\n");
      if (!prompt) {
        nextRows[rowIndex] = { ...row, error: t("infiniteCanvas:promptRequired") };
        continue;
      }
      const runningRow = {
        ...row,
        error: "",
        libtvQueued: true,
        libtvRunning: false,
        resultDownloadState: undefined,
        resultDownloadedAt: undefined,
      };
      nextRows[rowIndex] = runningRow;
      preparedRows.set(row.id, runningRow);
      jobs.push({
        id: row.id,
        prompt,
        modelName,
        aspectRatio: sourceState.aspectRatio || "1:1",
        quality: normalizeLibtvQuality(sourceState.resolution),
        referenceImages: publicReferences,
        nodeTitle: `${node.title || "Action Fission"} - ${row.selectedActionName || row.id}`,
        x: Math.round(node.x + 420),
        y: Math.round(node.y + jobs.length * 280),
      });
    }

    if (!jobs.length) {
      patchNodeActionFission(setNodes, nodeId, (state) => ({ ...state, rows: nextRows, error: "" }));
      return;
    }

    patchNodeActionFission(setNodes, nodeId, (state) => ({
      ...state,
      rows: nextRows,
      running: false,
      status: "",
      error: "",
    }));

    const writeRowResult = async (
      rowId: string,
      patch: Partial<ActionFissionRow>,
      projectPatch: Partial<ActionFissionState> = {},
    ) => {
      let nextNodesForSave: CanvasNode[] = [];
      setNodes((current) => {
        nextNodesForSave = current.map((currentNode) => {
          if (currentNode.id !== nodeId) return currentNode;
          const state = normalizeActionFissionState(currentNode.actionFission);
          return {
            ...currentNode,
            actionFission: {
              ...state,
              ...projectPatch,
              error: "",
              rows: state.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
            },
          };
        });
        return nextNodesForSave;
      });
      await saveActiveNodes(nextNodesForSave);
    };

    try {
      const setPreflightStatus = (status: string) => {
        patchNodeActionFission(setNodes, nodeId, (state) => ({ ...state, status, error: "" }));
      };

      setPreflightStatus(t("infiniteCanvas:libtvCheckingCli"));
      const availability = await Promise.all([
        listLibtvWorkspaces(),
        listLibtvImageModels(),
      ]);
      const workspaceResult = availability[0];
      const modelResult = availability[1];
      const workspace = (workspaceResult.workspaces || []).find((item) => item.id === workspaceId);
      if (!workspace) throw new Error(t("infiniteCanvas:libtvWorkspaceRequired"));
      setPreflightStatus(t("infiniteCanvas:libtvCheckingWorkspace"));
      const hasModel = (modelResult.models || []).some((model) => matchesLibtvModel(model, modelName));
      if (!hasModel) throw new Error(t("infiniteCanvas:libtvModelRequired"));
      setPreflightStatus(t("infiniteCanvas:libtvCheckingModel"));
      setPreflightStatus(t("infiniteCanvas:libtvCheckingProject"));
      const readyProject = await ensureLibtvReadyProject({ workspaceId });
      const readyProjectUuid = readyProject.projectUuid || "";
      if (!readyProjectUuid) throw new Error(t("infiniteCanvas:libtvProjectRequired"));
      patchNodeActionFission(setNodes, nodeId, (state) => ({
        ...state,
        status: "",
        error: "",
        libtvWorkspaceName: workspace.name || state.libtvWorkspaceName,
        libtvProjectUuid: readyProjectUuid,
        libtvProjectName: readyProject.projectName || state.libtvProjectName,
      }));

      for (const job of jobs) {
        await writeRowResult(job.id, { libtvQueued: false, libtvRunning: true, error: "" });
        try {
          const batch = await generateLibtvBatch({
            workspaceId,
            projectUuid: readyProjectUuid,
            projectName: readyProject.projectName,
            modelName,
            aspectRatio: sourceState.aspectRatio || "1:1",
            quality: normalizeLibtvQuality(sourceState.resolution),
            jobs: [job],
          });
          const result = batch.results[0];
          if (!result) {
            await writeRowResult(job.id, { libtvQueued: false, libtvRunning: false, error: t("infiniteCanvas:generationFailed") }, {
              libtvProjectUuid: batch.projectUuid || sourceState.libtvProjectUuid,
              libtvProjectName: batch.projectName || sourceState.libtvProjectName,
            });
            continue;
          }
          if (!result.ok) {
            await writeRowResult(job.id, { libtvQueued: false, libtvRunning: false, error: result.error || t("infiniteCanvas:generationFailed") }, {
              libtvProjectUuid: batch.projectUuid || sourceState.libtvProjectUuid,
              libtvProjectName: batch.projectName || sourceState.libtvProjectName,
            });
            continue;
          }
          const dimensions = result.localUrl ? await readImageDimensions(result.localUrl) : null;
          await writeRowResult(job.id, {
            libtvQueued: false,
            libtvRunning: false,
            resultUrl: result.localUrl || result.url,
            resultFileName: result.fileName || "libtv-generated-image.png",
            resultWidth: dimensions?.width,
            resultHeight: dimensions?.height,
            resultDownloadState: "pending",
            resultDownloadedAt: undefined,
            error: "",
          }, {
            libtvProjectUuid: batch.projectUuid || sourceState.libtvProjectUuid,
            libtvProjectName: batch.projectName || sourceState.libtvProjectName,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await writeRowResult(job.id, { libtvQueued: false, libtvRunning: false, error: message });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let nextNodesForSave: CanvasNode[] = [];
      setNodes((current) => {
        nextNodesForSave = current.map((currentNode) => {
          if (currentNode.id !== nodeId) return currentNode;
          const state = normalizeActionFissionState(currentNode.actionFission);
          return {
            ...currentNode,
            actionFission: {
              ...state,
              status: "",
              error: message,
              rows: state.rows.map((row) => preparedRows.has(row.id)
                ? { ...row, libtvQueued: false, libtvRunning: false, error: message }
                : row),
            },
          };
        });
        return nextNodesForSave;
      });
      await saveActiveNodes(nextNodesForSave);
    } finally {
      let nextNodesForSave: CanvasNode[] = [];
      setNodes((current) => {
        nextNodesForSave = current.map((currentNode) => {
          if (currentNode.id !== nodeId) return currentNode;
          const state = normalizeActionFissionState(currentNode.actionFission);
          return {
            ...currentNode,
            actionFission: {
              ...state,
              running: false,
              status: "",
            },
          };
        });
        return nextNodesForSave;
      });
      await saveActiveNodes(nextNodesForSave);
    }
  }, [connections, libtvReady, libtvUnavailableMessage, nodeMap, nodes, saveActiveNodes, setNodes, t]);

  const refreshActionFissionRow = useCallback((nodeId: string, rowId: string, actions: ActionEntry[], tags: ActionTag[]) => {
    const node = nodeMap.get(nodeId);
    if (!node?.actionFission) return;
    const state = normalizeActionFissionState(node.actionFission);
    const row = state.rows.find((item) => item.id === rowId);
    if (!row) return;
    const selection = selectActionForRow({ row, rows: state.rows, actions, tags });
    const action = selection.action;
    if (!action) {
      patchNodeActionFission(setNodes, nodeId, patchRowInState(rowId, {
        error: selection.reason === "noCandidatesAfterRules"
          ? t("infiniteCanvas:actionFissionNoSwitchableAction")
          : t("infiniteCanvas:actionFissionNoCandidates"),
      }));
      return;
    }
    patchNodeActionFission(setNodes, nodeId, patchRowInState(rowId, actionPatchFromEntry(action)));
  }, [nodeMap, setNodes, t]);

  const switchAllActionFissionRows = useCallback((nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => {
    if (!rowsData.length) return;
    const node = nodeMap.get(nodeId);
    if (!node?.actionFission) return;
    const sourceState = normalizeActionFissionState(node.actionFission);
    const rowDataById = new Map(rowsData.map((rowData) => [rowData.rowId, rowData]));
    const plannedRows = sourceState.rows.map((row) => ({ ...row }));
    const changedRows = new Map<string, ActionFissionRow>();
    let changed = false;

    plannedRows.forEach((row, rowIndex) => {
      const rowData = rowDataById.get(row.id);
      if (!rowData || !row.actionProjectId) return row;
      const selection = selectActionForRow({ row, rows: plannedRows, actions: rowData.actions, tags: rowData.tags });
      if (!selection.action) {
        changed = true;
        const nextRow = {
          ...row,
          error: selection.reason === "noCandidatesAfterRules"
            ? t("infiniteCanvas:actionFissionNoSwitchableAction")
            : t("infiniteCanvas:actionFissionNoCandidates"),
        };
        plannedRows[rowIndex] = nextRow;
        changedRows.set(row.id, nextRow);
        return nextRow;
      }
      changed = true;
      const nextRow = { ...row, ...actionPatchFromEntry(selection.action) };
      plannedRows[rowIndex] = nextRow;
      changedRows.set(row.id, nextRow);
      return nextRow;
    });

    if (!changed) return;
    patchNodeActionFission(setNodes, nodeId, (state) => ({
      ...state,
      rows: state.rows.map((row) => changedRows.get(row.id) || row),
    }));
  }, [nodeMap, setNodes, t]);

  const stopActionFissionRow = useCallback((nodeId: string, rowId: string) => {
    const key = `${nodeId}:${rowId}`;
    abortControllersRef.current[key]?.abort();
    delete abortControllersRef.current[key];
    const canvasId = activeCanvasId;
    if (canvasId) {
      void (async () => {
        await stopLocalGenerationTasksForTarget(canvasId, { type: "actionFissionRow", nodeId, rowId });
      })();
    }
    patchNodeActionFission(setNodes, nodeId, patchRowInState(rowId, {
      error: "",
      libtvQueued: false,
      libtvRunning: false,
      generationTask: undefined,
    }));
  }, [activeCanvasId, setNodes]);

  const runActionFissionRow = useCallback(async (nodeId: string, rowId: string, actions: ActionEntry[], tags: ActionTag[], preselectedAction?: ActionEntry) => {
    const node = nodeMap.get(nodeId);
    if (!node || !activeCanvasId) {
      patchNode(nodeId, { generationError: t("infiniteCanvas:canvasDesktopRequired") });
      return;
    }
    const state = normalizeActionFissionState(node.actionFission);
    if (getApiTypeForState(state) === "libtv-api") {
      await runLibtvActionFissionRows(nodeId, [{ rowId, actions, tags }], preselectedAction ? new Map([[rowId, preselectedAction]]) : undefined);
      return;
    }
    const row = state.rows.find((item) => item.id === rowId);
    if (!row) return;
    if (isGenerationTaskActive(row.generationTask)) return;
    const provider = getProviderForNode(state);
    const model = state.model && provider?.imageModels.includes(state.model) ? state.model : provider?.imageModels[0] || "";
    if (!provider || !model) {
      patchNodeActionFission(setNodes, nodeId, patchRowInState(rowId, { error: t("infiniteCanvas:noImageApiConfigured") }));
      return;
    }
    let activeRow = row;
    if (!activeRow.selectedActionPrompt) {
      const selection = preselectedAction ? null : selectActionForRow({ row: activeRow, rows: state.rows, actions, tags });
      const action = preselectedAction || selection?.action || null;
      if (!action) {
        patchNodeActionFission(setNodes, nodeId, patchRowInState(rowId, {
          error: selection?.reason === "noCandidatesAfterRules"
            ? t("infiniteCanvas:actionFissionNoSwitchableAction")
            : t("infiniteCanvas:actionFissionNoCandidates"),
        }));
        return;
      }
      activeRow = { ...activeRow, ...actionPatchFromEntry(action) };
      patchNodeActionFission(setNodes, nodeId, patchRowInState(rowId, actionPatchFromEntry(action)));
    }
    const upstreamPrompt = collectDirectActionFissionPrompt(node, nodes, connections);
    const prompt = [activeRow.selectedActionPrompt?.trim() || "", upstreamPrompt].filter(Boolean).join("\n\n");
    if (!prompt) {
      patchNodeActionFission(setNodes, nodeId, patchRowInState(rowId, { error: t("infiniteCanvas:promptRequired") }));
      return;
    }

    const rule = getImageModelRule(provider.modelRules.image[model] || detectImageModelRuleId(model));
    const publicReferences = collectDirectActionFissionReferenceImages(node, nodes, connections);
    const references = publicReferences;
    const publicValidation = validatePublicReferenceCount(publicReferences.length, rule);
    if (!publicValidation.valid) {
      patchNodeActionFission(setNodes, nodeId, patchRowInState(rowId, { error: t("infiniteCanvas:actionFissionTooManyPublicReferences", { count: publicValidation.limit }) }));
      return;
    }
    const totalValidation = validateTotalReferenceCount(references.length, rule);
    if (!totalValidation.valid) {
      patchNodeActionFission(setNodes, nodeId, patchRowInState(rowId, { error: t("infiniteCanvas:imageGenerationTooManyReferenceImages", { count: totalValidation.limit }) }));
      return;
    }
    const normalizedSize = normalizeImageModelSizeSelection(rule, state.resolution, state.aspectRatio);

    const key = `${nodeId}:${rowId}`;
    abortControllersRef.current[key]?.abort();
    const abortController = new AbortController();
    abortControllersRef.current[key] = abortController;
    const taskStartedAt = Date.now();
    let task: CanvasGenerationTask = await createLocalGenerationTask({
      id: `${activeCanvasId}:${nodeId}:${rowId}:${taskStartedAt}`,
      canvasId: activeCanvasId,
      nodeId,
      target: { type: "actionFissionRow", nodeId, rowId },
      kind: "image",
      providerId: provider.id,
      model,
      status: "submitting",
      startedAt: taskStartedAt,
      updatedAt: taskStartedAt,
      prompt,
      referenceImages: references,
      resolution: normalizedSize.resolution,
      aspectRatio: normalizedSize.aspectRatio,
      provider,
      modelRule: rule,
    } as CanvasGenerationTask & { provider: ApiProvider; modelRule: unknown });
    const initialTaskKey = taskRuntimeKey(task);
    let upstreamTaskKey = "";
    activeTaskKeysRef.current.add(initialTaskKey);
    patchNodeActionFission(setNodes, nodeId, patchRowInState(rowId, {
      error: "",
      resultDownloadState: undefined,
      resultDownloadedAt: undefined,
      generationTask: task,
    }));
    try {
      const completedTask = await waitForLocalGenerationTask(task.id, (nextTask) => {
        patchRowGenerationTaskInNode(setNodes, nodeId, rowId, nextTask);
        if (nextTask.upstreamTaskId && !upstreamTaskKey) {
          upstreamTaskKey = `${activeCanvasId}:${nodeId}:${rowId}:${nextTask.upstreamTaskId}`;
          activeTaskKeysRef.current.delete(initialTaskKey);
          activeTaskKeysRef.current.add(upstreamTaskKey);
        }
        task = { ...task, ...nextTask };
      }, abortController.signal);
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (completedTask.status !== "succeeded" || !completedTask.result?.localUrl) throw new Error(completedTask.error || "Image generation failed.");
      if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
      await writebackGenerationTask(completedTask);
    } catch (error) {
      const isAbort = isAbortError(error);
      const failedTask: CanvasGenerationTask = {
        ...task,
        status: isAbort ? "interrupted" : "failed",
        error: isAbort ? "" : error instanceof Error ? error.message : String(error),
        interruptReason: isAbort ? "user_stop" : undefined,
        updatedAt: Date.now(),
      };
      await updateLocalGenerationTask(task.id, failedTask);
      await writebackGenerationTask(failedTask);
    } finally {
      activeTaskKeysRef.current.delete(initialTaskKey);
      if (upstreamTaskKey) activeTaskKeysRef.current.delete(upstreamTaskKey);
      if (abortControllersRef.current[key] === abortController) delete abortControllersRef.current[key];
    }
  }, [activeCanvasId, connections, getApiTypeForState, getProviderForNode, nodeMap, nodes, patchNode, runLibtvActionFissionRows, setNodes, t, writebackGenerationTask]);

  const runAllActionFissionRows = useCallback(async (nodeId: string, rowsData: Array<{ rowId: string; actions: ActionEntry[]; tags: ActionTag[] }>) => {
    if (!rowsData.length) return;
    const node = nodeMap.get(nodeId);
    const state = normalizeActionFissionState(node?.actionFission);
    const plannedRows = state.rows.map((row) => ({ ...row }));
    const preselectedActions = new Map<string, ActionEntry>();
    const runnableRowsData = rowsData.filter((rowData) => {
      const rowIndex = plannedRows.findIndex((row) => row.id === rowData.rowId);
      const row = rowIndex >= 0 ? plannedRows[rowIndex] : null;
      if (!row) return false;
      if (row.selectedActionPrompt) return true;
      const selection = selectActionForRow({ row, rows: plannedRows, actions: rowData.actions, tags: rowData.tags });
      if (!selection.action) {
        patchNodeActionFission(setNodes, nodeId, patchRowInState(rowData.rowId, {
          error: selection.reason === "noCandidatesAfterRules"
            ? t("infiniteCanvas:actionFissionNoSwitchableAction")
            : t("infiniteCanvas:actionFissionNoCandidates"),
        }));
        return false;
      }
      preselectedActions.set(rowData.rowId, selection.action);
      plannedRows[rowIndex] = { ...row, ...actionPatchFromEntry(selection.action) };
      return true;
    });
    if (getApiTypeForState(state) === "libtv-api") {
      await runLibtvActionFissionRows(nodeId, runnableRowsData, preselectedActions);
      return;
    }
    await Promise.allSettled(runnableRowsData.map(async (rowData) => {
      await runActionFissionRow(nodeId, rowData.rowId, rowData.actions, rowData.tags, preselectedActions.get(rowData.rowId));
    }));
  }, [getApiTypeForState, nodeMap, runActionFissionRow, runLibtvActionFissionRows, setNodes, t]);

  const resumeActionFissionTask = useCallback(async (task: CanvasGenerationTask) => {
    if (task.target?.type !== "actionFissionRow" || !isGenerationTaskActive(task)) return;
    const target = task.target;
    const runtimeKey = taskRuntimeKey(task);
    if (activeTaskKeysRef.current.has(runtimeKey)) return;
    const provider = apiProviders.find((item) => item.id === task.providerId && supportsStandardImageGeneration(item));
    if (!provider) {
      const interruptedTask: CanvasGenerationTask = {
        ...task,
        status: "interrupted",
        error: t("infiniteCanvas:noImageApiConfigured"),
        interruptReason: "provider_lost",
        updatedAt: Date.now(),
      };
      await updateLocalGenerationTask(task.id, interruptedTask);
      await writebackGenerationTask(interruptedTask);
      return;
    }
    activeTaskKeysRef.current.add(runtimeKey);
    try {
      const localTask = await getLocalGenerationTask(task.id);
      if (localTask && isGenerationTaskActive(localTask)) {
        patchRowGenerationTaskInNode(setNodes, target.nodeId, target.rowId, localTask);
      }
      await resumeLocalGenerationTask(task.id, {
        ...task,
        provider,
        model: task.model,
        modelRule: getImageModelRule(provider.modelRules.image[task.model] || detectImageModelRuleId(task.model)),
      });
      const completedTask = await waitForLocalGenerationTask(task.id, (nextTask) => {
        patchRowGenerationTaskInNode(setNodes, target.nodeId, target.rowId, nextTask);
      });
      if (completedTask.status !== "succeeded" || !completedTask.result?.localUrl) throw new Error(completedTask.error || "Image generation failed.");
      await writebackGenerationTask(completedTask);
    } catch (error) {
      const failedTask: CanvasGenerationTask = {
        ...task,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      };
      await updateLocalGenerationTask(task.id, failedTask);
      await writebackGenerationTask(failedTask);
    } finally {
      activeTaskKeysRef.current.delete(runtimeKey);
    }
  }, [apiProviders, setNodes, t, writebackGenerationTask]);

  const resumeActionFissionTasks = useCallback((canvasNodes: CanvasNode[]) => {
    collectGenerationTasksFromNodes(canvasNodes).forEach((task) => {
      if (task.target?.type === "actionFissionRow" && isGenerationTaskActive(task)) void resumeActionFissionTask(task);
    });
  }, [resumeActionFissionTask]);

  const stopAllActionFissionRows = useCallback((nodeId: string) => {
    Object.keys(abortControllersRef.current)
      .filter((key) => key.startsWith(`${nodeId}:`))
      .forEach((key) => {
        abortControllersRef.current[key]?.abort();
        delete abortControllersRef.current[key];
      });
    if (activeCanvasId) {
      void (async () => {
        await stopLocalGenerationTasksForNode(activeCanvasId, nodeId);
      })();
    }
    patchNodeActionFission(setNodes, nodeId, (state) => ({
      ...state,
      rows: state.rows.map((row) => ({
        ...row,
        error: "",
        libtvQueued: false,
        libtvRunning: false,
        generationTask: undefined,
      })),
    }));
  }, [activeCanvasId, nodeMap, setNodes]);

  return {
    refreshActionFissionRow,
    runActionFissionRow,
    runAllActionFissionRows,
    resumeActionFissionTasks,
    switchAllActionFissionRows,
    stopActionFissionRow,
    stopAllActionFissionRows,
  };
}
