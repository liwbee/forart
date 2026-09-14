import type { BatchNodeItemBase, BatchNodeStateBase, BatchItemStatus } from "./batchNodeTypes";

export function patchBatchItem<TItem extends BatchNodeItemBase>(
  state: BatchNodeStateBase<TItem>,
  itemId: string,
  patch: Partial<TItem>,
): BatchNodeStateBase<TItem> {
  return { ...state, items: state.items.map((item) => item.id === itemId ? { ...item, ...patch } : item) };
}

export function setBatchItemsStatus<TItem extends BatchNodeItemBase>(
  state: BatchNodeStateBase<TItem>,
  itemIds: Iterable<string>,
  status: BatchItemStatus,
): BatchNodeStateBase<TItem> {
  const ids = new Set(itemIds);
  return { ...state, items: state.items.map((item) => ids.has(item.id) ? { ...item, status, error: undefined } : item) };
}
