const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'interrupted']);

function safeString(value) {
  return String(value || '').trim();
}

function createTaskId() {
  return `libtv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTarget(input = {}, nodeId = '') {
  const normalizedNodeId = safeString(input?.nodeId || nodeId);
  if (input?.type === 'actionFissionRow') {
    return { type: 'actionFissionRow', nodeId: normalizedNodeId, rowId: safeString(input.rowId) };
  }
  return { type: 'imageGenerator', nodeId: normalizedNodeId };
}

function targetKey(target = {}) {
  const normalized = normalizeTarget(target);
  return normalized.type === 'actionFissionRow'
    ? `${normalized.type}:${normalized.nodeId}:${normalized.rowId}`
    : `${normalized.type}:${normalized.nodeId}`;
}

function normalizeTask(input = {}, fallback = {}) {
  const now = Date.now();
  const status = safeString(input.status || fallback.status || 'preparing');
  const startedAt = Number(input.startedAt || fallback.startedAt || now);
  const normalizedStatus = ['queued', 'preparing', 'uploading', 'running', 'succeeded', 'failed', 'interrupted'].includes(status)
    ? status
    : 'preparing';
  const runningAt = Number(input.runningAt || fallback.runningAt || (normalizedStatus === 'running' ? now : 0)) || undefined;
  const completedAt = Number(input.completedAt || fallback.completedAt || 0) || undefined;
  return {
    id: safeString(input.id || fallback.id || createTaskId()),
    canvasId: safeString(input.canvasId || fallback.canvasId),
    nodeId: safeString(input.nodeId || fallback.nodeId),
    target: normalizeTarget(
      input.target && typeof input.target === 'object' ? input.target : fallback.target,
      input.nodeId || fallback.nodeId,
    ),
    queueKey: safeString(input.queueKey || fallback.queueKey),
    status: normalizedStatus,
    startedAt,
    runningAt,
    updatedAt: Number(input.updatedAt || fallback.updatedAt || now),
    completedAt,
    durationMs: Number(input.durationMs || fallback.durationMs || 0) || undefined,
    message: input.message !== undefined ? String(input.message || '') : fallback.message,
    messageCode: input.messageCode !== undefined ? String(input.messageCode || '') : fallback.messageCode,
    messageParams: input.messageParams !== undefined
      ? input.messageParams && typeof input.messageParams === 'object' ? { ...input.messageParams } : undefined
      : fallback.messageParams && typeof fallback.messageParams === 'object' ? { ...fallback.messageParams } : undefined,
    error: input.error !== undefined ? String(input.error || '') : fallback.error,
    prompt: input.prompt !== undefined ? String(input.prompt || '') : fallback.prompt,
    modelName: safeString(input.modelName || fallback.modelName),
    count: Math.max(1, Math.round(Number(input.count || fallback.count || 1))),
    quality: safeString(input.quality || fallback.quality),
    resolution: safeString(input.resolution || fallback.resolution),
    aspectRatio: safeString(input.aspectRatio || fallback.aspectRatio),
    referenceImages: Array.isArray(input.referenceImages)
      ? input.referenceImages.map(String).filter(Boolean)
      : Array.isArray(fallback.referenceImages) ? fallback.referenceImages : [],
    workspaceId: safeString(input.workspaceId || fallback.workspaceId),
    workspaceName: safeString(input.workspaceName || fallback.workspaceName),
    projectUuid: safeString(input.projectUuid || fallback.projectUuid),
    projectName: safeString(input.projectName || fallback.projectName),
    remoteNodeId: safeString(input.remoteNodeId || fallback.remoteNodeId),
    remoteReferenceNodeIds: Array.isArray(input.remoteReferenceNodeIds)
      ? input.remoteReferenceNodeIds.map(String).filter(Boolean)
      : Array.isArray(fallback.remoteReferenceNodeIds) ? fallback.remoteReferenceNodeIds : [],
    result: input.result && typeof input.result === 'object' ? input.result : fallback.result,
  };
}

function withTerminalTiming(task) {
  if (!TERMINAL_STATUSES.has(task.status)) return task;
  const completedAt = task.completedAt || Date.now();
  return {
    ...task,
    completedAt,
    durationMs: task.durationMs || Math.max(0, completedAt - task.startedAt),
  };
}

function createLibtvGenerationTaskStore() {
  const tasks = new Map();

  function getTask(taskId) {
    return tasks.get(safeString(taskId)) || null;
  }

  function createTask(payload = {}) {
    const task = normalizeTask(payload);
    tasks.set(task.id, task);
    return task;
  }

  function updateTask(taskId, patch = {}) {
    const current = getTask(taskId);
    if (!current) throw new Error('LibTV generation task not found.');
    const task = withTerminalTiming(normalizeTask({ ...current, ...patch, id: current.id, updatedAt: Date.now() }, current));
    tasks.set(task.id, task);
    return task;
  }

  function stopTask(taskId) {
    const current = getTask(taskId);
    if (!current || TERMINAL_STATUSES.has(current.status)) return current;
    return updateTask(taskId, { status: 'interrupted', message: '', error: '' });
  }

  function latestTaskForTarget(canvasId, target) {
    const safeCanvasId = safeString(canvasId);
    const safeTargetKey = targetKey(target);
    return [...tasks.values()]
      .filter((task) => task.canvasId === safeCanvasId && targetKey(task.target) === safeTargetKey)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0] || null;
  }

  return { createTask, getTask, latestTaskForTarget, stopTask, updateTask };
}

module.exports = { createLibtvGenerationTaskStore, targetKey };
