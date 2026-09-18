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
  const output = ts.transpileModule(fs.readFileSync(resolvedPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: resolvedPath,
  }).outputText;
  const localRequire = (request) => {
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

const featureRoot = path.join(__dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas');
const { collectGroupImageAdjustTargets, groupImageAdjustTargetKey } = loadTypeScriptModule(
  path.join(featureRoot, 'groupImageAdjustTargets.ts'),
);

function imageNode(id, label, images, options = {}) {
  return {
    id,
    type: 'canvasNode',
    position: options.position || { x: 0, y: 0 },
    ...(options.parentId ? { parentId: options.parentId } : {}),
    data: { kind: options.kind || 'imageGenerator', label, generatedImages: images, ...options.data },
  };
}

test('collects group images in reading order and expands multi-image nodes', () => {
  const nodes = [
    { id: 'group', type: 'groupNode', position: { x: 200, y: 100 }, data: { kind: 'group', label: 'Group' } },
    // 位置是相对父节点的：靠下的节点排在后面。
    imageNode('lower', 'Lower', [{ localUrl: 'lower.png', thumbUrl: 'lower-thumb.png' }], { parentId: 'group', position: { x: 10, y: 300 } }),
    imageNode('upper', 'Upper', [{ url: 'upper-a.png' }, { thumbUrl: 'upper-b-thumb.png', localUrl: 'upper-b.png' }], {
      parentId: 'group',
      position: { x: 40, y: 20 },
    }),
    { id: 'prompt', type: 'canvasNode', parentId: 'group', position: { x: 0, y: 0 }, data: { kind: 'prompt', label: 'Prompt' } },
    imageNode('outside', 'Outside', [{ url: 'outside.png' }], { position: { x: 0, y: 0 } }),
  ];

  assert.deepEqual(collectGroupImageAdjustTargets(nodes, 'group').map((target) => ({
    key: target.key,
    label: target.label,
    thumbnailUrl: target.thumbnailUrl,
  })), [
    // 两图节点：标签带序号，缩略图优先 thumbUrl，其次原图。
    { key: groupImageAdjustTargetKey('upper', 0), label: 'Upper · 1', thumbnailUrl: 'upper-a.png' },
    { key: groupImageAdjustTargetKey('upper', 1), label: 'Upper · 2', thumbnailUrl: 'upper-b-thumb.png' },
    { key: groupImageAdjustTargetKey('lower', 0), label: 'Lower', thumbnailUrl: 'lower-thumb.png' },
  ]);
});

test('includes nested groups and marks assets that are still loading', () => {
  const nodes = [
    { id: 'group', type: 'groupNode', position: { x: 0, y: 0 }, data: { kind: 'group', label: 'Group' } },
    { id: 'inner', type: 'groupNode', parentId: 'group', position: { x: 20, y: 20 }, data: { kind: 'group', label: 'Inner' } },
    imageNode('nested-image', 'Nested', [{ url: 'nested.png' }], { parentId: 'inner', position: { x: 0, y: 0 } }),
    imageNode('loading-image', 'Loading', [], {
      parentId: 'group',
      position: { x: 0, y: -10 },
      kind: 'assetLoader',
      data: { assetUrl: 'loading.png', assetLoadState: 'processing' },
    }),
  ];

  const targets = collectGroupImageAdjustTargets(nodes, 'group');

  assert.deepEqual(targets.map((target) => target.key), [
    groupImageAdjustTargetKey('loading-image', 0),
    groupImageAdjustTargetKey('nested-image', 0),
  ]);
  assert.equal(targets[0].isAssetLoading, true);
  assert.equal(targets[1].isAssetLoading, false);
});

test('returns nothing for an empty group or a group without images', () => {
  const nodes = [
    { id: 'group', type: 'groupNode', position: { x: 0, y: 0 }, data: { kind: 'group', label: 'Group' } },
    { id: 'empty-generator', type: 'canvasNode', parentId: 'group', position: { x: 0, y: 0 }, data: { kind: 'imageGenerator', label: 'Empty', generatedImages: [] } },
  ];

  assert.deepEqual(collectGroupImageAdjustTargets(nodes, 'group'), []);
  assert.deepEqual(collectGroupImageAdjustTargets(nodes, ''), []);
  assert.deepEqual(collectGroupImageAdjustTargets(nodes, 'missing'), []);
});
