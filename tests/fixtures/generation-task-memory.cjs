const { createGenerationTaskService } = require('../../electron/main/modules/generation/generation-task-service.cjs');

function createMemoryGenerationTaskRepository() {
  const records = new Map();
  const heads = new Map();
  const targetKey = (task) => {
    const target = task?.target || {};
    const base = `${task?.canvasId || ''}:${target.type || 'imageGenerator'}:${target.nodeId || ''}`;
    return target.type === 'actionFissionRow' ? `${base}:${target.rowId || ''}` : base;
  };
  const activeStatuses = new Set(['queued', 'preparing', 'uploading', 'submitting', 'running', 'result_processing']);
  return {
    getTask(taskId) {
      return records.get(String(taskId || '')) || null;
    },
    latestTaskIdForTarget(canvasId, target) {
      return heads.get(targetKey({ canvasId, target })) || '';
    },
    listActiveTaskRecords({ canvasId } = {}) {
      return [...records.values()].filter((record) => (
        (!canvasId || record.task.canvasId === canvasId)
        && activeStatuses.has(record.task.status)
      ));
    },
    listActiveTaskRefsForCanvas(canvasId) {
      return [...records.values()]
        .filter((record) => record.task.canvasId === canvasId && activeStatuses.has(record.task.status))
        .map((record) => ({
          id: record.task.id,
          canvasId: record.task.canvasId,
          executorKind: record.executorKind,
          status: record.task.status,
          target: structuredClone(record.task.target),
        }));
    },
    listLatestTaskRecordsForCanvas(canvasId) {
      return [...heads.values()]
        .map((taskId) => records.get(taskId))
        .filter((record) => record?.task.canvasId === canvasId);
    },
    getTasks(taskIds = []) {
      return [...new Set(taskIds)].map((taskId) => records.get(taskId)).filter(Boolean);
    },
    listTaskPage({ filter = 'all', limit = 30, offset = 0 } = {}) {
      const sorted = [...records.values()].sort((left, right) => (
        Number(right.task.updatedAt || 0) - Number(left.task.updatedAt || 0)
        || String(right.task.id).localeCompare(String(left.task.id))
      ));
      const matches = (record, targetFilter) => {
        const active = activeStatuses.has(record.task.status);
        if (targetFilter === 'active') return active;
        if (targetFilter === 'succeeded') return record.task.status === 'succeeded';
        if (targetFilter === 'exceptional') return !active && record.task.status !== 'succeeded';
        return true;
      };
      const counts = {
        all: sorted.length,
        active: sorted.filter((record) => matches(record, 'active')).length,
        succeeded: sorted.filter((record) => matches(record, 'succeeded')).length,
        exceptional: sorted.filter((record) => matches(record, 'exceptional')).length,
      };
      const filtered = filter === 'all' ? sorted : sorted.filter((record) => matches(record, filter));
      return { records: filtered.slice(offset, offset + limit), total: filtered.length, counts };
    },
    saveTask(task, { executorKind, setAsLatest }) {
      const current = records.get(task.id);
      const record = {
        task: structuredClone(task),
        executorKind,
        version: Number(current?.version || 0) + 1,
        resultCommitState: current?.resultCommitState || 'none',
      };
      records.set(task.id, record);
      if (setAsLatest) heads.set(targetKey(task), task.id);
      return record;
    },
  };
}

function createMemoryGenerationTaskService() {
  return createGenerationTaskService({ repository: createMemoryGenerationTaskRepository() });
}

function createMemoryGenerationTaskStore(executorKind) {
  return createMemoryGenerationTaskService().createStoreAdapter(executorKind);
}

module.exports = {
  createMemoryGenerationTaskRepository,
  createMemoryGenerationTaskService,
  createMemoryGenerationTaskStore,
};
