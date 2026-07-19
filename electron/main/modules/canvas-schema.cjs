const CURRENT_CANVAS_SCHEMA_VERSION = 2;

const NODE_KINDS = new Set(['imageGenerator', 'imageLoader', 'prompt', 'llm', 'actionFission']);
const NODE_DEFAULT_SIZES = Object.freeze({
  imageGenerator: { width: 280, height: 280 },
  imageLoader: { width: 240, height: 320 },
  prompt: { width: 260, height: 160 },
  llm: { width: 280, height: 190 },
  actionFission: { width: 820, height: 620 },
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function safeString(value) {
  return String(value || '').trim();
}

function normalizedStringIds(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(safeString).filter(Boolean))]
    : [];
}

function removeKeys(value, keys) {
  for (const key of keys) delete value[key];
  return value;
}

function normalizeGeneratedImages(data, fallbackUrl = '') {
  const images = Array.isArray(data.generatedImages)
    ? data.generatedImages.flatMap((item) => {
        if (!isRecord(item)) return [];
        const localUrl = safeString(item.localUrl);
        const url = safeString(item.url);
        if (!localUrl && !url) return [];
        return [{
          ...(url ? { url } : {}),
          ...(localUrl ? { localUrl } : {}),
          ...(safeString(item.thumbUrl) ? { thumbUrl: safeString(item.thumbUrl) } : {}),
          ...(safeString(item.fileName) ? { fileName: safeString(item.fileName) } : {}),
          ...(Number(item.width) > 0 ? { width: Number(item.width) } : {}),
          ...(Number(item.height) > 0 ? { height: Number(item.height) } : {}),
          downloadState: item.downloadState === 'downloaded' ? 'downloaded' : 'pending',
          ...(Number(item.downloadedAt) > 0 ? { downloadedAt: Number(item.downloadedAt) } : {}),
        }];
      })
    : [];
  if (images.length) return images;

  const legacyUrl = safeString(data.imageUrl || fallbackUrl);
  if (!legacyUrl) return [];
  return [{
    localUrl: legacyUrl,
    ...(safeString(data.thumbUrl) ? { thumbUrl: safeString(data.thumbUrl) } : {}),
    ...(safeString(data.label) ? { fileName: safeString(data.label) } : {}),
    ...(Number(data.imageNaturalWidth) > 0 ? { width: Number(data.imageNaturalWidth) } : {}),
    ...(Number(data.imageNaturalHeight) > 0 ? { height: Number(data.imageNaturalHeight) } : {}),
    downloadState: data.outputDownloadState === 'downloaded' ? 'downloaded' : 'pending',
    ...(Number(data.outputDownloadedAt) > 0 ? { downloadedAt: Number(data.outputDownloadedAt) } : {}),
  }];
}

function normalizeLibtvConfig(value) {
  if (!isRecord(value)) return undefined;
  const count = Number(value.count || 0);
  const next = {
    ...(safeString(value.aspectRatio) ? { aspectRatio: safeString(value.aspectRatio) } : {}),
    ...(count > 0 ? { count } : {}),
    ...(safeString(value.modelKey) ? { modelKey: safeString(value.modelKey) } : {}),
    ...(safeString(value.modelName) ? { modelName: safeString(value.modelName) } : {}),
    ...(safeString(value.quality) ? { quality: safeString(value.quality) } : {}),
    ...(safeString(value.resolution) ? { resolution: safeString(value.resolution) } : {}),
  };
  return Object.keys(next).length ? next : undefined;
}

function normalizeCategoryGroup(value, fallbackId) {
  const group = isRecord(value) ? { ...value } : {};
  removeKeys(group, ['fixedActionId']);
  group.id = safeString(group.id) || fallbackId;
  group.actionProjectId = safeString(group.actionProjectId);
  group.includeActionTagIds = normalizedStringIds(group.includeActionTagIds);
  group.excludeActionTagIds = normalizedStringIds(group.excludeActionTagIds);
  if (safeString(group.name)) group.name = safeString(group.name);
  else delete group.name;
  return group;
}

