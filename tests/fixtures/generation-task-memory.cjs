const { createGenerationTaskService } = require('../../electron/main/modules/generation/generation-task-service.cjs');

function createMemoryGenerationTaskRepository() {
  const records = new Map();
  return {
    getTask(taskId) {
      return records.get(String(taskId || '')) || null;
    },
    listTaskRecords({ canvasId, executorKind } = {}) {
      return [...records.values()].filter((record) => (
        (!canvasId || record.task.canvasId === canvasId)
        && (!executorKind || record.executorKind === executorKind)
      ));
    },
    listTasks(executorKind) {
      return [...records.values()]
        .filter((record) => record.executorKind === executorKind)
        .map((record) => record.task);
    },
    saveTask(task, { executorKind }) {
      const current = records.get(task.id);
      const record = {
        task: structuredClone(task),
        executorKind,
        version: Number(current?.version || 0) + 1,
        resultCommitState: current?.resultCommitState || 'none',
      };
      records.set(task.id, record);
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
