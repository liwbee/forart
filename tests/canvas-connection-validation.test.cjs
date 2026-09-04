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
    'canvasConnectionValidation.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  const definitions = {
    imageGenerator: { acceptsInput: true, providesOutput: true },
    assetLoader: { acceptsInput: false, providesOutput: true },
    prompt: { acceptsInput: false, providesOutput: true },
    annotation: { acceptsInput: false, providesOutput: false },
    llm: { acceptsInput: true, providesOutput: true },
    actionFission: { acceptsInput: true, providesOutput: true },
    smartReverse: { acceptsInput: true, providesOutput: true },
    group: { acceptsInput: false, providesOutput: false },
  };
  const inputKindForSource = (kind) => (
    kind === 'assetLoader' || kind === 'imageGenerator'
      ? 'referenceImage'
      : kind === 'prompt' || kind === 'llm' || kind === 'smartReverse'
        ? 'prompt'
        : undefined
  );
  const localRequire = (request) => {
    if (request === './nativeCanvas') {
      return { NATIVE_CANVAS_NODE_DEFINITIONS: definitions };
    }
    if (request === './generation/imageGenerationInputs') {
      return {
        edgeDataForConnection: (sourceKind, targetKind, _targetId, _edges, targetHandle) => {
          if (!['imageGenerator', 'actionFission', 'smartReverse'].includes(targetKind)) return undefined;
          const inputKind = inputKindForSource(sourceKind);
          if (!inputKind) return undefined;
          if (targetHandle === 'additional-reference' && targetKind !== 'actionFission') return undefined;
          return { inputKind };
        },
      };
    }
    return require(request);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    localRequire,
    loaded,
    loaded.exports,
    filePath,
    path.dirname(filePath),
  );
  return loaded.exports;
}

function node(id, kind) {
  return { id, data: { kind } };
}

test('connection validation accepts compatible nodes and rejects unsupported targets', () => {
  const { isNativeCanvasConnectionValid } = loadModule();
  const nodes = [
    node('prompt', 'prompt'),
    node('generator', 'imageGenerator'),
    node('asset', 'assetLoader'),
    node('action', 'actionFission'),
  ];

  assert.equal(isNativeCanvasConnectionValid({ source: 'prompt', target: 'generator', targetHandle: 'input' }, nodes, []), true);
  assert.equal(isNativeCanvasConnectionValid({ source: 'prompt', target: 'asset', targetHandle: 'input' }, nodes, []), false);
  assert.equal(isNativeCanvasConnectionValid({ source: 'action', target: 'generator', targetHandle: 'input' }, nodes, []), false);
});

test('connection validation rejects self-connections and an existing node pair on every handle', () => {
  const { isNativeCanvasConnectionValid } = loadModule();
  const nodes = [node('source', 'assetLoader'), node('target', 'actionFission')];
  const edges = [{
    id: 'existing',
    source: 'source',
    sourceHandle: 'output',
    target: 'target',
    targetHandle: 'input',
  }];

  assert.equal(isNativeCanvasConnectionValid({ source: 'source', target: 'source' }, nodes, []), false);
  assert.equal(isNativeCanvasConnectionValid({
    source: 'source',
    sourceHandle: 'output',
    target: 'target',
    targetHandle: 'additional-reference',
  }, nodes, edges), false);
});

