import type { ActionEntry } from "../../action-library/types";
import {
  DEFAULT_ACTION_FISSION_ROWS,
  MAX_ACTION_FISSION_CATEGORY_GROUPS,
  MAX_ACTION_FISSION_ROWS,
  type ActionFissionCategoryGroup,
  type ActionFissionRow,
  type ActionFissionState,
  actionFissionRowTaskId,
} from "./actionFissionTypes";

function createRowId() {
  return `action_row_${crypto.randomUUID()}`;
}

function createGroupId() {
  return `action_group_${crypto.randomUUID()}`;
}

export function createActionFissionCategoryGroup(actionProjectId = ""): ActionFissionCategoryGroup {
  return {
    id: createGroupId(),
    actionProjectId,
    includeActionTagIds: [],
    excludeActionTagIds: [],
  };
}

export function createActionFissionRow(actionProjectId = ""): ActionFissionRow {
  const group = createActionFissionCategoryGroup(actionProjectId);
  return {
    id: createRowId(),
    categoryGroups: [group],
    selectedCategoryGroupId: group.id,
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
    rows: state?.rows?.length
      ? state.rows.slice(0, MAX_ACTION_FISSION_ROWS).map(normalizeActionFissionRow)
      : fallback.rows,
    layout: state?.layout === "list" ? "list" : "grid",
    aspectRatio: state?.aspectRatio || "3:4",
  };
}

function normalizedIds(ids: unknown) {
  return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && Boolean(id)))] : [];
}

function normalizeActionFissionGroup(group: ActionFissionCategoryGroup, fallbackId: string): ActionFissionCategoryGroup {
  return {
    id: String(group?.id || fallbackId),
    name: group?.name ? String(group.name).trim() || undefined : undefined,
    actionProjectId: String(group?.actionProjectId || ""),
    includeActionTagIds: normalizedIds(group?.includeActionTagIds),
    excludeActionTagIds: normalizedIds(group?.excludeActionTagIds),
  };
}

function categoryGroupSelectionSignature(group: ActionFissionCategoryGroup | undefined) {
  if (!group) return "";
  return JSON.stringify({
    actionProjectId: group.actionProjectId,
    includeActionTagIds: group.includeActionTagIds,
    excludeActionTagIds: group.excludeActionTagIds,
  });
}

export function normalizeActionFissionRow(row: ActionFissionRow): ActionFissionRow {
  const groups = row.categoryGroups.length
    ? row.categoryGroups
        .slice(0, MAX_ACTION_FISSION_CATEGORY_GROUPS)
        .map((group, index) => normalizeActionFissionGroup(group, `${row.id}_group_${index + 1}`))
    : [normalizeActionFissionGroup(createActionFissionCategoryGroup(), `${row.id}_group_1`)];
  const selectedGroup = groups.find((group) => group.id === row.selectedCategoryGroupId) || groups[0];
  return {
    ...row,
    latestGenerationTaskId: actionFissionRowTaskId(row) || undefined,
    categoryGroups: groups,
    selectedCategoryGroupId: selectedGroup.id,
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
  } satisfies Partial<ActionFissionRow>;
}

export function actionPatchFromCategoryGroup(group: ActionFissionCategoryGroup, action: ActionEntry) {
  return {
    selectedCategoryGroupId: group.id,
    ...actionPatchFromEntry(action),
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
  };
}

export function configureActionFissionRow(
  state: ActionFissionState,
  rowId: string,
  categoryGroups: ActionFissionCategoryGroup[],
  selection?: { groupId: string; action: ActionEntry | null },
) {
  return {
    ...state,
    rows: state.rows.map((row) => {
      if (row.id !== rowId) return row;
      const normalizedRow = normalizeActionFissionRow(row);
      const nextGroups = categoryGroups
        .slice(0, MAX_ACTION_FISSION_CATEGORY_GROUPS)
        .map((group, index) => normalizeActionFissionGroup(group, `${row.id}_group_${index + 1}`));
      if (!nextGroups.length) nextGroups.push(createActionFissionCategoryGroup());

      if (selection) {
        const selectedGroup = nextGroups.find((group) => group.id === selection.groupId) || nextGroups[0];
        const nextRow = clearRowAction({
          ...normalizedRow,
          categoryGroups: nextGroups,
          selectedCategoryGroupId: selectedGroup.id,
        });
        return selection.action ? { ...nextRow, ...actionPatchFromCategoryGroup(selectedGroup, selection.action) } : nextRow;
      }

      const previousGroup = normalizedRow.categoryGroups?.find((group) => group.id === normalizedRow.selectedCategoryGroupId);
      const selectedGroup = nextGroups.find((group) => group.id === normalizedRow.selectedCategoryGroupId) || nextGroups[0];
      const selectedGroupChanged = categoryGroupSelectionSignature(previousGroup)
        !== categoryGroupSelectionSignature(selectedGroup);
      const nextRow = {
        ...normalizedRow,
        categoryGroups: nextGroups,
        selectedCategoryGroupId: selectedGroup.id,
      };
      return selectedGroupChanged ? clearRowAction(nextRow) : nextRow;
    }),
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
