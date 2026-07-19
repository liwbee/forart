import { create } from "zustand";

interface GenerationRuntimeState {
  launchingKeys: Set<string>;
  errorsByKey: Record<string, string>;
  dismissedTaskIds: Set<string>;
  beginLaunching: (keys: string[]) => void;
  endLaunching: (keys: string[]) => void;
  setError: (key: string, message: string) => void;
  clearError: (key: string) => void;
  dismissTask: (taskId: string) => void;
  clearCanvasLaunching: (canvasId: string) => void;
}

export function imageGenerationLaunchKey(canvasId: string, nodeId: string) {
  return `${canvasId}:node:${nodeId}`;
}

export function actionFissionLaunchKey(canvasId: string, nodeId: string, rowId: string) {
  return `${canvasId}:action-fission:${nodeId}:${rowId}`;
}

export function isImageNodeLaunching(keys: Set<string>, nodeId: string) {
  return [...keys].some((key) => key.endsWith(`:node:${nodeId}`));
}

export function isNodeGenerationLaunching(keys: Set<string>, nodeId: string) {
  return [...keys].some((key) => (
    key.endsWith(`:node:${nodeId}`) || key.includes(`:action-fission:${nodeId}:`)
  ));
}

export function actionFissionLaunchingRowIds(keys: Set<string>, nodeId: string) {
  const marker = `:action-fission:${nodeId}:`;
  return new Set([...keys].flatMap((key) => {
    const markerIndex = key.indexOf(marker);
    return markerIndex < 0 ? [] : [key.slice(markerIndex + marker.length)];
  }));
}

export const useGenerationRuntimeStore = create<GenerationRuntimeState>((set) => ({
  launchingKeys: new Set(),
  errorsByKey: {},
  dismissedTaskIds: new Set(),
  beginLaunching: (keys) => set((state) => {
    const launchingKeys = new Set(state.launchingKeys);
    keys.forEach((key) => launchingKeys.add(key));
    return { launchingKeys };
  }),
  endLaunching: (keys) => set((state) => {
    const launchingKeys = new Set(state.launchingKeys);
    keys.forEach((key) => launchingKeys.delete(key));
    return { launchingKeys };
  }),
  setError: (key, message) => set((state) => {
    const nextMessage = String(message || "");
    if (!nextMessage) {
      const errorsByKey = { ...state.errorsByKey };
      delete errorsByKey[key];
      return { errorsByKey };
    }
    return { errorsByKey: { ...state.errorsByKey, [key]: nextMessage } };
  }),
  clearError: (key) => set((state) => {
    if (!state.errorsByKey[key]) return state;
    const errorsByKey = { ...state.errorsByKey };
    delete errorsByKey[key];
    return { errorsByKey };
  }),
  dismissTask: (taskId) => set((state) => ({
    dismissedTaskIds: new Set(state.dismissedTaskIds).add(taskId),
  })),
  clearCanvasLaunching: (canvasId) => set((state) => ({
    launchingKeys: new Set([...state.launchingKeys].filter((key) => !key.startsWith(`${canvasId}:`))),
    errorsByKey: Object.fromEntries(Object.entries(state.errorsByKey)
      .filter(([key]) => !key.startsWith(`${canvasId}:`))),
  })),
}));

export function beginGenerationLaunching(keys: string[]) {
  useGenerationRuntimeStore.getState().beginLaunching(keys);
}

export function endGenerationLaunching(keys: string[]) {
  useGenerationRuntimeStore.getState().endLaunching(keys);
}

export function setGenerationRuntimeError(key: string, message: string) {
  useGenerationRuntimeStore.getState().setError(key, message);
}

export function clearGenerationRuntimeError(key: string) {
  useGenerationRuntimeStore.getState().clearError(key);
}

export function clearNodeGenerationRuntimeErrors(nodeId: string) {
  const state = useGenerationRuntimeStore.getState();
  Object.keys(state.errorsByKey).forEach((key) => {
    if (key.endsWith(`:node:${nodeId}`) || key.includes(`:action-fission:${nodeId}:`)) {
      state.clearError(key);
    }
  });
}
