const EXECUTOR_KINDS = Object.freeze({
  API: 'api',
  LIBTV: 'libtv',
});

const TASK_STATUSES = Object.freeze({
  QUEUED: 'queued',
  PREPARING: 'preparing',
  SUBMITTING: 'submitting',
  RUNNING: 'running',
  RESULT_PROCESSING: 'result_processing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
  INTERRUPTED: 'interrupted',
  SUPERSEDED: 'superseded',
});

const TERMINAL_TASK_STATUSES = new Set([
  TASK_STATUSES.SUCCEEDED,
  TASK_STATUSES.FAILED,
  TASK_STATUSES.CANCELED,
  TASK_STATUSES.INTERRUPTED,
  TASK_STATUSES.SUPERSEDED,
]);

function safeString(value) {
  return String(value || '').trim();
}

function normalizeExecutorKind(value) {
  return value === EXECUTOR_KINDS.LIBTV ? EXECUTOR_KINDS.LIBTV : EXECUTOR_KINDS.API;
}

function normalizeTaskStatus(status) {
  const value = safeString(status);
  if (value === 'uploading') return TASK_STATUSES.PREPARING;
  return Object.values(TASK_STATUSES).includes(value) ? value : TASK_STATUSES.QUEUED;
}

function normalizeTaskTarget(task = {}) {
  const source = task.target && typeof task.target === 'object' ? task.target : {};
  const kind = source.kind === 'actionFissionRow' || source.type === 'actionFissionRow'
    ? 'actionFissionRow'
    : 'imageGenerator';
  const target = {
    canvasId: safeString(source.canvasId || task.canvasId),
    kind,
    nodeId: safeString(source.nodeId || task.nodeId),
  };
  const rowId = safeString(source.rowId || task.rowId);
  return kind === 'actionFissionRow' ? { ...target, rowId } : target;
}

function normalizeResultImage(input = {}) {
  const assetUrl = safeString(input.assetUrl || input.localUrl || input.url);
  if (!assetUrl) return null;
  return {
    assetUrl,
    ...(safeString(input.thumbUrl) ? { thumbUrl: safeString(input.thumbUrl) } : {}),
    ...(safeString(input.fileName) ? { fileName: safeString(input.fileName) } : {}),
    ...(Number.isFinite(Number(input.width)) ? { width: Number(input.width) } : {}),
    ...(Number.isFinite(Number(input.height)) ? { height: Number(input.height) } : {}),
  };
}

function normalizeResult(result) {
  if (!result || typeof result !== 'object') return undefined;
  const source = Array.isArray(result.results) && result.results.length ? result.results : [result];
  const images = source.map(normalizeResultImage).filter(Boolean);
  return images.length ? { images } : undefined;
}

function createGenerationTaskDto(record = {}) {
  const task = record.task && typeof record.task === 'object' ? record.task : record;
  const executorKind = normalizeExecutorKind(record.executorKind || task.executorKind);
  const message = safeString(task.message);
  const messageCode = safeString(task.messageCode);
  const errorMessage = safeString(task.errorMessage || task.error);
  return {
    id: safeString(task.id),
    target: normalizeTaskTarget(task),
    executorKind,
    ...(safeString(task.providerId) ? { providerId: safeString(task.providerId) } : {}),
    ...(safeString(task.providerName) ? { providerName: safeString(task.providerName) } : {}),
    ...(safeString(task.model || task.modelName) ? { model: safeString(task.model || task.modelName) } : {}),
    ...(safeString(task.resolution) ? { resolution: safeString(task.resolution) } : {}),
    ...(safeString(task.aspectRatio) ? { aspectRatio: safeString(task.aspectRatio) } : {}),
    ...(safeString(task.quality) ? { quality: safeString(task.quality) } : {}),
    status: normalizeTaskStatus(task.status),
    version: Math.max(0, Number(record.version || task.version || 0)),
    ...(messageCode ? { messageCode } : {}),
    ...(task.messageParams && typeof task.messageParams === 'object' ? { messageParams: { ...task.messageParams } } : {}),
    ...(!messageCode && message ? { remoteMessage: message } : {}),
    ...(safeString(task.errorCode) ? { errorCode: safeString(task.errorCode) } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    startedAt: Number(task.startedAt || task.createdAt || 0),
    ...(Number(task.runningAt || 0) ? { runningAt: Number(task.runningAt) } : {}),
    updatedAt: Number(task.updatedAt || 0),
    ...(Number(task.completedAt || 0) ? { completedAt: Number(task.completedAt) } : {}),
    ...(Number.isFinite(Number(task.durationMs)) && Number(task.durationMs) >= 0
      ? { durationMs: Number(task.durationMs) }
      : {}),
    ...(normalizeResult(task.result) ? { result: normalizeResult(task.result) } : {}),
  };
}

function isTerminalTaskStatus(status) {
  return TERMINAL_TASK_STATUSES.has(normalizeTaskStatus(status));
}

module.exports = {
  EXECUTOR_KINDS,
  TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  createGenerationTaskDto,
  isTerminalTaskStatus,
  normalizeExecutorKind,
  normalizeTaskStatus,
  normalizeTaskTarget,
};
