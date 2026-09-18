const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const featureRoot = path.join(__dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas');
const moduleCache = new Map();

/** 递归加载 TS 源码（含相对依赖），只替换掉依赖浏览器/i18n 的资源模块。 */
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
  return loadTypeScriptModule(path.join(featureRoot, 'generation', 'imageGenerationInputs.ts'));
}

function imageNode(id, imageUrl, thumbUrl) {
  return {
    id,
    data: {
      kind: 'assetLoader',
      label: id,
      assetUrl: imageUrl,
      assetThumbUrl: thumbUrl,
    },
  };
}

function promptNode(id, text) {
  return {
    id,
    data: {
      kind: 'prompt',
      label: id,
      text,
    },
  };
}

function canvasNode(id, kind, data = {}, options = {}) {
  return {
    id,
    type: kind === 'group' ? 'groupNode' : 'canvasNode',
    position: options.position || { x: 0, y: 0 },
    ...(options.parentId ? { parentId: options.parentId } : {}),
    data: { kind, label: id, ...data },
  };
}

function edge(id, source, target, inputKind, referenceOrder) {
  return { id, source, target, data: { inputKind, referenceOrder } };
}

test('reference toolbar prefers thumbnails and falls back to original images', () => {
  const {
    collectAdditionalImageReferences,
    collectImageGeneratorReferences,
  } = loadModule();
  const nodes = [
    imageNode('with-thumb', 'original-a.png', 'thumb-a.webp'),
    imageNode('without-thumb', 'original-b.png', ''),
  ];
  const edges = [
    edge('main-1', 'with-thumb', 'generator', 'referenceImage', 1),
    edge('main-2', 'without-thumb', 'generator', 'referenceImage', 2),
    edge('extra-1', 'without-thumb', 'action', 'additionalReferenceImage', 1),
  ];

  assert.deepEqual(
    collectImageGeneratorReferences('generator', nodes, edges).map((item) => item.previewUrl),
    ['thumb-a.webp', 'original-b.png'],
  );
  assert.deepEqual(
    collectAdditionalImageReferences('action', nodes, edges).map((item) => item.previewUrl),
    ['original-b.png'],
  );
});

test('smart reverse accepts and collects connected prompt inputs', () => {
  const {
    collectImageGeneratorPrompts,
    edgeDataForConnection,
  } = loadModule();
  const nodes = [promptNode('prompt-a', 'Describe the clothing and accessories')];
  const edges = [];
  assert.deepEqual(
    edgeDataForConnection('prompt', 'smartReverse', 'reverse', edges),
    { inputKind: 'prompt' },
  );
  assert.deepEqual(
    collectImageGeneratorPrompts(
      'reverse',
      nodes,
      [{ id: 'prompt-edge', source: 'prompt-a', target: 'reverse', data: { inputKind: 'prompt' } }],
    ),
    [{ edgeId: 'prompt-edge', nodeId: 'prompt-a', title: '', text: 'Describe the clothing and accessories' }],
  );
});

test('a group source contributes every image inside it as a reference', () => {
  const {
    collectImageGeneratorReferences,
    edgeDataForConnection,
    inputKindForSource,
  } = loadModule();
  const nodes = [
    canvasNode('group', 'group', {}, { position: { x: 0, y: 0 } }),
    canvasNode('generator-in-group', 'imageGenerator', {
      generatedImages: [{ url: 'in-group-a.png' }, { localUrl: 'in-group-b.png', thumbUrl: 'in-group-b-thumb.webp' }],
    }, { parentId: 'group', position: { x: 20, y: 20 } }),
    canvasNode('asset-in-group', 'assetLoader', {
      assetUrl: 'in-group-c.png',
      assetThumbUrl: 'in-group-c-thumb.webp',
    }, { parentId: 'group', position: { x: 20, y: 300 } }),
    // 组里没有图的节点不算参考
    canvasNode('prompt-in-group', 'prompt', { text: 'hello' }, { parentId: 'group', position: { x: 20, y: 400 } }),
    canvasNode('target', 'imageGenerator', {}),
  ];
  const edges = [edge('group-edge', 'group', 'target', 'referenceImage', 1)];

  const references = collectImageGeneratorReferences('target', nodes, edges, 'fallback');

  // 组内两张图 + 一张素材图，按组内的阅读顺序（先上后下）。
  assert.deepEqual(references.map((item) => item.imageUrl), [
    'in-group-a.png',
    'in-group-b.png',
    'in-group-c.png',
  ]);
  assert.deepEqual(references.map((item) => item.previewUrl), [
    'in-group-a.png',
    'in-group-b-thumb.webp',
    'in-group-c-thumb.webp',
  ]);
  assert.deepEqual(references.map((item) => item.title), ['generator-in-group 1', 'generator-in-group 2', 'asset-in-group']);
  // 组内图片的顺序由组内容决定，不给单独删除/排序
  assert.equal(references.every((item) => item.fromGroup), true);
  assert.equal(new Set(references.map((item) => item.edgeId)).size, references.length);

  // 组现在也提供输出端点，可以连到图片生成节点
  assert.equal(inputKindForSource('group'), 'referenceImage');
  assert.deepEqual(
    edgeDataForConnection('group', 'imageGenerator', 'target', [], 'input'),
    { inputKind: 'referenceImage', referenceOrder: 1 },
  );
});

