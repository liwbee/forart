const fs = require('fs');
const path = require('path');

function sanitizeCanvasId(canvasId) {
  return String(canvasId || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function nowMs() {
  return Date.now();
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
  const timestamp = nowMs();
  const viewport = input?.viewport && typeof input.viewport === 'object' ? input.viewport : {};
  return {
    id: sanitizeCanvasId(input?.id || fallback.id || newCanvasId()),
    title: String(input?.title || fallback.title || 'Untitled canvas').slice(0, 80),
    icon: String(input?.icon || fallback.icon || 'layers').slice(0, 32),
    canvasType: 'forart',
    projectId: normalizeProjectId(input?.projectId || fallback.projectId),
    color: String(input?.color || fallback.color || ''),
    pinned: Boolean(input?.pinned || fallback.pinned),
    createdAt: Number(input?.createdAt || fallback.createdAt || timestamp),
    updatedAt: Number(input?.updatedAt || fallback.updatedAt || timestamp),
    nodes: Array.isArray(input?.nodes) ? input.nodes : [],
    connections: Array.isArray(input?.connections) ? input.connections : [],
    groups: Array.isArray(input?.groups) ? input.groups : [],
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
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
      return normalizeCanvasDocument(JSON.parse(fs.readFileSync(filePath, 'utf8')), { id: canvasId });
    } catch {
      return null;
    }
  }

  function readIndexPayload() {
    const filePath = indexPath();
    if (!fs.existsSync(filePath)) return { canvases: [], projects: ensureDefaultProject([]), valid: true };
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (payload?.version !== 3) return { canvases: [], projects: [], valid: false };
      const canvases = Array.isArray(payload?.canvases) ? payload.canvases : [];
      const projects = ensureDefaultProject(Array.isArray(payload?.projects) ? payload.projects : []);
      return {
        canvases: canvases.map((record) => normalizeCanvasRecord(record)).filter((record) => record.id),
        projects,
        valid: true,
      };
    } catch {
      return { canvases: [], projects: [], valid: false };
    }
  }

  function writeIndexPayload(inputPayload) {
    const nextPayload = {
      version: 3,
      updatedAt: nowMs(),
      canvases: sortCanvasRecords([...(inputPayload.canvases || [])]),
      projects: sortProjectRecords(ensureDefaultProject(inputPayload.projects || [])),
    };
    fs.writeFileSync(indexPath(), JSON.stringify(nextPayload, null, 2) + '\n', 'utf8');
  }

  function canvasIdsFromDisk() {
    return fs.readdirSync(jsonRoot())
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => sanitizeCanvasId(path.basename(fileName, '.json')))
      .filter(Boolean);
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
    for (const fileName of fs.readdirSync(jsonRoot())) {
      if (!fileName.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(jsonRoot(), fileName), 'utf8'));
        const canvas = normalizeCanvasDocument(parsed, { id: path.basename(fileName, '.json') });
        if (!canvas.id) continue;
        canvases.push({
          ...canvasRecord(canvas),
          projectId: projectById.has(canvas.projectId) ? canvas.projectId : indexPayload.projects[0]?.id || DEFAULT_PROJECT_ID,
        });
      } catch {
        // Skip malformed canvas files so one bad JSON does not hide the rest.
      }
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
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
    updateIndexCanvas(canvasRecord(normalized));
    return { canvas: normalized, filePath };
  }

  function listCanvases() {
    const canvasIds = canvasIdsFromDisk();
    const indexedPayload = readIndexPayload();
    if (!indexedPayload.valid) {
      writeIndexPayload({ canvases: [], projects: [] });
      return [];
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
    const result = writeCanvas({ ...existing, nodes, updatedAt: nowMs() });
    return { ok: true, canvas: result.canvas, record: canvasRecord(result.canvas), filePath: result.filePath };
  }

  function setGenerationRemoteTaskId(canvasId, nodeId, remoteTaskId) {
    const taskId = String(remoteTaskId || '').trim();
    if (!taskId) return { ok: false, reason: 'task_id_required' };
    return updateGenerationNode(canvasId, nodeId, (data) => ({
      ...data,
      generationRemoteTaskId: taskId,
      generationError: '',
    }));
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

  function setActionFissionRowRemoteTaskId(canvasId, nodeId, rowId, remoteTaskId) {
    const taskId = String(remoteTaskId || '').trim();
    if (!taskId) return { ok: false, reason: 'task_id_required' };
    return updateActionFissionRow(canvasId, nodeId, rowId, (row) => ({
      ...row,
      generationRemoteTaskId: taskId,
      error: '',
    }));
  }

  function setActionFissionRowTaskAnchor(canvasId, nodeId, rowId, payload = {}) {
    const taskId = String(payload.taskId || '').trim();
    if (!taskId) return { ok: false, reason: 'task_id_required' };
    return updateActionFissionRow(canvasId, nodeId, rowId, (row) => ({
      ...row,
      generationTaskId: taskId,
      ...(String(payload.remoteTaskId || '').trim()
        ? { generationRemoteTaskId: String(payload.remoteTaskId).trim() }
        : {}),
      error: '',
    }));
  }

  function setActionFissionRowLibtvAnchor(canvasId, nodeId, rowId, payload = {}) {
    const taskId = String(payload.taskId || '').trim();
    if (!taskId) return { ok: false, reason: 'task_id_required' };
    return updateActionFissionRow(canvasId, nodeId, rowId, (row) => ({
      ...row,
      libtvTaskId: taskId,
      ...(String(payload.projectUuid || '').trim() ? { libtvProjectUuid: String(payload.projectUuid).trim() } : {}),
      ...(String(payload.remoteNodeId || '').trim() ? { libtvRemoteNodeId: String(payload.remoteNodeId).trim() } : {}),
      error: '',
    }));
  }

  function completeActionFissionRow(payload = {}) {
    const taskId = String(payload.taskId || '').trim();
    const remoteTaskId = String(payload.remoteTaskId || '').trim();
    return updateActionFissionRow(payload.canvasId, payload.nodeId, payload.rowId, (row) => {
      const anchorField = payload.backend === 'libtv' ? 'libtvTaskId' : 'generationTaskId';
      const currentTaskId = String(row[anchorField] || '').trim();
      const currentRemoteTaskId = String(row.generationRemoteTaskId || '').trim();
      if (taskId && currentTaskId && currentTaskId !== taskId) return row;
      if (remoteTaskId && currentRemoteTaskId !== remoteTaskId) return row;
      const next = { ...row };
      delete next[anchorField];
      if (payload.backend === 'libtv') {
        delete next.libtvProjectUuid;
        delete next.libtvRemoteNodeId;
        delete next.libtvTask;
        next.libtvQueued = false;
        next.libtvRunning = false;
      } else {
        delete next.generationRemoteTaskId;
      }
      delete next.generationTask;
      if (payload.status === 'succeeded' && payload.result?.localUrl) {
        next.resultUrl = String(payload.result.localUrl);
        next.resultFileName = String(payload.result.fileName || next.selectedActionName || 'Generated image');
        next.resultWidth = Number(payload.result.width || 0) || undefined;
        next.resultHeight = Number(payload.result.height || 0) || undefined;
        next.resultDownloadState = 'pending';
        delete next.resultDownloadedAt;
        next.error = '';
      } else if (payload.status === 'failed') {
        next.error = String(payload.error || 'Image generation failed.');
      } else {
        next.error = '';
      }
      return next;
    });
  }

  function completeGenerationNode(payload = {}) {
    const remoteTaskId = String(payload.remoteTaskId || '').trim();
    return updateGenerationNode(payload.canvasId, payload.nodeId, (data) => {
      const currentRemoteTaskId = String(data.generationRemoteTaskId || '').trim();
      if (remoteTaskId && currentRemoteTaskId !== remoteTaskId) return data;
      const next = { ...data };
      delete next.generationRemoteTaskId;
      delete next.generationTask;
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
        next.generationError = '';
      } else if (payload.status === 'failed') {
        next.generationError = String(payload.error || 'Image generation failed.');
      } else {
        next.generationError = '';
      }
      return next;
    });
  }

  function listGenerationTaskAnchors() {
    return listCanvases().flatMap((record) => {
      const canvas = readCanvas(record.id);
      if (!canvas) return [];
      return canvas.nodes.flatMap((node) => {
        const data = node?.data && typeof node.data === 'object' ? node.data : {};
        const remoteTaskId = String(data.generationRemoteTaskId || '').trim();
        const providerId = String(data.imageProviderId || '').trim();
        const model = String(data.imageModel || '').trim();
        const nodeId = String(node.id || '');
        const anchors = remoteTaskId && providerId && model
          ? [{ canvasId: canvas.id, nodeId, target: { type: 'imageGenerator', nodeId }, remoteTaskId, providerId, model }]
          : [];
        const rows = Array.isArray(data.actionFission?.rows) ? data.actionFission.rows : [];
        for (const row of rows) {
          const rowId = String(row?.id || '').trim();
          const rowTaskId = String(row?.generationTaskId || '').trim();
          const rowRemoteTaskId = String(row?.generationRemoteTaskId || '').trim();
          if (!rowId || (!rowTaskId && !rowRemoteTaskId) || !providerId || !model) continue;
          anchors.push({
            canvasId: canvas.id,
            nodeId,
            rowId,
            target: { type: 'actionFissionRow', nodeId, rowId },
            taskId: rowTaskId,
            remoteTaskId: rowRemoteTaskId,
            providerId,
            model,
          });
        }
        return anchors;
      });
    });
  }

  function listLibtvTaskAnchors() {
    return listCanvases().flatMap((record) => {
      const canvas = readCanvas(record.id);
      if (!canvas) return [];
      return canvas.nodes.flatMap((node) => {
        const data = node?.data && typeof node.data === 'object' ? node.data : {};
        const rows = Array.isArray(data.actionFission?.rows) ? data.actionFission.rows : [];
        return rows.flatMap((row) => {
          const taskId = String(row?.libtvTaskId || '').trim();
          const rowId = String(row?.id || '').trim();
          if (!taskId || !rowId) return [];
          return [{
            canvasId: canvas.id,
            nodeId: String(node.id || ''),
            rowId,
            taskId,
            target: { type: 'actionFissionRow', nodeId: String(node.id || ''), rowId },
            projectUuid: String(row?.libtvProjectUuid || '').trim(),
            remoteNodeId: String(row?.libtvRemoteNodeId || '').trim(),
          }];
        });
      });
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

  return {
    canvasPath,
    createCanvas,
    createProject,
    deleteCanvas,
    deleteProject,
    listCanvases,
    listGenerationTaskAnchors,
    listLibtvTaskAnchors,
    listProjects,
    moveCanvasToProject,
    readCanvas,
    saveCanvas,
    setGenerationRemoteTaskId,
    setActionFissionRowRemoteTaskId,
    setActionFissionRowTaskAnchor,
    setActionFissionRowLibtvAnchor,
    completeActionFissionRow,
    completeGenerationNode,
    updateCanvasMeta,
    updateProject,
    writeCanvas,
  };
}

module.exports = {
  canvasRecord,
  createCanvasStore,
  newCanvasId,
  newProjectId,
  normalizeCanvasDocument,
  normalizeProjectRecord,
  nowMs,
  sanitizeCanvasId,
};
