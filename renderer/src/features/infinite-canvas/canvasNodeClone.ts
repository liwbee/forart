import type { ActionFissionRow, ActionFissionState } from "./action-fission/actionFissionTypes";
import type { CanvasNode } from "./types";

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;

function cloneSerializable<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneActionFissionRowForNewTarget(row: ActionFissionRow): ActionFissionRow {
  const {
    error: _error,
    libtvQueued: _libtvQueued,
    libtvRunning: _libtvRunning,
    generationTask: _generationTask,
    ...durableRow
  } = row;
  return {
    ...durableRow,
    id: uid("action_row"),
  };
}

function cloneActionFissionForNewTarget(state: ActionFissionState | undefined): ActionFissionState | undefined {
  if (!state) return state;
  const {
    error: _error,
    running: _running,
    status: _status,
    ...durableState
  } = state;
  return {
    ...durableState,
    rows: Array.isArray(state.rows) ? state.rows.map(cloneActionFissionRowForNewTarget) : [],
  };
}

export function cloneCanvasNodeForNewTarget(node: CanvasNode, nextId = node.id): CanvasNode {
  const source = cloneSerializable(node);
  const {
    running: _running,
    generationStatus: _generationStatus,
    generationError: _generationError,
    generationTask: _generationTask,
    libtvImageGeneration,
    ...durableNode
  } = source;
  const clonedLibtvImageGeneration = libtvImageGeneration
    ? {
        ...libtvImageGeneration,
        running: false,
        status: "",
        error: "",
      }
    : undefined;
  return {
    ...durableNode,
    id: nextId,
    actionFission: cloneActionFissionForNewTarget(source.actionFission),
    libtvImageGeneration: clonedLibtvImageGeneration,
  };
}

export function cloneCanvasNodesForNewCanvas(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.map((node) => cloneCanvasNodeForNewTarget(node));
}
