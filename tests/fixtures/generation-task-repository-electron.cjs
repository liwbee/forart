const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(process.argv[2]);
const { createGenerationTaskRepository } = require('../../electron/main/modules/generation/generation-task-repository.cjs');
const { createGenerationTaskService } = require('../../electron/main/modules/generation/generation-task-service.cjs');

function openRepository() {
  return createGenerationTaskRepository({ rootDir });
}

const databasePath = path.join(rootDir, 'CanvasAssests', 'tasks', 'generation-tasks.sqlite');

const firstRepository = openRepository();
const firstService = createGenerationTaskService({ repository: firstRepository });
assert.equal('listTaskRecords' in firstRepository, false);
assert.equal('listTasks' in firstRepository, false);
assert.equal('listTasksForCanvas' in firstService, false);
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
firstRepository.saveTask({
  id: 'sensitive-active',
  canvasId: 'canvas-sensitive',
  target: { type: 'imageGenerator', nodeId: 'node-sensitive' },
  providerId: 'provider-sensitive',
  provider: { id: 'provider-sensitive', apiKey: 'secret-provider-key' },
  headers: {
    'X-API-Key': 'secret-header-key',
    'Proxy-Authorization': 'secret-proxy-key',
  },
  executorState: { clientSecret: 'secret-client-key', safeValue: 'kept' },
  referenceImages: [
    `data:image/png;base64,${'x'.repeat(50_000)}`,
    'forart-asset://input/safe-reference.png',
  ],
  status: 'running',
  startedAt: Date.now(),
  updatedAt: Date.now(),
}, { executorKind: 'api' });
const sanitizedTask = firstRepository.getTask('sensitive-active').task;
assert.equal(sanitizedTask.provider, undefined);
assert.equal(sanitizedTask.headers['X-API-Key'], undefined);
assert.equal(sanitizedTask.headers['Proxy-Authorization'], undefined);
assert.equal(sanitizedTask.executorState.clientSecret, undefined);
assert.equal(sanitizedTask.executorState.safeValue, 'kept');
assert.deepEqual(sanitizedTask.referenceImages, ['forart-asset://input/safe-reference.png']);

assert.equal(apiStore.getTask(firstApiTask.id).status, 'superseded');
assert.equal(firstRepository.latestTaskIdForTarget('canvas_a', firstApiTask.target), secondApiTask.id);
assert.equal(firstRepository.latestTaskIdForTarget('canvas_a', libtvTask.target), libtvTask.id);
assert.deepEqual(
  firstRepository.listActiveTargetHeads().filter((head) => head.canvasId === 'canvas_a').map((head) => head.taskId).sort(),
  [libtvTask.id, secondApiTask.id].sort(),
);
assert.deepEqual(
  firstRepository.listActiveTargetHeads().filter((head) => head.canvasId === 'canvas_a').map((head) => head.taskId).sort(),
  [libtvTask.id, secondApiTask.id].sort(),
);
assert.deepEqual(
  firstRepository.listLatestTaskRecordsForCanvas('canvas_a').map((record) => record.task.id).sort(),
  [libtvTask.id, secondApiTask.id].sort(),
);
assert.deepEqual(
  firstRepository.getTasks([libtvTask.id, 'missing-task', secondApiTask.id]).map((record) => record.task.id),
  [libtvTask.id, secondApiTask.id],
);
assert.equal(firstRepository.getMeta('schema_version'), '4');
assert.ok(firstRepository.getTask(secondApiTask.id).version >= 1);
firstRepository.close();

const Database = require('better-sqlite3');
const schemaDatabase = new Database(databasePath);
const taskColumns = schemaDatabase.prepare(`PRAGMA table_info(generation_tasks)`).all().map((column) => column.name);
const tableNames = schemaDatabase.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((row) => row.name);
assert.equal(taskColumns.includes('summary_json'), true);
assert.equal(taskColumns.includes('payload_json'), false);
assert.equal(tableNames.includes('generation_schema_migrations'), false);
assert.equal(tableNames.includes('generation_task_assets'), true);
schemaDatabase.prepare(`UPDATE generation_meta SET value = '3' WHERE key = 'schema_version'`).run();
schemaDatabase.close();

assert.throws(openRepository, /delete .*generation-tasks\.sqlite.*rebuild the task database/i);
const resetSchemaDatabase = new Database(databasePath);
resetSchemaDatabase.prepare(`UPDATE generation_meta SET value = '4' WHERE key = 'schema_version'`).run();
resetSchemaDatabase.close();

const secondRepository = openRepository();
assert.equal(secondRepository.getMeta('schema_version'), '4');
const secondService = createGenerationTaskService({ repository: secondRepository });
const restoredApiStore = secondService.createStoreAdapter('api');
const restoredLibtvStore = secondService.createStoreAdapter('libtv');

