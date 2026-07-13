import type { ActionEntry } from "../../action-library/types";
import {
  DEFAULT_ACTION_FISSION_ROWS,
  MAX_ACTION_FISSION_ROWS,
  type ActionFissionRow,
  type ActionFissionState,
} from "./actionFissionTypes";

function createId() {
  return `action_row_${crypto.randomUUID()}`;
}

export function createActionFissionRow(actionProjectId = ""): ActionFissionRow {
  return {
    id: createId(),
    actionProjectId,
    includeActionTagIds: [],
    excludeActionTagIds: [],
  };
}

export function createDefaultActionFissionState(): ActionFissionState {
  return {
    rows: Array.from({ length: DEFAULT_ACTION_FISSION_ROWS }, () => createActionFissionRow()),
    layout: "grid",
    apiType: "third-party-api",
    resolution: "1k",
    aspectRatio: "3:4",
  };
}

export function normalizeActionFissionState(state: ActionFissionState | undefined): ActionFissionState {
  const fallback = createDefaultActionFissionState();
  return {
    ...fallback,
    ...state,
    rows: state?.rows?.length ? state.rows.slice(0, MAX_ACTION_FISSION_ROWS) : fallback.rows,
    layout: state?.layout === "list" ? "list" : "grid",
    aspectRatio: state?.aspectRatio || "3:4",
  };
}

export function actionPatchFromEntry(action: ActionEntry) {
  return {
    selectedActionId: action.id,
    selectedActionName: action.name,
    selectedActionPrompt: action.prompt,
    selectedActionTags: action.tags,
    selectedActionAssetUrl: action.asset_url,
    selectedActionThumbUrl: action.thumbnail_url || action.asset_url,
    error: "",
  } satisfies Partial<ActionFissionRow>;
}

function clearRowAction(row: ActionFissionRow) {
  return {
    ...row,
    selectedActionId: undefined,
    selectedActionName: undefined,
    selectedActionPrompt: undefined,
    selectedActionTags: undefined,
    selectedActionAssetUrl: undefined,
    selectedActionThumbUrl: undefined,
    error: "",
  };
}

export function configureActionFissionRow(
  state: ActionFissionState,
  rowId: string,
  actionProjectId: string,
  includeActionTagIds: string[],
  excludeActionTagIds: string[],
  selectedAction: ActionEntry | null,
) {
  return {
    ...state,
    rows: state.rows.map((row) => row.id === rowId
      ? {
          ...clearRowAction({ ...row, actionProjectId, includeActionTagIds, excludeActionTagIds }),
          ...(selectedAction ? actionPatchFromEntry(selectedAction) : {}),
        }
      : row),
  };
}

export function addActionFissionRow(state: ActionFissionState) {
  if (state.rows.length >= MAX_ACTION_FISSION_ROWS) return state;
  return {
    ...state,
    rows: [...state.rows, createActionFissionRow()],
  };
}

export function removeActionFissionRow(state: ActionFissionState, rowId: string) {
  if (state.rows.length <= 1) return state;
  return { ...state, rows: state.rows.filter((row) => row.id !== rowId) };
}
