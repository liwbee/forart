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
    'generation',
    'generationDownloadTarget.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)(require, loaded, loaded.exports);
  return loaded.exports;
}

const task = {
  result: {
    images: [
      { assetUrl: 'first.png', fileName: 'first.png' },
      { assetUrl: 'second.png', fileName: 'second.png' },
    ],
  },
};

test('task-center downloads select the requested result image', () => {
  const { generationTaskImageAt } = loadModule();
  assert.equal(generationTaskImageAt(task, 0).assetUrl, 'first.png');
  assert.equal(generationTaskImageAt(task, 1).assetUrl, 'second.png');
  assert.equal(generationTaskImageAt(task, 2), null);
});

test('action-fission downloads fall back to the terminal task result before canvas writeback', () => {
  const { actionFissionDownloadTarget } = loadModule();
  assert.deepEqual(actionFissionDownloadTarget({ resultUrl: '', resultFileName: '' }, task), {
    imageUrl: 'first.png',
    fileName: 'first.png',
  });
  assert.deepEqual(actionFissionDownloadTarget({
    resultUrl: 'canvas-result.png',
    resultFileName: 'canvas-result.png',
  }, task), {
    imageUrl: 'canvas-result.png',
    fileName: 'canvas-result.png',
  });
});