secondRepository.saveTask({
  id: 'dirty-runtime',
  canvasId: 'dirty-canvas',
  target: { type: 'imageGenerator', nodeId: 'dirty-node' },
  status: 'running',
  prompt: 'unchanged runtime',
  referenceImages: ['forart-asset://input/dirty.png'],
  startedAt: 1_000,
  updatedAt: 1_000,
}, { executorKind: 'api' });
const fragmentDatabase = new Database(databasePath);
const firstRuntimeUpdatedAt = fragmentDatabase.prepare(`
  SELECT updated_at FROM generation_task_runtime WHERE task_id = 'dirty-runtime'
`).get().updated_at;
secondRepository.saveTask({
  id: 'dirty-runtime',
  canvasId: 'dirty-canvas',
  target: { type: 'imageGenerator', nodeId: 'dirty-node' },
  status: 'running',
  message: 'summary-only change',
  prompt: 'unchanged runtime',
  referenceImages: ['forart-asset://input/dirty.png'],
  startedAt: 1_000,
  updatedAt: 2_000,
}, { executorKind: 'api' });
const unchangedRuntime = fragmentDatabase.prepare(`
  SELECT updated_at FROM generation_task_runtime WHERE task_id = 'dirty-runtime'
`).get();
const dirtyAssetReferences = fragmentDatabase.prepare(`
  SELECT url FROM generation_task_assets WHERE task_id = 'dirty-runtime'
`).all();
assert.equal(firstRuntimeUpdatedAt, 1_000);
assert.equal(unchangedRuntime.updated_at, 1_000);
assert.deepEqual(dirtyAssetReferences.map((row) => row.url), ['forart-asset://input/dirty.png']);
fragmentDatabase.close();

const countsBefore = secondRepository.listTaskPage({ filter: 'all', limit: 1 }).counts;
secondRepository.saveTask({
  id: 'cached-count-task',
  canvasId: 'count-canvas',
  target: { type: 'imageGenerator', nodeId: 'count-node' },
  status: 'running',
  startedAt: 3_000,
  updatedAt: 3_000,
}, { executorKind: 'api' });
const countsActive = secondRepository.listTaskPage({ filter: 'all', limit: 1 }).counts;
secondRepository.saveTask({
  id: 'cached-count-task',
  canvasId: 'count-canvas',
  target: { type: 'imageGenerator', nodeId: 'count-node' },
  status: 'succeeded',
  startedAt: 3_000,
  updatedAt: 4_000,
  completedAt: 4_000,
}, { executorKind: 'api' });
const countsTerminal = secondRepository.listTaskPage({ filter: 'all', limit: 1 }).counts;
assert.equal(countsActive.all, countsBefore.all + 1);
assert.equal(countsActive.active, countsBefore.active + 1);
assert.equal(countsTerminal.all, countsActive.all);
assert.equal(countsTerminal.active, countsActive.active - 1);
assert.equal(countsTerminal.succeeded, countsActive.succeeded + 1);

assert.equal(restoredApiStore.getTask(firstApiTask.id).status, 'superseded');
assert.equal(restoredApiStore.getTask(secondApiTask.id).upstreamTaskId, 'remote_a');
assert.equal(restoredLibtvStore.getTask(libtvTask.id).projectUuid, 'project_a');
restoredApiStore.updateTask('sensitive-active', { status: 'interrupted' });

restoredApiStore.updateTask(secondApiTask.id, { status: 'succeeded', result: { localUrl: 'forart-asset://output/result.png' } });
restoredApiStore.createTask({
  id: 'gen_large_result',
  canvasId: 'canvas_a',
  target: { type: 'imageGenerator', nodeId: 'node_large' },
  status: 'running',
});
restoredApiStore.updateTask('gen_large_result', {
  canvasId: 'canvas_a',
  target: { type: 'imageGenerator', nodeId: 'node_large' },
  status: 'succeeded',
  result: {
    url: `data:image/png;base64,${'x'.repeat(200_000)}`,
    localUrl: 'forart-asset://output/large.png',
    results: [{
      url: `data:image/png;base64,${'y'.repeat(200_000)}`,
      localUrl: 'forart-asset://output/large.png',
      fileName: 'large.png',
    }],
  },
});
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
const compactedLarge = thirdRepository.getTask('gen_large_result').task;
assert.equal(compactedLarge.result.localUrl, 'forart-asset://output/large.png');
assert.equal(compactedLarge.result.url, undefined);
assert.equal(compactedLarge.result.results[0].url, undefined);
assert.equal(thirdRepository.getTask(libtvTask.id).task.status, 'failed');
assert.equal(thirdRepository.getTask(libtvTask.id).task.error, 'remote failure');

