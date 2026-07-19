const assert = require('node:assert/strict');
const test = require('node:test');
const { createGenerationResultCommitter } = require('../electron/main/modules/generation/generation-result-committer.cjs');

test('generation result committer writes each task terminal exactly once', () => {
  let commitState = 'none';
  const transitions = [];
  const repository = {
    beginResultCommit() {
      if (commitState !== 'none' && commitState !== 'pending') return false;
      commitState = 'committing';
      return true;
    },
    finishResultCommit(_taskId, committed) {
      commitState = committed ? 'committed' : 'pending';
      transitions.push(commitState);
      return true;
    },
  };
  const writes = [];
  const canvasStore = {
    completeActionFissionRow(payload) {
      writes.push(payload);
      return { ok: true };
    },
  };
  const committer = createGenerationResultCommitter({ repository, canvasStore });
  const task = {
    id: 'task-1',
    canvasId: 'canvas-1',
    target: { type: 'actionFissionRow', nodeId: 'node-1', rowId: 'row-1' },
    status: 'succeeded',
    result: { localUrl: 'forart-asset://output/result.png' },
  };

  assert.equal(committer.commit(task).ok, true);
  assert.equal(committer.commit(task).reason, 'already_committed');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].taskId, 'task-1');
  assert.deepEqual(transitions, ['committed']);
});

test('generation result committer discards a superseded task without overwriting canvas results', () => {
  let commitState = 'none';
  const transitions = [];
  const repository = {
    beginResultCommit() {
      if (commitState !== 'none' && commitState !== 'pending') return false;
      commitState = 'committing';
      return true;
    },
    finishResultCommit(_taskId, outcome) {
      commitState = outcome === 'discarded' ? 'discarded' : outcome ? 'committed' : 'pending';
      transitions.push(commitState);
      return true;
    },
  };
  const writes = [];
  const canvasStore = {
    completeGenerationNode(payload) {
      writes.push(payload);
      return { ok: true, applied: false };
    },
  };
  const committer = createGenerationResultCommitter({ repository, canvasStore });
  const task = {
    id: 'old-task',
    canvasId: 'canvas-1',
    target: { type: 'imageGenerator', nodeId: 'node-1' },
    status: 'succeeded',
    result: { localUrl: 'forart-asset://output/old-result.png' },
  };

  const result = committer.commit(task);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'superseded');
  assert.equal(writes.length, 1);
  assert.deepEqual(transitions, ['discarded']);
  assert.equal(commitState, 'discarded');
  assert.equal(committer.commit(task).reason, 'already_committed');
});

test('generation result committer leaves a transient canvas write failure pending for recovery', () => {
  let commitState = 'none';
  const transitions = [];
  const repository = {
    beginResultCommit() {
      if (commitState !== 'none' && commitState !== 'pending') return false;
      commitState = 'committing';
      return true;
    },
    finishResultCommit(_taskId, outcome) {
      commitState = outcome === 'discarded' ? 'discarded' : outcome ? 'committed' : 'pending';
      transitions.push(commitState);
      return true;
    },
  };
  const canvasStore = {
    completeGenerationNode() {
      return { ok: false, reason: 'write_failed' };
    },
  };
  const committer = createGenerationResultCommitter({ repository, canvasStore });
  const task = {
    id: 'task-retry',
    canvasId: 'missing-canvas',
    target: { type: 'imageGenerator', nodeId: 'node-1' },
    status: 'succeeded',
    result: { localUrl: 'forart-asset://output/result.png' },
  };

  assert.throws(
    () => committer.commit(task, { backend: 'libtv' }),
    /Canvas result commit failed: write_failed/,
  );
  assert.deepEqual(transitions, ['pending']);
  assert.equal(commitState, 'pending');
});

test('generation result committer discards results whose canvas target was deleted', () => {
  for (const reason of ['canvas_not_found', 'node_not_found', 'row_not_found']) {
    let commitState = 'none';
    const repository = {
      beginResultCommit() {
        if (commitState !== 'none') return false;
        commitState = 'committing';
        return true;
      },
      finishResultCommit(_taskId, outcome) {
        commitState = outcome === 'discarded' ? 'discarded' : outcome ? 'committed' : 'pending';
        return true;
      },
    };
    const canvasStore = {
      completeGenerationNode() {
        return { ok: false, reason };
      },
    };
    const committer = createGenerationResultCommitter({ repository, canvasStore });
    const result = committer.commit({
      id: `deleted-target-${reason}`,
      canvasId: 'canvas-1',
      target: { type: 'imageGenerator', nodeId: 'deleted-node' },
      status: 'succeeded',
      result: { localUrl: 'forart-asset://output/result.png' },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'target_missing');
    assert.equal(result.targetReason, reason);
    assert.equal(commitState, 'discarded');
  }
});

test('generation result committer recovers pending terminal writes independently', () => {
  const states = new Map([
    ['latest-task', 'pending'],
    ['stale-task', 'pending'],
    ['missing-task', 'pending'],
  ]);
  const repository = {
    preparePendingResultCommits() {
      return [
        {
          executorKind: 'api',
          task: {
            id: 'latest-task',
            canvasId: 'canvas-1',
            target: { type: 'imageGenerator', nodeId: 'node-1' },
            status: 'succeeded',
            result: { localUrl: 'forart-asset://output/latest.png' },
          },
        },
        {
          executorKind: 'libtv',
          task: {
            id: 'stale-task',
            canvasId: 'canvas-1',
            target: { type: 'imageGenerator', nodeId: 'node-2' },
            status: 'succeeded',
            result: { localUrl: 'forart-asset://output/stale.png' },
          },
        },
        {
          executorKind: 'api',
          task: {
            id: 'missing-task',
            canvasId: 'canvas-1',
            target: { type: 'imageGenerator', nodeId: 'deleted-node' },
            status: 'succeeded',
            result: { localUrl: 'forart-asset://output/missing.png' },
          },
        },
      ];
    },
    beginResultCommit(taskId) {
      if (states.get(taskId) !== 'pending') return false;
      states.set(taskId, 'committing');
      return true;
    },
    finishResultCommit(taskId, outcome) {
      states.set(taskId, outcome === 'discarded' ? 'discarded' : outcome ? 'committed' : 'pending');
      return true;
    },
  };
  const canvasStore = {
    completeGenerationNode(payload) {
      if (payload.taskId === 'missing-task') return { ok: false, reason: 'node_not_found' };
      return { ok: true, applied: payload.taskId === 'latest-task' };
    },
  };

  const result = createGenerationResultCommitter({ repository, canvasStore }).recoverPending();

  assert.deepEqual(result.committedTaskIds, ['latest-task']);
  assert.deepEqual(result.discardedTaskIds, ['stale-task', 'missing-task']);
  assert.deepEqual(result.errors, []);
  assert.equal(states.get('latest-task'), 'committed');
  assert.equal(states.get('stale-task'), 'discarded');
  assert.equal(states.get('missing-task'), 'discarded');
});
