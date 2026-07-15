interface CanvasViewportLike {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasSnapshotLike {
  nodes: readonly object[];
  edges: readonly object[];
  viewport: CanvasViewportLike;
}

export interface StoredCanvasSnapshot {
  nodes: Record<string, unknown>[];
  connections: Record<string, unknown>[];
  groups: never[];
  viewport: { x: number; y: number; scale: number };
}

export interface CanvasSnapshotSignatures {
  content: string;
  persistence: string;
}

export type CanvasSnapshotSaveStatus = "saved" | "unsaved" | "saving";

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function durableActionFission(value: unknown) {
  const actionFission = { ...recordOf(value) };
  if (!Array.isArray(actionFission.rows)) return actionFission;
  actionFission.rows = actionFission.rows.map((value) => {
    const row = { ...recordOf(value) };
    if (Array.isArray(row.categoryGroups)) {
      row.categoryGroups = row.categoryGroups.map((value) => {
        const group = { ...recordOf(value) };
        delete group.fixedActionId;
        return group;
      });
    }
    delete row.generationTask;
    delete row.libtvTask;
    delete row.libtvQueued;
    delete row.libtvRunning;
    return row;
  });
  return actionFission;
}

function durableNode(value: object) {
  const node = { ...recordOf(value) };
  const resizedWidth = Number(node.width);
  const resizedHeight = Number(node.height);
  if (Number.isFinite(resizedWidth) && resizedWidth > 0) {
    node.style = { ...recordOf(node.style), width: resizedWidth };
  }
  if (Number.isFinite(resizedHeight) && resizedHeight > 0) {
    node.style = { ...recordOf(node.style), height: resizedHeight };
  }
  delete node.selected;
  delete node.dragging;
  delete node.measured;
  delete node.width;
  delete node.height;
  delete node.resizing;

  const data = { ...recordOf(node.data) };
  delete data.generationTask;
  if (data.libtvImageGeneration && typeof data.libtvImageGeneration === "object") {
    const libtvState = { ...recordOf(data.libtvImageGeneration) };
    delete libtvState.task;
    data.libtvImageGeneration = libtvState;
  }
  if (data.actionFission && typeof data.actionFission === "object") {
    data.actionFission = durableActionFission(data.actionFission);
  }
  node.data = data;
  return node;
}

function durableEdge(value: object) {
  const edge = { ...recordOf(value) };
  delete edge.selected;
  return edge;
}

function contentNode(value: Record<string, unknown>) {
  const node = { ...value };
  const data = { ...recordOf(node.data) };
  if (Array.isArray(data.generatedImages)) {
    data.generatedImages = data.generatedImages.map((value) => {
      const image = { ...recordOf(value) };
      delete image.downloadState;
      delete image.downloadedAt;
      return image;
    });
  }
  if (data.actionFission && typeof data.actionFission === "object") {
    const actionFission = { ...recordOf(data.actionFission) };
    if (Array.isArray(actionFission.rows)) {
      actionFission.rows = actionFission.rows.map((value) => {
        const row = { ...recordOf(value) };
        delete row.resultDownloadState;
        delete row.resultDownloadedAt;
        return row;
      });
    }
    data.actionFission = actionFission;
  }
  node.data = data;
  return node;
}

export function canvasSnapshotForStorage(snapshot: CanvasSnapshotLike): StoredCanvasSnapshot {
  return {
    nodes: snapshot.nodes.map(durableNode),
    connections: snapshot.edges.map(durableEdge),
    groups: [],
    viewport: {
      x: snapshot.viewport.x,
      y: snapshot.viewport.y,
      scale: snapshot.viewport.zoom,
    },
  };
}

export function canvasSnapshotSignatures(snapshot: CanvasSnapshotLike): CanvasSnapshotSignatures {
  const stored = canvasSnapshotForStorage(snapshot);
  return storedCanvasSnapshotSignatures(stored);
}

export function storedCanvasSnapshotSignatures(stored: StoredCanvasSnapshot): CanvasSnapshotSignatures {
  return {
    content: JSON.stringify({
      nodes: stored.nodes.map(contentNode),
      connections: stored.connections,
      groups: stored.groups,
    }),
    persistence: JSON.stringify(stored),
  };
}

export function canvasSnapshotSaveState(
  current: CanvasSnapshotSignatures,
  saved: CanvasSnapshotSignatures,
  activeSave?: { signatures: CanvasSnapshotSignatures; reportsStatus: boolean } | null,
) {
  const persistenceBaseline = activeSave?.signatures.persistence ?? saved.persistence;
  const contentBaseline = activeSave?.reportsStatus
    ? activeSave.signatures.content
    : saved.content;
  const contentDirty = current.content !== contentBaseline;
  return {
    contentDirty,
    persistenceDirty: current.persistence !== persistenceBaseline,
    status: (contentDirty
      ? "unsaved"
      : activeSave?.reportsStatus
        ? "saving"
        : "saved") as CanvasSnapshotSaveStatus,
  };
}
