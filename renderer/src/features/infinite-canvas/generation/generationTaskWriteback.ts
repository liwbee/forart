import { useCallback, useRef, type MutableRefObject } from "react";
import type { TFunction } from "i18next";
import { normalizeActionFissionState, patchActionFissionRow } from "../action-fission/actionFissionState";
import { fitImageNodeSize, readImageDimensions } from "../imageCrop";
import { sanitizeCanvasNodesForSave } from "../canvasSerialization";
import type { CanvasConnection, CanvasDocument, CanvasDocumentRecord, CanvasGenerationTask, CanvasGenerationTaskStatus, CanvasGroup, CanvasNode, Viewport } from "../types";

type StateUpdater<T> = T | ((current: T) => T);

interface UseGenerationTaskWritebackOptions {
  nodes: CanvasNode[];
  activeCanvasTitle: string;
  activeProject: CanvasDocumentRecord | null;
  activeCanvasIdRef: MutableRefObject<string>;
  connections: CanvasConnection[];
  groups: CanvasGroup[];
  viewport: Viewport;
  setNodes: (updater: StateUpdater<CanvasNode[]>) => void;
  t: TFunction;
}

type CanvasSavePayload = Omit<CanvasDocument, "id" | "projectId" | "color" | "pinned" | "createdAt" | "updatedAt">;

function taskStatusMessage(task: CanvasGenerationTask, fallback: string) {
  return task.error || task.message || fallback;
}

function normalizeTaskForTarget(task: CanvasGenerationTask, status: CanvasGenerationTaskStatus = task.status): CanvasGenerationTask {
  return {
    ...task,
    status,
    nodeId: task.target?.nodeId || task.nodeId,
    updatedAt: Date.now(),
  };
}

function shouldHideInterruptedNotice(task: CanvasGenerationTask) {
  return task.status === "interrupted" && (task.interruptReason === "user_stop" || task.interruptReason === "superseded");
}

function shouldKeepRecoveryAnchor(task: CanvasGenerationTask, status: CanvasGenerationTaskStatus) {
  return status === "failed" && Boolean(task.upstreamTaskId);
}

function savePayloadFromActiveSnapshot(
  title: string,
  activeProject: CanvasDocumentRecord | null,
  nodes: CanvasNode[],
  connections: CanvasConnection[],
  groups: CanvasGroup[],
  viewport: Viewport,
): CanvasSavePayload {
  return {
    title,
    icon: activeProject?.icon,
    canvasType: activeProject?.canvasType,
    nodes: sanitizeCanvasNodesForSave(nodes),
    connections,
    groups,
    viewport,
  };
}

function savePayloadFromProject(project: CanvasDocument, nodes: CanvasNode[]): CanvasSavePayload {
  return {
    title: project.title,
    icon: project.icon,
    canvasType: project.canvasType,
    nodes: sanitizeCanvasNodesForSave(nodes),
    connections: project.connections,
    groups: project.groups,
    viewport: project.viewport,
  };
}

