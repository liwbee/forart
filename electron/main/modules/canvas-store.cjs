const fs = require('fs');
const path = require('path');
const { CURRENT_CANVAS_SCHEMA_VERSION, upgradeCanvasDocument } = require('./canvas-schema.cjs');

function sanitizeCanvasId(canvasId) {
  return String(canvasId || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function nowMs() {
  return Date.now();
}

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function atomicWriteJson(filePath, payload) {
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  JSON.parse(serialized);
  const temporaryPath = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = fs.openSync(temporaryPath, 'w');
  try {
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporaryPath, filePath);
}

function readAtomicJson(filePath, revisionOf) {
  const temporaryPath = `${filePath}.tmp`;
  const primary = readJsonFile(filePath);
  const temporary = readJsonFile(temporaryPath);
  if (!temporary) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    return primary;
  }
  const primaryRevision = primary ? Number(revisionOf(primary) || 0) : -1;
  const temporaryRevision = Number(revisionOf(temporary) || 0);
  if (!primary || temporaryRevision > primaryRevision) {
    fs.renameSync(temporaryPath, filePath);
    return temporary;
  }
  fs.unlinkSync(temporaryPath);
  return primary;
}

function newCanvasId() {
  return `canvas_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function newProjectId() {
  return `project_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_PROJECT_ID = 'project_default';
const DEFAULT_PROJECT_TITLE = 'Default project';

function normalizeProjectId(projectId) {
  return sanitizeCanvasId(projectId || '');
}

function canvasRecord(canvas) {
  return {
    id: canvas.id,
    title: String(canvas.title || 'Untitled canvas'),
    icon: String(canvas.icon || 'layers'),
    canvasType: 'forart',
    projectId: normalizeProjectId(canvas.projectId),
    color: String(canvas.color || ''),
    pinned: Boolean(canvas.pinned),
    createdAt: Number(canvas.createdAt || 0),
    updatedAt: Number(canvas.updatedAt || 0),
    revision: Math.max(1, Number(canvas.revision || 1)),
    nodeCount: Array.isArray(canvas.nodes) ? canvas.nodes.length : 0,
  };
}

function normalizeCanvasRecord(input, fallback = {}) {
  const timestamp = nowMs();
  return {
    id: sanitizeCanvasId(input?.id || fallback.id || ''),
    title: String(input?.title || fallback.title || 'Untitled canvas'),
    icon: String(input?.icon || fallback.icon || 'layers'),
    canvasType: 'forart',
    projectId: normalizeProjectId(input?.projectId || fallback.projectId),
    color: String(input?.color || fallback.color || ''),
    pinned: Boolean(input?.pinned || fallback.pinned),
    createdAt: Number(input?.createdAt || fallback.createdAt || timestamp),
    updatedAt: Number(input?.updatedAt || fallback.updatedAt || fallback.createdAt || timestamp),
    revision: Math.max(1, Number(input?.revision || fallback.revision || 1)),
    nodeCount: Number(input?.nodeCount || fallback.nodeCount || 0),
  };
}

function normalizeProjectRecord(input, fallback = {}) {
  const timestamp = nowMs();
  const id = normalizeProjectId(input?.id || fallback.id || newProjectId());
  const fallbackSortOrder = Number.isFinite(Number(fallback.sortOrder)) ? Number(fallback.sortOrder) : 0;
  const sortOrder = Number.isFinite(Number(input?.sortOrder)) ? Number(input.sortOrder) : fallbackSortOrder;
  return {
    id,
    title: String(input?.title || fallback.title || 'New project').trim().slice(0, 80) || 'New project',
    color: String(input?.color || fallback.color || ''),
    sortOrder,
    createdAt: Number(input?.createdAt || fallback.createdAt || timestamp),
    updatedAt: Number(input?.updatedAt || fallback.updatedAt || fallback.createdAt || timestamp),
  };
}

function defaultProjectRecord(timestamp = nowMs()) {
  return normalizeProjectRecord({
    id: DEFAULT_PROJECT_ID,
    title: DEFAULT_PROJECT_TITLE,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function ensureDefaultProject(projects) {
  const normalizedProjects = (projects || []).map((project, index) => normalizeProjectRecord(project, { sortOrder: index + 1 })).filter((project) => project.id);
  if (normalizedProjects.length) return normalizedProjects;
  return [normalizeProjectRecord(defaultProjectRecord(), { sortOrder: 1 })];
}

function sortCanvasRecords(canvases) {
  return canvases.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });
}

function sortProjectRecords(projects) {
  return projects.sort((a, b) => {
    const leftOrder = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
    const rightOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return Number(a.createdAt || 0) - Number(b.createdAt || 0);
  });
}

function normalizeCanvasDocument(input, fallback = {}) {
  const { canvas: upgraded } = upgradeCanvasDocument(input || fallback);
  const timestamp = nowMs();
  const viewport = upgraded?.viewport && typeof upgraded.viewport === 'object' ? upgraded.viewport : {};
  return {
    canvasSchemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
    id: sanitizeCanvasId(upgraded?.id || fallback.id || newCanvasId()),
    title: String(upgraded?.title || fallback.title || 'Untitled canvas').slice(0, 80),
    icon: String(upgraded?.icon || fallback.icon || 'layers').slice(0, 32),
    canvasType: 'forart',
    projectId: normalizeProjectId(upgraded?.projectId || fallback.projectId),
    color: String(upgraded?.color || fallback.color || ''),
    pinned: Boolean(upgraded?.pinned || fallback.pinned),
    createdAt: Number(upgraded?.createdAt || fallback.createdAt || timestamp),
    updatedAt: Number(upgraded?.updatedAt || fallback.updatedAt || timestamp),
    revision: Math.max(1, Number(upgraded?.revision || fallback.revision || 1)),
    nodes: Array.isArray(upgraded?.nodes) ? upgraded.nodes : [],
    connections: Array.isArray(upgraded?.connections) ? upgraded.connections : [],
    groups: Array.isArray(upgraded?.groups) ? upgraded.groups : [],
    viewport: {
      x: Number.isFinite(Number(viewport.x)) ? Number(viewport.x) : 0,
      y: Number.isFinite(Number(viewport.y)) ? Number(viewport.y) : 0,
      scale: Number.isFinite(Number(viewport.scale)) ? Number(viewport.scale) : 1,
    },
  };
}

function createCanvasStore({ rootDir }) {
  function storageRoot() {
    const root = path.join(rootDir, 'CanvasAssests');
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  function jsonRoot() {
    const directory = path.join(storageRoot(), 'json');
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  function indexPath() {
    return path.join(storageRoot(), 'canvas-index.json');
  }

  function canvasPath(canvasId) {
    const safeId = sanitizeCanvasId(canvasId);
    if (!safeId) return '';
    return path.join(jsonRoot(), safeId + '.json');
  }

  function readCanvas(canvasId) {
    const filePath = canvasPath(canvasId);
    if (!filePath) return null;
    const payload = readAtomicJson(filePath, (value) => value?.revision);
    if (!payload) return null;
    const canvas = normalizeCanvasDocument(payload, { id: canvasId });
    if (Number(payload.canvasSchemaVersion || 1) !== CURRENT_CANVAS_SCHEMA_VERSION) {
      atomicWriteJson(filePath, canvas);
    }
    return canvas;
  }

  function migrateStoredCanvasDocuments() {
    let migrated = 0;
    for (const canvasId of canvasIdsFromDisk()) {
      const filePath = canvasPath(canvasId);
      const payload = readAtomicJson(filePath, (value) => value?.revision);
      if (!payload || Number(payload.canvasSchemaVersion || 1) === CURRENT_CANVAS_SCHEMA_VERSION) continue;
      const canvas = normalizeCanvasDocument(payload, { id: canvasId });
      atomicWriteJson(filePath, canvas);
      migrated += 1;
    }
    return migrated;
  }

  function readIndexPayload() {
    const filePath = indexPath();
    if (!fs.existsSync(filePath) && !fs.existsSync(`${filePath}.tmp`)) {
      return { canvases: [], projects: ensureDefaultProject([]), revision: 0, valid: true };
    }
    const payload = readAtomicJson(filePath, (value) => value?.revision || value?.updatedAt);
    if (payload?.version !== 3) return { canvases: [], projects: [], revision: 0, valid: false };
    const canvases = Array.isArray(payload?.canvases) ? payload.canvases : [];
    const projects = ensureDefaultProject(Array.isArray(payload?.projects) ? payload.projects : []);
    return {
      canvases: canvases.map((record) => normalizeCanvasRecord(record)).filter((record) => record.id),
      projects,
      revision: Math.max(0, Number(payload.revision || 0)),
      valid: true,
    };
  }

  function writeIndexPayload(inputPayload) {
    const nextPayload = {
      version: 3,
      revision: Math.max(0, Number(inputPayload.revision || 0)) + 1,
      updatedAt: nowMs(),
      canvases: sortCanvasRecords([...(inputPayload.canvases || [])]),
      projects: sortProjectRecords(ensureDefaultProject(inputPayload.projects || [])),
    };
    atomicWriteJson(indexPath(), nextPayload);
  }

  function canvasIdsFromDisk() {
    return [...new Set(fs.readdirSync(jsonRoot())
      .filter((fileName) => fileName.endsWith('.json') || fileName.endsWith('.json.tmp'))
      .map((fileName) => sanitizeCanvasId(fileName.replace(/\.json(?:\.tmp)?$/, '')))
      .filter(Boolean))];
  }

  function indexMatchesDisk(payload, canvasIds) {
    const canvases = payload?.canvases || [];
    if (canvases.length !== canvasIds.length) return false;
    const diskIds = new Set(canvasIds);
    return canvases.every((record) => diskIds.has(record.id));
  }

  function rebuildIndex() {
    const indexPayload = readIndexPayload();
    const projectById = new Map(indexPayload.projects.map((project) => [project.id, project]));
    const canvases = [];
    for (const canvasId of canvasIdsFromDisk()) {
      const canvas = readCanvas(canvasId);
      if (!canvas?.id) continue;
      canvases.push({
        ...canvasRecord(canvas),
        projectId: projectById.has(canvas.projectId) ? canvas.projectId : indexPayload.projects[0]?.id || DEFAULT_PROJECT_ID,
      });
    }
    writeIndexPayload({ canvases, projects: indexPayload.projects });
    return sortCanvasRecords(canvases);
  }

  function updateIndexCanvas(record) {
    const payload = readIndexPayload();
    const nextRecord = normalizeCanvasRecord(record);
    const next = payload.canvases.some((item) => item.id === nextRecord.id)
      ? payload.canvases.map((item) => (item.id === nextRecord.id ? nextRecord : item))
      : [nextRecord, ...payload.canvases];
    writeIndexPayload({ ...payload, canvases: next });
  }

  function removeIndexCanvas(canvasId) {
    const payload = readIndexPayload();
    writeIndexPayload({ ...payload, canvases: payload.canvases.filter((record) => record.id !== canvasId) });
  }

  function updateIndexProject(project) {
    const payload = readIndexPayload();
    const nextProject = normalizeProjectRecord(project);
    const next = payload.projects.some((item) => item.id === nextProject.id)
      ? payload.projects.map((item) => (item.id === nextProject.id ? nextProject : item))
      : [nextProject, ...payload.projects];
    writeIndexPayload({ ...payload, projects: next });
    return nextProject;
  }

  function writeCanvas(canvas) {
    const normalized = normalizeCanvasDocument(canvas);
    const filePath = canvasPath(normalized.id);
    atomicWriteJson(filePath, normalized);
    updateIndexCanvas(canvasRecord(normalized));
    return { canvas: normalized, filePath };
  }

  function listCanvases() {
    const canvasIds = canvasIdsFromDisk();
    const indexedPayload = readIndexPayload();
    if (!indexedPayload.valid) {
      return rebuildIndex();
    }
    if (indexMatchesDisk(indexedPayload, canvasIds)) return sortCanvasRecords(indexedPayload.canvases);
    return rebuildIndex();
  }

  function listProjects() {
    return sortProjectRecords(readIndexPayload().projects);
  }

  function createCanvas(payload = {}) {
    const timestamp = nowMs();
    const result = writeCanvas({
      id: newCanvasId(),
      title: String(payload?.title || 'Untitled canvas').trim() || 'Untitled canvas',
      icon: payload?.icon || 'layers',
      canvasType: 'forart',
      projectId: normalizeProjectId(payload?.projectId) || listProjects()[0]?.id || DEFAULT_PROJECT_ID,
      color: '',
      pinned: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      nodes: Array.isArray(payload?.nodes) ? payload.nodes : [],
      connections: Array.isArray(payload?.connections) ? payload.connections : [],
      groups: Array.isArray(payload?.groups) ? payload.groups : [],
      viewport: payload?.viewport || { x: 0, y: 0, scale: 1 },
    });
    return { ok: true, canvas: result.canvas, record: canvasRecord(result.canvas), filePath: result.filePath };
  }

  function saveCanvas(canvasId, payload = {}) {
    const existing = readCanvas(canvasId);
    if (!existing) throw new Error('Canvas not found.');
    const nextNodes = Array.isArray(payload?.nodes) ? payload.nodes : existing.nodes;
    if (existing.nodes.length > 0 && nextNodes.length === 0 && payload?.allowEmpty !== true) {
      throw new Error('Refusing to replace a non-empty canvas with an unexpected empty canvas snapshot.');
    }
    const result = writeCanvas({
      ...existing,
      ...(payload || {}),
      id: existing.id,
      createdAt: existing.createdAt,
      title: String(payload?.title || existing.title || 'Untitled canvas').slice(0, 80),
      icon: String(payload?.icon || existing.icon || 'layers').slice(0, 32),
      canvasType: 'forart',
      projectId: payload?.projectId !== undefined ? normalizeProjectId(payload.projectId) : existing.projectId,
      updatedAt: nowMs(),
      revision: existing.revision + 1,
    });
    return { ok: true, canvas: result.canvas, record: canvasRecord(result.canvas), filePath: result.filePath };
  }

  function updateGenerationNode(canvasId, nodeId, updater) {
    const existing = readCanvas(canvasId);
    if (!existing) return { ok: false, reason: 'canvas_not_found' };
    let matched = false;
    const nodes = existing.nodes.map((node) => {
      if (String(node?.id || '') !== String(nodeId || '')) return node;
      matched = true;
      const data = node?.data && typeof node.data === 'object' ? node.data : {};
      return { ...node, data: updater(data) };
    });
    if (!matched) return { ok: false, reason: 'node_not_found' };
    const result = writeCanvas({ ...existing, nodes, updatedAt: nowMs(), revision: existing.revision + 1 });
    return { ok: true, canvas: result.canvas, record: canvasRecord(result.canvas), filePath: result.filePath };
  }

  function generationNodeTaskId(data) {
    return String(data?.latestGenerationTaskId || '').trim();
  }

  function actionFissionRowTaskId(row) {
    return String(row?.latestGenerationTaskId || '').trim();
  }

  function setGenerationTaskAnchor(canvasId, nodeId, payload = {}) {
    const taskId = String(payload.taskId || '').trim();
    if (!taskId) return { ok: false, reason: 'task_id_required' };
    return updateGenerationNode(canvasId, nodeId, (data) => {
      const next = { ...data };
      next.latestGenerationTaskId = taskId;
      return next;
    });
  }

  function updateActionFissionRow(canvasId, nodeId, rowId, updater) {
    return updateGenerationNode(canvasId, nodeId, (data) => {
      const actionFission = data.actionFission && typeof data.actionFission === 'object' ? data.actionFission : null;
      const rows = Array.isArray(actionFission?.rows) ? actionFission.rows : [];
      if (!rows.some((row) => String(row?.id || '') === String(rowId || ''))) return data;
      return {
        ...data,
        actionFission: {
          ...actionFission,
          rows: rows.map((row) => String(row?.id || '') === String(rowId || '') ? updater(row || {}) : row),
        },
      };
    });
  }

  function setActionFissionRowTaskAnchor(canvasId, nodeId, rowId, payload = {}) {
    const taskId = String(payload.taskId || '').trim();
    if (!taskId) return { ok: false, reason: 'task_id_required' };
    return updateActionFissionRow(canvasId, nodeId, rowId, (row) => ({
      ...row,
      latestGenerationTaskId: taskId,
    }));
  }

  function completeActionFissionRow(payload = {}) {
    const taskId = String(payload.taskId || '').trim();
    let applied = false;
    const result = updateActionFissionRow(payload.canvasId, payload.nodeId, payload.rowId, (row) => {
      const currentTaskId = actionFissionRowTaskId(row);
      if (taskId && currentTaskId !== taskId) return row;
      applied = true;
      const next = { ...row };
      if (taskId) next.latestGenerationTaskId = taskId;
      if (payload.status === 'succeeded' && payload.result?.localUrl) {
        next.resultUrl = String(payload.result.localUrl);
        next.resultFileName = String(payload.result.fileName || next.selectedActionName || 'Generated image');
        next.resultWidth = Number(payload.result.width || 0) || undefined;
        next.resultHeight = Number(payload.result.height || 0) || undefined;
        next.resultDownloadState = 'pending';
        delete next.resultDownloadedAt;
      }
      return next;
    });
    return { ...result, applied };
  }

  function completeGenerationNode(payload = {}) {
    const taskId = String(payload.taskId || '').trim();
    let applied = false;
    const result = updateGenerationNode(payload.canvasId, payload.nodeId, (data) => {
      const currentTaskId = generationNodeTaskId(data);
      // Only the task currently anchored to this node may commit a result.
      if (taskId && currentTaskId !== taskId) return data;
      applied = true;
      const next = { ...data };
      if (taskId) next.latestGenerationTaskId = taskId;
      if (payload.status === 'succeeded' && payload.result?.localUrl) {
        next.generatedImages = Array.isArray(payload.result.results)
          ? payload.result.results.map((result) => ({
              url: String(result?.url || ''),
              localUrl: String(result?.localUrl || ''),
              thumbUrl: String(result?.thumbUrl || ''),
              fileName: String(result?.fileName || ''),
              width: Number(result?.width || 0) || undefined,
              height: Number(result?.height || 0) || undefined,
              downloadState: 'pending',
            })).filter((result) => result.localUrl || result.url)
          : [{
              url: String(payload.result.url || ''),
              localUrl: String(payload.result.localUrl || ''),
              thumbUrl: String(payload.result.thumbUrl || ''),
              fileName: String(payload.result.fileName || ''),
              width: Number(payload.result.width || 0) || undefined,
              height: Number(payload.result.height || 0) || undefined,
              downloadState: 'pending',
            }];
        next.multiImageExpanded = false;
        delete next.multiImageCollapsedSize;
        delete next.imageUrl;
        delete next.thumbUrl;
        next.label = String(payload.result.fileName || next.label || 'Generated image');
        delete next.outputDownloadState;
        delete next.outputDownloadedAt;
      }
      return next;
    });
    return { ...result, applied };
  }

  function findMissingGenerationTargets(heads = []) {
    const canvases = new Map();
    return (Array.isArray(heads) ? heads : []).filter((head) => {
      const canvasId = String(head?.canvasId || '').trim();
      if (!canvases.has(canvasId)) canvases.set(canvasId, readCanvas(canvasId));
      const canvas = canvases.get(canvasId);
      if (!canvas) return true;
      const target = head?.target && typeof head.target === 'object' ? head.target : {};
      const node = canvas.nodes.find((item) => String(item?.id || '') === String(target.nodeId || '').trim());
      if (!node) return true;
      if (target.type !== 'actionFissionRow' && target.kind !== 'actionFissionRow') return false;
      const rows = Array.isArray(node.data?.actionFission?.rows) ? node.data.actionFission.rows : [];
      return !rows.some((row) => String(row?.id || '') === String(target.rowId || '').trim());
    });
  }

  function updateCanvasMeta(canvasId, patch = {}) {
    const existing = readCanvas(canvasId);
    if (!existing) throw new Error('Canvas not found.');
    const result = writeCanvas({
      ...existing,
      title: patch?.title !== undefined ? String(patch.title || existing.title || 'Untitled canvas').slice(0, 80) : existing.title,
      icon: patch?.icon !== undefined ? String(patch.icon || 'layers').slice(0, 32) : existing.icon,
      projectId: patch?.projectId !== undefined ? normalizeProjectId(patch.projectId) || listProjects()[0]?.id || DEFAULT_PROJECT_ID : existing.projectId,
      color: patch?.color !== undefined ? String(patch.color || '') : existing.color,
      pinned: patch?.pinned !== undefined ? Boolean(patch.pinned) : existing.pinned,
      updatedAt: nowMs(),
      revision: existing.revision + 1,
    });
    return { ok: true, canvas: result.canvas, record: canvasRecord(result.canvas), filePath: result.filePath };
  }

  function createProject(payload = {}) {
    const timestamp = nowMs();
    const sortOrder = Number.isFinite(Number(payload?.sortOrder))
      ? Number(payload.sortOrder)
      : Math.min(0, ...listProjects().map((project) => Number(project.sortOrder || 0))) - 1;
    const project = normalizeProjectRecord({
      id: newProjectId(),
      title: payload?.title,
      color: payload?.color,
      sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const saved = updateIndexProject(project);
    return { ok: true, project: saved };
  }

  function updateProject(projectId, patch = {}) {
    const safeId = normalizeProjectId(projectId);
    const payload = readIndexPayload();
    const existing = payload.projects.find((project) => project.id === safeId);
    if (!existing) throw new Error('Canvas project not found.');
    const project = normalizeProjectRecord({
      ...existing,
      title: patch?.title !== undefined ? patch.title : existing.title,
      color: patch?.color !== undefined ? patch.color : existing.color,
      sortOrder: patch?.sortOrder !== undefined ? Number(patch.sortOrder || 0) : existing.sortOrder,
      updatedAt: nowMs(),
    });
    const nextProjects = payload.projects.map((item) => (item.id === safeId ? project : item));
    writeIndexPayload({ ...payload, projects: nextProjects });
    return { ok: true, project };
  }

  function deleteProject(projectId) {
    const safeId = normalizeProjectId(projectId);
    const payload = readIndexPayload();
    if (payload.projects.length <= 1) {
      return { ok: true, deletedCanvasIds: [] };
    }
    const deletedCanvasIds = payload.canvases.filter((record) => record.projectId === safeId).map((record) => record.id);
    for (const canvasId of deletedCanvasIds) {
      const filePath = canvasPath(canvasId);
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    const nextCanvases = payload.canvases.filter((record) => record.projectId !== safeId);
    const nextProjects = ensureDefaultProject(payload.projects.filter((project) => project.id !== safeId));
    writeIndexPayload({ ...payload, canvases: nextCanvases, projects: nextProjects });
    return { ok: true, deletedCanvasIds };
  }

  function moveCanvasToProject(canvasId, projectId) {
    return updateCanvasMeta(canvasId, { projectId });
  }

  function deleteCanvas(canvasId) {
    const filePath = canvasPath(canvasId);
    if (!filePath || !fs.existsSync(filePath)) return { ok: true };
    fs.unlinkSync(filePath);
    removeIndexCanvas(sanitizeCanvasId(canvasId));
    return { ok: true, filePath };
  }

  migrateStoredCanvasDocuments();

  return {
    canvasPath,
    createCanvas,
    createProject,
    deleteCanvas,
    deleteProject,
    findMissingGenerationTargets,
    listCanvases,
    listProjects,
    migrateStoredCanvasDocuments,
    moveCanvasToProject,
    readCanvas,
    saveCanvas,
    setGenerationTaskAnchor,
    setActionFissionRowTaskAnchor,
    completeActionFissionRow,
    completeGenerationNode,
    updateCanvasMeta,
    updateProject,
    writeCanvas,
  };
}

module.exports = {
  CURRENT_CANVAS_SCHEMA_VERSION,
  canvasRecord,
  createCanvasStore,
  newCanvasId,
  newProjectId,
  normalizeCanvasDocument,
  normalizeProjectRecord,
  nowMs,
  sanitizeCanvasId,
};
