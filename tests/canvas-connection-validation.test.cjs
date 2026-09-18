const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const featureRoot = path.join(__dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas');
const moduleCache = new Map();

/** 递归加载 TS 源码，跑的就是页面里那份校验逻辑。 */
function loadTypeScriptModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (moduleCache.has(resolvedPath)) return moduleCache.get(resolvedPath).exports;
  const loaded = { exports: {} };
  moduleCache.set(resolvedPath, loaded);
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: resolvedPath,
  }).outputText;
  const localRequire = (request) => {
    if (request === '../../../lib/libraryImageActions') {
      return { resolveLibraryImageUrl: (url) => String(url || '') };
    }
    if (!request.startsWith('.')) return require(request);
    const dependency = path.resolve(path.dirname(resolvedPath), request);
    return loadTypeScriptModule(path.extname(dependency) ? dependency : `${dependency}.ts`);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    localRequire,
    loaded,
    loaded.exports,
    resolvedPath,
    path.dirname(resolvedPath),
  );
  return loaded.exports;
}

function loadModule() {
  return loadTypeScriptModule(path.join(featureRoot, 'canvasConnectionValidation.ts'));
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

test('connection validation rejects self-connections and a repeated handle', () => {
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
  // 同一个端口连第二次：拒绝
  assert.equal(isNativeCanvasConnectionValid({
    source: 'source',
    sourceHandle: 'output',
    target: 'target',
    targetHandle: 'input',
  }, nodes, edges), false);
});

test('the same source can feed different handles of one batch node', () => {
  const { isNativeCanvasConnectionValid } = loadModule();
  const nodes = [
    { id: 'source', data: { kind: 'assetLoader', assetUrl: 'a.png' } },
    { id: 'batch', data: { kind: 'batchImageGenerator', batchImageGenerator: { items: [] } } },
  ];
  const edges = [{
    id: 'main',
    source: 'source',
    sourceHandle: 'output',
    target: 'batch',
    targetHandle: 'input',
  }];

  // 已经连了主参考，还可以连附加参考和「传入目标」
  assert.equal(isNativeCanvasConnectionValid({
    source: 'source',
    sourceHandle: 'output',
    target: 'batch',
    targetHandle: 'additional-reference',
  }, nodes, edges), true);
  assert.equal(isNativeCanvasConnectionValid({
    source: 'source',
    sourceHandle: 'output',
    target: 'batch',
    targetHandle: 'batch-import-target',
  }, nodes, edges), true);
  // 「传入目标」端口只收图片
  assert.equal(isNativeCanvasConnectionValid({
    source: 'prompt-source',
    sourceHandle: 'output',
    target: 'batch',
    targetHandle: 'batch-import-target',
  }, [...nodes, { id: 'prompt-source', data: { kind: 'prompt', text: 'hi' } }], edges), false);
});

