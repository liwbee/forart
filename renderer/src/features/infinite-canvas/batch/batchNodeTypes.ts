/** Shared contracts for canvas nodes that execute independent items in a batch. */
export type BatchItemStatus = "pending" | "queued" | "running" | "completed" | "failed";

/** Stable prompt-reference id for the per-item source image in batch generation. */
export const BATCH_TASK_REFERENCE_EDGE_ID = "batch-task-reference";

/** Maximum item count a batch-style node accepts (batch image generation and action fission). */
export const MAX_BATCH_NODE_ITEMS = 50;

export interface BatchItemResult {
  url?: string;
  thumbUrl?: string;
  fileName?: string;
  width?: number;
  height?: number;
}

export interface BatchNodeItemBase {
  id: string;
  latestGenerationTaskId?: string;
  status?: BatchItemStatus;
  error?: string;
  result?: BatchItemResult;
}

export interface BatchNodeStateBase<TItem extends BatchNodeItemBase = BatchNodeItemBase> {
  items: TItem[];
  layout?: "list" | "grid";
}

export function batchItemTaskId(item: BatchNodeItemBase | undefined) {
  return String(item?.latestGenerationTaskId || "");
}

export function isBatchItemActive(item: BatchNodeItemBase | undefined) {
  return item?.status === "queued" || item?.status === "running";
}
