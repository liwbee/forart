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

function canvasRecord(canvas) {
  const hasLibtvNodes = Array.isArray(canvas.nodes) && canvas.nodes.some((node) => ['libtvImage', 'libtvPrompt', 'libtvUpload'].includes(node?.type) || node?.libtvProjectId);
  const canvasType = canvas.canvasType === 'forart-libtv' || canvas.source === 'libtv' ? 'forart-libtv' : 'forart';
  return {
    id: canvas.id,
    title: String(canvas.title || 'Untitled canvas'),
    icon: hasLibtvNodes ? 'libtv' : String(canvas.icon || 'layers'),
    canvasType,
    source: canvasType === 'forart-libtv' ? 'libtv' : String(canvas.source || 'forart'),
    libtvProjectId: String(canvas.libtvProjectId || ''),
    libtvProjectName: String(canvas.libtvProjectName || ''),
    color: String(canvas.color || ''),
    pinned: Boolean(canvas.pinned),
    createdAt: Number(canvas.createdAt || 0),
    updatedAt: Number(canvas.updatedAt || 0),
    nodeCount: Array.isArray(canvas.nodes) ? canvas.nodes.length : 0,
  };
}

function normalizeCanvasProject(input, fallback = {}) {
  const timestamp = nowMs();
  const viewport = input?.viewport && typeof input.viewport === 'object' ? input.viewport : {};
  return {
    id: sanitizeCanvasId(input?.id || fallback.id || newCanvasId()),
    title: String(input?.title || fallback.title || 'Untitled canvas').slice(0, 80),
    icon: String(input?.icon || fallback.icon || 'layers').slice(0, 32),
    canvasType: input?.canvasType === 'forart-libtv' || fallback.canvasType === 'forart-libtv' || input?.source === 'libtv' ? 'forart-libtv' : 'forart',
    source: input?.source === 'libtv' || fallback.source === 'libtv' || input?.canvasType === 'forart-libtv' ? 'libtv' : 'forart',
    libtvProjectId: String(input?.libtvProjectId || fallback.libtvProjectId || ''),
    libtvProjectName: String(input?.libtvProjectName || fallback.libtvProjectName || ''),
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

  function projectPath(canvasId) {
    const safeId = sanitizeCanvasId(canvasId);
    if (!safeId) return '';
    return path.join(jsonRoot(), safeId + '.json');
  }

  function readProject(canvasId) {
    const filePath = projectPath(canvasId);
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
      return normalizeCanvasProject(JSON.parse(fs.readFileSync(filePath, 'utf8')), { id: canvasId });
    } catch {
      return null;
    }
  }

  function writeProject(canvas) {
    const normalized = normalizeCanvasProject(canvas);
    const filePath = projectPath(normalized.id);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
    return { canvas: normalized, filePath };
  }

  function listProjects() {
    const records = [];
    for (const fileName of fs.readdirSync(jsonRoot())) {
      if (!fileName.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(jsonRoot(), fileName), 'utf8'));
        const canvas = normalizeCanvasProject(parsed, { id: path.basename(fileName, '.json') });
        if (!canvas.id) continue;
        records.push(canvasRecord(canvas));
      } catch {
        // Skip malformed project files so one bad JSON does not hide the rest.
      }
    }
    return records.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  }

  function createProject(payload = {}) {
    const timestamp = nowMs();
    const result = writeProject({
      id: newCanvasId(),
      title: String(payload?.title || 'Untitled canvas').trim() || 'Untitled canvas',
      icon: payload?.icon || 'layers',
      canvasType: payload?.canvasType === 'forart-libtv' || payload?.source === 'libtv' ? 'forart-libtv' : 'forart',
      source: payload?.source === 'libtv' || payload?.canvasType === 'forart-libtv' ? 'libtv' : 'forart',
      libtvProjectId: String(payload?.libtvProjectId || ''),
      libtvProjectName: String(payload?.libtvProjectName || ''),
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

  function saveProject(canvasId, payload = {}) {
    const existing = readProject(canvasId);
    if (!existing) throw new Error('Canvas project not found.');
    const result = writeProject({
      ...existing,
      ...(payload || {}),
      id: existing.id,
      createdAt: existing.createdAt,
      title: String(payload?.title || existing.title || 'Untitled canvas').slice(0, 80),
      icon: String(payload?.icon || existing.icon || 'layers').slice(0, 32),
      canvasType: existing.canvasType,
      source: existing.source,
      libtvProjectId: existing.libtvProjectId,
      libtvProjectName: existing.libtvProjectName,
      updatedAt: nowMs(),
    });
    return { ok: true, canvas: result.canvas, record: canvasRecord(result.canvas), filePath: result.filePath };
  }

  function updateMeta(canvasId, patch = {}) {
    const existing = readProject(canvasId);
    if (!existing) throw new Error('Canvas project not found.');
    const result = writeProject({
      ...existing,
      title: patch?.title !== undefined ? String(patch.title || existing.title || 'Untitled canvas').slice(0, 80) : existing.title,
      icon: patch?.icon !== undefined ? String(patch.icon || 'layers').slice(0, 32) : existing.icon,
      color: patch?.color !== undefined ? String(patch.color || '') : existing.color,
      pinned: patch?.pinned !== undefined ? Boolean(patch.pinned) : existing.pinned,
      updatedAt: nowMs(),
    });
    return { ok: true, canvas: result.canvas, record: canvasRecord(result.canvas), filePath: result.filePath };
  }

  function deleteProject(canvasId) {
    const filePath = projectPath(canvasId);
    if (!filePath || !fs.existsSync(filePath)) return { ok: true };
    fs.unlinkSync(filePath);
    return { ok: true, filePath };
  }

  return {
    createProject,
    deleteProject,
    listProjects,
    projectPath,
    readProject,
    saveProject,
    updateMeta,
    writeProject,
  };
}

module.exports = { canvasRecord, createCanvasStore, newCanvasId, normalizeCanvasProject, nowMs, sanitizeCanvasId };
