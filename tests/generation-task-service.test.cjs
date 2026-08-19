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
  assert.deepEqual(service.listLatestTasksForCanvas('canvas').map((task) => task.id), ['api-task-next', 'libtv-task']);
  const recentTasks = service.listTaskCenterPage({ limit: 2, filter: 'all' }).tasks;
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

test('generation task service does not version or broadcast an equivalent task update', () => {
  const repository = createMemoryGenerationTaskRepository();
  const service = createGenerationTaskService({ repository });
  const api = service.createStoreAdapter('api');
  const changed = [];
  service.subscribe((task) => changed.push(task));

  api.createTask({
    id: 'stable-task',
    canvasId: 'canvas',
    target: { type: 'imageGenerator', nodeId: 'node' },
    status: 'running',
    messageCode: 'image.waitingForResult',
    messageParams: { attempt: 1 },
  });
  const before = service.getTask('stable-task');
  const returned = api.updateTask('stable-task', {
    status: 'running',
    messageCode: 'image.waitingForResult',
    messageParams: { attempt: 1 },
  });
  const after = service.getTask('stable-task');

  assert.equal(after.version, before.version);
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(returned.updatedAt, before.updatedAt);
  assert.deepEqual(changed.map((task) => `${task.id}:${task.version}`), ['stable-task:1']);
});

test('generation task service publishes the saved record without querying it again', () => {
  const repository = createMemoryGenerationTaskRepository();
  const originalGetTask = repository.getTask.bind(repository);
  let taskReads = 0;
  repository.getTask = (taskId) => {
    taskReads += 1;
    return originalGetTask(taskId);
  };
  const service = createGenerationTaskService({ repository });
  const api = service.createStoreAdapter('api');
  const changed = [];
  service.subscribe((task) => changed.push(task));

  api.createTask({
    id: 'single-write-task',
    canvasId: 'canvas',
    target: { type: 'imageGenerator', nodeId: 'node' },
    status: 'submitting',
  });
  api.updateTask('single-write-task', { status: 'running' });

  assert.equal(taskReads, 0);
  assert.deepEqual(changed.map((task) => task.version), [1, 2]);
  assert.deepEqual(changed.map((task) => task.status), ['submitting', 'running']);
});

test('generation task service exposes lightweight active task references for canvas maintenance', () => {
  const repository = createMemoryGenerationTaskRepository();
  repository.listActiveTaskRefsForCanvas = (canvasId) => [{
    id: 'active-ref',
    canvasId,
    executorKind: 'api',
    status: 'running',
    target: { type: 'imageGenerator', nodeId: 'node' },
  }];
  repository.listActiveTaskRecords = () => {
    throw new Error('full active records must not be loaded for canvas maintenance');
  };
  const service = createGenerationTaskService({
    repository: {
      ...repository,
      listActiveTaskRecords: () => [],
    },
  });

  assert.deepEqual(service.listActiveTaskRefsForCanvas('canvas'), [{
    id: 'active-ref',
    canvasId: 'canvas',
    executorKind: 'api',
    status: 'running',
    target: { type: 'imageGenerator', nodeId: 'node' },
  }]);
});