function normalizeActionFissionRow(value, index) {
  const row = isRecord(value) ? { ...value } : {};
  const rowId = safeString(row.id) || `action_row_migrated_${index + 1}`;
  const legacyGroup = {
    id: `${rowId}_group_1`,
    actionProjectId: row.actionProjectId,
    includeActionTagIds: row.includeActionTagIds,
    excludeActionTagIds: row.excludeActionTagIds,
  };
  const sourceGroups = Array.isArray(row.categoryGroups) && row.categoryGroups.length
    ? row.categoryGroups
    : [legacyGroup];
  const groups = sourceGroups.map((group, groupIndex) => (
    normalizeCategoryGroup(group, `${rowId}_group_${groupIndex + 1}`)
  ));
  const selectedGroupId = safeString(row.selectedCategoryGroupId);

  row.id = rowId;
  row.categoryGroups = groups;
  row.selectedCategoryGroupId = groups.some((group) => group.id === selectedGroupId)
    ? selectedGroupId
    : groups[0].id;
  removeKeys(row, [
    'actionProjectId',
    'includeActionTagIds',
    'excludeActionTagIds',
    'generationTask',
    'generationTaskId',
    'generationRemoteTaskId',
    'libtvTask',
    'libtvTaskId',
    'libtvQueued',
    'libtvRunning',
    'libtvProjectUuid',
    'libtvRemoteNodeId',
    'error',
  ]);
  return row;
}

function normalizeActionFission(value) {
  if (!isRecord(value)) return undefined;
  const next = { ...value };
  removeKeys(next, [
    'running',
    'status',
    'error',
    'libtvWorkspaceId',
    'libtvWorkspaceName',
    'libtvProjectUuid',
    'libtvProjectName',
    'libtvGroupNodeId',
    'libtvGroupTitle',
  ]);
  next.rows = Array.isArray(next.rows)
    ? next.rows.map(normalizeActionFissionRow)
    : [];
  return next;
}

function currentNodeKind(node, data) {
  const value = safeString(data.kind || node.type);
  const kind = value === 'image' ? 'imageLoader' : value;
  if (NODE_KINDS.has(kind)) return kind;
  if (isRecord(data.actionFission) || isRecord(node.actionFission)) return 'actionFission';
  if (
    Array.isArray(data.generatedImages)
    || data.imageProviderId
    || data.imageModel
    || data.imageGenerationBackend
    || data.libtvImageGeneration
    || data.generationTaskId
    || data.latestGenerationTaskId
  ) return 'imageGenerator';
  if (data.imageUrl || node.url) return 'imageLoader';
  if (data.text !== undefined || node.text !== undefined) return 'prompt';
  return '';
}

function normalizeNodeData(node, kind) {
  const source = isRecord(node.data) ? node.data : {};
  const data = { ...source, kind };
  if (!safeString(data.label)) data.label = safeString(node.title);
  else data.label = String(data.label);

  removeKeys(data, [
    'generationTask',
    'generationTaskId',
    'generationRemoteTaskId',
    'generationStatus',
    'generationError',
    'running',
  ]);

  if (!safeString(data.latestGenerationTaskId)) delete data.latestGenerationTaskId;
  if (kind === 'imageLoader') {
    const imageUrl = safeString(data.imageUrl || node.url);
    if (imageUrl) data.imageUrl = imageUrl;
    const thumbUrl = safeString(data.thumbUrl || node.thumbUrl);
    if (thumbUrl) data.thumbUrl = thumbUrl;
  }
  if (kind === 'imageGenerator') {
    const generatedImages = normalizeGeneratedImages(data, node.url);
    if (generatedImages.length) data.generatedImages = generatedImages;
    else delete data.generatedImages;
    const libtvConfig = normalizeLibtvConfig(data.libtvImageGeneration);
    if (libtvConfig) data.libtvImageGeneration = libtvConfig;
    else delete data.libtvImageGeneration;
    removeKeys(data, ['imageUrl', 'thumbUrl', 'outputDownloadState', 'outputDownloadedAt']);
  }
  if (kind === 'actionFission') {
    data.actionFission = normalizeActionFission(data.actionFission || node.actionFission) || { rows: [] };
  }
  return data;
}

