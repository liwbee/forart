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
    source: String(canvas.source || 'forart'),
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
    source: String(input?.source || fallback.source || 'forart'),
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
  return {
    id,
    title: String(input?.title || fallback.title || 'New project').trim().slice(0, 80) || 'New project',
    color: String(input?.color || fallback.color || ''),
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
  const normalizedProjects = (projects || []).map((project) => normalizeProjectRecord(project)).filter((project) => project.id);
  if (normalizedProjects.length) return normalizedProjects;
  return [defaultProjectRecord()];
}

function sortCanvasRecords(canvases) {
  return canvases.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });
}

function sortProjectRecords(projects) {
  return projects.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { numeric: true, sensitivity: 'base' }));
}

function normalizeCanvasDocument(input, fallback = {}) {
  const timestamp = nowMs();
  const viewport = input?.viewport && typeof input.viewport === 'object' ? input.viewport : {};
  return {
    id: sanitizeCanvasId(input?.id || fallback.id || newCanvasId()),
    title: String(input?.title || fallback.title || 'Untitled canvas').slice(0, 80),
    icon: String(input?.icon || fallback.icon || 'layers').slice(0, 32),
    canvasType: 'forart',
    source: String(input?.source || fallback.source || 'forart'),
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
      source: payload?.source || 'forart',
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
      source: existing.source,
      projectId: payload?.projectId !== undefined ? normalizeProjectId(payload.projectId) : existing.projectId,
      updatedAt: nowMs(),
    });
    return { ok: true, canvas: result.canvas, record: canvasRecord(result.canvas), filePath: result.filePath };
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
    const project = normalizeProjectRecord({
      id: newProjectId(),
      title: payload?.title,
      color: payload?.color,
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
    listProjects,
    moveCanvasToProject,
    readCanvas,
    saveCanvas,
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
