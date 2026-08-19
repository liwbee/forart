const {
  EXECUTOR_KINDS,
  createGenerationTaskDto,
  normalizeExecutorKind,
} = require('./generation-task-types.cjs');
const { isDeepStrictEqual } = require('node:util');
const {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  normalizeTarget: normalizeDomainTarget,
  safeString,
  targetIdentityKey,
} = require('./generation-task-domain.cjs');

const TASK_CENTER_FILTERS = new Set(['all', 'active', 'succeeded', 'exceptional']);

function newTaskId(executorKind) {
  const prefix = executorKind === EXECUTOR_KINDS.LIBTV ? 'libtv' : 'gen';
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTarget(input = {}, nodeId = '') {
  const target = normalizeDomainTarget(input, nodeId);
  return target.kind === 'actionFissionRow'
    ? { type: target.kind, nodeId: target.nodeId, rowId: target.rowId }
    : { type: target.kind, nodeId: target.nodeId };
}

function targetKey(target = {}) {
  return targetIdentityKey(target);
}

function targetScopeKey(payload = {}) {
  const canvasId = safeString(payload?.canvasId);
  const target = normalizeTarget(payload?.target);
  if (!canvasId || !target.nodeId) return '';
  return `${canvasId}:${targetKey(target)}`;
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
    providerId: safeString(input.providerId || input.provider?.id || fallback.providerId),
    providerName: safeString(input.providerName || input.provider?.name || fallback.providerName),
    model: safeString(input.model || fallback.model),
    upstreamTaskId: safeString(input.upstreamTaskId || fallback.upstreamTaskId),
    status,
    startedAt,
    runningAt: Number(input.runningAt || fallback.runningAt || (status === 'running' ? now : 0)) || undefined,
    remoteExecutionStartedAt: Number(input.remoteExecutionStartedAt || fallback.remoteExecutionStartedAt || 0) || undefined,
    updatedAt: Number(input.updatedAt || fallback.updatedAt || now),
    completedAt: Number(input.completedAt || fallback.completedAt || 0) || undefined,
    durationMs: Number(input.durationMs || fallback.durationMs || 0) || undefined,
    prompt: input.prompt !== undefined ? String(input.prompt || '') : fallback.prompt,
    referenceImages: Array.isArray(input.referenceImages)
      ? input.referenceImages.map(String).filter(Boolean)
      : Array.isArray(fallback.referenceImages) ? fallback.referenceImages.map(String).filter(Boolean) : [],
    resolution: safeString(input.resolution || fallback.resolution),
    aspectRatio: safeString(input.aspectRatio || fallback.aspectRatio),
    customSize: safeString(input.customSize || fallback.customSize),
    quality: safeString(input.quality || fallback.quality),
    imageCount: Math.max(1, Math.round(Number(input.imageCount || fallback.imageCount || 1))),
    negativePrompt: input.negativePrompt !== undefined ? String(input.negativePrompt || '') : fallback.negativePrompt,
    promptExtend: input.promptExtend !== undefined ? Boolean(input.promptExtend) : Boolean(fallback.promptExtend),
    promptExtendMode: safeString(input.promptExtendMode || fallback.promptExtendMode),
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
    remoteExecutionStartedAt: Number(input.remoteExecutionStartedAt || fallback.remoteExecutionStartedAt || 0) || undefined,
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
  const targetStartQueues = new Map();
  let recoveryPromise = null;

  const persistedActiveRecords = repository.listActiveTaskRecords();
  for (const record of persistedActiveRecords) {
    const kind = normalizeExecutorKind(record.executorKind);
    const task = normalizeTask(kind, record.task, record.task);
    if (!ACTIVE_STATUSES.has(task.status)) continue;
    tasks.set(task.id, { executorKind: kind, task });
  }

  function emitTask(taskId, savedRecord) {
    const record = savedRecord || repository.getTask(taskId);
    if (!record) return;
    const dto = createGenerationTaskDto(record);
    for (const listener of listeners) listener(dto);
  }

  function executionRecord(taskId) {
    return tasks.get(safeString(taskId)) || null;
  }

  function persistTask(executorKind, task, setAsLatest = false) {
    const savedRecord = repository.saveTask(task, { executorKind, setAsLatest });
    if (ACTIVE_STATUSES.has(task.status)) tasks.set(task.id, { executorKind, task });
    else tasks.delete(task.id);
    return savedRecord;
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
    const candidate = normalizeTask(kind, {
      ...current.task,
      ...patch,
      id: current.task.id,
      updatedAt: current.task.updatedAt,
    }, current.task);
    if (isDeepStrictEqual(candidate, current.task)) return current.task;
    const task = withTerminalTiming({ ...candidate, updatedAt: Date.now() });
    const savedRecord = persistTask(kind, task);
    emitTask(task.id, savedRecord);
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
    const savedRecord = persistTask(kind, task, true);
    emitTask(task.id, savedRecord);
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
        if (record?.executorKind === kind) return record.task;
        const persisted = repository.getTask(safeString(taskId));
        return persisted?.executorKind === kind ? persisted.task : null;
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

  function getManyTasks(taskIds = []) {
    return repository.getTasks(taskIds).map(createGenerationTaskDto);
  }

  function listLatestTasksForCanvas(canvasId) {
    const safeCanvasId = safeString(canvasId);
    return repository.listLatestTaskRecordsForCanvas(safeCanvasId).map(createGenerationTaskDto);
  }

  function listActiveTasksForCanvas(canvasId) {
    const safeCanvasId = safeString(canvasId);
    return repository.listActiveTaskRecords({ canvasId: safeCanvasId }).map(createGenerationTaskDto);
  }

  function listActiveTaskRefsForCanvas(canvasId) {
    const safeCanvasId = safeString(canvasId);
    return repository.listActiveTaskRefsForCanvas(safeCanvasId);
  }

  function listTargetHeadsForCanvas(canvasId) {
    return repository.listTargetHeadsForCanvas(safeString(canvasId));
  }

  function listTaskCenterPage(payload = {}) {
    const limit = Math.min(500, Math.max(1, Math.round(Number(payload.limit) || 30)));
    const offset = Math.max(0, Math.round(Number(payload.offset) || 0));
    const requestedFilter = safeString(payload.filter);
    const filter = TASK_CENTER_FILTERS.has(requestedFilter) ? requestedFilter : 'all';
    const repositoryPage = repository.listTaskPage({ limit, offset, filter });
    return {
      tasks: repositoryPage.records.map(createGenerationTaskDto),
      total: repositoryPage.total,
      counts: repositoryPage.counts,
    };
  }

  function removeTargetHeadsForCanvas(canvasId) {
    return repository.removeTargetHeadsForCanvas(safeString(canvasId));
  }

  function removeTargetHeads(targetKeys = []) {
    return repository.removeTargetHeads(targetKeys);
  }

  async function runInTargetStartQueue(payloads, work) {
    const keys = [...new Set((Array.isArray(payloads) ? payloads : [payloads])
      .map(targetScopeKey)
      .filter(Boolean))];
    const preceding = keys.map((key) => targetStartQueues.get(key)).filter(Boolean);
    const operation = Promise.allSettled(preceding).then(work);
    for (const key of keys) targetStartQueues.set(key, operation);
    try {
      return await operation;
    } finally {
      for (const key of keys) {
        if (targetStartQueues.get(key) === operation) targetStartQueues.delete(key);
      }
    }
  }

  async function startTask(executorKind, payload = {}) {
    const kind = normalizeExecutorKind(executorKind);
    const executor = executors.get(kind);
    if (!executor?.startTask) throw new Error(`Generation executor cannot start tasks for ${kind}.`);
    return runInTargetStartQueue([payload], async () => {
      await stopActiveTasksForTargets([payload]);
      return executor.startTask(payload);
    });
  }

  async function startTasks(executorKind, payloads = []) {
    const kind = normalizeExecutorKind(executorKind);
    const executor = executors.get(kind);
    const safePayloads = Array.isArray(payloads) ? payloads : [];
    if (!safePayloads.length) return [];
    if (!executor?.startTasks && !executor?.startTask) {
      throw new Error(`Generation executor cannot start tasks for ${kind}.`);
    }
    return runInTargetStartQueue(safePayloads, async () => {
      await stopActiveTasksForTargets(safePayloads);
      if (executor.startTasks) return executor.startTasks(safePayloads);
      return Promise.all(safePayloads.map((payload) => executor.startTask(payload)));
    });
  }

  function stopTask(taskId) {
    const record = executionRecord(taskId);
    if (!record) return null;
    const executor = executors.get(record.executorKind);
    if (executor?.stopTask) return executor.stopTask(taskId);
    return stopExecutionTask(record.executorKind, taskId);
  }

  async function stopActiveTasksForTargets(payloads = []) {
    const targets = new Set((Array.isArray(payloads) ? payloads : [payloads])
      .map(targetScopeKey)
      .filter(Boolean));
    const taskIds = [...tasks.values()]
      .filter((record) => targets.has(targetScopeKey(record.task)))
      .map((record) => record.task.id);
    if (!taskIds.length) return;
    await Promise.allSettled(taskIds.map((taskId) => Promise.resolve().then(() => stopTask(taskId))));
    // A remote adapter can fail to stop, but the replacement must still own
    // the target locally. Mark any survivor interrupted so its late result is
    // rejected and it is not recovered on the next launch.
    for (const taskId of taskIds) {
      const current = executionRecord(taskId);
      if (current) stopExecutionTask(current.executorKind, taskId);
    }
  }

  async function recoverActiveTasks(contextByExecutor = {}) {
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = (async () => {
      for (const { executorKind, task } of [...tasks.values()]) {
        const latestTaskId = repository.latestTaskIdForTarget(task.canvasId, task.target);
        if (!latestTaskId || latestTaskId === task.id) continue;
        updateExecutionTask(executorKind, task.id, {
          status: 'superseded',
          error: 'Superseded by a newer task.',
          interruptReason: 'superseded',
        });
      }
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
    getManyTasks,
    listActiveTasksForCanvas,
    listActiveTaskRefsForCanvas,
    listTaskCenterPage,
    listLatestTasksForCanvas,
    listTargetHeadsForCanvas,
    removeTargetHeads,
    removeTargetHeadsForCanvas,
    recoverActiveTasks,
    registerExecutor,
    startTask,
    startTasks,
    stopTask,
    subscribe,
  };
}

module.exports = { createGenerationTaskService, targetKey };
