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
    : 'imageGenerator';
  const rowId = safeString(source?.rowId);
  return {
    kind,
    nodeId: normalizedNodeId,
    rowId: kind === 'actionFissionRow' ? rowId : '',
  };
}

function publicTarget(input = {}, nodeId = '', canvasId = '') {
  const target = normalizeTarget(input, nodeId);
  return {
    canvasId: safeString(input?.canvasId || canvasId),
    kind: target.kind,
    nodeId: target.nodeId,
    ...(target.kind === 'actionFissionRow' ? { rowId: target.rowId } : {}),
  };
}

function targetIdentityKey(input = {}) {
  const target = normalizeTarget(input);
  return target.kind === 'actionFissionRow'
    ? `${target.kind}:${target.nodeId}:${target.rowId}`
    : `${target.kind}:${target.nodeId}`;
}

function targetKey(canvasId, input = {}) {
  const canvas = safeString(canvasId);
  const target = normalizeTarget(input);
  if (!canvas || !target.nodeId) return '';
  const base = `canvas:${canvas}/node:${target.nodeId}`;
  return target.kind === 'actionFissionRow' ? `${base}/row:${target.rowId}` : base;
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
