import { create } from "zustand";

interface NativeCanvasInteractionState {
  editingNodeId: string | null;
  selectionGestureActive: boolean;
  soleSelectedNodeId: string | null;
  toolbarNodeId: string | null;
  beginNodeEditing: (nodeId: string) => void;
  beginSelectionGesture: () => void;
  endSelectionGesture: () => void;
  endNodeEditing: (nodeId?: string) => void;
  syncSelection: (selectedNodeIds: string[]) => void;
  resetInteractions: () => void;
}

const EMPTY_INTERACTIONS = {
  editingNodeId: null,
  selectionGestureActive: false,
  soleSelectedNodeId: null,
  toolbarNodeId: null,
} as const;

export const useNativeCanvasInteractionStore = create<NativeCanvasInteractionState>((set) => ({
  ...EMPTY_INTERACTIONS,
  beginNodeEditing: (nodeId) => set({
    editingNodeId: nodeId,
  }),
  beginSelectionGesture: () => set({
    editingNodeId: null,
    selectionGestureActive: true,
    toolbarNodeId: null,
  }),
  endSelectionGesture: () => set((state) => ({
    selectionGestureActive: false,
    toolbarNodeId: state.soleSelectedNodeId,
  })),
  endNodeEditing: (nodeId) => set((state) => (
    nodeId && state.editingNodeId !== nodeId ? state : { editingNodeId: null }
  )),
  syncSelection: (selectedNodeIds) => set((state) => {
    const soleSelectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
    const editingNodeId = state.editingNodeId === soleSelectedNodeId ? state.editingNodeId : null;
    const toolbarNodeId = state.selectionGestureActive ? null : soleSelectedNodeId;
    if (
      editingNodeId === state.editingNodeId
      && soleSelectedNodeId === state.soleSelectedNodeId
      && toolbarNodeId === state.toolbarNodeId
    ) {
      return state;
    }

    return { editingNodeId, soleSelectedNodeId, toolbarNodeId };
  }),
  resetInteractions: () => set(EMPTY_INTERACTIONS),
}));
