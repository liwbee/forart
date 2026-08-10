const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');
const unzipper = require('unzipper');

const { createAssetStore } = require('../electron/main/modules/asset-store.cjs');
const { createCanvasPackageStore } = require('../electron/main/modules/canvas-package-store.cjs');

test('canvas upload packages include resources stored in React Flow node data', async (t) => {
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
    canvasSchemaVersion: 2,
    id: 'canvas-modern',
    title: 'Modern canvas',
    nodes: [
      {
        id: 'image-loader',
        data: { kind: 'imageLoader', imageUrl: inputUrl, thumbUrl: thumbnailUrl },
      },
      {
        id: 'image-generator',
        running: true,
        data: {
          kind: 'imageGenerator',
          running: true,
          latestGenerationTaskId: 'task-image-generator',
          generatedImages: [{ localUrl: generatedUrl, thumbUrl: thumbnailUrl }],
        },
      },
      {
        id: 'action-fission',
        data: {
          kind: 'actionFission',
          actionFission: {
            rows: [{
              id: 'row-1',
              latestGenerationTaskId: 'task-action-row',
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

  const created = await packageStore.createPackageForUpload(canvas.id);
  const archive = await unzipper.Open.file(created.filePath);
  const entries = new Map(archive.files.map((entry) => [entry.path, entry]));
  const manifest = JSON.parse((await entries.get('manifest.json').buffer()).toString('utf8'));
  const packagedCanvas = JSON.parse((await entries.get('canvas.json').buffer()).toString('utf8'));

  assert.equal(packagedCanvas.canvasSchemaVersion, 2);
  assert.equal(manifest.assets.length, 4);
  assert.equal(manifest.warnings.length, 1);
  assert.match(manifest.warnings[0].source, /missing-image.*data\.imageUrl/);
  for (const asset of manifest.assets) assert.ok(entries.has(asset.packagePath));

  assert.match(packagedCanvas.nodes[0].data.imageUrl, /^forart-package:\/\/asset\//);
  assert.equal('thumbUrl' in packagedCanvas.nodes[0].data, false);
  assert.match(packagedCanvas.nodes[1].data.generatedImages[0].localUrl, /^forart-package:\/\/asset\//);
  assert.equal('thumbUrl' in packagedCanvas.nodes[1].data.generatedImages[0], false);
  assert.equal('latestGenerationTaskId' in packagedCanvas.nodes[1].data, false);
  assert.equal('running' in packagedCanvas.nodes[1], false);
  assert.equal('running' in packagedCanvas.nodes[1].data, false);
  assert.match(packagedCanvas.nodes[2].data.actionFission.rows[0].resultUrl, /^forart-package:\/\/asset\//);
  assert.match(packagedCanvas.nodes[2].data.actionFission.rows[0].selectedActionAssetUrl, /^forart-package:\/\/asset\//);
  assert.equal('resultThumbUrl' in packagedCanvas.nodes[2].data.actionFission.rows[0], false);
  assert.equal('latestGenerationTaskId' in packagedCanvas.nodes[2].data.actionFission.rows[0], false);
  assert.equal(packagedCanvas.nodes[2].data.actionFission.rows[1].selectedActionAssetUrl, '/api/assets/action-preview/file');
  assert.equal('imageUrl' in packagedCanvas.nodes[3].data, false);

  let importedPayload = null;
  const importProgress = [];
  const importStore = createCanvasPackageStore({
    rootDir,
    dialog: {},
    canvasStore: {
      listProjects: () => [{ id: 'project-import' }],
      createCanvas: (payload) => {
        importedPayload = payload;
        return { ok: true, canvas: { ...payload, id: 'canvas-imported' }, record: {} };
      },
    },
    assetStore,
  });
  const imported = await importStore.importPackageFile(created.filePath, 'project-import', {
    onProgress: (progress) => importProgress.push(progress),
  });
  assert.equal(imported.canvas.id, 'canvas-imported');
  assert.equal(importedPayload.nodes.length, canvas.nodes.length);
  const importedAssetUrlPattern = /^forart-asset:\/\/canvas\/(?:input|output)\/asset_[0-9a-f-]{36}\.[a-z0-9]+(?:\?v=\d+)?$/;
  assert.match(importedPayload.nodes[0].data.imageUrl, importedAssetUrlPattern);
  assert.match(importedPayload.nodes[1].data.generatedImages[0].localUrl, importedAssetUrlPattern);
  assert.match(importedPayload.nodes[2].data.actionFission.rows[0].resultUrl, importedAssetUrlPattern);
  assert.match(importedPayload.nodes[2].data.actionFission.rows[0].selectedActionAssetUrl, importedAssetUrlPattern);
  assert.equal(importProgress.at(-1).percent, 100);
  assert.ok(importProgress.every((progress, index) => index === 0 || progress.percent >= importProgress[index - 1].percent));
  assert.equal(fs.existsSync(created.filePath), false);

  const controller = new AbortController();
  await assert.rejects(
    packageStore.createPackageForUpload(canvas.id, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === 'scanning') controller.abort();
      },
    }),
    /canceled/i,
  );
  const temporaryFiles = fs.readdirSync(path.join(rootDir, 'CanvasAssests', 'tmp'));
  assert.equal(temporaryFiles.some((fileName) => fileName.endsWith('.part') || fileName.endsWith('.forartcanvas')), false);
});

test('canvas upload streams package bytes, reports progress, and removes the temporary package', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-canvas-upload-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const assetStore = createAssetStore({
    rootDir,
    net: { fetch: async () => { throw new Error('Unexpected network request'); } },
  });
  const packageDirectory = path.join(assetStore.canvasAssetsRoot(), 'tmp');
  fs.mkdirSync(packageDirectory, { recursive: true });
  const packagePath = path.join(packageDirectory, 'upload-test.forartcanvas');
  const packageBuffer = Buffer.alloc(1024 * 1024, 7);
  fs.writeFileSync(packagePath, packageBuffer);

  let receivedBytes = 0;
  const requestHeaders = new Map();
  const net = {
    request() {
      const request = new Writable({
        write(chunk, _encoding, callback) {
          receivedBytes += chunk.length;
          callback();
        },
        final(callback) {
          callback();
          queueMicrotask(() => {
            const response = Readable.from([Buffer.from('{"ok":true}', 'utf8')]);
            response.statusCode = 200;
            response.headers = { 'content-type': 'application/json' };
            request.emit('response', response);
          });
        },
      });
      request.setHeader = (name, value) => {
        if (String(name).toLowerCase() === 'content-length') {
          throw new Error('Electron net.request forbids the Content-Length header.');
        }
        requestHeaders.set(String(name).toLowerCase(), String(value));
      };
      request.abort = () => request.destroy();
      return request;
    },
  };
  const packageStore = createCanvasPackageStore({ rootDir, dialog: {}, canvasStore: {}, assetStore, net });
  const progress = [];
  const result = await packageStore.uploadPackageToRemote({
    filePath: packagePath,
    uploadUrl: 'https://example.test/upload',
  }, {
    onProgress: (value) => progress.push(value),
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(requestHeaders.get('content-type'), 'application/octet-stream');
  assert.equal(receivedBytes, packageBuffer.length);
  assert.equal(progress.at(-1).percent, 100);
  assert.ok(progress.some((value) => value.loadedBytes > 0));
  assert.equal(fs.existsSync(packagePath), false);
});
