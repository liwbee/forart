const ACTIVE_STATUSES = new Set([
  'queued',
  'preparing',
  'uploading',
  'submitting',
  'running',
  'result_processing',
]);

const TERMINAL_STATUSES = new Set([
  'succeeded',
  'failed',
  'canceled',
  'interrupted',
  'superseded',
]);

function safeString(value) {
  return String(value || '').trim();
}

function normalizeTarget(input = {}, nodeId = '') {
  const source = input?.target && typeof input.target === 'object' ? input.target : input;
  const normalizedNodeId = safeString(source?.nodeId || nodeId);
  const kind = source?.type === 'actionFissionRow'
    || source?.kind === 'actionFissionRow'
    ? 'actionFissionRow'
    : source?.type === 'batchImageGeneratorItem' || source?.kind === 'batchImageGeneratorItem'
      ? 'batchImageGeneratorItem'
      : 'imageGenerator';
  const rowId = safeString(source?.rowId);
  return {
    kind,
    nodeId: normalizedNodeId,
    rowId: kind === 'actionFissionRow' ? rowId : '',
    itemId: kind === 'batchImageGeneratorItem' ? safeString(source?.itemId) : '',
  };
}

function publicTarget(input = {}, nodeId = '', canvasId = '') {
  const target = normalizeTarget(input, nodeId);
  return {
    canvasId: safeString(input?.canvasId || canvasId),
    kind: target.kind,
    nodeId: target.nodeId,
    ...(target.kind === 'actionFissionRow' ? { rowId: target.rowId } : {}),
    ...(target.kind === 'batchImageGeneratorItem' ? { itemId: target.itemId } : {}),
  };
}

function targetIdentityKey(input = {}) {
  const target = normalizeTarget(input);
  if (target.kind === 'actionFissionRow') return `${target.kind}:${target.nodeId}:${target.rowId}`;
  if (target.kind === 'batchImageGeneratorItem') return `${target.kind}:${target.nodeId}:${target.itemId}`;
  return `${target.kind}:${target.nodeId}`;
}

function targetKey(canvasId, input = {}) {
  const canvas = safeString(canvasId);
  const target = normalizeTarget(input);
  if (!canvas || !target.nodeId) return '';
  const base = `canvas:${canvas}/node:${target.nodeId}`;
  if (target.kind === 'actionFissionRow') return `${base}/row:${target.rowId}`;
  if (target.kind === 'batchImageGeneratorItem') return `${base}/item:${target.itemId}`;
  return base;
}

module.exports = {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  normalizeTarget,
  publicTarget,
  safeString,
  targetIdentityKey,
  targetKey,
};