test('generation task service paginates task-center results in groups of thirty', () => {
  const repository = createMemoryGenerationTaskRepository();
  const service = createGenerationTaskService({ repository });
  const api = service.createStoreAdapter('api');
  for (let index = 0; index < 65; index += 1) {
    api.createTask({
      id: `task-${String(index).padStart(2, '0')}`,
      canvasId: 'canvas',
      target: { type: 'imageGenerator', nodeId: `node-${index}` },
      status: index % 3 === 0 ? 'succeeded' : index % 3 === 1 ? 'failed' : 'running',
    });
  }

  const first = service.listTaskCenterPage({ limit: 30, offset: 0, filter: 'all' });
  const second = service.listTaskCenterPage({ limit: 30, offset: 30, filter: 'all' });
  const third = service.listTaskCenterPage({ limit: 30, offset: 60, filter: 'all' });
  assert.equal(first.tasks.length, 30);
  assert.equal(second.tasks.length, 30);
  assert.equal(third.tasks.length, 5);
  assert.equal(first.total, 65);
  assert.equal(new Set([...first.tasks, ...second.tasks, ...third.tasks].map((task) => task.id)).size, 65);
  assert.deepEqual(first.counts, { all: 65, active: 21, succeeded: 22, exceptional: 22 });

  const active = service.listTaskCenterPage({ limit: 30, offset: 0, filter: 'active' });
  assert.equal(active.total, 21);
  assert.equal(active.tasks.every((task) => task.status === 'running'), true);
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

test('generation task service supersedes non-head active tasks before startup recovery', async () => {
  const repository = createMemoryGenerationTaskRepository();
  const initialService = createGenerationTaskService({ repository });
  initialService.createStoreAdapter('api').createTask({
    id: 'older-api',
    canvasId: 'canvas',
    target: { type: 'imageGenerator', nodeId: 'node' },
    status: 'running',
  });
  initialService.createStoreAdapter('libtv').createTask({
    id: 'latest-libtv',
    canvasId: 'canvas',
    target: { type: 'imageGenerator', nodeId: 'node' },
    status: 'running',
  });

  const recovered = [];
  const service = createGenerationTaskService({ repository });
  service.registerExecutor('api', {
    recoverPersistedTasks() {
      recovered.push(...service.createStoreAdapter('api').listTasks().map((task) => task.id));
      return { ok: true };
    },
  });
  service.registerExecutor('libtv', {
    recoverPersistedTasks() {
      recovered.push(...service.createStoreAdapter('libtv').listTasks().map((task) => task.id));
      return { ok: true };
    },
  });

  await service.recoverActiveTasks();

  assert.equal(service.getTask('older-api').status, 'superseded');
  assert.deepEqual(recovered, ['latest-libtv']);
});

test('generation task service stops an older cross-executor task before starting its replacement', async () => {
  const repository = createMemoryGenerationTaskRepository();
  const service = createGenerationTaskService({ repository });
  const api = service.createStoreAdapter('api');
  const libtv = service.createStoreAdapter('libtv');
  api.createTask({
    id: 'older-api',
    canvasId: 'canvas',
    target: { type: 'imageGenerator', nodeId: 'node' },
    status: 'running',
  });

  const calls = [];
  service.registerExecutor('api', {
    async stopTask(taskId) {
      calls.push(`stop:${taskId}:begin`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      api.stopTask(taskId);
      calls.push(`stop:${taskId}:end`);
    },
  });
  service.registerExecutor('libtv', {
    startTask(payload) {
      calls.push('start:replacement');
      return libtv.createTask({ ...payload, id: 'latest-libtv' });
    },
  });

  await service.startTask('libtv', {
    canvasId: 'canvas',
    target: { type: 'imageGenerator', nodeId: 'node' },
  });

  assert.deepEqual(calls, [
    'stop:older-api:begin',
    'stop:older-api:end',
    'start:replacement',
  ]);
  assert.equal(service.getTask('older-api').status, 'interrupted');
  assert.equal(service.getTask('latest-libtv').status, 'preparing');
});

test('generation task service locally interrupts a replaced task when its executor stop fails', async () => {
  const repository = createMemoryGenerationTaskRepository();
  const service = createGenerationTaskService({ repository });
  const api = service.createStoreAdapter('api');
  const libtv = service.createStoreAdapter('libtv');
  api.createTask({
    id: 'older-api',
    canvasId: 'canvas',
    target: { type: 'imageGenerator', nodeId: 'node' },
    status: 'running',
  });
  service.registerExecutor('api', {
    stopTask() { throw new Error('remote stop failed'); },
  });
  service.registerExecutor('libtv', {
    startTask(payload) { return libtv.createTask({ ...payload, id: 'latest-libtv' }); },
  });

  await service.startTask('libtv', {
    canvasId: 'canvas',
    target: { type: 'imageGenerator', nodeId: 'node' },
  });

  assert.equal(service.getTask('older-api').status, 'interrupted');
  assert.equal(service.getTask('latest-libtv').status, 'preparing');
});

test('generation task service serializes concurrent starts for the same target', async () => {
  const repository = createMemoryGenerationTaskRepository();
  const service = createGenerationTaskService({ repository });
  const api = service.createStoreAdapter('api');
  const calls = [];
  service.registerExecutor('api', {
    async startTask(payload) {
      calls.push(`start:${payload.id}`);
      const task = api.createTask(payload);
      if (payload.id === 'first') await new Promise((resolve) => setTimeout(resolve, 5));
      return task;
    },
    stopTask(taskId) {
      calls.push(`stop:${taskId}`);
      return api.stopTask(taskId);
    },
  });
  const target = { type: 'imageGenerator', nodeId: 'node' };

  await Promise.all([
    service.startTask('api', { id: 'first', canvasId: 'canvas', target }),
    service.startTask('api', { id: 'second', canvasId: 'canvas', target }),
  ]);

  assert.deepEqual(calls, ['start:first', 'stop:first', 'start:second']);
  assert.equal(service.getTask('first').status, 'interrupted');
  assert.deepEqual(api.listTasks().map((task) => task.id), ['second']);
});

test('generation task service startup hydrates only active repository records', () => {
  let activeReads = 0;
  const records = new Map();
  const repository = {
    listActiveTaskRecords() {
      activeReads += 1;
      return [{
        executorKind: 'api',
        version: 1,
        task: {
          id: 'restored-active',
          canvasId: 'canvas',
          target: { type: 'imageGenerator', nodeId: 'node' },
          status: 'running',
          startedAt: 1,
          updatedAt: 2,
        },
      }];
    },
    getTask(taskId) { return records.get(taskId) || null; },
    saveTask() { throw new Error('not used'); },
  };

  const service = createGenerationTaskService({ repository });
  assert.equal(activeReads, 1);
  assert.deepEqual(service.createStoreAdapter('api').listTasks().map((task) => task.id), ['restored-active']);
});

test('generation task service keeps only active tasks in executor stores', () => {
  const repository = createMemoryGenerationTaskRepository();
  const service = createGenerationTaskService({ repository });
  const api = service.createStoreAdapter('api');
  const libtv = service.createStoreAdapter('libtv');
  api.createTask({ id: 'api-old', canvasId: 'canvas', target: { type: 'imageGenerator', nodeId: 'node-a' } });
  api.updateTask('api-old', { status: 'failed', error: 'failed' });
  libtv.createTask({ id: 'libtv-old', canvasId: 'canvas', target: { type: 'imageGenerator', nodeId: 'node-b' } });
  libtv.updateTask('libtv-old', { status: 'failed', error: 'failed' });
  api.createTask({ id: 'api-active', canvasId: 'canvas', target: { type: 'imageGenerator', nodeId: 'node-c' } });

  assert.deepEqual(api.listTasks().map((task) => task.id), ['api-active']);
  assert.deepEqual(libtv.listTasks(), []);
  assert.equal(api.getTask('api-old').status, 'failed');
  assert.equal(libtv.getTask('libtv-old').status, 'failed');
  assert.notEqual(api.getTask('api-active'), null);
});
