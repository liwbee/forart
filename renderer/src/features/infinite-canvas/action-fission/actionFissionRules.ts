import type { ActionEntry } from "../../action-library/types";
import { actionPatchFromCategoryGroup } from "./actionFissionState";
import type { ActionFissionCategoryGroup, ActionFissionMode, ActionFissionRow } from "./actionFissionTypes";

export interface ActionFissionRunReadiness {
  canRun: boolean;
  missingReference: boolean;
  unconfiguredRowIds: string[];
}

/**
 * 同一个动作裂变节点上的两种长任务：生图与生成提示词。
 * 它们是互斥的，任何一方在跑都不允许启动另一方。
 */
export interface ActionFissionBusyState {
  /** 生图：launching / queued / running。 */
  imageGenerationActive: boolean;
  /** 生成提示词：Agent 运行中。 */
  promptGenerationActive: boolean;
}

export type ActionFissionPromptGenerationBlocker =
  | "library-mode"
  | "image-generation-active"
  | "prompt-generation-active"
  | "missing-reference";

/** 切换模式在任一任务运行期间都不允许。 */
export function actionFissionModeSwitchBlocked(busy: ActionFissionBusyState) {
  return busy.imageGenerationActive || busy.promptGenerationActive;
}

/** 生成提示词期间禁止启动生图。 */
export function actionFissionImageGenerationBlocked(busy: ActionFissionBusyState) {
  return busy.promptGenerationActive;
}

/**
 * 生成提示词的前置条件与互斥检查，返回阻止原因，空字符串表示可以生成。
 * 平台/模型是否已选择由参数面板判断（只有那里拿得到 Provider 列表）。
 */
export function actionFissionPromptGenerationBlocker({
  mode,
  referenceCount,
  busy,
}: {
  mode: ActionFissionMode;
  referenceCount: number;
  busy: ActionFissionBusyState;
}): ActionFissionPromptGenerationBlocker | "" {
  if (mode !== "agent") return "library-mode";
  if (busy.imageGenerationActive) return "image-generation-active";
  if (busy.promptGenerationActive) return "prompt-generation-active";
  if (referenceCount < 1) return "missing-reference";
  return "";
}

interface RandomizeRowsOptions {
  random?: () => number;
  rowIds?: ReadonlySet<string>;
}

export function getActionFissionRunReadiness(
  rows: readonly ActionFissionRow[],
  referenceCount: number,
  mode: ActionFissionMode = "library",
): ActionFissionRunReadiness {
  const unconfiguredRowIds = rows
    .filter((row) => !actionFissionRowReady(row, mode))
    .map((row) => row.id);
  const missingReference = referenceCount < 1;

  return {
    canRun: !missingReference && unconfiguredRowIds.length === 0,
    missingReference,
    unconfiguredRowIds,
  };
}

/** 该行在当前模式下是否已经具备生图所需的提示词配置。 */
export function actionFissionRowReady(row: ActionFissionRow, mode: ActionFissionMode = "library") {
  return mode === "agent"
    ? Boolean(String(row.agentPrompt || "").trim())
    : Boolean(row.selectedActionId);
}

/** 行标题：Agent 模式用差异摘要，动作库模式用动作名，最后回退到行 id。 */
export function actionFissionRowLabel(row: ActionFissionRow, mode: ActionFissionMode = "library") {
  if (mode === "agent") {
    return String(row.agentPromptLabel || "").trim() || row.id;
  }
  return String(row.selectedActionName || "").trim() || row.id;
}

export interface ActionFissionCategoryCandidates {
  group: ActionFissionCategoryGroup;
  actions: readonly ActionEntry[];
}

export function actionFissionReferenceImages(
  row: ActionFissionRow,
  primaryReferences: readonly string[],
  additionalReferences: readonly string[],
) {
  const references = row.useAdditionalReferences
    ? [...primaryReferences, ...additionalReferences]
    : primaryReferences;
  return [...new Set(references.map((reference) => reference.trim()).filter(Boolean))];
}

export function actionFissionPrompt(
  row: ActionFissionRow,
  primaryPrompt: string,
  additionalPrompts: readonly string[],
  mode: ActionFissionMode = "library",
) {
  const prompts = [
    mode === "agent" ? String(row.agentPrompt || "") : String(row.selectedActionPrompt || ""),
    primaryPrompt,
    ...(row.useAdditionalReferences ? additionalPrompts : []),
  ];
  return prompts.map((prompt) => prompt.trim()).filter(Boolean).join("\n\n");
}