test('a stored image order reorders the references that share one edge', () => {
  const { collectImageGeneratorReferences } = loadModule();
  const nodes = [
    canvasNode('group', 'group', {}),
    canvasNode('gen', 'imageGenerator', {
      generatedImages: [{ url: 'a.png' }, { url: 'b.png' }],
    }, { parentId: 'group', position: { x: 0, y: 0 } }),
    canvasNode('asset', 'assetLoader', { assetUrl: 'c.png' }, { parentId: 'group', position: { x: 0, y: 200 } }),
    canvasNode('target', 'imageGenerator', {}),
  ];
  const edges = [{
    id: 'group-edge',
    source: 'group',
    target: 'target',
    data: {
      inputKind: 'referenceImage',
      referenceOrder: 1,
      // 拖过之后记下来的顺序：素材排到最前，生成节点的第二张排第二
      referenceImageOrder: ['asset#0', 'gen#1', 'gen#0'],
    },
  }];

  const references = collectImageGeneratorReferences('target', nodes, edges);

  assert.deepEqual(references.map((item) => item.imageUrl), ['c.png', 'b.png', 'a.png']);
  assert.deepEqual(references.map((item) => item.sortKey), ['asset#0', 'gen#1', 'gen#0']);
  // 合成 id 仍然指回同一条边，页面按它写回顺序
  assert.equal(references.every((item) => item.sourceEdgeId === 'group-edge'), true);
});

test('the batch import-target port only accepts images and stays out of the references', () => {
  const {
    collectBatchTargetImages,
    collectImageGeneratorReferences,
    edgeDataForConnection,
  } = loadModule();

  // 图片来源可以连，文字来源连不上
  assert.deepEqual(
    edgeDataForConnection('assetLoader', 'batchImageGenerator', 'batch', [], 'batch-import-target'),
    { inputKind: 'batchTargetImage', referenceOrder: 1 },
  );
  assert.equal(
    edgeDataForConnection('prompt', 'batchImageGenerator', 'batch', [], 'batch-import-target'),
    undefined,
  );
  // 只有批量洗图有这个端口
  assert.equal(
    edgeDataForConnection('assetLoader', 'imageGenerator', 'generator', [], 'batch-import-target'),
    undefined,
  );

  const nodes = [
    canvasNode('group', 'group', {}),
    canvasNode('gen', 'imageGenerator', {
      generatedImages: [{ localUrl: 'a.png', fileName: 'a.png' }, { localUrl: 'b.png', fileName: 'b.png' }],
    }, { parentId: 'group', position: { x: 0, y: 0 } }),
    canvasNode('asset', 'assetLoader', { assetUrl: 'c.png', assetThumbUrl: 'c-thumb.webp' }, { parentId: 'group', position: { x: 0, y: 200 } }),
    canvasNode('batch', 'batchImageGenerator', {}),
  ];
  const edges = [
    { id: 'target-edge', source: 'group', target: 'batch', data: { inputKind: 'batchTargetImage', referenceOrder: 1 } },
    { id: 'main-edge', source: 'asset', target: 'batch', data: { inputKind: 'referenceImage', referenceOrder: 1 } },
  ];

  const targets = collectBatchTargetImages('batch', nodes, edges);
  assert.deepEqual(targets.map((item) => item.imageUrl), ['a.png', 'b.png', 'c.png']);
  assert.deepEqual(targets.map((item) => item.fileName), ['a.png', 'b.png', 'asset']);
  assert.deepEqual(targets.map((item) => item.previewUrl), ['a.png', 'b.png', 'c-thumb.webp']);
  assert.equal(targets.every((item) => item.edgeId === 'target-edge'), true);

  // 目标边不会进入参考图列表（模型只看到主参考）
  assert.deepEqual(
    collectImageGeneratorReferences('batch', nodes, edges).map((item) => item.imageUrl),
    ['c.png'],
  );
});

test('the batch import-target port accepts image sources and rejects text sources', () => {
  const { isNativeCanvasConnectionValid } = loadTypeScriptModule(
    path.join(featureRoot, 'canvasConnectionValidation.ts'),
  );
  const nodes = [
    canvasNode('asset', 'assetLoader', { assetUrl: 'a.png' }),
    canvasNode('prompt', 'prompt', { text: 'describe this' }),
    canvasNode('batch', 'batchImageGenerator', {}),
  ];

  assert.equal(
    isNativeCanvasConnectionValid({ source: 'asset', target: 'batch', targetHandle: 'batch-import-target' }, nodes, []),
    true,
  );
  assert.equal(
    isNativeCanvasConnectionValid({ source: 'prompt', target: 'batch', targetHandle: 'batch-import-target' }, nodes, []),
    false,
  );
});
