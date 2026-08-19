const assert = require('node:assert/strict');
const test = require('node:test');

const { registerGenerationTaskIpc } = require('../electron/main/ipc/generation-task-ipc.cjs');

test('generation task IPC exposes snapshots and publishes changed events', async () => {
  const handlers = new Map();
  const sent = [];
  let changedListener = null;
  let disposed = false;
  let getTaskCount = 0;
  let getManyCount = 0;
  const service = {
    getTask(taskId) { getTaskCount += 1; return { id: taskId, version: 2 }; },
    getManyTasks(taskIds) { getManyCount += 1; return taskIds.map((taskId) => ({ id: taskId, version: 2 })); },
    async startTasks(_executorKind, payloads) { return payloads.map((payload) => ({ id: payload.id })); },
    listLatestTasksForCanvas(canvasId) { return [{ id: `task:${canvasId}`, version: 1 }]; },
    listTaskCenterPage(payload) { return { tasks: [{ id: `page:${payload.offset}`, version: 1 }], total: 1, counts: { all: 1, active: 0, succeeded: 1, exceptional: 0 } }; },
    stopTask(taskId) { return { id: taskId, status: 'interrupted' }; },
    subscribe(listener) {
      changedListener = listener;
      return () => { disposed = true; };
    },
  };
  const dispose = registerGenerationTaskIpc({
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    generationTaskService: service,
    getWebContents: () => ({
      isDestroyed: () => false,
      send(channel, payload) { sent.push({ channel, payload }); },
    }),
  });

  assert.deepEqual(await handlers.get('generation-task-system:get')(null, 'task-a'), { id: 'task-a', version: 2 });
  assert.deepEqual(await handlers.get('generation-task-system:get-many')(null, ['task-a', 'task-b']), [
    { id: 'task-a', version: 2 },
    { id: 'task-b', version: 2 },
  ]);
  assert.deepEqual(await handlers.get('generation-task-system:list-for-canvas')(null, 'canvas-a'), [
    { id: 'task:canvas-a', version: 1 },
  ]);
  assert.equal(handlers.has('generation-task-system:list-recent'), false);
  assert.deepEqual(await handlers.get('generation-task-system:list-page')(null, { limit: 30, offset: 30 }), {
    tasks: [{ id: 'page:30', version: 1 }],
    total: 1,
    counts: { all: 1, active: 0, succeeded: 1, exceptional: 0 },
  });
  assert.deepEqual(await handlers.get('generation-task-system:stop')(null, 'task-a'), { id: 'task-a', status: 'interrupted' });

  getTaskCount = 0;
  getManyCount = 0;
  assert.deepEqual(await handlers.get('generation-task-system:start-many')(null, 'api', [{ id: 'task-a' }, { id: 'task-b' }]), [
    { id: 'task-a', version: 2 },
    { id: 'task-b', version: 2 },
  ]);
  assert.equal(getTaskCount, 0);
  assert.equal(getManyCount, 1);

  changedListener({ id: 'task-a', version: 3 });
  assert.deepEqual(sent, [{ channel: 'generation-task:changed', payload: { id: 'task-a', version: 3 } }]);
  dispose();
  assert.equal(disposed, true);
});
