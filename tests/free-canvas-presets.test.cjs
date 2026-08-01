const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadPresets() {
  const filePath = path.join(__dirname, '..', 'renderer', 'src', 'features', 'free-canvas', 'freeCanvasPresets.ts');
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)(require, loaded, loaded.exports);
  return loaded.exports;
}

test('free canvas K presets use 1024, 2048, and 4096 pixel long edges', () => {
  const { freeCanvasSizeFor } = loadPresets();
  assert.deepEqual(freeCanvasSizeFor('1K', '3:4'), { width: 768, height: 1024 });
  assert.deepEqual(freeCanvasSizeFor('2K', '1:1'), { width: 2048, height: 2048 });
  assert.deepEqual(freeCanvasSizeFor('4K', '16:9'), { width: 4096, height: 2304 });
  assert.deepEqual(freeCanvasSizeFor('4K', '9:16'), { width: 2304, height: 4096 });
});

test('every free canvas preset has an exact supported aspect ratio', () => {
  const { FREE_CANVAS_PRESETS } = loadPresets();
  for (const preset of FREE_CANVAS_PRESETS) {
    const [ratioWidth, ratioHeight] = preset.key.split(':').map(Number);
    for (const size of preset.sizes) {
      assert.equal(size.width * ratioHeight, size.height * ratioWidth);
    }
  }
});
