const assert = require('node:assert/strict');
const path = require('node:path');

const rootDir = path.resolve(process.argv[2]);
const { createGenerationTaskRepository } = require('../../electron/main/modules/generation/generation-task-repository.cjs');
const { createGenerationTaskService } = require('../../electron/main/modules/generation/generation-task-service.cjs');

function openRepository() {
  return createGenerationTaskRepository({ rootDir });
}

const firstRepository = openRepository();
const firstService = createGenerationTaskService({ repository: firstRepository });
const apiStore = firstService.createStoreAdapter('api');
const libtvStore = firstService.createStoreAdapter('libtv');

const firstApiTask = apiStore.createTask({
  id: 'gen_persisted_first',
  canvasId: 'canvas_a',
  target: { type: 'imageGenerator', nodeId: 'node_a' },
  providerId: 'provider_a',
  model: 'model_a',
  status: 'submitting',
});
const secondApiTask = apiStore.createTask({
  id: 'gen_persisted_second',
  canvasId: 'canvas_a',
  target: { type: 'imageGenerator', nodeId: 'node_a' },
  providerId: 'provider_a',
  model: 'model_a',
  status: 'running',
  upstreamTaskId: 'remote_a',
});
const libtvTask = libtvStore.createTask({
  id: 'libtv_persisted_row',
  canvasId: 'canvas_a',
  nodeId: 'node_fission',
  target: { type: 'actionFissionRow', nodeId: 'node_fission', rowId: 'row_a' },
  status: 'running',
  projectUuid: 'project_a',
  remoteNodeId: 'remote_node_a',
});

assert.equal(apiStore.getTask(firstApiTask.id).status, 'superseded');
assert.equal(firstRepository.latestTaskIdForTarget('canvas_a', firstApiTask.target), secondApiTask.id);
assert.equal(firstRepository.latestTaskIdForTarget('canvas_a', libtvTask.target), libtvTask.id);
assert.ok(firstRepository.getTask(secondApiTask.id).version >= 1);
firstRepository.close();

const secondRepository = openRepository();
const secondService = createGenerationTaskService({ repository: secondRepository });
const restoredApiStore = secondService.createStoreAdapter('api');
const restoredLibtvStore = secondService.createStoreAdapter('libtv');

assert.equal(restoredApiStore.getTask(firstApiTask.id).status, 'superseded');
assert.equal(restoredApiStore.getTask(secondApiTask.id).upstreamTaskId, 'remote_a');
assert.equal(restoredLibtvStore.getTask(libtvTask.id).projectUuid, 'project_a');

restoredApiStore.updateTask(secondApiTask.id, { status: 'succeeded', result: { localUrl: 'forart-asset://output/result.png' } });
restoredLibtvStore.updateTask(libtvTask.id, { status: 'failed', error: 'remote failure' });
assert.equal(secondRepository.beginResultCommit(secondApiTask.id), true);
assert.equal(secondRepository.beginResultCommit(secondApiTask.id), false);
assert.equal(secondRepository.finishResultCommit(secondApiTask.id, true), true);
const apiVersionAfterUpdate = secondRepository.getTask(secondApiTask.id).version;
assert.ok(apiVersionAfterUpdate >= 2);
secondRepository.close();

const thirdRepository = openRepository();
assert.equal(thirdRepository.getTask(secondApiTask.id).task.status, 'succeeded');
assert.equal(thirdRepository.getTask(secondApiTask.id).task.result.localUrl, 'forart-asset://output/result.png');
assert.equal(thirdRepository.getTask(secondApiTask.id).resultCommitState, 'committed');
assert.equal(thirdRepository.getTask(libtvTask.id).task.status, 'failed');
assert.equal(thirdRepository.getTask(libtvTask.id).task.error, 'remote failure');

