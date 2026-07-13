import { create } from "zustand";
import { temporal } from "zundo";
import { cloneNativeCanvasNodeData, type NativeCanvasEdge, type NativeCanvasNode } from "./nativeCanvas";

export interface NativeCanvasHistorySnapshot {
  nodes: NativeCanvasNode[];
  edges: NativeCanvasEdge[];
}

interface NativeCanvasHistoryState {
  snapshot: NativeCanvasHistorySnapshot;
  replaceSnapshot: (snapshot: NativeCanvasHistorySnapshot) => void;
}

const emptyHistorySnapshot = (): NativeCanvasHistorySnapshot => ({ nodes: [], edges: [] });

function historySnapshot(nodes: NativeCanvasNode[], edges: NativeCanvasEdge[]): NativeCanvasHistorySnapshot {
  return {
    nodes: nodes.map((node) => {
      const { measured: _measured, width: _width, height: _height, ...durableNode } = node;
      return {
      ...durableNode,
      data: cloneNativeCanvasNodeData(node.data),
      position: { ...node.position },
      selected: false,
      dragging: false,
      };
    }),
    edges: edges.map((edge) => ({
      ...edge,
      data: edge.data ? { ...edge.data } : undefined,
      selected: false,
    })),
  };
}

function snapshotsEqual(left: NativeCanvasHistorySnapshot, right: NativeCanvasHistorySnapshot) {
  if (left.nodes.length !== right.nodes.length) return false;
  return left.nodes.every((node, index) => {
    const other = right.nodes[index];
    return Boolean(
      other
      && node.id === other.id
      && node.position.x === other.position.x
      && node.position.y === other.position.y
    );
  });
}

export const useInfiniteCanvasHistoryStore = create<NativeCanvasHistoryState>()(
  temporal(
    (set) => ({
      snapshot: emptyHistorySnapshot(),
      replaceSnapshot: (snapshot) => set({ snapshot }),
    }),
    {
      partialize: (state) => ({ snapshot: state.snapshot }),
      equality: (left, right) => snapshotsEqual(left.snapshot, right.snapshot),
      limit: 100,
    },
  ),
);

export function resetInfiniteCanvasHistory(nodes: NativeCanvasNode[], edges: NativeCanvasEdge[]) {
  const temporalState = useInfiniteCanvasHistoryStore.temporal.getState();
  temporalState.pause();
  useInfiniteCanvasHistoryStore.getState().replaceSnapshot(historySnapshot(nodes, edges));
  useInfiniteCanvasHistoryStore.temporal.setState({ pastStates: [], futureStates: [] });
  temporalState.resume();
}

export function recordInfiniteCanvasHistory(nodes: NativeCanvasNode[], edges: NativeCanvasEdge[]) {
  useInfiniteCanvasHistoryStore.getState().replaceSnapshot(historySnapshot(nodes, edges));
}

export function beginInfiniteCanvasHistoryGesture() {
  const previous = useInfiniteCanvasHistoryStore.getState().snapshot;
  useInfiniteCanvasHistoryStore.temporal.getState().pause();
  return previous;
}

export function commitInfiniteCanvasHistoryGesture(previous: NativeCanvasHistorySnapshot | null) {
  const temporalState = useInfiniteCanvasHistoryStore.temporal.getState();
  temporalState.resume();
  if (!previous) return;
  const current = useInfiniteCanvasHistoryStore.getState().snapshot;
  if (snapshotsEqual(previous, current)) return;
  useInfiniteCanvasHistoryStore.temporal.setState((state) => ({
    pastStates: [...state.pastStates, { snapshot: previous }].slice(-100),
    futureStates: [],
  }));
}

export function undoInfiniteCanvasHistory() {
  useInfiniteCanvasHistoryStore.temporal.getState().undo();
  return useInfiniteCanvasHistoryStore.getState().snapshot;
}

export function redoInfiniteCanvasHistory() {
  useInfiniteCanvasHistoryStore.temporal.getState().redo();
  return useInfiniteCanvasHistoryStore.getState().snapshot;
}

export function restoreInfiniteCanvasHistorySnapshot(
  snapshot: NativeCanvasHistorySnapshot,
  currentNodes: NativeCanvasNode[],
  currentEdges: NativeCanvasEdge[],
): NativeCanvasHistorySnapshot {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const desiredIds = new Set(snapshot.nodes.map((node) => node.id));
  const restoredIds = new Set(snapshot.nodes.filter((node) => !currentById.has(node.id)).map((node) => node.id));
  const edges = currentEdges.filter((edge) => desiredIds.has(edge.source) && desiredIds.has(edge.target));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  for (const edge of snapshot.edges) {
    if (
      !edgeIds.has(edge.id)
      && desiredIds.has(edge.source)
      && desiredIds.has(edge.target)
      && (restoredIds.has(edge.source) || restoredIds.has(edge.target))
    ) {
      edges.push(edge);
    }
  }
  return {
    edges,
    nodes: snapshot.nodes.map((node) => {
      const current = currentById.get(node.id);
      if (!current) return node;
      return {
        ...current,
        position: { ...node.position },
        selected: false,
        dragging: false,
      };
    }),
  };
}
