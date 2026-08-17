import { create } from "zustand";

export type CanvasSaveStatus = "saved" | "unsaved" | "saving";

interface CanvasSaveStatusState {
  statusByCanvasId: Record<string, CanvasSaveStatus>;
  setStatus: (canvasId: string, status: CanvasSaveStatus) => void;
}

const useCanvasSaveStatusStore = create<CanvasSaveStatusState>((set) => ({
  statusByCanvasId: {},
  setStatus: (canvasId, status) => set((state) => (
    state.statusByCanvasId[canvasId] === status
      ? state
      : { statusByCanvasId: { ...state.statusByCanvasId, [canvasId]: status } }
  )),
}));

export function setCanvasSaveStatus(canvasId: string, status: CanvasSaveStatus) {
  if (canvasId) useCanvasSaveStatusStore.getState().setStatus(canvasId, status);
}

export function useCanvasSaveStatus(canvasId: string) {
  return useCanvasSaveStatusStore((state) => state.statusByCanvasId[canvasId] || "saved");
}