const cleanupNow = Date.now();
const cleanupTarget = { type: 'imageGenerator', nodeId: 'cleanup-node' };
thirdRepository.saveTask({
  id: 'cleanup-old-success',
  canvasId: 'cleanup-canvas',
  target: cleanupTarget,
  providerId: 'provider-a',
  model: 'model-a',
  status: 'succeeded',
  prompt: 'old prompt',
  result: { localUrl: 'forart-asset://output/old.png' },
  startedAt: cleanupNow - 20_000,
  updatedAt: cleanupNow - 10_000,
  completedAt: cleanupNow - 10_000,
}, { executorKind: 'api', setAsLatest: true });
thirdRepository.beginResultCommit('cleanup-old-success');
thirdRepository.finishResultCommit('cleanup-old-success', true);
thirdRepository.saveTask({
  id: 'cleanup-current-head',
  canvasId: 'cleanup-canvas',
  target: cleanupTarget,
  providerId: 'provider-a',
  providerName: 'API Mart',
  model: 'model-a',
  resolution: '1K',
  aspectRatio: '3:4',
  status: 'succeeded',
  prompt: 'remove this input snapshot',
  referenceImages: ['forart-asset://input/reference.png'],
  result: { localUrl: 'forart-asset://output/current.png' },
  startedAt: cleanupNow - 5_000,
  updatedAt: cleanupNow - 1_000,
  completedAt: cleanupNow - 1_000,
}, { executorKind: 'api', setAsLatest: true });
thirdRepository.beginResultCommit('cleanup-current-head');
thirdRepository.finishResultCommit('cleanup-current-head', true);
thirdRepository.saveTask({
  id: 'cleanup-pending-result',
  canvasId: 'cleanup-canvas',
  target: { type: 'imageGenerator', nodeId: 'pending-node' },
  status: 'succeeded',
  result: { localUrl: 'forart-asset://output/pending.png' },
  startedAt: cleanupNow - 20_000,
  updatedAt: cleanupNow - 10_000,
  completedAt: cleanupNow - 10_000,
}, { executorKind: 'api' });
thirdRepository.beginResultCommit('cleanup-pending-result');
thirdRepository.finishResultCommit('cleanup-pending-result', false);
thirdRepository.saveTask({
  id: 'cleanup-active',
  canvasId: 'cleanup-canvas',
  target: { type: 'imageGenerator', nodeId: 'active-node' },
  status: 'running',
  startedAt: cleanupNow - 20_000,
  updatedAt: cleanupNow - 10_000,
}, { executorKind: 'api' });
thirdRepository.saveTask({
  id: 'cleanup-interrupted-commit',
  canvasId: 'cleanup-canvas',
  target: { type: 'imageGenerator', nodeId: 'interrupted-commit-node' },
  status: 'succeeded',
  result: { localUrl: 'forart-asset://output/interrupted-commit.png' },
  startedAt: cleanupNow - 20_000,
  updatedAt: cleanupNow - 10_000,
  completedAt: cleanupNow - 10_000,
}, { executorKind: 'api' });
assert.equal(thirdRepository.beginResultCommit('cleanup-interrupted-commit'), true);
const pendingCommits = thirdRepository.preparePendingResultCommits();
assert.equal(pendingCommits.some((record) => record.task.id === 'cleanup-interrupted-commit'), true);
assert.equal(thirdRepository.getTask('cleanup-interrupted-commit').resultCommitState, 'pending');
thirdRepository.saveTask({
  id: 'cleanup-orphan-head',
  canvasId: 'missing-canvas',
  target: { type: 'imageGenerator', nodeId: 'missing-node' },
  status: 'succeeded',
  result: { localUrl: 'forart-asset://output/orphan.png' },
  startedAt: cleanupNow - 20_000,
  updatedAt: cleanupNow - 10_000,
  completedAt: cleanupNow - 10_000,
}, { executorKind: 'api', setAsLatest: true });
thirdRepository.beginResultCommit('cleanup-orphan-head');
thirdRepository.finishResultCommit('cleanup-orphan-head', false);
const orphanHead = thirdRepository.listTargetHeads().find((head) => head.taskId === 'cleanup-orphan-head');
assert.ok(orphanHead);
const orphanedTaskIds = thirdRepository.removeTargetHeads([orphanHead.targetKey], cleanupNow);
assert.deepEqual(orphanedTaskIds, ['cleanup-orphan-head']);
assert.equal(thirdRepository.getTask('cleanup-orphan-head').resultCommitState, 'discarded');

const cleanupExecutionNow = cleanupNow + (24 * 60 * 60 * 1000) + 1;
const cleanupResult = thirdRepository.cleanupTerminalHistory({
  now: cleanupExecutionNow,
  orphanedTaskIds,
  retentionMs: {
    succeeded: 0,
    failed: 0,
    canceled: 0,
    interrupted: 0,
    superseded: 0,
    unsubmitted: 0,
  },
});
assert.equal(cleanupResult.deletedTaskIds.includes('cleanup-old-success'), true);
assert.equal(cleanupResult.deletedTaskIds.includes('cleanup-orphan-head'), true);
assert.equal(thirdRepository.getTask('cleanup-old-success'), null);
assert.notEqual(thirdRepository.getTask('cleanup-pending-result'), null);
assert.notEqual(thirdRepository.getTask('cleanup-active'), null);
const compactedHead = thirdRepository.getTask('cleanup-current-head').task;
assert.equal(compactedHead.status, 'succeeded');
assert.equal(compactedHead.prompt, undefined);
assert.equal(compactedHead.referenceImages, undefined);
assert.equal(compactedHead.providerName, 'API Mart');
assert.equal(compactedHead.resolution, '1K');
assert.equal(compactedHead.aspectRatio, '3:4');
assert.equal(compactedHead.result.localUrl, 'forart-asset://output/current.png');
assert.equal(thirdRepository.getMeta('last_cleanup_at'), String(cleanupExecutionNow));
thirdRepository.close();
