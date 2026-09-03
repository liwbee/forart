import { create } from "zustand";

interface SmartReverseController {
  run: () => void;
  stop: () => void;
}

interface SmartReverseRuntimeState {
  runningByNode: Record<string, boolean>;
  controllers: Record<string, SmartReverseController | undefined>;
  register: (nodeId: string, controller: SmartReverseController) => void;
  unregister: (nodeId: string) => void;
  setRunning: (nodeId: string, running: boolean) => void;
  run: (nodeId: string) => void;
  stop: (nodeId: string) => void;
}

export const useSmartReverseRuntimeStore = create<SmartReverseRuntimeState>((set, get) => ({
  runningByNode: {},
  controllers: {},
  register: (nodeId, controller) => set((state) => ({ controllers: { ...state.controllers, [nodeId]: controller } })),
  unregister: (nodeId) => set((state) => {
    const controllers = { ...state.controllers };
    delete controllers[nodeId];
    const runningByNode = { ...state.runningByNode };
    delete runningByNode[nodeId];
    return { controllers, runningByNode };
  }),
  setRunning: (nodeId, running) => set((state) => ({ runningByNode: { ...state.runningByNode, [nodeId]: running } })),
  run: (nodeId) => get().controllers[nodeId]?.run(),
  stop: (nodeId) => get().controllers[nodeId]?.stop(),
}));
