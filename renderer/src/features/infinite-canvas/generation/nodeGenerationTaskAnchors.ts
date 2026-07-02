import { normalizeActionFissionState, patchActionFissionRow } from "../action-fission/actionFissionState";
import type { ActionFissionRow } from "../action-fission/actionFissionTypes";
import type { CanvasGenerationTarget, CanvasGenerationTask, CanvasNode } from "../types";
import { isGenerationTaskActive } from "./generationTaskRuntime";

type TaskPatch = CanvasGenerationTask | null | undefined;

export function getNodeGenerationTask(node: CanvasNode | undefined | null): CanvasGenerationTask | null {
  return node?.generationTask || null;
}

export function getActionFissionRowGenerationTask(row: ActionFissionRow | undefined | null): CanvasGenerationTask | null {
  return row?.generationTask || null;
}

export function getGenerationTaskForNodeTarget(nodes: CanvasNode[], target: CanvasGenerationTarget): CanvasGenerationTask | null {
  const node = nodes.find((item) => item.id === target.nodeId);
  if (!node) return null;
  if (target.type === "imageGenerator") return getNodeGenerationTask(node);
  const state = normalizeActionFissionState(node.actionFission);
  return getActionFissionRowGenerationTask(state.rows.find((row) => row.id === target.rowId));
}

export function isGenerationTargetActiveFromNodes(nodes: CanvasNode[], target: CanvasGenerationTarget): boolean {
  return isGenerationTaskActive(getGenerationTaskForNodeTarget(nodes, target) || undefined);
}

export function isNodeGenerationActiveFromAnchor(node: CanvasNode): boolean {
  if (node.type === "imageGenerator") return isGenerationTaskActive(node.generationTask);
  if (node.type === "actionFission") {
    return normalizeActionFissionState(node.actionFission).rows.some((row) => isGenerationTaskActive(row.generationTask));
  }
  return Boolean(node.running);
}

export function patchNodeGenerationTask(node: CanvasNode, task: TaskPatch): CanvasNode {
  const { generationTask: _generationTask, ...rest } = node;
  return task ? { ...rest, generationTask: task } : rest;
}

export function patchActionFissionRowGenerationTask(node: CanvasNode, rowId: string, task: TaskPatch): CanvasNode {
  const state = normalizeActionFissionState(node.actionFission);
  const rowPatch = task ? { generationTask: task } : { generationTask: undefined };
  return {
    ...node,
    actionFission: patchActionFissionRow(state, rowId, rowPatch),
  };
}

export function patchGenerationTaskForTarget(node: CanvasNode, target: CanvasGenerationTarget, task: TaskPatch): CanvasNode {
  if (target.type === "actionFissionRow") return patchActionFissionRowGenerationTask(node, target.rowId, task);
  return patchNodeGenerationTask(node, task);
}

export function collectGenerationTasksFromNodes(nodes: CanvasNode[]): CanvasGenerationTask[] {
  return nodes.flatMap((node) => {
    const tasks: CanvasGenerationTask[] = [];
    if (node.generationTask) tasks.push(node.generationTask);
    if (node.type === "actionFission") {
      normalizeActionFissionState(node.actionFission).rows.forEach((row) => {
        if (row.generationTask) tasks.push(row.generationTask);
      });
    }
    return tasks;
  });
}
