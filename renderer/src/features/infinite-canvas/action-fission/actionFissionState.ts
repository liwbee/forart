import type { CanvasNode } from "../types";
import type { ActionFissionAspectRatio, ActionFissionResolution, ActionFissionRow, ActionFissionState } from "./actionFissionTypes";
import { MAX_ACTION_FISSION_ROWS } from "./actionFissionTypes";

const createId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;

export function createActionFissionRow(): ActionFissionRow {
  return {
    id: createId("action_row"),
    actionProjectId: "",
    actionTagIds: [],
  };
}

export function createDefaultActionFissionState(): ActionFissionState {
  return {
    rows: [createActionFissionRow()],
    apiType: "third-party-api",
    resolution: "1k",
    aspectRatio: "1:1",
  };
}

export function normalizeActionFissionState(state: ActionFissionState | undefined): ActionFissionState {
  const rows = state?.rows?.length ? state.rows : [createActionFissionRow()];
  const resolution = String(state?.resolution || "1k");
  const aspectRatio = String(state?.aspectRatio || "1:1");
  return {
    rows,
    apiType: state?.apiType === "libtv-api" ? "libtv-api" : "third-party-api",
    providerId: state?.providerId || "",
    model: state?.model || "",
    libtvWorkspaceId: state?.libtvWorkspaceId || "",
    libtvWorkspaceName: state?.libtvWorkspaceName || "",
    libtvModelName: state?.libtvModelName || "",
    libtvProjectUuid: state?.libtvProjectUuid || "",
    libtvProjectName: state?.libtvProjectName || "",
    libtvGroupNodeId: state?.libtvGroupNodeId || "",
    libtvGroupTitle: state?.libtvGroupTitle || "",
    resolution: resolution as ActionFissionResolution,
    aspectRatio: aspectRatio as ActionFissionAspectRatio,
    running: Boolean(state?.running),
    status: state?.status || "",
    error: state?.error || "",
  };
}

export function updateActionFissionState(node: CanvasNode, updater: (state: ActionFissionState) => ActionFissionState): ActionFissionState {
  return updater(normalizeActionFissionState(node.actionFission));
}

export function updateActionFissionStateValue(state: ActionFissionState | undefined, updater: (state: ActionFissionState) => ActionFissionState): ActionFissionState {
  return updater(normalizeActionFissionState(state));
}

export function patchActionFissionRow(state: ActionFissionState, rowId: string, patch: Partial<ActionFissionRow>): ActionFissionState {
  return {
    ...state,
    rows: state.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
  };
}

export function clearSelectedAction(row: ActionFissionRow): ActionFissionRow {
  return {
    ...row,
    selectedActionId: undefined,
    selectedActionName: undefined,
    selectedActionPrompt: undefined,
    selectedActionTags: undefined,
    selectedActionAssetUrl: undefined,
  };
}

export function clearActionFissionRow(rowId?: string): ActionFissionRow {
  return {
    ...createActionFissionRow(),
    id: rowId || createId("action_row"),
  };
}

export function changeActionFissionRowProject(state: ActionFissionState, rowId: string, actionProjectId: string): ActionFissionState {
  return {
    ...state,
    rows: state.rows.map((row) => (
      row.id === rowId
        ? clearSelectedAction({ ...row, actionProjectId, actionTagIds: [], error: "" })
        : row
    )),
  };
}

export function changeActionFissionRowTags(state: ActionFissionState, rowId: string, actionTagIds: string[]): ActionFissionState {
  return {
    ...state,
    rows: state.rows.map((row) => (
      row.id === rowId
        ? clearSelectedAction({ ...row, actionTagIds, error: "" })
        : row
    )),
  };
}

export function addActionFissionRow(state: ActionFissionState): ActionFissionState {
  if (state.rows.length >= MAX_ACTION_FISSION_ROWS) return state;
  return {
    ...state,
    rows: [...state.rows, createActionFissionRow()],
  };
}

export function removeActionFissionRow(state: ActionFissionState, rowId: string): ActionFissionState {
  if (state.rows.length <= 1) {
    return {
      ...state,
      rows: [clearActionFissionRow()],
    };
  }
  return {
    ...state,
    rows: state.rows.filter((row) => row.id !== rowId),
  };
}
