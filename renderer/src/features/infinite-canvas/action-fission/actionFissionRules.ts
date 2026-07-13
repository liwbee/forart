import type { ActionEntry } from "../../action-library/types";
import { actionPatchFromEntry } from "./actionFissionState";
import type { ActionFissionRow } from "./actionFissionTypes";

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
  candidatesByRowId: ReadonlyMap<string, readonly ActionEntry[]>,
  options: RandomizeRowsOptions = {},
) {
  const random = options.random || Math.random;
  const targetRows = rows
    .filter((row) => (options.rowIds?.has(row.id) ?? true) && (candidatesByRowId.get(row.id)?.length || 0) > 0)
    .sort((left, right) => (
      (candidatesByRowId.get(left.id)?.length || 0) - (candidatesByRowId.get(right.id)?.length || 0)
    ));
  const targetIds = new Set(targetRows.map((row) => row.id));
  const reservedActionIds = new Set(
    rows
      .filter((row) => !targetIds.has(row.id) && row.selectedActionId)
      .map((row) => row.selectedActionId as string),
  );
  const selectedByRowId = new Map<string, ActionEntry>();

  for (const row of targetRows) {
    const selected = pickRandomAction(
      candidatesByRowId.get(row.id) || [],
      row.selectedActionId,
      reservedActionIds,
      random,
    );
    if (!selected) continue;
    selectedByRowId.set(row.id, selected);
    reservedActionIds.add(selected.id);
  }

  return rows.map((row) => {
    const selected = selectedByRowId.get(row.id);
    return selected ? { ...row, ...actionPatchFromEntry(selected) } : row;
  });
}
