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
    'generation',
    'imageGenerationInputs.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (request) => {
    if (request === '../../../lib/libraryImageActions') {
      return { resolveLibraryImageUrl: (url) => String(url || '') };
    }
    if (request === '../nativeCanvas') {
      return {
        nativeCanvasNodePrimaryImage: (data) => {
          if (data.kind === 'imageGenerator') return data.generatedImages?.[0] || null;
          return data.imageUrl
            ? { localUrl: data.imageUrl, thumbUrl: data.thumbUrl }
            : null;
        },
      };
    }
    if (request === '../canvasThumbnails') {
      return { canvasPreviewSourceUrl: (original, thumbnail) => String(thumbnail || original || '').trim() };
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

function imageNode(id, imageUrl, thumbUrl) {
  return {
    id,
    data: {
      kind: 'imageLoader',
      label: id,
      imageUrl,
      thumbUrl,
    },
  };
}

function edge(id, source, target, inputKind, referenceOrder) {
  return { id, source, target, data: { inputKind, referenceOrder } };
}

test('reference toolbar prefers thumbnails and falls back to original images', () => {
  const {
    collectActionFissionAdditionalReferences,
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
    collectActionFissionAdditionalReferences('action', nodes, edges).map((item) => item.previewUrl),
    ['original-b.png'],
  );
});
