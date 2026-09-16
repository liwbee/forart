const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadModule() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'batch',
    'batchItemPatch.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    require, loaded, loaded.exports, filePath, path.dirname(filePath),
  );
  return loaded.exports;
}

function item(overrides = {}) {
  return {
    id: 'item-1',
    status: 'completed',
    resultUrl: 'forart-asset://output/a.png',
    resultThumbUrl: '',
    latestGenerationTaskId: 'task-1',
    resultFileName: 'APImart-gpt-image-2-01011200.png',
    resultWidth: 1024,
    resultHeight: 1024,
    error: undefined,
    ...overrides,
  };
}

// Regression guard: a finished batch task re-reports its result every time it is watched
// again, and the watcher is re-registered whenever nodes change. Recognising an unchanged
// patch is what stops that from republishing nodes and bouncing into React's update limit.
test('an unchanged item patch is recognised as a no-op', () => {
  const { batchItemPatchChanges } = loadModule();
  const current = item();
  assert.equal(batchItemPatchChanges(current, {}), false);
  assert.equal(batchItemPatchChanges(current, {
    status: 'completed',
    resultUrl: 'forart-asset://output/a.png',
    latestGenerationTaskId: 'task-1',
    resultWidth: 1024,
    resultHeight: 1024,
    error: undefined,
  }), false);
});

test('a real change is detected', () => {
  const { batchItemPatchChanges } = loadModule();
  const current = item();
  assert.equal(batchItemPatchChanges(current, { status: 'running' }), true);
  assert.equal(batchItemPatchChanges(current, { resultThumbUrl: 'forart-asset://output/a.webp' }), true);
  assert.equal(batchItemPatchChanges(current, { error: 'failed' }), true);
  assert.equal(batchItemPatchChanges(current, { status: 'completed', error: undefined }), false);
});

test('array values are compared by content', () => {
  const { batchItemPatchChanges } = loadModule();
  const current = item({ sourceTags: ['a', 'b'] });
  assert.equal(batchItemPatchChanges(current, { sourceTags: ['a', 'b'] }), false);
  assert.equal(batchItemPatchChanges(current, { sourceTags: ['a', 'c'] }), true);
});
