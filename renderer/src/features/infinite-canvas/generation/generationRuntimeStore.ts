import { create } from "zustand";

interface GenerationRuntimeState {
  launchingKeys: Set<string>;
  beginLaunching: (keys: string[]) => void;
  endLaunching: (keys: string[]) => void;
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
  clearCanvasLaunching: (canvasId) => set((state) => ({
    launchingKeys: new Set([...state.launchingKeys].filter((key) => !key.startsWith(`${canvasId}:`))),
  })),
}));

export function beginGenerationLaunching(keys: string[]) {
  useGenerationRuntimeStore.getState().beginLaunching(keys);
}

export function endGenerationLaunching(keys: string[]) {
  useGenerationRuntimeStore.getState().endLaunching(keys);
}
