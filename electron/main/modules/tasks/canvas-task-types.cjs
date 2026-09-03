const TASK_CATEGORIES = Object.freeze({ IMAGE: 'image', VIDEO: 'video' });
const TASK_OPERATIONS = Object.freeze({
  IMAGE_GENERATE: 'image_generate',
  ACTION_FISSION_GENERATE: 'action_fission_generate',
});
const TASK_STATUSES = Object.freeze({
  QUEUED: 'queued', RUNNING: 'running', SUCCEEDED: 'succeeded', FAILED: 'failed', CANCELED: 'canceled', INTERRUPTED: 'interrupted', SUPERSEDED: 'superseded',
});
const ACTIVE_STATUSES = new Set([TASK_STATUSES.QUEUED, TASK_STATUSES.RUNNING]);
const TERMINAL_STATUSES = new Set([TASK_STATUSES.SUCCEEDED, TASK_STATUSES.FAILED, TASK_STATUSES.CANCELED, TASK_STATUSES.INTERRUPTED, TASK_STATUSES.SUPERSEDED]);
const TASK_CATEGORIES_LIST = Object.values(TASK_CATEGORIES);
const TASK_OPERATIONS_LIST = Object.values(TASK_OPERATIONS);

function safeString(value) { return String(value || '').trim(); }
function normalizeCategory(value) { return TASK_CATEGORIES_LIST.includes(value) ? value : TASK_CATEGORIES.IMAGE; }
function normalizeOperation(value) { return TASK_OPERATIONS_LIST.includes(value) ? value : TASK_OPERATIONS.IMAGE_GENERATE; }
function normalizeStatus(value) { return Object.values(TASK_STATUSES).includes(value) ? value : TASK_STATUSES.QUEUED; }
function targetKey(task = {}) {
  const canvasId = safeString(task.canvasId);
  const nodeId = safeString(task.nodeId || task.target?.nodeId);
  const rowId = safeString(task.rowId || task.target?.rowId);
  const operation = normalizeOperation(task.operation);
  return canvasId && nodeId ? `${canvasId}:${nodeId}:${rowId}:${operation}` : '';
}

module.exports = { ACTIVE_STATUSES, TERMINAL_STATUSES, TASK_CATEGORIES, TASK_OPERATIONS, TASK_STATUSES, normalizeCategory, normalizeOperation, normalizeStatus, safeString, targetKey };