export function pickRandomAction(
  candidates: readonly ActionEntry[],
  previousActionId: string | undefined,
  reservedActionIds: ReadonlySet<string>,
  random: () => number = Math.random,
) {
  if (!candidates.length) return null;

  const uniqueAlternatives = candidates.filter((action) => (
    action.id !== previousActionId && !reservedActionIds.has(action.id)
  ));
  const alternatives = candidates.filter((action) => action.id !== previousActionId);
  const uniqueCandidates = candidates.filter((action) => !reservedActionIds.has(action.id));
  const preferred = uniqueAlternatives.length
    ? uniqueAlternatives
    : alternatives.length
      ? alternatives
      : uniqueCandidates.length
        ? uniqueCandidates
        : candidates;
  return preferred[Math.floor(random() * preferred.length)] || null;
}

export function randomizeActionFissionRows(
  rows: readonly ActionFissionRow[],
  candidatesByRowId: ReadonlyMap<string, readonly ActionFissionCategoryCandidates[]>,
  options: RandomizeRowsOptions = {},
) {
  return pickActionFissionRows(rows, candidatesByRowId, options);
}

/**
 * Resolve rows that are waiting for an automatic action assignment.
 *
 * Returns `null` when the library cannot fill any of the requested rows, so callers
 * that react to this by writing node data can leave the canvas untouched instead of
 * republishing nodes on every render (which lets React run away until it aborts with
 * "Maximum update depth exceeded").
 */
export function assignPendingActionFissionRows(
  rows: readonly ActionFissionRow[],
  candidatesByRowId: ReadonlyMap<string, readonly ActionFissionCategoryCandidates[]>,
  rowIds: ReadonlySet<string>,
): ActionFissionRow[] | null {
  const next = pickActionFissionRows(rows, candidatesByRowId, { rowIds });
  return next.some((row, index) => row !== rows[index]) ? next : null;
}

function pickActionFissionRows(
  rows: readonly ActionFissionRow[],
  candidatesByRowId: ReadonlyMap<string, readonly ActionFissionCategoryCandidates[]>,
  options: RandomizeRowsOptions = {},
) {
  const random = options.random || Math.random;
  const candidateCount = (rowId: string) => new Set(
    (candidatesByRowId.get(rowId) || []).flatMap(({ actions }) => actions).map((action) => action.id),
  ).size;
  const targetRows = rows
    .filter((row) => (options.rowIds?.has(row.id) ?? true) && candidateCount(row.id) > 0)
    .sort((left, right) => (
      candidateCount(left.id) - candidateCount(right.id)
    ));
  const targetIds = new Set(targetRows.map((row) => row.id));
  const reservedActionIds = new Set(
    rows
      .filter((row) => !targetIds.has(row.id) && row.selectedActionId)
      .map((row) => row.selectedActionId as string),
  );
  const selectedByRowId = new Map<string, { group: ActionFissionCategoryGroup; action: ActionEntry }>();

  for (const row of targetRows) {
    const eligibleGroups = (candidatesByRowId.get(row.id) || []).map(({ group, actions }) => ({
      group,
      actions: [...actions],
    })).filter(({ actions }) => actions.length > 0);
    if (!eligibleGroups.length) continue;
    const uniqueAlternativeGroups = eligibleGroups.filter(({ actions }) => actions.some((action) => (
      action.id !== row.selectedActionId && !reservedActionIds.has(action.id)
    )));
    const alternativeGroups = eligibleGroups.filter(({ group }) => group.id !== row.selectedCategoryGroupId);
    const uniqueGroups = eligibleGroups.filter(({ actions }) => actions.some((action) => !reservedActionIds.has(action.id)));
    const preferredGroups = uniqueAlternativeGroups.length
      ? uniqueAlternativeGroups
      : alternativeGroups.length
        ? alternativeGroups
        : uniqueGroups.length
          ? uniqueGroups
          : eligibleGroups;
    const selectedGroup = preferredGroups[Math.floor(random() * preferredGroups.length)] || preferredGroups[0];
    const selectedAction = pickRandomAction(
      selectedGroup.actions,
      row.selectedActionId,
      reservedActionIds,
      random,
    );
    if (!selectedAction) continue;
    selectedByRowId.set(row.id, { group: selectedGroup.group, action: selectedAction });
    reservedActionIds.add(selectedAction.id);
  }

  return rows.map((row) => {
    const selected = selectedByRowId.get(row.id);
    return selected ? { ...row, ...actionPatchFromCategoryGroup(selected.group, selected.action) } : row;
  });
}
