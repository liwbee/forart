import { create } from "zustand";
import { temporal } from "zundo";
import type { FreeCanvasDocument, FreeCanvasEditorItem } from "../types";
import { normalizeLayerOrder, sortedBackToFront } from "./geometry";

type StateUpdater<T> = T | ((current: T) => T);

interface FreeCanvasStore extends FreeCanvasDocument {
  itemIds: string[];
  itemLookup: Map<string, FreeCanvasEditorItem>;
  setItems: (updater: StateUpdater<FreeCanvasEditorItem[]>) => void;
  setItemsWithoutHistory: (updater: StateUpdater<FreeCanvasEditorItem[]>) => void;
  addItem: (item: FreeCanvasEditorItem) => void;
  patchItem: (itemId: string, patch: Partial<FreeCanvasEditorItem>) => void;
  patchItemWithoutHistory: (itemId: string, patch: Partial<FreeCanvasEditorItem>) => void;
  deleteItems: (itemIds: string[]) => void;
  clearItems: () => void;
  moveLayer: (itemId: string, direction: "up" | "down") => void;
  moveLayerToEdge: (itemId: string, edge: "front" | "back") => void;
  reorderLayer: (draggedItemId: string, targetItemId: string, position: "before" | "after") => void;
}

function resolveUpdater<T>(updater: StateUpdater<T>, current: T) {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

function createIndexes(items: FreeCanvasEditorItem[]) {
  return {
    itemIds: items.map((item) => item.id),
    itemLookup: new Map(items.map((item) => [item.id, item])),
  };
}

function withIndexes(items: FreeCanvasEditorItem[]) {
  return {
    items,
    ...createIndexes(items),
  };
}

function idsEqual(items: FreeCanvasEditorItem[], ids: string[]) {
  return items.length === ids.length && items.every((item, index) => item.id === ids[index]);
}

function isDocumentEqual(a: FreeCanvasDocument, b: FreeCanvasDocument) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function setItemsState(
  currentItems: FreeCanvasEditorItem[],
  currentIds: string[],
  updater: StateUpdater<FreeCanvasEditorItem[]>,
) {
  const items = resolveUpdater(updater, currentItems);
  return {
    items,
    itemIds: idsEqual(items, currentIds) ? currentIds : items.map((item) => item.id),
    itemLookup: new Map(items.map((item) => [item.id, item])),
  };
}

export const useFreeCanvasStore = create<FreeCanvasStore>()(
  temporal(
    (set) => ({
      ...withIndexes([]),
      setItems: (updater) => {
        set((state) => setItemsState(state.items, state.itemIds, updater));
      },
      setItemsWithoutHistory: (updater) => {
        const temporalState = useFreeCanvasStore.temporal.getState();
        temporalState.pause();
        set((state) => setItemsState(state.items, state.itemIds, updater));
        temporalState.resume();
      },
      addItem: (item) => {
        set((state) => {
          const items = normalizeLayerOrder([...sortedBackToFront(state.items), item]);
          return withIndexes(items);
        });
      },
      patchItem: (itemId, patch) => {
        set((state) => withIndexes(state.items.map((item) => (item.id === itemId ? ({ ...item, ...patch } as FreeCanvasEditorItem) : item))));
      },
      patchItemWithoutHistory: (itemId, patch) => {
        const temporalState = useFreeCanvasStore.temporal.getState();
        temporalState.pause();
        set((state) => withIndexes(state.items.map((item) => (item.id === itemId ? ({ ...item, ...patch } as FreeCanvasEditorItem) : item))));
        temporalState.resume();
      },
      deleteItems: (itemIds) => {
        const itemIdSet = new Set(itemIds);
        set((state) => withIndexes(normalizeLayerOrder(sortedBackToFront(state.items).filter((item) => !itemIdSet.has(item.id)))));
      },
      clearItems: () => set(withIndexes([])),
      moveLayer: (itemId, direction) => {
        set((state) => {
          const orderedItems = sortedBackToFront(state.items);
          const selectedIndex = orderedItems.findIndex((item) => item.id === itemId);
          if (selectedIndex < 0) return state;
          const targetIndex = selectedIndex + (direction === "up" ? 1 : -1);
          if (targetIndex < 0 || targetIndex >= orderedItems.length) return state;
          const nextItems = [...orderedItems];
          [nextItems[selectedIndex], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[selectedIndex]];
          return withIndexes(normalizeLayerOrder(nextItems));
        });
      },
      moveLayerToEdge: (itemId, edge) => {
        set((state) => {
          const orderedItems = sortedBackToFront(state.items);
          const selectedIndex = orderedItems.findIndex((item) => item.id === itemId);
          if (selectedIndex < 0) return state;
          const [item] = orderedItems.splice(selectedIndex, 1);
          if (edge === "front") orderedItems.push(item);
          else orderedItems.unshift(item);
          return withIndexes(normalizeLayerOrder(orderedItems));
        });
      },
      reorderLayer: (draggedItemId, targetItemId, position) => {
        set((state) => {
          if (draggedItemId === targetItemId) return state;
          const topToBottomItems = [...state.items].sort((left, right) => right.zIndex - left.zIndex);
          const draggedItem = topToBottomItems.find((item) => item.id === draggedItemId);
          if (!draggedItem) return state;
          const remainingItems = topToBottomItems.filter((item) => item.id !== draggedItemId);
          const targetIndex = remainingItems.findIndex((item) => item.id === targetItemId);
          if (targetIndex < 0) return state;
          const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
          remainingItems.splice(insertIndex, 0, draggedItem);
          return withIndexes(normalizeLayerOrder([...remainingItems].reverse()));
        });
      },
    }),
    {
      partialize: (state) => ({ items: state.items }),
      equality: isDocumentEqual,
      limit: 100,
    },
  ),
);

export function snapshotFreeCanvasDocument(): FreeCanvasDocument {
  return { items: useFreeCanvasStore.getState().items };
}

export function commitFreeCanvasDocumentChange(previous: FreeCanvasDocument) {
  const current = snapshotFreeCanvasDocument();
  if (isDocumentEqual(previous, current)) return;
  useFreeCanvasStore.temporal.setState((state) => ({
    pastStates: [...state.pastStates, previous].slice(-100),
    futureStates: [],
  }));
}

export function undoFreeCanvasHistory() {
  useFreeCanvasStore.temporal.getState().undo();
}

export function redoFreeCanvasHistory() {
  useFreeCanvasStore.temporal.getState().redo();
}
