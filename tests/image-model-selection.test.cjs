const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadSelectionHelpers() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'settings',
    'imageModelSelection.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)(require, loaded, loaded.exports);
  return loaded.exports;
}

const {
  reconcileAspectRatio,
  reconcileImageCount,
  reconcileResolution,
  reconcileStringOption,
} = loadSelectionHelpers();

test('preserves equivalent resolution tiers across models with different casing', () => {
  assert.equal(reconcileResolution(['1K', '2K', '4K'], '2k', '1K'), '2K');
  assert.equal(reconcileResolution(['1K', '2K', '4K'], '4K', '1K'), '4K');
});

test('uses the nearest supported resolution when the exact tier is unavailable', () => {
  assert.equal(reconcileResolution(['1K', '2K'], '4K', '1K'), '2K');
  assert.equal(reconcileResolution(['2K', '4K'], '3K', '2K'), '2K');
});

test('preserves aspect ratio or chooses the nearest supported shape', () => {
  assert.equal(reconcileAspectRatio(['1:1', '3:4', '16:9'], '3:4', '1:1'), '3:4');
  assert.equal(reconcileAspectRatio(['1:1', '3:4', '16:9'], '4:5', '1:1'), '3:4');
});

test('falls back quality and chooses the nearest supported image count', () => {
  assert.equal(reconcileStringOption(['auto', 'high'], 'HIGH', 'auto'), 'high');
  assert.equal(reconcileStringOption(['auto', 'high'], 'medium', 'auto'), 'auto');
  assert.equal(reconcileImageCount([1, 2], 4, 1), 2);
});
