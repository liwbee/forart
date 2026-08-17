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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
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
const {
  applyCanvasNodeThumbnail,
  collectMissingCanvasThumbnailTargets,
} = loadTypeScriptModule(path.join(featureRoot, 'canvasThumbnails.ts'));

function node(id, kind, data = {}) {
  return { id, type: 'canvasNode', position: { x: 0, y: 0 }, data: { kind, label: id, ...data } };
}

test('collects every missing thumbnail in image and multi-result generator nodes', () => {
  const nodes = [
    node('loader', 'imageLoader', { imageUrl: 'loader-original.png' }),
    node('generator', 'imageGenerator', {
      generatedImages: [
        { localUrl: 'first-original.png' },
        { url: 'second-original.png' },
        { url: 'already-done.png', thumbUrl: 'already-done-thumb.png' },
      ],
    }),
    node('prompt', 'prompt', { imageUrl: 'ignored.png' }),
  ];

  assert.deepEqual(collectMissingCanvasThumbnailTargets(nodes), [
    { nodeId: 'loader', sourceUrl: 'loader-original.png' },
    { nodeId: 'generator', sourceUrl: 'first-original.png' },
    { nodeId: 'generator', sourceUrl: 'second-original.png' },
  ]);
});

test('writes only the thumbnail matching the current original image', () => {
  const nodes = [
    node('loader', 'imageLoader', { imageUrl: 'new-original.png' }),
    node('generator', 'imageGenerator', {
      generatedImages: [{ url: 'first.png' }, { url: 'second.png' }],
    }),
  ];

  const stale = applyCanvasNodeThumbnail(nodes, 'loader', 'old-original.png', 'old-thumb.png');
  assert.equal(stale[0].data.thumbUrl, undefined);

  const updated = applyCanvasNodeThumbnail(nodes, 'generator', 'second.png', 'second-thumb.png');
  assert.equal(updated[1].data.generatedImages[0].thumbUrl, undefined);
  assert.equal(updated[1].data.generatedImages[1].thumbUrl, 'second-thumb.png');
});
