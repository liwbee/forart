import type { BatchImageGeneratorItem } from "../nativeCanvas";

function samePatchValue(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  }
  return false;
}

/**
 * Does applying `patch` actually change this item?
 *
 * Batch task watchers re-report the same terminal result whenever they are re-registered,
 * so the flush must recognise an unchanged patch. Writing it anyway republishes the
 * canvas nodes, which re-registers the watchers and bounces until React aborts with
 * "Maximum update depth exceeded".
 */
export function batchItemPatchChanges(
  item: BatchImageGeneratorItem,
  patch: Partial<BatchImageGeneratorItem>,
) {
  const record = item as unknown as Record<string, unknown>;
  return Object.entries(patch).some(([key, value]) => !samePatchValue(record[key], value));
}
