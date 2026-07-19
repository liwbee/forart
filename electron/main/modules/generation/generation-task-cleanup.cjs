const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000;

function createGenerationTaskCleanup({
  repository,
  findMissingTargets,
  onTasksDeleted,
  targetExists,
  intervalMs = CLEANUP_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (!repository) throw new Error('Generation task repository is required.');
  let timer = null;

  function run({ force = false, now = Date.now(), retentionMs } = {}) {
    const timestamp = Number(now) || Date.now();
    const lastCleanupAt = Number(repository.getMeta?.('last_cleanup_at') || 0);
    if (!force && lastCleanupAt && timestamp - lastCleanupAt < intervalMs) {
      return { compactedCount: 0, deletedCount: 0, deletedTaskIds: [], skipped: true };
    }
    const heads = repository.listTargetHeads?.() || [];
    const orphanedHeads = typeof findMissingTargets === 'function'
      ? findMissingTargets(heads)
      : typeof targetExists === 'function'
        ? heads.filter((head) => !targetExists(head.canvasId, head.target))
        : [];
    const orphanedTaskIds = orphanedHeads.length
      ? repository.removeTargetHeads(orphanedHeads.map((head) => head.targetKey), timestamp)
      : [];
    const result = repository.cleanupTerminalHistory({ now: timestamp, retentionMs, orphanedTaskIds });
    if (result.deletedTaskIds?.length) onTasksDeleted?.(result.deletedTaskIds);
    return { ...result, orphanedTaskIds, skipped: false };
  }

  function start() {
    if (timer || !Number.isFinite(intervalMs) || intervalMs <= 0) return;
    timer = setIntervalFn(() => {
      try {
        run();
      } catch (error) {
        console.error('Generation task cleanup failed:', error);
      }
    }, intervalMs);
    timer?.unref?.();
  }

  function stop() {
    if (!timer) return;
    clearIntervalFn(timer);
    timer = null;
  }

  return { run, start, stop };
}

module.exports = {
  CLEANUP_INTERVAL_MS,
  createGenerationTaskCleanup,
};
