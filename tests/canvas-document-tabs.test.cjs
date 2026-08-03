const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTabDragModule() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'canvasTabDrag.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    require,
    loaded,
    loaded.exports,
    filePath,
    path.dirname(filePath),
  );
  return loaded.exports;
}

test('canvas tab drag overlay only follows horizontal movement', () => {
  const { restrictCanvasTabDragToHorizontalAxis } = loadTabDragModule();
  const result = restrictCanvasTabDragToHorizontalAxis({
    transform: { x: 84, y: 57, scaleX: 1, scaleY: 1 },
  });
  assert.deepEqual(result, { x: 84, y: 0, scaleX: 1, scaleY: 1 });
});
