const assert = require('node:assert/strict');
const test = require('node:test');

const { registerGenerationTaskIpc } = require('../electron/main/ipc/generation-task-ipc.cjs');

test('generation task IPC exposes snapshots and publishes changed events', async () => {
  const handlers = new Map();
  const sent = [];
  let changedListener = null;
  let disposed = false;
  const service = {
    getTask(taskId) { return { id: taskId, version: 2 }; },
    listTasksForCanvas(canvasId) { return [{ id: `task:${canvasId}`, version: 1 }]; },
    listRecentTasks(limit) { return [{ id: `recent:${limit}`, version: 1 }]; },
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
  assert.deepEqual(await handlers.get('generation-task-system:list-recent')(null, 40), [
    { id: 'recent:40', version: 1 },
  ]);
  assert.deepEqual(await handlers.get('generation-task-system:stop')(null, 'task-a'), { id: 'task-a', status: 'interrupted' });

  changedListener({ id: 'task-a', version: 3 });
  assert.deepEqual(sent, [{ channel: 'generation-task:changed', payload: { id: 'task-a', version: 3 } }]);
  dispose();
  assert.equal(disposed, true);
});
