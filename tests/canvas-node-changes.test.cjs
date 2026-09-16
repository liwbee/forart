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
    'canvasNodeChanges.ts',
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

function node(overrides = {}) {
  return {
    id: 'node-1',
    type: 'canvasNode',
    position: { x: 10, y: 20 },
    style: { width: 240, height: 320 },
    measured: { width: 240, height: 320 },
    selected: false,
    dragging: false,
    data: { kind: 'prompt', label: 'A' },
    ...overrides,
  };
}

// Regression guard: React Flow's change stream must not republish the nodes array when
// nothing actually changed. An identical republish re-renders the canvas and can bounce a
// measurement change back and forth until React aborts with "Maximum update depth
// exceeded".
test('an unchanged node is recognised as a no-op', () => {
  const { sameCanvasNodeRuntime } = loadModule();
  const before = node();
  assert.equal(sameCanvasNodeRuntime(before, before), true);
  assert.equal(sameCanvasNodeRuntime(before, node()), true);
});

test('runtime differences are recognised', () => {
  const { sameCanvasNodeRuntime } = loadModule();
  const before = node();

  assert.equal(sameCanvasNodeRuntime(before, node({ selected: true })), false);
  assert.equal(sameCanvasNodeRuntime(before, node({ dragging: true })), false);
  assert.equal(sameCanvasNodeRuntime(before, node({ position: { x: 11, y: 20 } })), false);
  assert.equal(sameCanvasNodeRuntime(before, node({ measured: { width: 241, height: 320 } })), false);
  assert.equal(sameCanvasNodeRuntime(before, node({ style: { width: 240, height: 321 } })), false);
});

test('label-only changes are not treated as layout churn', () => {
  const { sameCanvasNodeRuntime } = loadModule();
  const before = node();
  // Node data is not part of React Flow's change stream signature; a data edit goes
  // through our own patch path, so it must not look like a runtime layout change.
  assert.equal(sameCanvasNodeRuntime(before, node({ data: { kind: 'prompt', label: 'B' } })), true);
});
