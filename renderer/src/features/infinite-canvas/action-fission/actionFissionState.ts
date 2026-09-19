import type { ActionEntry } from "../../action-library/types";
import {
  ACTION_FISSION_AGENT_REASONING_LEVELS,
  DEFAULT_ACTION_FISSION_ROWS,
  DEFAULT_ACTION_FISSION_AGENT_REASONING,
  MAX_ACTION_FISSION_CATEGORY_GROUPS,
  MAX_ACTION_FISSION_ROWS,
  type ActionFissionAgentReasoning,
  type ActionFissionCategoryGroup,
  type ActionFissionMode,
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
    mode: "library",
    apiType: "third-party-api",
    resolution: "1K",
    aspectRatio: "3:4",
  };
}

/** 统一读取模式，缺省回退到动作库模式。 */
export function actionFissionMode(state: ActionFissionState | undefined): ActionFissionMode {
  return state?.mode === "agent" ? "agent" : "library";
}

export function normalizeActionFissionAgentReasoning(value: unknown): ActionFissionAgentReasoning {
  return ACTION_FISSION_AGENT_REASONING_LEVELS.includes(value as ActionFissionAgentReasoning)
    ? value as ActionFissionAgentReasoning
    : DEFAULT_ACTION_FISSION_AGENT_REASONING;
}

export function normalizeActionFissionState(state: ActionFissionState | undefined): ActionFissionState {
  const fallback = createDefaultActionFissionState();
  // Drop removed features when loading older canvases so they are not carried
  // forward by the generic state spread: the per-node Agent optimization flag
  // and the list/grid layout toggle (the grid layout is the only one left).
  const storedState = { ...(state || {}) } as ActionFissionState & { promptOptimizationEnabled?: unknown; layout?: unknown };
  delete storedState.promptOptimizationEnabled;
  delete storedState.layout;
  const agentProviderId = String(storedState.agentProviderId || "").trim();
  const agentModel = String(storedState.agentModel || "").trim();
  return {
    ...fallback,
    ...storedState,
    mode: actionFissionMode(storedState),
    agentProviderId: agentProviderId || undefined,
    agentModel: agentModel || undefined,
    agentReasoning: normalizeActionFissionAgentReasoning(storedState.agentReasoning),
    rows: state?.rows?.length
      ? state.rows.slice(0, MAX_ACTION_FISSION_ROWS).map(normalizeActionFissionRow)
      : fallback.rows,
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

function actionLibraryThumbnailUrl(assetUrl: string) {
  return assetUrl.replace(
    /(\/api\/assets\/[^/?#]+)\/file(?=([?#]|$))/,
    "$1/thumb",
  );
}

export function normalizeActionFissionRow(row: ActionFissionRow): ActionFissionRow {
  const storedRow = row as ActionFissionRow & {
    actionProjectId?: unknown;
    includeActionTagIds?: unknown;
    excludeActionTagIds?: unknown;
  };
  const sourceGroups = Array.isArray(row.categoryGroups) && row.categoryGroups.length
    ? row.categoryGroups
    : [{
        id: `${row.id}_group_1`,
        actionProjectId: String(storedRow.actionProjectId || ""),
        includeActionTagIds: normalizedIds(storedRow.includeActionTagIds),
        excludeActionTagIds: normalizedIds(storedRow.excludeActionTagIds),
      }];
  const groups = sourceGroups.length
    ? sourceGroups
        .slice(0, MAX_ACTION_FISSION_CATEGORY_GROUPS)
        .map((group, index) => normalizeActionFissionGroup(group, `${row.id}_group_${index + 1}`))
    : [normalizeActionFissionGroup(createActionFissionCategoryGroup(), `${row.id}_group_1`)];
  const selectedGroup = groups.find((group) => group.id === row.selectedCategoryGroupId) || groups[0];
  const selectedActionAssetUrl = String(row.selectedActionAssetUrl || "");
  const selectedActionThumbUrl = String(row.selectedActionThumbUrl || "")
    || actionLibraryThumbnailUrl(selectedActionAssetUrl);
  const agentWarnings = Array.isArray(row.agentWarnings)
    ? row.agentWarnings.map((warning) => String(warning || "").trim()).filter(Boolean)
    : [];
  const normalized = {
    ...row,
    latestGenerationTaskId: actionFissionRowTaskId(row) || undefined,
    categoryGroups: groups,
    selectedCategoryGroupId: selectedGroup.id,
    selectedActionThumbUrl: selectedActionThumbUrl && selectedActionThumbUrl !== selectedActionAssetUrl
      ? selectedActionThumbUrl
      : undefined,
    agentPrompt: String(row.agentPrompt || "").trim() || undefined,
    agentPromptLabel: String(row.agentPromptLabel || "").trim() || undefined,
    agentWarnings: agentWarnings.length ? agentWarnings : undefined,
  } as ActionFissionRow & Record<string, unknown>;
  delete normalized.actionProjectId;
  delete normalized.includeActionTagIds;
  delete normalized.excludeActionTagIds;
  return normalized;
}

export function actionPatchFromEntry(action: ActionEntry) {
  return {
    selectedActionId: action.id,
    selectedActionName: action.name,
    selectedActionPrompt: action.prompt,
    selectedActionTags: action.tags,
    selectedActionAssetUrl: action.asset_url,
    selectedActionThumbUrl: action.thumbnail_url || undefined,
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

/**
 * 清空某一行的两种模式专属配置，保留生成结果与生图参数。
 * 切换模式时使用，避免旧配置被带到另一种模式里。
 */
export function clearActionFissionRowModeData(row: ActionFissionRow): ActionFissionRow {
  const group = createActionFissionCategoryGroup();
  return {
    ...clearRowAction(row),
    categoryGroups: [group],
    selectedCategoryGroupId: group.id,
    agentPrompt: undefined,
    agentPromptLabel: undefined,
    agentWarnings: undefined,
  };
}

/** 当前画布上是否存在任一模式的专属配置，用于判断切换模式是否需要弹确认框。 */
export function actionFissionModeHasData(state: ActionFissionState): boolean {
  return normalizeActionFissionState(state).rows.some((row) => (
    Boolean(String(row.selectedActionId || "").trim())
    || Boolean(String(row.agentPrompt || "").trim())
  ));
}

/**
 * 切换模式：清空两种模式的专属配置（动作选择 + Agent 提示词），
 * 保留生成结果、任务 id、行数、比例、分辨率、平台与模型选择。
 */
export function switchActionFissionMode(state: ActionFissionState, mode: ActionFissionMode): ActionFissionState {
  const normalized = normalizeActionFissionState(state);
  if (actionFissionMode(normalized) === mode) return normalized;
  return {
    ...normalized,
    mode,
    rows: normalized.rows.map(clearActionFissionRowModeData),
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
