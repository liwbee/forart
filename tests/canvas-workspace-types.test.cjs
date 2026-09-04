const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadCanvasWorkspaceTypes() {
  const filePath = path.join(__dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas', 'canvasWorkspaceTypes.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === './action-fission/actionFissionState') {
      return { normalizeActionFissionState: (value) => value };
    }
    if (specifier === './nativeCanvas') {
      return {
        NATIVE_CANVAS_NODE_DEFINITIONS: {
          prompt: { size: { width: 260, height: 160 } },
        },
        createNativeCanvasGroupNode: () => { throw new Error('Unexpected group migration.'); },
      };
    }
    return require(specifier);
  };
  const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
  execute(localRequire, loaded, loaded.exports, filePath, path.dirname(filePath));
  return loaded.exports;
}

function loadCanvasSnapshotSemantics() {
  const filePath = path.join(__dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas', 'canvasSnapshotSemantics.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const output = ts.transpileModule(source, {
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

test('renderer opens a canvas saved with the current schema version', () => {
  const { normalizeCanvasDocument } = loadCanvasWorkspaceTypes();
  const { serializeCanvasDocument } = loadCanvasSnapshotSemantics();
  const serialized = serializeCanvasDocument({
    id: 'canvas-v5',
    title: 'Current canvas',
    projectId: 'project-1',
    createdAt: 1,
    viewport: { x: 3, y: 4, zoom: 1.2 },
  }, {
    nodes: [{
      id: 'prompt-1',
      type: 'canvasNode',
      position: { x: 10, y: 20 },
      data: { kind: 'prompt', label: 'Prompt', text: 'hello' },
    }],
    connections: [],
    groups: [],
    viewport: { x: 3, y: 4, scale: 1.2 },
  });
  const canvas = normalizeCanvasDocument(JSON.parse(serialized));

  assert.ok(canvas, 'a canvas written by the renderer should be readable by the renderer');
  assert.equal(canvas.canvasSchemaVersion, 5);
  assert.equal(canvas.nodes[0].data.text, 'hello');
  assert.deepEqual(canvas.viewport, { x: 3, y: 4, zoom: 1.2 });
});
