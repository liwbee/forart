const MISSING_TARGET_REASONS = new Set([
  'canvas_not_found',
  'node_not_found',
  'row_not_found',
]);

function createGenerationResultCommitter({ repository, canvasStore } = {}) {
  if (!repository) throw new Error('Generation task repository is required.');
  if (!canvasStore) throw new Error('Canvas store is required.');

  function commit(task, payload = {}) {
    const taskId = String(task?.id || '').trim();
    if (!taskId || !task?.canvasId || !task?.target?.nodeId) {
      return { ok: false, reason: 'invalid_task_target' };
    }
    if (!repository.beginResultCommit(taskId)) {
      return { ok: false, reason: 'already_committed' };
    }

    try {
      const common = {
        canvasId: task.canvasId,
        nodeId: task.target.nodeId,
        taskId,
        status: payload.status || task.status,
        result: payload.result || task.result,
        error: payload.error || task.error,
      };
      const result = task.target.type === 'actionFissionRow'
        ? canvasStore.completeActionFissionRow({
            ...common,
            backend: payload.backend,
            rowId: task.target.rowId,
          })
        : canvasStore.completeGenerationNode(common);
      if (result?.ok === false) {
        const targetReason = String(result.reason || 'unknown');
        if (MISSING_TARGET_REASONS.has(targetReason)) {
          repository.finishResultCommit(taskId, 'discarded');
          return { ok: false, reason: 'target_missing', targetReason, result };
        }
        throw new Error(`Canvas result commit failed: ${targetReason}`);
      }
      if (result?.applied === false) {
        repository.finishResultCommit(taskId, 'discarded');
        return { ok: false, reason: 'superseded', result };
      }
      repository.finishResultCommit(taskId, true);
      return { ok: true, result };
    } catch (error) {
      repository.finishResultCommit(taskId, false);
      throw error;
    }
  }

  function recoverPending() {
    const records = repository.preparePendingResultCommits?.() || [];
    const committedTaskIds = [];
    const discardedTaskIds = [];
    const errors = [];
    for (const record of records) {
      try {
        const result = commit(record.task, { backend: record.executorKind });
        if (result.ok) committedTaskIds.push(record.task.id);
        else if (result.reason === 'superseded' || result.reason === 'target_missing') discardedTaskIds.push(record.task.id);
      } catch (error) {
        errors.push({
          taskId: record.task.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { committedTaskIds, discardedTaskIds, errors };
  }

  return { commit, recoverPending };
}

module.exports = { createGenerationResultCommitter };
