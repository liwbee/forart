import type { ActionEntry } from "../../action-library/types";
import { actionPatchFromCategoryGroup } from "./actionFissionState";
import type { ActionFissionCategoryGroup, ActionFissionRow } from "./actionFissionTypes";

export interface ActionFissionRunReadiness {
  canRun: boolean;
  missingReference: boolean;
  unconfiguredRowIds: string[];
}

interface RandomizeRowsOptions {
  random?: () => number;
  rowIds?: ReadonlySet<string>;
}

export function getActionFissionRunReadiness(
  rows: readonly ActionFissionRow[],
  referenceCount: number,
): ActionFissionRunReadiness {
  const unconfiguredRowIds = rows
    .filter((row) => !row.selectedActionId)
    .map((row) => row.id);
  const missingReference = referenceCount < 1;

  return {
    canRun: !missingReference && unconfiguredRowIds.length === 0,
    missingReference,
    unconfiguredRowIds,
  };
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
