const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadDownloadState() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'generation',
    'generationResultDownloadState.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
  execute(require, loaded, loaded.exports, filePath, path.dirname(filePath));
  return loaded.exports;
}

test('restoring the same terminal task result preserves its downloaded marker', () => {
  const { downloadMarkerForTaskResult } = loadDownloadState();
  assert.deepEqual(downloadMarkerForTaskResult(
    'task-1',
    'task-1',
    'forart-asset://canvas/output/result.png?v=1',
    'forart-asset://canvas/output/result.png?v=1',
    'downloaded',
    100,
  ), {
    downloadState: 'downloaded',
    downloadedAt: 100,
  });
});

test('a new task or result resets the downloaded marker', () => {
  const { downloadMarkerForTaskResult } = loadDownloadState();
  const inputs = [
    ['task-old', 'task-new', 'asset-1', 'asset-1'],
    ['task-1', 'task-1', 'asset-old', 'asset-new'],
  ];
  inputs.forEach(([currentTaskId, resultTaskId, currentAssetUrl, resultAssetUrl]) => {
    assert.deepEqual(downloadMarkerForTaskResult(
      currentTaskId,
      resultTaskId,
      currentAssetUrl,
      resultAssetUrl,
      'downloaded',
      100,
    ), {
      downloadState: 'pending',
      downloadedAt: undefined,
    });
  });
});

test('image generation terminal replay preserves only matching downloaded results', () => {
  const { nativeResultsFromTask } = loadDownloadState();
  const results = nativeResultsFromTask('task-1', 'task-1', [{
    localUrl: 'asset-1',
    downloadState: 'downloaded',
    downloadedAt: 100,
  }, {
    localUrl: 'asset-old',
    downloadState: 'downloaded',
    downloadedAt: 200,
  }], [{
    assetUrl: 'asset-1',
    fileName: 'one.png',
  }, {
    assetUrl: 'asset-2',
    fileName: 'two.png',
  }]);

  assert.equal(results[0].downloadState, 'downloaded');
  assert.equal(results[0].downloadedAt, 100);
  assert.equal(results[1].downloadState, 'pending');
  assert.equal(results[1].downloadedAt, undefined);
});
