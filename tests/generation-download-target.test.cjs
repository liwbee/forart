const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

// Loads a renderer TS module and resolves its relative TS imports the same way
// Vite would, so pure helper modules can be unit tested without a bundler.
function loadTsModule(filePath, cache = new Map()) {
  if (cache.has(filePath)) return cache.get(filePath).exports;
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  cache.set(filePath, loaded);
  const localRequire = (specifier) => {
    if (!specifier.startsWith('.')) return require(specifier);
    const resolved = path.resolve(path.dirname(filePath), specifier);
    const target = fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : `${resolved}.ts`;
    return target.endsWith('.ts') ? loadTsModule(target, cache) : require(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

function loadModule() {
  return loadTsModule(path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'generation',
    'generationDownloadTarget.ts',
  ));
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

test('action-fission downloads prefer the terminal task result while canvas writeback catches up', () => {
  const { actionFissionDownloadTarget } = loadModule();
  assert.deepEqual(actionFissionDownloadTarget({ resultUrl: '', resultFileName: '' }, task), {
    imageUrl: 'first.png',
    fileName: 'first.png',
  });
  assert.deepEqual(actionFissionDownloadTarget({
    resultUrl: 'canvas-result.png',
    resultFileName: 'canvas-result.png',
  }, task), {
    imageUrl: 'first.png',
    fileName: 'first.png',
  });
  assert.deepEqual(actionFissionDownloadTarget({
    resultUrl: 'canvas-result.png',
    resultFileName: 'canvas-result.png',
  }, undefined), {
    imageUrl: 'canvas-result.png',
    fileName: 'canvas-result.png',
  });
});
