import type { ActionEntry, ActionTag } from "../../action-library/types";
import type { ActionFissionRow } from "./actionFissionTypes";

export type ActionFissionSelectionReason = "selected" | "noCandidates" | "noCandidatesAfterRules";

export interface SelectActionForRowOptions {
  row: ActionFissionRow;
  rows: ActionFissionRow[];
  actions: ActionEntry[];
  tags: ActionTag[];
  excludedActionIds?: Iterable<string>;
}

export interface SelectActionForRowResult {
  action: ActionEntry | null;
  reason: ActionFissionSelectionReason;
  candidates: ActionEntry[];
  eligibleCandidates: ActionEntry[];
}

export function selectedTagNames(row: ActionFissionRow, tags: ActionTag[]) {
  const byId = new Map(tags.map((tag) => [tag.id, tag.name]));
  return row.actionTagIds
    .map((tagId) => byId.get(tagId) || "")
    .filter(Boolean);
}

export function filterActionsForRow(row: ActionFissionRow, actions: ActionEntry[], tags: ActionTag[]) {
  const names = selectedTagNames(row, tags);
  if (!row.actionProjectId) return [];
  const projectActions = actions.filter((action) => action.project_id === row.actionProjectId);
  if (!names.length) return projectActions;
  return projectActions.filter((action) => names.every((tagName) => action.tags.includes(tagName)));
}

export function pickRandomAction(actions: ActionEntry[]) {
  if (!actions.length) return null;
  return actions[Math.floor(Math.random() * actions.length)];
}

export function selectActionForRow({
  row,
  rows,
  actions,
  tags,
  excludedActionIds,
}: SelectActionForRowOptions): SelectActionForRowResult {
  const candidates = filterActionsForRow(row, actions, tags);
  if (!candidates.length) {
    return { action: null, reason: "noCandidates", candidates, eligibleCandidates: [] };
  }

  const blockedActionIds = new Set<string>();
  if (row.selectedActionId) blockedActionIds.add(row.selectedActionId);
  rows.forEach((item) => {
    if (item.id !== row.id && item.selectedActionId) blockedActionIds.add(item.selectedActionId);
  });
  Array.from(excludedActionIds || []).forEach((id) => {
    if (id) blockedActionIds.add(id);
  });

  const eligibleCandidates = candidates.filter((action) => !blockedActionIds.has(action.id));
  if (!eligibleCandidates.length) {
    return { action: null, reason: "noCandidatesAfterRules", candidates, eligibleCandidates };
  }

  return {
    action: pickRandomAction(eligibleCandidates),
    reason: "selected",
    candidates,
    eligibleCandidates,
  };
}

export function actionPatchFromEntry(action: ActionEntry) {
  return {
    selectedActionId: action.id,
    selectedActionName: action.name,
    selectedActionPrompt: action.prompt,
    selectedActionTags: action.tags,
    selectedActionAssetUrl: action.asset_url,
    error: "",
  };
}
