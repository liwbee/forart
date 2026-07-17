const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const AdmZip = require('adm-zip');

const { createAssetStore } = require('../electron/main/modules/asset-store.cjs');
const { createCanvasPackageStore } = require('../electron/main/modules/canvas-package-store.cjs');

test('canvas upload packages include resources stored in React Flow node data', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-canvas-package-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  const assetStore = createAssetStore({
    rootDir,
    net: { fetch: async () => { throw new Error('Unexpected network request'); } },
  });
  const inputDir = assetStore.assetDirectory('input');
  const outputDir = assetStore.assetDirectory('output');
  const writeAsset = (directory, name, content) => {
    const filePath = path.join(directory, name);
    fs.writeFileSync(filePath, content);
    return assetStore.assetUrl(filePath);
  };

  const inputUrl = writeAsset(inputDir, 'input.png', 'input-image');
  const actionPreviewUrl = writeAsset(inputDir, 'action.png', 'action-image');
  const generatedUrl = writeAsset(outputDir, 'generated.png', 'generated-image');
  const actionResultUrl = writeAsset(outputDir, 'action-result.png', 'action-result-image');
  const thumbnailUrl = writeAsset(inputDir, 'thumbnail.png', 'thumbnail-image');
  const missingUrl = assetStore.assetUrl(path.join(inputDir, 'missing.png'));

  const canvas = {
    id: 'canvas-modern',
    title: 'Modern canvas',
    nodes: [
      {
        id: 'image-loader',
        data: { kind: 'imageLoader', imageUrl: inputUrl, thumbUrl: thumbnailUrl },
      },
      {
        id: 'image-generator',
        data: {
          kind: 'imageGenerator',
          generatedImages: [{ localUrl: generatedUrl, thumbUrl: thumbnailUrl }],
          generationTask: {
            result: { localUrl: generatedUrl },
            referenceImages: [inputUrl],
          },
        },
      },
      {
        id: 'action-fission',
        data: {
          kind: 'actionFission',
          actionFission: {
            rows: [{
              id: 'row-1',
              resultUrl: actionResultUrl,
              resultThumbUrl: thumbnailUrl,
              selectedActionAssetUrl: actionPreviewUrl,
            }, {
              id: 'row-2',
              selectedActionAssetUrl: '/api/assets/action-preview/file',
            }],
          },
        },
      },
      {
        id: 'missing-image',
        data: { kind: 'imageLoader', imageUrl: missingUrl },
      },
    ],
    connections: [],
    groups: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };
  const packageStore = createCanvasPackageStore({
    rootDir,
    dialog: {},
    canvasStore: { readCanvas: (canvasId) => canvasId === canvas.id ? canvas : null },
    assetStore,
  });

  const created = packageStore.createPackageForUpload(canvas.id);
  const zip = new AdmZip(created.filePath);
  const manifest = JSON.parse(zip.getEntry('manifest.json').getData().toString('utf8'));
  const packagedCanvas = JSON.parse(zip.getEntry('canvas.json').getData().toString('utf8'));

  assert.equal(manifest.assets.length, 4);
  assert.equal(manifest.warnings.length, 1);
  assert.match(manifest.warnings[0].source, /missing-image.*data\.imageUrl/);
  for (const asset of manifest.assets) assert.ok(zip.getEntry(asset.packagePath));

  assert.match(packagedCanvas.nodes[0].data.imageUrl, /^forart-package:\/\/asset\//);
  assert.equal('thumbUrl' in packagedCanvas.nodes[0].data, false);
  assert.match(packagedCanvas.nodes[1].data.generatedImages[0].localUrl, /^forart-package:\/\/asset\//);
  assert.equal('thumbUrl' in packagedCanvas.nodes[1].data.generatedImages[0], false);
  assert.equal('generationTask' in packagedCanvas.nodes[1].data, false);
  assert.match(packagedCanvas.nodes[2].data.actionFission.rows[0].resultUrl, /^forart-package:\/\/asset\//);
  assert.match(packagedCanvas.nodes[2].data.actionFission.rows[0].selectedActionAssetUrl, /^forart-package:\/\/asset\//);
  assert.equal('resultThumbUrl' in packagedCanvas.nodes[2].data.actionFission.rows[0], false);
  assert.equal(packagedCanvas.nodes[2].data.actionFission.rows[1].selectedActionAssetUrl, '/api/assets/action-preview/file');
  assert.equal('imageUrl' in packagedCanvas.nodes[3].data, false);
});
