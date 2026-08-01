const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const moduleCache = new Map();

function loadTypeScriptModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (moduleCache.has(resolvedPath)) return moduleCache.get(resolvedPath).exports;
  const loaded = { exports: {} };
  moduleCache.set(resolvedPath, loaded);
  const source = fs.readFileSync(resolvedPath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: resolvedPath,
  }).outputText;
  const localRequire = (request) => {
    if (!request.startsWith('.')) return require(request);
    const dependency = path.resolve(path.dirname(resolvedPath), request);
    return loadTypeScriptModule(path.extname(dependency) ? dependency : `${dependency}.ts`);
  };
  const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
  execute(localRequire, loaded, loaded.exports, resolvedPath, path.dirname(resolvedPath));
  return loaded.exports;
}

const featureRoot = path.join(__dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas');
const { applyNativeNodeDataPatch } = loadTypeScriptModule(path.join(featureRoot, 'applyNativeNodeDataPatch.ts'));
const { getImageGeneratorNodeSize, getImageNodeSize } = loadTypeScriptModule(path.join(featureRoot, 'imageNodeSizing.ts'));

function generatorNode(overrides = {}) {
  return {
    id: 'generator-1',
    type: 'canvasNode',
    position: { x: 100, y: 200 },
    data: { kind: 'imageGenerator', label: '', imageAspectRatio: '1:1' },
    style: { width: 280, height: 280 },
    ...overrides,
  };
}

test('empty image generator follows the selected parameter aspect ratio', () => {
  const node = applyNativeNodeDataPatch(generatorNode(), { imageAspectRatio: '3:4' });
  assert.deepEqual(node.style, getImageGeneratorNodeSize('3:4'));
});

test('generated image dimensions resize the generator and preserve its center', () => {
  const original = generatorNode();
  const expected = getImageNodeSize(1536, 1024);
  const node = applyNativeNodeDataPatch(original, {
    generatedImages: [{ localUrl: 'forart-asset://canvas/output/result.png', width: 1536, height: 1024 }],
    imageNaturalWidth: 1536,
    imageNaturalHeight: 1024,
  });

  assert.deepEqual(node.style, expected);
  assert.equal(node.data.imageNaturalWidth, 1536);
  assert.equal(node.data.imageNaturalHeight, 1024);
  assert.equal(node.position.x + expected.width / 2, original.position.x + 140);
  assert.equal(node.position.y + expected.height / 2, original.position.y + 140);
});

test('the primary generated image controls a multi-image generator ratio', () => {
  const node = applyNativeNodeDataPatch(generatorNode(), {
    generatedImages: [
      { localUrl: 'forart-asset://canvas/output/portrait.png', width: 900, height: 1200 },
      { localUrl: 'forart-asset://canvas/output/landscape.png', width: 1200, height: 900 },
    ],
  });
  assert.deepEqual(node.style, getImageNodeSize(900, 1200));
});

test('original-image dimensions recover a task result that omitted dimensions', () => {
  const pending = applyNativeNodeDataPatch(generatorNode(), {
    generatedImages: [{ localUrl: 'forart-asset://canvas/output/legacy.png' }],
    imageNaturalWidth: undefined,
    imageNaturalHeight: undefined,
  });
  assert.deepEqual(pending.style, { width: 280, height: 280 });

  const recovered = applyNativeNodeDataPatch(pending, {
    imageNaturalWidth: 1024,
    imageNaturalHeight: 1536,
  });
  assert.deepEqual(recovered.style, getImageNodeSize(1024, 1536));
});
