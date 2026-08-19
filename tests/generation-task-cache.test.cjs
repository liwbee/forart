const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTaskCache(taskApi) {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'generation',
    'generationTaskCache.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  global.window = { forartGenerationTasks: taskApi };
  const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
  execute(require, loaded, loaded.exports, filePath, path.dirname(filePath));
  return loaded.exports;
}

function task(id, version, status = 'running') {
  return {
    id,
    target: { canvasId: 'canvas', kind: 'imageGenerator', nodeId: 'node' },
    executorKind: 'api',
    status,
    version,
    startedAt: 1,
    updatedAt: version,
  };
}

test('generation task cache ignores stale versions and resolves terminal events without polling', async () => {
  const previousWindow = global.window;
  let eventListener = null;
  let disconnectCount = 0;
  let getCount = 0;
  const snapshots = new Map([['watched', task('watched', 1)]]);
  const cache = loadTaskCache({
    async get(taskId) { getCount += 1; return snapshots.get(taskId) || null; },
    async listForCanvas() { return [...snapshots.values()]; },
    onChanged(listener) {
      eventListener = listener;
      return () => { disconnectCount += 1; };
    },
  });

  try {
    cache.useGenerationTaskCache.getState().mergeTask(task('versioned', 2));
    cache.useGenerationTaskCache.getState().mergeTask(task('versioned', 1, 'failed'));
    assert.equal(cache.useGenerationTaskCache.getState().tasksById.versioned.version, 2);
    assert.equal(cache.useGenerationTaskCache.getState().tasksById.versioned.status, 'running');

    const disconnectA = cache.connectGenerationTaskEvents();
    const disconnectB = cache.connectGenerationTaskEvents();
    const seen = [];
    const waiting = cache.watchGenerationTask('watched', new AbortController().signal, (value) => seen.push(value.status));
    await new Promise((resolve) => setImmediate(resolve));
    const completed = task('watched', 2, 'succeeded');
    snapshots.set('watched', completed);
    eventListener(completed);
    const result = await waiting;

    assert.deepEqual(seen, ['running', 'succeeded']);
    assert.equal(result.status, 'succeeded');
    assert.equal(getCount, 1);

    const terminalFromCache = await cache.watchGenerationTask('watched', new AbortController().signal, () => {});
    assert.equal(terminalFromCache.status, 'succeeded');
    assert.equal(getCount, 1);

    const missing = await cache.watchGenerationTask('missing', new AbortController().signal, () => {});
    assert.equal(missing, null);
    assert.equal(getCount, 2);
    disconnectA();
    assert.equal(disconnectCount, 0);
    disconnectB();
    assert.equal(disconnectCount, 1);
  } finally {
    global.window = previousWindow;
  }
});

test('generation task cache bounds terminal history while retaining active tasks', () => {
  const previousWindow = global.window;
  const cache = loadTaskCache({});
  try {
    const terminalTasks = Array.from({ length: 160 }, (_, index) => ({
      ...task(`terminal-${index}`, 1, 'succeeded'),
      updatedAt: index + 1,
    }));
    const activeTasks = [task('active-a', 1), task('active-b', 1, 'queued')];
    cache.useGenerationTaskCache.getState().mergeTasks([...terminalTasks, ...activeTasks]);
    const tasksById = cache.useGenerationTaskCache.getState().tasksById;

    assert.equal(Object.keys(tasksById).length, 122);
    assert.equal(tasksById['active-a'].status, 'running');
    assert.equal(tasksById['active-b'].status, 'queued');
    assert.equal(tasksById['terminal-159'].status, 'succeeded');
    assert.equal(tasksById['terminal-0'], undefined);
  } finally {
    global.window = previousWindow;
  }
});