export function useGenerationTaskWriteback({
  nodes,
  activeCanvasTitle,
  activeProject,
  activeCanvasIdRef,
  connections,
  groups,
  viewport,
  setNodes,
  t,
}: UseGenerationTaskWritebackOptions) {
  const activeSnapshotRef = useRef({ nodes, activeCanvasTitle, activeProject, connections, groups, viewport });
  activeSnapshotRef.current = { nodes, activeCanvasTitle, activeProject, connections, groups, viewport };

  const saveActiveNodes = useCallback(async (canvasId: string, nextNodes: CanvasNode[]) => {
    if (!window.easyTool?.saveCanvas) throw new Error("Canvas save API is unavailable.");
    const snapshot = activeSnapshotRef.current;
    await window.easyTool.saveCanvas(canvasId, savePayloadFromActiveSnapshot(
      snapshot.activeCanvasTitle,
      snapshot.activeProject,
      nextNodes,
      snapshot.connections,
      snapshot.groups,
      snapshot.viewport,
    ));
  }, []);

  const savePatchedNodes = useCallback(async (
    canvasId: string,
    patchNodes: (current: CanvasNode[]) => { nodes: CanvasNode[]; changed: boolean; orphanReason?: string },
  ) => {
    if (!canvasId) throw new Error("Canvas ID is missing.");
    if (activeCanvasIdRef.current === canvasId) {
      const patchResult = patchNodes(activeSnapshotRef.current.nodes);
      if (patchResult.changed) setNodes(patchResult.nodes);
      if (!patchResult.changed) return patchResult;
      await saveActiveNodes(canvasId, patchResult.nodes);
      return patchResult;
    }
    if (!window.easyTool?.loadCanvas || !window.easyTool.saveCanvas) throw new Error("Canvas load/save API is unavailable.");
    const project = await window.easyTool.loadCanvas(canvasId) as CanvasDocument | null;
    if (!project || !Array.isArray(project.nodes)) return { nodes: [], changed: false, orphanReason: "Canvas project was not found." };
    const patchResult = patchNodes(project.nodes);
    if (!patchResult.changed) return patchResult;
    await window.easyTool.saveCanvas(canvasId, savePayloadFromProject(project, patchResult.nodes));
    return patchResult;
  }, [activeCanvasIdRef, saveActiveNodes, setNodes]);

  const writebackGenerationTask = useCallback(async (task: CanvasGenerationTask) => {
    const terminalStatus = task.writeback?.terminalStatus || task.status;
    const terminalTask = normalizeTaskForTarget(task, terminalStatus);
    if (terminalStatus !== "succeeded" && terminalStatus !== "failed" && terminalStatus !== "interrupted" && terminalStatus !== "superseded") return;
    try {
      if (terminalTask.target?.type === "actionFissionRow") {
        const { nodeId, rowId } = terminalTask.target;
        const result = terminalTask.result;
        const dimensions = result?.localUrl ? await readImageDimensions(result.localUrl) : null;
        const patchResult = await savePatchedNodes(terminalTask.canvasId, (currentNodes) => {
          let changed = false;
          let orphanReason = "Action fission node was not found.";
          const nodes = currentNodes.map((node) => {
            if (node.id !== nodeId) return node;
            const state = normalizeActionFissionState(node.actionFission);
            const row = state.rows.find((item) => item.id === rowId);
            if (!row) {
              orphanReason = "Action fission row was not found.";
              return node;
            }
            changed = true;
            const statusText = terminalStatus === "failed" || terminalStatus === "interrupted" || terminalStatus === "superseded"
              ? taskStatusMessage(terminalTask, t("infiniteCanvas:generationInterrupted", { defaultValue: "Interrupted" }))
              : "";
            const recoveryTask = shouldKeepRecoveryAnchor(terminalTask, terminalStatus) ? terminalTask : undefined;
            return {
              ...node,
              actionFission: patchActionFissionRow(state, rowId, {
                ...(terminalStatus === "succeeded" && result ? {
                  resultUrl: result.localUrl || result.url,
                  resultFileName: result.fileName || "generated-image.png",
                  resultWidth: dimensions?.width || result.width,
                  resultHeight: dimensions?.height || result.height,
                  resultDownloadState: "pending" as const,
                  resultDownloadedAt: undefined,
                } : {}),
                error: terminalStatus === "succeeded" || shouldHideInterruptedNotice(terminalTask) ? "" : statusText,
                generationTask: recoveryTask,
              }),
            };
          });
          return { nodes, changed, orphanReason };
        });
        if (!patchResult.changed) {
          return;
        }
        return;
      }

      const nodeId = terminalTask.target?.nodeId || terminalTask.nodeId;
      const result = terminalTask.result;
      const dimensions = result?.localUrl ? await readImageDimensions(result.localUrl) : null;
      const nextSize = terminalStatus === "succeeded" && result
        ? dimensions ? fitImageNodeSize(dimensions.width, dimensions.height) : fitImageNodeSize(result.width || 1024, result.height || 1024)
        : {};
      const patchResult = await savePatchedNodes(terminalTask.canvasId, (currentNodes) => {
        let changed = false;
        const nodes = currentNodes.map((node) => {
          if (node.id !== nodeId) return node;
          changed = true;
          const statusText = terminalStatus === "failed" || terminalStatus === "interrupted" || terminalStatus === "superseded"
            ? taskStatusMessage(terminalTask, t("infiniteCanvas:generationInterrupted", { defaultValue: "Interrupted" }))
            : "";
          const recoveryTask = shouldKeepRecoveryAnchor(terminalTask, terminalStatus) ? terminalTask : undefined;
          return {
            ...node,
            ...(terminalStatus === "succeeded" && result ? {
              url: result.localUrl || result.url,
              fileName: result.fileName || "generated-image.png",
              imageProviderId: terminalTask.providerId,
              imageModel: terminalTask.model,
              imageResolution: terminalTask.resolution as CanvasNode["imageResolution"],
              imageAspectRatio: terminalTask.aspectRatio as CanvasNode["imageAspectRatio"],
              imageMode: "imageGenerator" as const,
              imageSource: "generated" as const,
              outputDownloadState: "pending" as const,
              outputDownloadedAt: undefined,
              imageNaturalWidth: dimensions?.width || result.width || 1024,
              imageNaturalHeight: dimensions?.height || result.height || 1024,
              ...nextSize,
            } : {}),
            generationError: terminalStatus === "succeeded" ? "" : statusText,
            generationTask: recoveryTask,
          };
        });
        return {
          nodes,
          changed,
          orphanReason: currentNodes.some((node) => node.id === nodeId)
            ? "Image generation node was not changed."
            : "Image generation node was not found.",
        };
      });
      if (!patchResult.changed) {
        return;
      }
    } catch (error) {
      console.error("Generation task writeback failed", error);
    }
  }, [savePatchedNodes, t]);

  return {
    writebackGenerationTask,
  };
}