function normalizeNode(value, index) {
  if (!isRecord(value)) return null;
  const sourceData = isRecord(value.data) ? value.data : {};
  const kind = currentNodeKind(value, sourceData);
  if (!kind) return null;
  const current = value.type === 'canvasNode' && isRecord(value.position) && safeString(sourceData.kind);
  const position = isRecord(value.position) ? value.position : {};
  const node = current ? { ...value } : {
    id: safeString(value.id) || `${kind}_migrated_${index + 1}`,
    type: 'canvasNode',
    position: {
      x: Number(position.x ?? value.x ?? 0) || 0,
      y: Number(position.y ?? value.y ?? 0) || 0,
    },
    data: sourceData,
    style: {
      ...NODE_DEFAULT_SIZES[kind],
      ...(isRecord(value.style) ? value.style : {}),
      ...(Number(value.width ?? value.w) > 0 ? { width: Number(value.width ?? value.w) } : {}),
      ...(Number(value.height ?? value.h) > 0 ? { height: Number(value.height ?? value.h) } : {}),
    },
    ...(Number.isFinite(Number(value.zIndex)) ? { zIndex: Number(value.zIndex) } : {}),
  };
  const measuredWidth = Number(node.width);
  const measuredHeight = Number(node.height);
  if (measuredWidth > 0 || measuredHeight > 0) {
    node.style = {
      ...(isRecord(node.style) ? node.style : {}),
      ...(measuredWidth > 0 ? { width: measuredWidth } : {}),
      ...(measuredHeight > 0 ? { height: measuredHeight } : {}),
    };
  }
  node.id = safeString(node.id) || `${kind}_migrated_${index + 1}`;
  node.type = 'canvasNode';
  node.position = {
    x: Number(node.position?.x || 0),
    y: Number(node.position?.y || 0),
  };
  node.data = normalizeNodeData(value, kind);
  removeKeys(node, ['selected', 'dragging', 'measured', 'width', 'height', 'resizing', 'running']);
  return node;
}

function normalizeEdge(value, index) {
  if (!isRecord(value)) return null;
  const source = safeString(value.source || value.from);
  const target = safeString(value.target || value.to);
  if (!source || !target) return null;
  const data = isRecord(value.data) ? { ...value.data } : {};
  const edge = {
    ...value,
    id: safeString(value.id) || `edge_migrated_${index + 1}`,
    type: 'default',
    source,
    target,
    sourceHandle: typeof value.sourceHandle === 'string' ? value.sourceHandle : 'output',
    targetHandle: typeof value.targetHandle === 'string' ? value.targetHandle : 'input',
    data: {
      ...data,
      ...(['prompt', 'referenceImage', 'additionalReferenceImage', 'additionalReferencePrompt'].includes(data.inputKind)
        ? { inputKind: data.inputKind }
        : {}),
      ...(['referenceImage', 'additionalReferenceImage'].includes(data.inputKind) && Number(data.referenceOrder) > 0
        ? { referenceOrder: Number(data.referenceOrder) }
        : {}),
    },
  };
  removeKeys(edge, ['from', 'to', 'selected']);
  if (!Object.keys(edge.data).length) delete edge.data;
  return edge;
}

function migrateVersion1To2(input) {
  const canvas = cloneSerializable(input);
  const viewport = isRecord(canvas.viewport) ? canvas.viewport : {};
  const rawConnections = Array.isArray(canvas.connections)
    ? canvas.connections
    : Array.isArray(canvas.edges) ? canvas.edges : [];
  canvas.canvasSchemaVersion = CURRENT_CANVAS_SCHEMA_VERSION;
  canvas.nodes = (Array.isArray(canvas.nodes) ? canvas.nodes : [])
    .map(normalizeNode)
    .filter(Boolean);
  canvas.connections = rawConnections.map(normalizeEdge).filter(Boolean);
  canvas.groups = Array.isArray(canvas.groups) ? canvas.groups : [];
  canvas.viewport = {
    x: Number(viewport.x || 0),
    y: Number(viewport.y || 0),
    scale: Number(viewport.scale || viewport.zoom || 1),
  };
  delete canvas.edges;
  return canvas;
}

function upgradeCanvasDocument(input) {
  if (!isRecord(input)) throw new Error('Invalid canvas document.');
  const fromVersion = Number(input.canvasSchemaVersion || 1);
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new Error('Invalid canvas schema version.');
  if (fromVersion > CURRENT_CANVAS_SCHEMA_VERSION) {
    throw new Error(`Unsupported canvas schema version: ${fromVersion}.`);
  }
  if (fromVersion === CURRENT_CANVAS_SCHEMA_VERSION) {
    return { canvas: cloneSerializable(input), fromVersion, migrated: false };
  }
  return {
    canvas: migrateVersion1To2(input),
    fromVersion,
    migrated: true,
  };
}

module.exports = {
  CURRENT_CANVAS_SCHEMA_VERSION,
  upgradeCanvasDocument,
};