test('generation task events coalesce to their latest versions once per frame', () => {
  const previousWindow = global.window;
  let eventListener = null;
  let scheduledFrame = null;
  const cache = loadTaskCache({
    onChanged(listener) {
      eventListener = listener;
      return () => {};
    },
  });
  global.window.requestAnimationFrame = (callback) => {
    scheduledFrame = callback;
    return 1;
  };
  global.window.cancelAnimationFrame = () => {};

  try {
    const disconnect = cache.connectGenerationTaskEvents();
    eventListener(task('task-a', 1, 'queued'));
    eventListener(task('task-a', 2, 'running'));
    eventListener(task('task-b', 1, 'running'));

    assert.equal(cache.useGenerationTaskCache.getState().revision, 0);
    scheduledFrame(16);
    const state = cache.useGenerationTaskCache.getState();
    assert.equal(state.revision, 1);
    assert.equal(state.tasksById['task-a'].version, 2);
    assert.equal(state.tasksById['task-a'].status, 'running');
    assert.equal(state.tasksById['task-b'].version, 1);
    disconnect();
  } finally {
    global.window = previousWindow;
  }
});

test('canvas hydration pins all latest terminal tasks beyond the global history limit', async () => {
  const previousWindow = global.window;
  const latestTasks = Array.from({ length: 160 }, (_, index) => ({
    ...task(`head-${index}`, 1, index % 2 ? 'failed' : 'succeeded'),
    target: { canvasId: 'large-canvas', kind: 'imageGenerator', nodeId: `node-${index}` },
    updatedAt: index + 1,
  }));
  const cache = loadTaskCache({
    async listForCanvas() { return latestTasks; },
    async getMany() { return []; },
  });
  try {
    await cache.hydrateGenerationTasks('large-canvas');
    const state = cache.useGenerationTaskCache.getState();
    assert.equal(state.hydratedCanvasId, 'large-canvas');
    assert.equal(state.pinnedTaskIds.size, 160);
    assert.equal(latestTasks.every((value) => state.tasksById[value.id]), true);
  } finally {
    global.window = previousWindow;
  }
});

test('canvas hydration batch-loads legacy anchors and ignores stale canvas responses', async () => {
  const previousWindow = global.window;
  const pending = new Map();
  let getManyCalls = 0;
  const cache = loadTaskCache({
    listForCanvas(canvasId) {
      return new Promise((resolve) => pending.set(canvasId, resolve));
    },
    async getMany(taskIds) {
      getManyCalls += 1;
      return taskIds.map((taskId) => ({
        ...task(taskId, 1, 'failed'),
        target: { canvasId: 'canvas-b', kind: 'imageGenerator', nodeId: 'legacy-node' },
      }));
    },
  });
  try {
    const hydrationA = cache.hydrateGenerationTasks('canvas-a');
    const hydrationB = cache.hydrateGenerationTasks('canvas-b', ['legacy-failure']);
    pending.get('canvas-b')([]);
    await hydrationB;
    pending.get('canvas-a')([{
      ...task('stale-a', 1, 'failed'),
      target: { canvasId: 'canvas-a', kind: 'imageGenerator', nodeId: 'node-a' },
    }]);
    await hydrationA;

    let state = cache.useGenerationTaskCache.getState();
    assert.equal(getManyCalls, 1);
    assert.equal(state.hydratedCanvasId, 'canvas-b');
    assert.equal(state.tasksById['legacy-failure'].status, 'failed');
    assert.equal(state.tasksById['stale-a'], undefined);

    cache.clearHydratedGenerationTasks();
    state = cache.useGenerationTaskCache.getState();
    assert.equal(state.hydratedCanvasId, '');
    assert.equal(state.pinnedTaskIds.size, 0);
  } finally {
    global.window = previousWindow;
  }
});

test('canvas hydration tolerates an old JSON anchor after the task database was rebuilt', async () => {
  const previousWindow = global.window;
  let requestedIds = [];
  const cache = loadTaskCache({
    async listForCanvas() { return []; },
    async getMany(taskIds) {
      requestedIds = taskIds;
      return [];
    },
  });
  try {
    const hydrated = await cache.hydrateGenerationTasks('old-json-canvas', ['deleted-task-id']);
    assert.deepEqual(requestedIds, ['deleted-task-id']);
    assert.deepEqual(hydrated, []);
    const state = cache.useGenerationTaskCache.getState();
    assert.equal(state.hydratedCanvasId, 'old-json-canvas');
    assert.equal(state.pinnedTaskIds.size, 0);
  } finally {
    global.window = previousWindow;
  }
});
