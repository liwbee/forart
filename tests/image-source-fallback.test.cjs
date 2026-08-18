const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadModule() {
  const filePath = path.join(__dirname, '..', 'renderer', 'src', 'components', 'imageSourceFallback.ts');
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)(require, loaded, loaded.exports);
  return loaded.exports;
}

test('image previews prefer thumbnails, then switch once to the original after an error', () => {
  const { initialImageSource, nextImageSourceAfterError } = loadModule();

  assert.equal(initialImageSource('thumb.webp', 'original.png'), 'thumb.webp');
  assert.equal(initialImageSource('', 'original.png'), 'original.png');
  assert.equal(nextImageSourceAfterError('thumb.webp', 'original.png'), 'original.png');
  assert.equal(nextImageSourceAfterError('original.png', 'original.png'), '');
  assert.equal(nextImageSourceAfterError('thumb.webp', ''), '');
});
