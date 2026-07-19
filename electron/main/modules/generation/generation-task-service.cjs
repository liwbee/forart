const {
  EXECUTOR_KINDS,
  createGenerationTaskDto,
  normalizeExecutorKind,
} = require('./generation-task-types.cjs');

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled', 'interrupted', 'superseded']);

function safeString(value) {
  return String(value || '').trim();
}

function newTaskId(executorKind) {
  const prefix = executorKind === EXECUTOR_KINDS.LIBTV ? 'libtv' : 'gen';
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTarget(input = {}, nodeId = '') {
  const type = input?.type === 'actionFissionRow' || input?.kind === 'actionFissionRow'
    ? 'actionFissionRow'
    : 'imageGenerator';
  const normalizedNodeId = safeString(input?.nodeId || nodeId);
  const rowId = safeString(input?.rowId);
  return type === 'actionFissionRow'
    ? { type, nodeId: normalizedNodeId, rowId }
    : { type, nodeId: normalizedNodeId };
}

function targetKey(target = {}) {
  const normalized = normalizeTarget(target);
  return normalized.type === 'actionFissionRow'
    ? `${normalized.type}:${normalized.nodeId}:${normalized.rowId}`
    : `${normalized.type}:${normalized.nodeId}`;
}

function normalizeResult(input) {
  if (!input || typeof input !== 'object') return undefined;
  const normalizeImage = (image = {}) => ({
    url: safeString(image.url),
    localUrl: safeString(image.localUrl),
    thumbUrl: safeString(image.thumbUrl),
    fileName: safeString(image.fileName),
    width: Number.isFinite(Number(image.width)) ? Number(image.width) : undefined,
    height: Number.isFinite(Number(image.height)) ? Number(image.height) : undefined,
  });
  return {
    ...normalizeImage(input),
    results: Array.isArray(input.results) ? input.results.map(normalizeImage).filter(Boolean) : undefined,
  };
}

function normalizeApiTask(input = {}, fallback = {}) {
  const now = Date.now();
  const statusValue = safeString(input.status || fallback.status || 'queued');
  const status = ['queued', 'submitting', 'running', 'result_processing', 'succeeded', 'failed', 'canceled', 'interrupted', 'superseded'].includes(statusValue)
    ? statusValue
    : 'queued';
  const startedAt = Number(input.startedAt || fallback.startedAt || now);
  const interruptReason = safeString(input.interruptReason || fallback.interruptReason);
  const result = input.result && typeof input.result === 'object' ? input.result : fallback.result;
  return {
    id: safeString(input.id || fallback.id || newTaskId(EXECUTOR_KINDS.API)),
    canvasId: safeString(input.canvasId || fallback.canvasId),
    target: normalizeTarget(input.target || fallback.target),
    kind: safeString(input.kind || fallback.kind || 'image') || 'image',
    providerId: safeString(input.providerId || fallback.providerId),
    providerName: safeString(input.providerName || input.provider?.name || fallback.providerName),
    model: safeString(input.model || fallback.model),
    upstreamTaskId: safeString(input.upstreamTaskId || fallback.upstreamTaskId),
    status,
    startedAt,
    runningAt: Number(input.runningAt || fallback.runningAt || (status === 'running' ? now : 0)) || undefined,
    updatedAt: Number(input.updatedAt || fallback.updatedAt || now),
    completedAt: Number(input.completedAt || fallback.completedAt || 0) || undefined,
    durationMs: Number(input.durationMs || fallback.durationMs || 0) || undefined,
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
    interruptReason: ['user_stop', 'app_restart', 'provider_lost', 'superseded'].includes(interruptReason) ? interruptReason : '',
    result: normalizeResult(result),
  };
}

function normalizeLibtvTask(input = {}, fallback = {}) {
  const now = Date.now();
  const statusValue = safeString(input.status || fallback.status || 'preparing');
  const status = ['queued', 'preparing', 'uploading', 'running', 'result_processing', 'succeeded', 'failed', 'canceled', 'interrupted', 'superseded'].includes(statusValue)
    ? statusValue
    : 'preparing';
  const startedAt = Number(input.startedAt || fallback.startedAt || now);
  const target = normalizeTarget(
    input.target && typeof input.target === 'object' ? input.target : fallback.target,
    input.nodeId || fallback.nodeId,
  );
  return {
    id: safeString(input.id || fallback.id || newTaskId(EXECUTOR_KINDS.LIBTV)),
    canvasId: safeString(input.canvasId || fallback.canvasId),
    target,
    queueKey: safeString(input.queueKey || fallback.queueKey),
    status,
    startedAt,
    runningAt: Number(input.runningAt || fallback.runningAt || (status === 'running' ? now : 0)) || undefined,
    updatedAt: Number(input.updatedAt || fallback.updatedAt || now),
    completedAt: Number(input.completedAt || fallback.completedAt || 0) || undefined,
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
      : Array.isArray(fallback.referenceImages) ? fallback.referenceImages.map(String).filter(Boolean) : [],
    workspaceId: safeString(input.workspaceId || fallback.workspaceId),
    workspaceName: safeString(input.workspaceName || fallback.workspaceName),
    projectUuid: safeString(input.projectUuid || fallback.projectUuid),
    projectName: safeString(input.projectName || fallback.projectName),
    remoteNodeId: safeString(input.remoteNodeId || fallback.remoteNodeId),
    remoteReferenceNodeIds: Array.isArray(input.remoteReferenceNodeIds)
      ? input.remoteReferenceNodeIds.map(String).filter(Boolean)
      : Array.isArray(fallback.remoteReferenceNodeIds) ? fallback.remoteReferenceNodeIds.map(String).filter(Boolean) : [],
    result: input.result && typeof input.result === 'object' ? { ...input.result } : fallback.result,
  };
}

function normalizeTask(executorKind, input, fallback) {
  return executorKind === EXECUTOR_KINDS.LIBTV
    ? normalizeLibtvTask(input, fallback)
    : normalizeApiTask(input, fallback);
}

function withTerminalTiming(task) {
  if (!TERMINAL_STATUSES.has(task.status)) return task;
  const completedAt = Number(task.completedAt || 0) || Date.now();
  return {
    ...task,
    completedAt,
    durationMs: Number(task.durationMs || 0) || Math.max(0, completedAt - Number(task.startedAt || completedAt)),
  };
}

function createGenerationTaskService({ repository } = {}) {
  if (!repository) throw new Error('Generation task repository is required.');

  const tasks = new Map();
  const executors = new Map();
  const listeners = new Set();
  let recoveryPromise = null;

  for (const record of repository.listTaskRecords?.() || []) {
    const kind = normalizeExecutorKind(record.executorKind);
    const task = normalizeTask(kind, record.task, record.task);
    tasks.set(task.id, { executorKind: kind, task });
  }

  function emitTask(taskId) {
    const record = repository.getTask(taskId);
    if (!record) return;
    const dto = createGenerationTaskDto(record);
    for (const listener of listeners) listener(dto);
  }

  function executionRecord(taskId) {
    return tasks.get(safeString(taskId)) || null;
  }

  function persistTask(executorKind, task, setAsLatest = false) {
    repository.saveTask(task, { executorKind, setAsLatest });
    tasks.set(task.id, { executorKind, task });
    return task;
  }

  function listExecutionTasks(executorKind) {
    const kind = normalizeExecutorKind(executorKind);
    return [...tasks.values()].filter((record) => record.executorKind === kind).map((record) => record.task);
  }

  function activeTaskIdsForTarget(executorKind, canvasId, target) {
    const safeCanvasId = safeString(canvasId);
    const safeTargetKey = targetKey(target);
    return listExecutionTasks(executorKind)
      .filter((task) => task.canvasId === safeCanvasId && targetKey(task.target) === safeTargetKey && !TERMINAL_STATUSES.has(task.status))
      .map((task) => task.id);
  }

  function updateExecutionTask(executorKind, taskId, patch = {}) {
    const kind = normalizeExecutorKind(executorKind);
    const current = executionRecord(taskId);
    if (!current || current.executorKind !== kind) throw new Error('Generation task not found.');
    const task = withTerminalTiming(normalizeTask(kind, {
      ...current.task,
      ...patch,
      id: current.task.id,
      updatedAt: Date.now(),
    }, current.task));
    persistTask(kind, task);
    emitTask(task.id);
    return task;
  }

  function createExecutionTask(executorKind, payload = {}) {
    const kind = normalizeExecutorKind(executorKind);
    const replacedTaskIds = kind === EXECUTOR_KINDS.API
      ? activeTaskIdsForTarget(kind, payload.canvasId, payload.target)
      : [];
    for (const taskId of replacedTaskIds) {
      updateExecutionTask(kind, taskId, {
        status: 'superseded',
        error: 'Superseded by a newer task.',
        interruptReason: 'superseded',
      });
    }
    const defaultStatus = kind === EXECUTOR_KINDS.LIBTV ? 'preparing' : 'queued';
    const task = normalizeTask(kind, {
      ...payload,
      id: payload.id || newTaskId(kind),
      status: payload.status || defaultStatus,
      updatedAt: Date.now(),
    }, {});
    persistTask(kind, task, true);
    emitTask(task.id);
    return task;
  }

  function stopExecutionTask(executorKind, taskId) {
    const current = executionRecord(taskId);
    if (!current || TERMINAL_STATUSES.has(current.task.status)) return current?.task || null;
    return updateExecutionTask(executorKind, taskId, current.executorKind === EXECUTOR_KINDS.LIBTV
      ? { status: 'interrupted', message: '', messageCode: '', messageParams: null, error: '' }
      : { status: 'interrupted', error: '', interruptReason: 'user_stop' });
  }

  function createStoreAdapter(executorKind) {
    const kind = normalizeExecutorKind(executorKind);
    return {
      executorKind: kind,
      activeTaskIdsForTarget: (canvasId, target) => activeTaskIdsForTarget(kind, canvasId, target),
      createTask: (payload) => createExecutionTask(kind, payload),
      getTask: (taskId) => {
        const record = executionRecord(taskId);
        return record?.executorKind === kind ? record.task : null;
      },
      listTasks: () => listExecutionTasks(kind),
      stopTask: (taskId) => stopExecutionTask(kind, taskId),
      updateTask: (taskId, patch) => updateExecutionTask(kind, taskId, patch),
    };
  }

  function registerExecutor(executorKind, executor) {
    const kind = normalizeExecutorKind(executorKind);
    if (!executor) throw new Error(`Generation executor is required for ${kind}.`);
    executors.set(kind, executor);
  }

  function getTaskRecord(taskId) {
    return repository.getTask(safeString(taskId));
  }

  function getTask(taskId) {
    const record = getTaskRecord(taskId);
    return record ? createGenerationTaskDto(record) : null;
  }

  function listTasksForCanvas(canvasId) {
    return repository.listTaskRecords({ canvasId: safeString(canvasId) }).map(createGenerationTaskDto);
  }

  function listRecentTasks(limit = 100) {
    const safeLimit = Math.min(500, Math.max(1, Math.round(Number(limit) || 100)));
    return [...tasks.values()]
      .sort((left, right) => Number(right.task.updatedAt || 0) - Number(left.task.updatedAt || 0))
      .slice(0, safeLimit)
      .map(({ executorKind, task }) => createGenerationTaskDto({ executorKind, task }));
  }

  function removeTasks(taskIds = []) {
    let removedCount = 0;
    for (const taskId of Array.isArray(taskIds) ? taskIds : []) {
      const record = executionRecord(taskId);
      if (!record || !TERMINAL_STATUSES.has(record.task.status)) continue;
      removedCount += tasks.delete(safeString(taskId)) ? 1 : 0;
    }
    return removedCount;
  }

  async function startTask(executorKind, payload = {}) {
    const kind = normalizeExecutorKind(executorKind);
    const executor = executors.get(kind);
    if (!executor?.startTask) throw new Error(`Generation executor cannot start tasks for ${kind}.`);
    return executor.startTask(payload);
  }

  async function startTasks(executorKind, payloads = []) {
    const kind = normalizeExecutorKind(executorKind);
    const executor = executors.get(kind);
    if (executor?.startTasks) return executor.startTasks(payloads);
    return Promise.all((Array.isArray(payloads) ? payloads : []).map((payload) => startTask(kind, payload)));
  }

  function stopTask(taskId) {
    const record = executionRecord(taskId);
    if (!record) return null;
    const executor = executors.get(record.executorKind);
    if (executor?.stopTask) return executor.stopTask(taskId);
    return stopExecutionTask(record.executorKind, taskId);
  }

  async function recoverActiveTasks(contextByExecutor = {}) {
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = (async () => {
      const results = {};
      for (const kind of [EXECUTOR_KINDS.API, EXECUTOR_KINDS.LIBTV]) {
        const executor = executors.get(kind);
        results[kind] = executor?.recoverPersistedTasks
          ? await executor.recoverPersistedTasks(contextByExecutor[kind] || {})
          : { ok: true, tasks: [], errors: [] };
      }
      return { ok: true, executors: results };
    })().finally(() => {
      recoveryPromise = null;
    });
    return recoveryPromise;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    createStoreAdapter,
    getTask,
    listRecentTasks,
    listTasksForCanvas,
    removeTasks,
    recoverActiveTasks,
    registerExecutor,
    startTask,
    startTasks,
    stopTask,
    subscribe,
  };
}

module.exports = { createGenerationTaskService, targetKey };
