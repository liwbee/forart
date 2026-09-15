const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadNativeCanvas() {
  const filePath = path.join(__dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas', 'nativeCanvas.ts');
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const loaded = { exports: {} };
  const icons = new Proxy({}, { get: () => function Icon() {} });
  const localRequire = (specifier) => {
    if (specifier === 'lucide-react') return icons;
    if (specifier === './imageNodeSizing') {
      return {
        ASSET_LOADER_DEFAULT_SIZE: { width: 260, height: 180 },
        IMAGE_GENERATOR_DEFAULT_SIZE: { width: 420, height: 360 },
        getImageGeneratorNodeSize: () => ({ width: 420, height: 360 }),
        getImageNodeSize: () => ({ width: 260, height: 180 }),
      };
    }
    if (specifier === './action-fission/actionFissionTypes') return {};
    if (specifier === './batchNodeSizing') {
      return {
        BATCH_NODE_DEFAULT_SIZE: { width: 1010, height: 478 },
        BATCH_NODE_RESIZE_CONFIG: { minWidth: 762, minHeight: 478 },
      };
    }
    return require(specifier);
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

function referenceDocument(edgeId) {
  return {
    root: {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [
          { type: 'text', text: 'Use ' },
          { type: 'image-reference', edgeId },
        ],
      }],
    },
  };
}

test('cloned prompt documents rebind copied edge ids without mutating the source', () => {
  const { remapNativeCanvasNodePromptReferences } = loadNativeCanvas();
  const source = {
    kind: 'imageGenerator',
    label: 'Generator',
    text: 'Use @图一',
    imagePromptDocument: referenceDocument('edge-old'),
    smartReverseInstructionDocument: referenceDocument('edge-old'),
  };
  const clone = remapNativeCanvasNodePromptReferences(source, new Map([['edge-old', 'edge-new']]));

  assert.equal(clone.imagePromptDocument.root.children[0].children[1].edgeId, 'edge-new');
  assert.equal(clone.smartReverseInstructionDocument.root.children[0].children[1].edgeId, 'edge-new');
  assert.equal(source.imagePromptDocument.root.children[0].children[1].edgeId, 'edge-old');
});

test('references whose edges were not copied remain unresolved instead of being rebound', () => {
  const { remapNativeCanvasNodePromptReferences } = loadNativeCanvas();
  const source = { kind: 'imageGenerator', label: 'Generator', imagePromptDocument: referenceDocument('edge-old') };
  const clone = remapNativeCanvasNodePromptReferences(source, new Map());
  assert.equal(clone.imagePromptDocument.root.children[0].children[1].edgeId, 'edge-old');
});
