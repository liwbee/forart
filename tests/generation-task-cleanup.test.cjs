const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CLEANUP_INTERVAL_MS,
  createGenerationTaskCleanup,
} = require('../electron/main/modules/generation/generation-task-cleanup.cjs');

test('generation task cleanup respects its interval and synchronizes deleted task ids', () => {
  let lastCleanupAt = 1_000;
  let cleanupCalls = 0;
  const removed = [];
  const repository = {
    getMeta() {
      return String(lastCleanupAt);
    },
    cleanupTerminalHistory({ now }) {
      cleanupCalls += 1;
      lastCleanupAt = now;
      return { compactedCount: 2, deletedCount: 1, deletedTaskIds: ['old-task'] };
    },
  };
  const cleanup = createGenerationTaskCleanup({
    repository,
    onTasksDeleted: (taskIds) => removed.push(...taskIds),
  });

  assert.equal(cleanup.run({ now: lastCleanupAt + 10 }).skipped, true);
  const result = cleanup.run({ now: lastCleanupAt + CLEANUP_INTERVAL_MS, force: true });

  assert.equal(result.skipped, false);
  assert.equal(result.compactedCount, 2);
  assert.equal(cleanupCalls, 1);
  assert.deepEqual(removed, ['old-task']);
});

test('generation task cleanup removes orphaned target heads before applying retention', () => {
  const removedHeads = [];
  let cleanupOptions = null;
  const repository = {
    getMeta() {
      return '0';
    },
    listTargetHeads() {
      return [
        { targetKey: 'existing', taskId: 'task-existing', canvasId: 'canvas', target: { type: 'imageGenerator', nodeId: 'node' } },
        { targetKey: 'orphan', taskId: 'task-orphan', canvasId: 'missing', target: { type: 'imageGenerator', nodeId: 'node' } },
      ];
    },
    removeTargetHeads(targetKeys) {
      removedHeads.push(...targetKeys);
      return ['task-orphan'];
    },
    cleanupTerminalHistory(options) {
      cleanupOptions = options;
      return { compactedCount: 0, deletedCount: 1, deletedTaskIds: ['task-orphan'] };
    },
  };
  const cleanup = createGenerationTaskCleanup({
    repository,
    targetExists: (canvasId) => canvasId === 'canvas',
  });

  const result = cleanup.run({ force: true, now: 5_000 });

  assert.deepEqual(removedHeads, ['orphan']);
  assert.deepEqual(cleanupOptions.orphanedTaskIds, ['task-orphan']);
  assert.deepEqual(result.orphanedTaskIds, ['task-orphan']);
});
