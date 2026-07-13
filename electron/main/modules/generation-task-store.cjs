const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'interrupted', 'superseded']);
const TIMED_TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'interrupted', 'superseded']);

function nowMs() {
  return Date.now();
}

function newTaskId() {
  return `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeString(value) {
  return String(value || '').trim();
}

function normalizeTarget(input = {}) {
  const type = input?.type === 'actionFissionRow' ? 'actionFissionRow' : 'imageGenerator';
  const nodeId = safeString(input?.nodeId);
  const rowId = safeString(input?.rowId);
  return type === 'actionFissionRow' ? { type, nodeId, rowId } : { type, nodeId };
}

function targetKey(target = {}) {
  const normalized = normalizeTarget(target);
  return normalized.type === 'actionFissionRow'
    ? `${normalized.type}:${normalized.nodeId}:${normalized.rowId}`
    : `${normalized.type}:${normalized.nodeId}`;
}

function normalizeStatus(status) {
  const value = safeString(status);
  if (['queued', 'submitting', 'running', 'succeeded', 'failed', 'interrupted', 'superseded'].includes(value)) {
    return value;
  }
  return 'queued';
}

function normalizeInterruptReason(reason) {
  const value = safeString(reason);
  if (['user_stop', 'app_restart', 'provider_lost', 'superseded'].includes(value)) return value;
  return '';
}

function normalizeResult(input) {
  if (!input || typeof input !== 'object') return undefined;
  return {
    url: safeString(input.url),
    localUrl: safeString(input.localUrl),
    thumbUrl: safeString(input.thumbUrl),
    fileName: safeString(input.fileName),
    width: Number.isFinite(Number(input.width)) ? Number(input.width) : undefined,
    height: Number.isFinite(Number(input.height)) ? Number(input.height) : undefined,
  };
}

function normalizeTask(input = {}, fallback = {}) {
  const timestamp = nowMs();
  const target = normalizeTarget(input.target || fallback.target);
  const result = input.result && typeof input.result === 'object' ? input.result : fallback.result;
  const startedAt = Number(input.startedAt || fallback.startedAt || timestamp);
  const status = normalizeStatus(input.status || fallback.status || 'queued');
  const runningAt = Number(input.runningAt || fallback.runningAt || (status === 'running' ? timestamp : 0)) || undefined;
  const completedAt = Number(input.completedAt || fallback.completedAt || 0) || undefined;
  const durationMs = Number(input.durationMs || fallback.durationMs || 0) || undefined;
  return {
    id: safeString(input.id || fallback.id || newTaskId()),
    canvasId: safeString(input.canvasId || fallback.canvasId),
    target,
    kind: safeString(input.kind || fallback.kind || 'image') || 'image',
    providerId: safeString(input.providerId || fallback.providerId),
    model: safeString(input.model || fallback.model),
    upstreamTaskId: safeString(input.upstreamTaskId || fallback.upstreamTaskId),
    status,
    startedAt,
    runningAt,
    updatedAt: Number(input.updatedAt || fallback.updatedAt || timestamp),
    completedAt,
    durationMs,
    prompt: input.prompt !== undefined ? String(input.prompt || '') : fallback.prompt,
    referenceImages: Array.isArray(input.referenceImages)
      ? input.referenceImages.map(String).filter(Boolean)
      : Array.isArray(fallback.referenceImages) ? fallback.referenceImages.map(String).filter(Boolean) : [],
    resolution: safeString(input.resolution || fallback.resolution),
    aspectRatio: safeString(input.aspectRatio || fallback.aspectRatio),
    quality: safeString(input.quality || fallback.quality),
    imageCount: Math.max(1, Math.round(Number(input.imageCount || fallback.imageCount || 1))),
    message: input.message !== undefined ? String(input.message || '') : fallback.message,
    messageCode: input.messageCode !== undefined ? String(input.messageCode || '') : fallback.messageCode,
    messageParams: input.messageParams !== undefined
      ? input.messageParams && typeof input.messageParams === 'object' ? { ...input.messageParams } : undefined
      : fallback.messageParams && typeof fallback.messageParams === 'object' ? { ...fallback.messageParams } : undefined,
    error: input.error !== undefined ? String(input.error || '') : fallback.error,
    interruptReason: normalizeInterruptReason(input.interruptReason || fallback.interruptReason),
    result: result && typeof result === 'object' ? {
      ...normalizeResult(result),
      results: Array.isArray(result.results) ? result.results.map(normalizeResult).filter(Boolean) : undefined,
    } : undefined,
  };
}

function withTerminalTiming(task, timestamp = nowMs()) {
  if (!TIMED_TERMINAL_STATUSES.has(task.status)) return task;
  const completedAt = Number(task.completedAt || 0) || timestamp;
  const startedAt = Number(task.startedAt || completedAt);
  const durationMs = Number(task.durationMs || 0) || Math.max(0, completedAt - startedAt);
  return { ...task, completedAt, durationMs };
}

function createGenerationTaskStore() {
  const tasks = new Map();

  function getTask(taskId) {
    const id = safeString(taskId);
    return id ? tasks.get(id) || null : null;
  }

  function createTask(payload = {}) {
    const task = normalizeTask({ ...payload, id: payload.id || newTaskId(), status: payload.status || 'queued', updatedAt: nowMs() });
    for (const existing of tasks.values()) {
      if (
        existing.id !== task.id
        && existing.canvasId === task.canvasId
        && targetKey(existing.target) === targetKey(task.target)
        && !TERMINAL_STATUSES.has(existing.status)
      ) {
        tasks.set(existing.id, withTerminalTiming(normalizeTask({
          ...existing,
          status: 'superseded',
          error: 'Superseded by a newer task.',
          interruptReason: 'superseded',
          updatedAt: nowMs(),
        }, existing)));
      }
    }
    tasks.set(task.id, task);
    return task;
  }

  function updateTask(taskId, patch = {}) {
    const id = safeString(taskId);
    const current = getTask(id);
    if (!current) throw new Error('Generation task not found.');
    const updated = withTerminalTiming(normalizeTask({ ...current, ...patch, id, updatedAt: nowMs() }, current));
    tasks.set(id, updated);
    return updated;
  }

  function stopTask(taskId) {
    return updateTask(taskId, { status: 'interrupted', error: '', interruptReason: 'user_stop' });
  }

  function stopTasksMatching(predicate, patch = {}) {
    const stopped = [];
    for (const task of tasks.values()) {
      if (!predicate(task) || TERMINAL_STATUSES.has(task.status)) continue;
      const stoppedTask = withTerminalTiming(normalizeTask({
        ...task,
        ...patch,
        status: patch.status || 'interrupted',
        error: patch.error === undefined ? '' : patch.error,
        interruptReason: patch.interruptReason || 'user_stop',
        updatedAt: nowMs(),
      }, task));
      tasks.set(stoppedTask.id, stoppedTask);
      stopped.push(stoppedTask);
    }
    return { ok: true, tasks: stopped, taskIds: stopped.map((task) => task.id) };
  }

  function activeTaskIdsForTarget(canvasId, target) {
    const safeCanvasId = safeString(canvasId);
    const safeTargetKey = targetKey(target);
    return [...tasks.values()]
      .filter((task) => (
        task.canvasId === safeCanvasId
        && targetKey(task.target) === safeTargetKey
        && !TERMINAL_STATUSES.has(task.status)
      ))
      .map((task) => task.id);
  }

  function latestTaskForTarget(canvasId, target) {
    const safeCanvasId = safeString(canvasId);
    const safeTargetKey = targetKey(target);
    return [...tasks.values()]
      .filter((task) => task.canvasId === safeCanvasId && targetKey(task.target) === safeTargetKey)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0] || null;
  }

  function stopTasksForTarget(canvasId, target) {
    const safeCanvasId = safeString(canvasId);
    const safeTargetKey = targetKey(target);
    return stopTasksMatching((task) => task.canvasId === safeCanvasId && targetKey(task.target) === safeTargetKey);
  }

  function stopTasksForNode(canvasId, nodeId) {
    const safeCanvasId = safeString(canvasId);
    const safeNodeId = safeString(nodeId);
    return stopTasksMatching((task) => task.canvasId === safeCanvasId && task.target.nodeId === safeNodeId);
  }

  function stopTasksForCanvas(canvasId) {
    const safeCanvasId = safeString(canvasId);
    return stopTasksMatching((task) => task.canvasId === safeCanvasId);
  }

  return {
    activeTaskIdsForTarget,
    createTask,
    getTask,
    latestTaskForTarget,
    stopTask,
    stopTasksForCanvas,
    stopTasksForNode,
    stopTasksForTarget,
    updateTask,
  };
}

module.exports = { createGenerationTaskStore, targetKey };
