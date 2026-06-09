import { create } from "zustand";
import { temporal } from "zundo";
import type { CanvasConnection, CanvasNode } from "./types";

type StateUpdater<T> = T | ((current: T) => T);

export interface CanvasDocument {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
}

interface CanvasStore extends CanvasDocument {
  setCanvasDocument: (updater: StateUpdater<CanvasDocument>) => void;
  setCanvasDocumentWithoutHistory: (updater: StateUpdater<CanvasDocument>) => void;
  setNodes: (updater: StateUpdater<CanvasNode[]>) => void;
  setNodesWithoutHistory: (updater: StateUpdater<CanvasNode[]>) => void;
  setConnections: (updater: StateUpdater<CanvasConnection[]>) => void;
}

function resolveUpdater<T>(updater: StateUpdater<T>, current: T) {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

function isCanvasDocumentEqual(a: CanvasDocument, b: CanvasDocument) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const useCanvasStore = create<CanvasStore>()(
  temporal(
    (set, get) => ({
      nodes: [],
      connections: [],
      setCanvasDocument: (updater) => {
        set((state) => resolveUpdater(updater, { nodes: state.nodes, connections: state.connections }));
      },
      setCanvasDocumentWithoutHistory: (updater) => {
        const temporalState = useCanvasStore.temporal.getState();
        temporalState.pause();
        set((state) => resolveUpdater(updater, { nodes: state.nodes, connections: state.connections }));
        temporalState.resume();
      },
      setNodes: (updater) => {
        set((state) => ({ nodes: resolveUpdater(updater, state.nodes) }));
      },
      setNodesWithoutHistory: (updater) => {
        const temporalState = useCanvasStore.temporal.getState();
        temporalState.pause();
        set((state) => ({ nodes: resolveUpdater(updater, state.nodes) }));
        temporalState.resume();
      },
      setConnections: (updater) => {
        set((state) => ({ connections: resolveUpdater(updater, state.connections) }));
      },
    }),
    {
      partialize: (state) => ({ nodes: state.nodes, connections: state.connections }),
      equality: isCanvasDocumentEqual,
      limit: 100,
    },
  ),
);

let initialized = false;

export function ensureCanvasDocument(document: CanvasDocument) {
  if (initialized) return;
  replaceCanvasDocument(document);
  initialized = true;
}

export function replaceCanvasDocument(document: CanvasDocument) {
  const temporalState = useCanvasStore.temporal.getState();
  temporalState.pause();
  useCanvasStore.setState(document);
  temporalState.clear();
  temporalState.resume();
}

export function commitCanvasDocumentChange(previous: CanvasDocument) {
  const current = {
    nodes: useCanvasStore.getState().nodes,
    connections: useCanvasStore.getState().connections,
  };
  if (isCanvasDocumentEqual(previous, current)) return;
  useCanvasStore.temporal.setState((state) => ({
    pastStates: [...state.pastStates, previous].slice(-100),
    futureStates: [],
  }));
}

export function undoCanvasHistory() {
  useCanvasStore.temporal.getState().undo();
}

export function redoCanvasHistory() {
  useCanvasStore.temporal.getState().redo();
}
