const assert = require('node:assert/strict');
const test = require('node:test');

const { createGenerationTaskService } = require('../electron/main/modules/generation/generation-task-service.cjs');
const { createMemoryGenerationTaskRepository } = require('./fixtures/generation-task-memory.cjs');
const {
  createGenerationTaskDto,
  isTerminalTaskStatus,
} = require('../electron/main/modules/generation/generation-task-types.cjs');

test('unified generation task DTO maps legacy API and LibTV task shapes', () => {
  const dto = createGenerationTaskDto({
    executorKind: 'libtv',
    version: 4,
    task: {
      id: 'libtv-task',
      canvasId: 'canvas',
      target: { type: 'actionFissionRow', nodeId: 'node', rowId: 'row' },
      modelName: 'Qwen Edit',
      resolution: '1K',
      aspectRatio: '3:4',
      quality: 'high',
      status: 'uploading',
      message: 'remote feedback',
      result: { localUrl: 'forart-asset://output/result.png', thumbUrl: 'forart-asset://thumb/result.png' },
      startedAt: 1,
      updatedAt: 2,
    },
  });

  assert.equal(dto.executorKind, 'libtv');
  assert.equal(dto.status, 'preparing');
  assert.deepEqual(dto.target, { canvasId: 'canvas', kind: 'actionFissionRow', nodeId: 'node', rowId: 'row' });
  assert.equal(dto.model, 'Qwen Edit');
  assert.equal(dto.resolution, '1K');
  assert.equal(dto.aspectRatio, '3:4');
  assert.equal(dto.quality, 'high');
  assert.equal(dto.remoteMessage, 'remote feedback');
  assert.equal(dto.result.images[0].assetUrl, 'forart-asset://output/result.png');
  assert.equal(isTerminalTaskStatus('succeeded'), true);
  assert.equal(isTerminalTaskStatus('running'), false);
});

test('generation task service exposes one query and event stream for both executors', () => {
  const repository = createMemoryGenerationTaskRepository();
  const service = createGenerationTaskService({ repository });
  const api = service.createStoreAdapter('api');
  const libtv = service.createStoreAdapter('libtv');
  const changed = [];
  service.subscribe((task) => changed.push(task));

  const apiTask = api.createTask({
    id: 'api-task',
    canvasId: 'canvas',
    target: { type: 'imageGenerator', nodeId: 'api-node' },
    provider: { id: 'api-provider', name: 'API Mart' },
    providerId: 'api-provider',
    model: 'gpt-image-2',
    resolution: '1K',
    aspectRatio: '3:4',
    status: 'submitting',
  });
  api.updateTask(apiTask.id, { status: 'running' });
  api.createTask({
    id: 'api-task-next',
    canvasId: 'canvas',
    target: { type: 'imageGenerator', nodeId: 'api-node' },
    status: 'submitting',
  });
  const libtvTask = libtv.createTask({
    id: 'libtv-task',
    canvasId: 'canvas',
    nodeId: 'legacy-top-level-node',
    target: { type: 'imageGenerator', nodeId: 'libtv-node' },
    status: 'preparing',
  });
  assert.equal(libtvTask.nodeId, undefined);

  assert.equal(service.getTask('api-task').executorKind, 'api');
  assert.equal(service.getTask('api-task').providerName, 'API Mart');
  assert.equal(service.getTask('api-task').resolution, '1K');
  assert.equal(service.getTask('api-task').aspectRatio, '3:4');
  assert.equal(service.getTask('api-task').status, 'superseded');
  assert.equal(service.getTask('api-task').version, 3);
  assert.equal(service.getTask('libtv-task').executorKind, 'libtv');
  assert.deepEqual(service.listTasksForCanvas('canvas').map((task) => task.id), ['api-task', 'api-task-next', 'libtv-task']);
  const recentTasks = service.listRecentTasks(2);
  assert.equal(recentTasks.length, 2);
  assert.equal(recentTasks[0].updatedAt >= recentTasks[1].updatedAt, true);
  assert.deepEqual(changed.map((task) => `${task.id}:${task.version}`), [
    'api-task:1',
    'api-task:2',
    'api-task:3',
    'api-task-next:1',
    'libtv-task:1',
  ]);
});

test('generation task service routes stop and coalesces concurrent startup recovery', async () => {
  const repository = createMemoryGenerationTaskRepository();
  const service = createGenerationTaskService({ repository });
  const api = service.createStoreAdapter('api');
  const libtv = service.createStoreAdapter('libtv');
  api.createTask({ id: 'api-task', canvasId: 'canvas', target: { type: 'imageGenerator', nodeId: 'node-a' } });
  libtv.createTask({ id: 'libtv-task', canvasId: 'canvas', target: { type: 'imageGenerator', nodeId: 'node-b' } });

  let apiRecoveries = 0;
  let libtvRecoveries = 0;
  const stopped = [];
  service.registerExecutor('api', {
    stopTask(taskId) { stopped.push(`api:${taskId}`); return api.stopTask(taskId); },
    async recoverPersistedTasks() { apiRecoveries += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { ok: true }; },
  });
  service.registerExecutor('libtv', {
    stopTask(taskId) { stopped.push(`libtv:${taskId}`); return libtv.stopTask(taskId); },
    async recoverPersistedTasks() { libtvRecoveries += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { ok: true }; },
  });

  await Promise.all([service.recoverActiveTasks(), service.recoverActiveTasks()]);
  service.stopTask('libtv-task');

  assert.equal(apiRecoveries, 1);
  assert.equal(libtvRecoveries, 1);
  assert.deepEqual(stopped, ['libtv:libtv-task']);
  assert.equal(service.getTask('libtv-task').status, 'interrupted');
});

test('generation task service removes cleaned terminal tasks from executor stores', () => {
  const repository = createMemoryGenerationTaskRepository();
  const service = createGenerationTaskService({ repository });
  const api = service.createStoreAdapter('api');
  const libtv = service.createStoreAdapter('libtv');
  api.createTask({ id: 'api-old', canvasId: 'canvas', target: { type: 'imageGenerator', nodeId: 'node-a' } });
  api.updateTask('api-old', { status: 'failed', error: 'failed' });
  libtv.createTask({ id: 'libtv-old', canvasId: 'canvas', target: { type: 'imageGenerator', nodeId: 'node-b' } });
  libtv.updateTask('libtv-old', { status: 'failed', error: 'failed' });
  api.createTask({ id: 'api-active', canvasId: 'canvas', target: { type: 'imageGenerator', nodeId: 'node-c' } });

  assert.equal(service.removeTasks(['api-old', 'libtv-old', 'api-active']), 2);
  assert.equal(api.getTask('api-old'), null);
  assert.equal(libtv.getTask('libtv-old'), null);
  assert.notEqual(api.getTask('api-active'), null);
});