const batchTaskIds = [];
for (let index = 0; index < 405; index += 1) {
  const taskId = `batch-task-${String(index).padStart(3, '0')}`;
  batchTaskIds.push(taskId);
  thirdRepository.saveTask({
    id: taskId,
    canvasId: 'batch-canvas',
    target: { type: 'imageGenerator', nodeId: `batch-node-${index}` },
    status: 'failed',
    error: 'batch fixture',
    startedAt: index + 1,
    updatedAt: index + 1,
    completedAt: index + 1,
  }, { executorKind: 'api' });
}
const reversedBatchTaskIds = [...batchTaskIds].reverse();
assert.deepEqual(
  thirdRepository.getTasks(reversedBatchTaskIds).map((record) => record.task.id),
  reversedBatchTaskIds,
);

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
  prompt: 'active prompt kept in runtime',
  referenceImages: ['forart-asset://input/active-reference.png'],
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
const activePage = thirdRepository.listTaskPage({ filter: 'active', limit: 30, offset: 0 });
assert.equal(activePage.records.some((record) => record.task.id === 'cleanup-active'), true);
assert.equal(activePage.total, activePage.counts.active);
const exceptionalPage = thirdRepository.listTaskPage({ filter: 'exceptional', limit: 30, offset: 0 });
assert.equal(exceptionalPage.records.every((record) => ![
  'queued', 'preparing', 'uploading', 'submitting', 'running', 'result_processing', 'succeeded',
].includes(record.task.status)), true);
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
const orphanedTaskIds = thirdRepository.removeTargetHeads([orphanHead.targetKey, orphanHead.targetKey], cleanupNow);
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
const countsAfterCleanup = thirdRepository.listTaskPage({ filter: 'all', limit: 1 }).counts;
assert.equal(countsAfterCleanup.all, thirdRepository.listTaskPage({ filter: 'all', limit: 500 }).total);
const compactedHead = thirdRepository.getTask('cleanup-current-head').task;
assert.equal(compactedHead.status, 'succeeded');
assert.equal(compactedHead.prompt, undefined);
assert.equal(compactedHead.referenceImages, undefined);
assert.equal(compactedHead.providerName, 'API Mart');
assert.equal(compactedHead.resolution, '1K');
assert.equal(compactedHead.aspectRatio, '3:4');
assert.equal(compactedHead.result.localUrl, 'forart-asset://output/current.png');
assert.equal(thirdRepository.getMeta('last_cleanup_at'), String(cleanupExecutionNow));
const taskAssetReferences = thirdRepository.listTaskAssetReferences();
assert.equal(taskAssetReferences.some((reference) => reference.url === 'forart-asset://input/active-reference.png'), true);
assert.equal(taskAssetReferences.some((reference) => reference.url === 'forart-asset://output/current.png'), true);

const normalizedDatabase = new Database(path.join(rootDir, 'CanvasAssests', 'tasks', 'generation-tasks.sqlite'));
assert.equal(
  countsAfterCleanup.all,
  normalizedDatabase.prepare(`SELECT COUNT(*) AS count FROM generation_tasks`).get().count,
);
const normalizedActiveRow = normalizedDatabase.prepare(`
  SELECT task.summary_json, runtime.runtime_json
  FROM generation_tasks task
  LEFT JOIN generation_task_runtime runtime ON runtime.task_id = task.id
  WHERE task.id = 'cleanup-active'
`).get();
assert.equal(JSON.parse(normalizedActiveRow.summary_json).prompt, undefined);
assert.equal(JSON.parse(normalizedActiveRow.runtime_json).prompt, 'active prompt kept in runtime');
const normalizedResultRow = normalizedDatabase.prepare(`
  SELECT task.summary_json, runtime.runtime_json, result.result_json
  FROM generation_tasks task
  LEFT JOIN generation_task_runtime runtime ON runtime.task_id = task.id
  LEFT JOIN generation_task_results result ON result.task_id = task.id
  WHERE task.id = 'cleanup-current-head'
`).get();
assert.equal(JSON.parse(normalizedResultRow.summary_json).result, undefined);
assert.equal(normalizedResultRow.runtime_json, null);
assert.equal(JSON.parse(normalizedResultRow.result_json).localUrl, 'forart-asset://output/current.png');
normalizedDatabase.close();
thirdRepository.close();

fs.rmSync(databasePath, { force: true });
fs.writeFileSync(`${databasePath}-wal`, 'orphaned wal');
fs.writeFileSync(`${databasePath}-shm`, 'orphaned shm');
const rebuiltRepository = openRepository();
assert.equal(rebuiltRepository.getMeta('schema_version'), '4');
assert.equal(rebuiltRepository.getTask('cleanup-current-head'), null);
assert.equal(
  fs.existsSync(`${databasePath}-wal`) && fs.readFileSync(`${databasePath}-wal`, 'utf8') === 'orphaned wal',
  false,
);
rebuiltRepository.saveTask({
  id: 'rebuilt-task',
  canvasId: 'existing-json-canvas',
  target: { type: 'imageGenerator', nodeId: 'existing-json-node' },
  status: 'running',
  startedAt: Date.now(),
  updatedAt: Date.now(),
}, { executorKind: 'api', setAsLatest: true });
assert.equal(rebuiltRepository.getTask('rebuilt-task').task.status, 'running');
rebuiltRepository.close();
