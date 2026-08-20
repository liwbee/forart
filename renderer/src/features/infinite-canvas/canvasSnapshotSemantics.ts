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

function compactActionFissionRow(value: unknown) {
  const row = { ...recordOf(value) };

  // These fields are unused response metadata. Keep thumbnail URLs so opening
  // a saved canvas does not have to probe or regenerate every thumbnail again.
  delete row.selectedActionTags;
  delete row.resultWidth;
  delete row.resultHeight;
  if (row.useAdditionalReferences === false) delete row.useAdditionalReferences;

  // Most action-fission rows have one unnamed group. Store that group's
  // selection directly on the row; both schema normalizers understand this
  // representation and recreate the deterministic group id when opening it.
  const groups = Array.isArray(row.categoryGroups) ? row.categoryGroups : [];
  if (groups.length === 1) {
    const group = recordOf(groups[0]);
    const selectedGroupId = String(row.selectedCategoryGroupId || "");
    const groupId = String(group.id || "");
    const groupName = String(group.name || "").trim();
    if (!groupName && (!selectedGroupId || selectedGroupId === groupId)) {
      row.actionProjectId = String(group.actionProjectId || "");
      const includeIds = Array.isArray(group.includeActionTagIds) ? group.includeActionTagIds : [];
      const excludeIds = Array.isArray(group.excludeActionTagIds) ? group.excludeActionTagIds : [];
      if (includeIds.length) row.includeActionTagIds = includeIds;
      else delete row.includeActionTagIds;
      if (excludeIds.length) row.excludeActionTagIds = excludeIds;
      else delete row.excludeActionTagIds;
      delete row.categoryGroups;
      delete row.selectedCategoryGroupId;
    }
  }

  return row;
}

function durableNodeData(value: unknown) {
  const data = { ...recordOf(value) };
  delete data.groupId;
  delete data.imageUploadState;
  delete data.imageUploadError;
  if (data.actionFission && typeof data.actionFission === "object") {
    const actionFission = { ...recordOf(data.actionFission) };
    if (Array.isArray(actionFission.rows)) {
      actionFission.rows = actionFission.rows.map(compactActionFissionRow);
    }
    data.actionFission = actionFission;
  }
  return data;
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

  node.data = durableNodeData(node.data);
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
    // Do not persist a transient upload placeholder. If the app closes before
    // the asset finishes saving, the next open should not contain a blank node.
    nodes: snapshot.nodes
      .filter((node) => {
        const data = recordOf(recordOf(node).data);
        return data.imageUploadState !== "processing" && data.imageUploadState !== "error";
      })
      .map(durableNode),
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
    // The current canvas type is always Forart and is restored by the schema
    // normalizers. Keep custom icon metadata, but omit the default value.
    ...(document.icon && document.icon !== "layers" ? { icon: document.icon } : {}),
    projectId: document.projectId,
    ...(document.color ? { color: document.color } : {}),
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
