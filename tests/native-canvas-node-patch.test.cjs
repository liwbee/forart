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
const { getImageGeneratorNodeSize, getImageNodeSize, getVideoNodeSize, VIDEO_NODE_DEFAULT_SIZE } = loadTypeScriptModule(path.join(featureRoot, 'imageNodeSizing.ts'));

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

test('video assets use a larger aspect-preserving canvas surface', () => {
  const imageSize = getImageNodeSize(1920, 1080);
  const videoSize = getVideoNodeSize(1920, 1080);
  assert.ok(videoSize.width > imageSize.width);
  assert.ok(videoSize.height > imageSize.height);
  assert.ok(Math.abs((videoSize.width / videoSize.height) - (16 / 9)) < 0.01);
  assert.deepEqual(getVideoNodeSize(0, 0), VIDEO_NODE_DEFAULT_SIZE);
});

test('generated image dimensions resize the generator without moving it', () => {
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
  // 尺寸跟着主图比例走，位置永远不动（以前按中心回正会把节点挪走）
  assert.deepEqual(node.position, original.position);
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

test('a generator in the expanded grid keeps its position when results change', () => {
  // 展开态：style 是临时的放大尺寸，折叠尺寸记在 multiImageCollapsedSize 里。
  const expanded = generatorNode({
    position: { x: 100, y: 200 },
    style: { width: 608, height: 408 },
    data: {
      kind: 'imageGenerator',
      label: '',
      multiImageExpanded: true,
      multiImageCollapsedSize: { width: 280, height: 280 },
      generatedImages: [{ localUrl: 'forart-asset://canvas/output/first.png', width: 900, height: 1200 }],
    },
  });

  const patched = applyNativeNodeDataPatch(expanded, {
    generatedImages: [
      { localUrl: 'forart-asset://canvas/output/first.png', width: 900, height: 1200 },
      { localUrl: 'forart-asset://canvas/output/second.png', width: 1200, height: 900 },
    ],
  });

  // 展开态下：位置和尺寸都不动（尺寸由展开/折叠布局负责），数据照常更新。
  assert.deepEqual(patched.position, { x: 100, y: 200 });
  assert.deepEqual(patched.style, { width: 608, height: 408 });
  assert.equal(patched.data.multiImageCollapsedSize.width, 280);
  assert.equal(patched.data.generatedImages.length, 2);
});

test('a generation write-back resizes the node in place without moving it', () => {
  const original = generatorNode({
    position: { x: 100, y: 200 },
    style: { width: 608, height: 408 },
    data: {
      kind: 'imageGenerator',
      label: '',
      multiImageExpanded: true,
      multiImageCollapsedSize: { width: 280, height: 280 },
      generatedImages: [{ localUrl: 'forart-asset://canvas/output/first.png', width: 900, height: 1200 }],
    },
  });

  const patched = applyNativeNodeDataPatch(original, {
    generatedImages: [{ localUrl: 'forart-asset://canvas/output/second.png', width: 1200, height: 900 }],
    imageNaturalWidth: 1200,
    imageNaturalHeight: 900,
    multiImageExpanded: false,
  });

  // 生成写回会顺带折叠：尺寸回到主图比例，但位置保持不动。
  assert.deepEqual(patched.position, { x: 100, y: 200 });
  assert.deepEqual(patched.style, getImageNodeSize(1200, 900));
});

test('a manually resized generator is re-fitted in place, never moved', () => {
  const resized = generatorNode({
    position: { x: 40, y: 60 },
    style: { width: 520, height: 300 },
    data: { kind: 'imageGenerator', label: '' },
  });

  const patched = applyNativeNodeDataPatch(resized, {
    generatedImages: [{ localUrl: 'forart-asset://canvas/output/wide.png', width: 1600, height: 900 }],
    imageNaturalWidth: 1600,
    imageNaturalHeight: 900,
  });

  assert.deepEqual(patched.position, { x: 40, y: 60 });
  assert.deepEqual(patched.style, getImageNodeSize(1600, 900));
  // 数据本身照常更新
  assert.equal(patched.data.imageNaturalWidth, 1600);
  assert.equal(patched.data.generatedImages.length, 1);
});
