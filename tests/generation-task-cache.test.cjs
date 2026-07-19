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
