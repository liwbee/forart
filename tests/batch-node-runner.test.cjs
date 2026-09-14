const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const moduleCache = new Map();

function loadTypeScriptModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (moduleCache.has(resolvedPath)) return moduleCache.get(resolvedPath).exports;
  const loaded = { exports: {} };
  moduleCache.set(resolvedPath, loaded);
  const output = ts.transpileModule(fs.readFileSync(resolvedPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: resolvedPath,
  }).outputText;
  const localRequire = (request) => {
    if (!request.startsWith('.')) return require(request);
    const dependency = path.resolve(path.dirname(resolvedPath), request);
    return loadTypeScriptModule(path.extname(dependency) ? dependency : `${dependency}.ts`);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    localRequire,
    loaded,
    loaded.exports,
    resolvedPath,
    path.dirname(resolvedPath),
  );
  return loaded.exports;
}

const { submitBatchTasks, stopBatchTasks } = loadTypeScriptModule(path.join(
  __dirname,
  '..',
  'renderer',
  'src',
  'features',
  'infinite-canvas',
  'batch',
  'batchNodeRunner.ts',
));

test('submitBatchTasks writes task ids before watching each item and waits for all watchers', async () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const tasks = [{ id: 'task-a' }, { id: 'task-b' }];
  const events = [];

  const result = await submitBatchTasks({
    items,
    start: async () => {
      events.push('start');
      return tasks;
    },
    onTaskIds: (startedItems, startedTasks) => {
      events.push(['anchors', startedItems.map((item) => item.id), startedTasks.map((task) => task.id)]);
    },
    watch: async (task, item) => {
      events.push(['watch', task.id, item.id]);
      if (item.id === 'a') throw new Error('one watcher failed');
    },
  });

  assert.deepEqual(result, tasks);
  assert.deepEqual(events, [
    'start',
    ['anchors', ['a', 'b'], ['task-a', 'task-b']],
    ['watch', 'task-a', 'a'],
    ['watch', 'task-b', 'b'],
  ]);
});

test('submitBatchTasks rejects a count mismatch before publishing anchors', async () => {
  let published = false;
  await assert.rejects(
    submitBatchTasks({
      items: [{ id: 'a' }, { id: 'b' }],
      start: async () => [{ id: 'task-a' }],
      onTaskIds: () => { published = true; },
      watch: async () => undefined,
      onCountMismatch: () => new Error('mismatch'),
    }),
    /mismatch/,
  );
  assert.equal(published, false);
});

test('stopBatchTasks aborts and stops only active tasks, then projects the stop', async () => {
  const active = new Set(['task-a']);
  const events = [];
  await stopBatchTasks({
    items: [{ id: 'a', taskId: 'task-a' }, { id: 'b', taskId: 'task-b' }],
    taskId: (item) => item.taskId,
    isActive: (taskId) => active.has(taskId),
    abort: (taskId) => events.push(['abort', taskId]),
    stop: async (taskId) => events.push(['stop', taskId]),
    onStopped: (item, taskId) => events.push(['stopped', item.id, taskId]),
  });

  assert.deepEqual(events, [
    ['abort', 'task-a'],
    ['stop', 'task-a'],
    ['stopped', 'a', 'task-a'],
  ]);
});
