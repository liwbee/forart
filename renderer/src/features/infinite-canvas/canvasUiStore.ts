import { create } from "zustand";

type StateUpdater<T> = T | ((current: T) => T);

interface CanvasUiStore {
  selectedIds: Set<string>;
  selectedGroupId: string;
  selectedConnectionId: string;
  hoveredId: string;
  editingPromptId: string;
  setSelectedIds: (updater: StateUpdater<Set<string>>) => void;
  setSelectedGroupId: (updater: StateUpdater<string>) => void;
  setSelectedConnectionId: (updater: StateUpdater<string>) => void;
  setHoveredId: (updater: StateUpdater<string>) => void;
  setEditingPromptId: (updater: StateUpdater<string>) => void;
}

function resolveUpdater<T>(updater: StateUpdater<T>, current: T) {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

function areSetsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export const useCanvasUiStore = create<CanvasUiStore>()((set) => ({
  selectedIds: new Set(),
  selectedGroupId: "",
  selectedConnectionId: "",
  hoveredId: "",
  editingPromptId: "",
  setSelectedIds: (updater) => {
    set((state) => {
      const next = resolveUpdater(updater, state.selectedIds);
      return areSetsEqual(next, state.selectedIds) ? state : { selectedIds: next };
    });
  },
  setSelectedGroupId: (updater) => {
    set((state) => {
      const next = resolveUpdater(updater, state.selectedGroupId);
      return state.selectedGroupId === next ? state : { selectedGroupId: next };
    });
  },
  setSelectedConnectionId: (updater) => {
    set((state) => {
      const next = resolveUpdater(updater, state.selectedConnectionId);
      return state.selectedConnectionId === next ? state : { selectedConnectionId: next };
    });
  },
  setHoveredId: (updater) => {
    set((state) => {
      const next = resolveUpdater(updater, state.hoveredId);
      return state.hoveredId === next ? state : { hoveredId: next };
    });
  },
  setEditingPromptId: (updater) => {
    set((state) => {
      const next = resolveUpdater(updater, state.editingPromptId);
      return state.editingPromptId === next ? state : { editingPromptId: next };
    });
  },
}));
