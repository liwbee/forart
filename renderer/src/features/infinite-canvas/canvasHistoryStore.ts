import { create } from "zustand";
import { temporal } from "zundo";
import type { ActionFissionRow } from "./action-fission/actionFissionTypes";
import type { NativeCanvasEdge, NativeCanvasNode, NativeCanvasNodeData } from "./nativeCanvas";

export interface NativeCanvasHistorySnapshot {
  nodes: NativeCanvasNode[];
  edges: NativeCanvasEdge[];
}

interface NativeCanvasHistoryState {
  snapshot: NativeCanvasHistorySnapshot;
  replaceSnapshot: (snapshot: NativeCanvasHistorySnapshot) => void;
}

const emptyHistorySnapshot = (): NativeCanvasHistorySnapshot => ({ nodes: [], edges: [] });

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function positiveDimension(value: unknown) {
  const dimension = Number(value || 0);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : 0;
}

function snapshotNode(node: NativeCanvasNode): NativeCanvasNode {
  const {
    measured: _measured,
    resizing: _resizing,
    width: nodeWidth,
    height: nodeHeight,
    ...durableNode
  } = node;
  const width = positiveDimension(nodeWidth);
  const height = positiveDimension(nodeHeight);
  const style = node.style || width || height
    ? {
        ...node.style,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
      }
    : undefined;
  return {
    ...durableNode,
    style,
    data: cloneValue(node.data),
    position: { ...node.position },
    selected: false,
    dragging: false,
  };
}

function snapshotEdge(edge: NativeCanvasEdge): NativeCanvasEdge {
  return {
    ...edge,
    data: edge.data ? cloneValue(edge.data) : undefined,
    selected: false,
  };
}

function historySnapshot(nodes: NativeCanvasNode[], edges: NativeCanvasEdge[]): NativeCanvasHistorySnapshot {
  return {
    nodes: nodes.map(snapshotNode),
    edges: edges.map(snapshotEdge),
  };
}

const ACTION_FISSION_RUNTIME_FIELDS: (keyof ActionFissionRow)[] = [
  "latestGenerationTaskId",
  "resultUrl",
  "resultThumbUrl",
  "resultFileName",
  "resultWidth",
  "resultHeight",
  "resultDownloadState",
  "resultDownloadedAt",
  "selectedActionThumbUrl",
];

function undoableNodeData(data: NativeCanvasNodeData): NativeCanvasNodeData {
  const undoable = cloneValue(data);
  delete undoable.latestGenerationTaskId;
  delete undoable.generatedImages;
  delete undoable.multiImageExpanded;
  delete undoable.multiImageCollapsedSize;
  delete undoable.thumbUrl;
  if (undoable.kind === "imageGenerator" || undoable.kind === "imageLoader") {
    delete undoable.imageNaturalWidth;
    delete undoable.imageNaturalHeight;
  }
  if (undoable.libtvImageGeneration) {
    delete (undoable.libtvImageGeneration as Record<string, unknown>).error;
  }
  if (undoable.actionFission) {
    undoable.actionFission.rows = undoable.actionFission.rows.map((row) => {
      const undoableRow = { ...row };
      ACTION_FISSION_RUNTIME_FIELDS.forEach((field) => delete undoableRow[field]);
      return undoableRow;
    });
  }
  return undoable;
}

function styleWithoutDimensions(style: NativeCanvasNode["style"]) {
  if (!style) return undefined;
  const { width: _width, height: _height, ...rest } = style;
  return Object.keys(rest).length ? rest : undefined;
}

function visualNodeSize(node: NativeCanvasNode) {
  return {
    width: positiveDimension(node.style?.width) || positiveDimension(node.width) || positiveDimension(node.measured?.width),
    height: positiveDimension(node.style?.height) || positiveDimension(node.height) || positiveDimension(node.measured?.height),
  };
}

function undoableNode(node: NativeCanvasNode): NativeCanvasNode {
  const projected = snapshotNode(node);
  projected.data = undoableNodeData(projected.data);
  if (
    node.data.kind === "annotation"
    || node.data.kind === "imageLoader"
    || node.data.kind === "imageGenerator"
  ) {
    projected.style = styleWithoutDimensions(projected.style);
  }
  if (node.data.kind === "imageGenerator") {
    const currentSize = visualNodeSize(node);
    const collapsedSize = node.data.multiImageCollapsedSize;
    const canonicalWidth = positiveDimension(collapsedSize?.width) || currentSize.width;
    const canonicalHeight = positiveDimension(collapsedSize?.height) || currentSize.height;
    projected.position = {
      x: node.position.x + canonicalWidth / 2,
      y: node.position.y + canonicalHeight / 2,
    };
  }
  return projected;
}

function undoableSnapshot(snapshot: NativeCanvasHistorySnapshot): NativeCanvasHistorySnapshot {
  return {
    nodes: snapshot.nodes.map(undoableNode),
    edges: snapshot.edges.map(snapshotEdge),
  };
}

