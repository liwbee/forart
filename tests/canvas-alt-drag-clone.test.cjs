const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadAltDragCloneModule() {
  const filePath = path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'infinite-canvas',
    'canvasAltDragClone.ts',
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

test('alt drag keeps the source fixed and moves the clone during the gesture', () => {
  const { projectAltDragOntoClones } = loadAltDragCloneModule();
  const gesture = {
    cloneIdBySourceId: new Map([['source', 'clone']]),
    cloneZIndex: 9,
    sourceNodes: [{ id: 'source', position: { x: 10, y: 20 }, zIndex: 2 }],
  };
  const nodes = [
    { id: 'source', position: { x: 70, y: 90 }, zIndex: 9, selected: true, dragging: true },
    { id: 'clone', position: { x: 10, y: 20 }, zIndex: 2, selected: false, dragging: false },
    { id: 'other', position: { x: 200, y: 300 }, selected: false, dragging: false },
  ];

  const projected = projectAltDragOntoClones(
    nodes,
    gesture,
    [{ id: 'source', position: { x: 70, y: 90 } }],
    true,
  );

  assert.deepEqual(projected.find((node) => node.id === 'source'), {
    id: 'source',
    position: { x: 10, y: 20 },
    zIndex: 2,
    selected: false,
    dragging: false,
  });
  assert.deepEqual(projected.find((node) => node.id === 'clone'), {
    id: 'clone',
    position: { x: 70, y: 90 },
    zIndex: 9,
    selected: true,
    dragging: true,
  });
  assert.deepEqual(projected.find((node) => node.id === 'other'), nodes[2]);
});

test('alt drag finalization leaves the clone selected without a dragging state', () => {
  const { projectAltDragOntoClones } = loadAltDragCloneModule();
  const gesture = {
    cloneIdBySourceId: new Map([['source', 'clone']]),
    cloneZIndex: 4,
    sourceNodes: [{ id: 'source', position: { x: 0, y: 0 }, zIndex: 1 }],
  };

  const projected = projectAltDragOntoClones(
    [
      { id: 'source', position: { x: 40, y: 50 }, selected: true, dragging: false },
      { id: 'clone', position: { x: 0, y: 0 }, selected: true, dragging: true },
    ],
    gesture,
    [{ id: 'source', position: { x: 40, y: 50 } }],
    false,
  );

  assert.deepEqual(projected.map((node) => ({
    id: node.id,
    position: node.position,
    selected: node.selected,
    dragging: node.dragging,
  })), [
    { id: 'source', position: { x: 0, y: 0 }, selected: false, dragging: false },
    { id: 'clone', position: { x: 40, y: 50 }, selected: true, dragging: false },
  ]);
});
