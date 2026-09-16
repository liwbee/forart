import type { ActionFissionRow } from "./actionFissionTypes";

/** Fields that describe which action a row is currently showing. */
export const ACTION_FISSION_SELECTION_FIELDS = [
  "selectedCategoryGroupId",
  "selectedActionId",
  "selectedActionName",
  "selectedActionPrompt",
  "selectedActionTags",
  "selectedActionAssetUrl",
  "selectedActionThumbUrl",
] as const;

function sameSelectionValue(left: unknown, right: unknown) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }
  return Object.is(left, right);
}

/**
 * Copy the selection fields of `source` onto `row`.
 *
 * Returns the very same row when they already match. Callers write the result into node
 * data, and republishing nodes for an unchanged selection re-renders the whole canvas —
 * the auto-assignment effect would then write again on the next render and never settle
 * ("Maximum update depth exceeded"). Comparing values rather than row identity is what
 * makes an unchanged write a no-op.
 */
export function withActionFissionSelection(row: ActionFissionRow, source: ActionFissionRow) {
  const differs = ACTION_FISSION_SELECTION_FIELDS.some((field) => !sameSelectionValue(row[field], source[field]));
  if (!differs) return row;
  const next = { ...row } as ActionFissionRow & Record<string, unknown>;
  const record = source as ActionFissionRow & Record<string, unknown>;
  ACTION_FISSION_SELECTION_FIELDS.forEach((field) => {
    const value = record[field];
    (next as Record<string, unknown>)[field] = Array.isArray(value) ? [...value] : value;
  });
  return next;
}
