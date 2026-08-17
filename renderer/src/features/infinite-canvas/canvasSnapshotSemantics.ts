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

export interface CanvasDocumentSerializationMetadata {
  id: string;
  title: string;
  icon?: string;
  projectId: string;
  color?: string;
  pinned?: boolean;
  createdAt: number;
  viewport: CanvasViewportLike;
}

export const CANVAS_SAVE_UPDATED_AT_PLACEHOLDER = "__FORART_SAVE_UPDATED_AT__";
export const CANVAS_SAVE_REVISION_PLACEHOLDER = "__FORART_SAVE_REVISION__";

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
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
  if (node.parentId) {
    delete node.extent;
    delete node.expandParent;
  }

  const nodeData = { ...recordOf(node.data) };
  delete nodeData.groupId;
  node.data = nodeData;
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
  delete data.latestGenerationTaskId;
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
        delete row.latestGenerationTaskId;
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

export function storedCanvasContentSignature(stored: StoredCanvasSnapshot) {
  return JSON.stringify({
    nodes: stored.nodes.map(contentNode),
    connections: stored.connections,
    groups: stored.groups,
  });
}

/**
 * Build the final schema-v2 file in the renderer so Electron IPC transfers one
 * string instead of cloning the complete React Flow object graph. The main
 * process replaces the two metadata placeholders immediately before writing.
 */
export function serializeCanvasDocument(
  document: CanvasDocumentSerializationMetadata,
  stored: StoredCanvasSnapshot,
) {
  return JSON.stringify({
    canvasSchemaVersion: 2,
    id: document.id,
    title: document.title,
    icon: document.icon || "layers",
    canvasType: "forart",
    projectId: document.projectId,
    color: document.color || "",
    pinned: Boolean(document.pinned),
    createdAt: document.createdAt,
    updatedAt: CANVAS_SAVE_UPDATED_AT_PLACEHOLDER,
    revision: CANVAS_SAVE_REVISION_PLACEHOLDER,
    nodes: stored.nodes,
    connections: stored.connections,
    groups: stored.groups,
    viewport: {
      x: document.viewport.x,
      y: document.viewport.y,
      scale: document.viewport.zoom,
    },
  });
}