function snapshotsEqual(left: NativeCanvasHistorySnapshot, right: NativeCanvasHistorySnapshot) {
  return JSON.stringify(undoableSnapshot(left)) === JSON.stringify(undoableSnapshot(right));
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

export function rebaseInfiniteCanvasHistoryNode(
  nodeId: string,
  transformCurrent: (node: NativeCanvasNode) => NativeCanvasNode,
  transformHistory: (node: NativeCanvasNode) => NativeCanvasNode = transformCurrent,
) {
  const transformSnapshot = (
    snapshot: NativeCanvasHistorySnapshot,
    transform: (node: NativeCanvasNode) => NativeCanvasNode,
  ) => historySnapshot(
    snapshot.nodes.map((node) => node.id === nodeId ? transform(node) : node),
    snapshot.edges,
  );
  const temporalState = useInfiniteCanvasHistoryStore.temporal.getState();
  const wasTracking = temporalState.isTracking;
  if (wasTracking) temporalState.pause();
  const current = useInfiniteCanvasHistoryStore.getState().snapshot;
  useInfiniteCanvasHistoryStore.getState().replaceSnapshot(transformSnapshot(current, transformCurrent));
  useInfiniteCanvasHistoryStore.temporal.setState((state) => ({
    pastStates: state.pastStates.map((entry) => entry.snapshot
      ? { ...entry, snapshot: transformSnapshot(entry.snapshot, transformHistory) }
      : entry),
    futureStates: state.futureStates.map((entry) => entry.snapshot
      ? { ...entry, snapshot: transformSnapshot(entry.snapshot, transformHistory) }
      : entry),
  }));
  if (wasTracking) temporalState.resume();
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

function overlayProperty(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
) {
  if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = cloneValue(source[key]);
  else delete target[key];
}

function restoreNodeData(historyData: NativeCanvasNodeData, currentData: NativeCanvasNodeData) {
  const restored = cloneValue(historyData) as NativeCanvasNodeData & Record<string, unknown>;
  const current = currentData as NativeCanvasNodeData & Record<string, unknown>;
  [
    "latestGenerationTaskId",
    "generatedImages",
    "multiImageExpanded",
    "multiImageCollapsedSize",
  ].forEach((field) => overlayProperty(restored, current, field));

  if (historyData.kind === "imageGenerator") {
    ["thumbUrl", "imageNaturalWidth", "imageNaturalHeight"].forEach((field) => (
      overlayProperty(restored, current, field)
    ));
  } else if (historyData.kind === "imageLoader" && historyData.imageUrl === currentData.imageUrl) {
    ["thumbUrl", "imageNaturalWidth", "imageNaturalHeight"].forEach((field) => (
      overlayProperty(restored, current, field)
    ));
  }

  if (restored.libtvImageGeneration) {
    const restoredLibtv = restored.libtvImageGeneration as Record<string, unknown>;
    const currentLibtv = (currentData.libtvImageGeneration || {}) as Record<string, unknown>;
    overlayProperty(restoredLibtv, currentLibtv, "error");
  }

  if (restored.actionFission) {
    const currentRows = new Map(currentData.actionFission?.rows.map((row) => [row.id, row]) || []);
    restored.actionFission.rows = restored.actionFission.rows.map((row) => {
      const currentRow = currentRows.get(row.id);
      if (!currentRow) return row;
      const restoredRow = { ...row } as ActionFissionRow & Record<string, unknown>;
      ACTION_FISSION_RUNTIME_FIELDS.forEach((field) => {
        if (
          field === "selectedActionThumbUrl"
          && row.selectedActionAssetUrl !== currentRow.selectedActionAssetUrl
        ) return;
        overlayProperty(restoredRow, currentRow as ActionFissionRow & Record<string, unknown>, field);
      });
      return restoredRow;
    });
  }
  return restored;
}

function generatorCanonicalCenter(node: NativeCanvasNode) {
  const size = visualNodeSize(node);
  const collapsedSize = node.data.multiImageCollapsedSize;
  return {
    x: node.position.x + (positiveDimension(collapsedSize?.width) || size.width) / 2,
    y: node.position.y + (positiveDimension(collapsedSize?.height) || size.height) / 2,
  };
}

export function restoreInfiniteCanvasHistorySnapshot(
  snapshot: NativeCanvasHistorySnapshot,
  currentNodes: NativeCanvasNode[],
  _currentEdges: NativeCanvasEdge[],
): NativeCanvasHistorySnapshot {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  return {
    edges: snapshot.edges.map(snapshotEdge),
    nodes: snapshot.nodes.map((historyNode) => {
      const current = currentById.get(historyNode.id);
      if (!current) return snapshotNode(historyNode);
      const data = restoreNodeData(historyNode.data, current.data);
      let position = { ...historyNode.position };
      let style = historyNode.style ? cloneValue(historyNode.style) : undefined;
      if (historyNode.data.kind === "imageGenerator" && current.data.generatedImages?.length) {
        const desiredCenter = generatorCanonicalCenter(historyNode);
        const currentSize = visualNodeSize(current);
        const currentCollapsedSize = current.data.multiImageCollapsedSize;
        const positioningWidth = positiveDimension(currentCollapsedSize?.width) || currentSize.width;
        const positioningHeight = positiveDimension(currentCollapsedSize?.height) || currentSize.height;
        position = {
          x: desiredCenter.x - positioningWidth / 2,
          y: desiredCenter.y - positioningHeight / 2,
        };
        style = current.style ? cloneValue(current.style) : undefined;
      }
      return {
        ...current,
        ...historyNode,
        width: undefined,
        height: undefined,
        measured: undefined,
        resizing: false,
        position,
        style,
        data,
        selected: false,
        dragging: false,
      };
    }),
  };
}
