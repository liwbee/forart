const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createCanvasCacheStore } = require('../electron/main/modules/canvas-cache-store.cjs');

test('canvas cache protects current canvas assets and SQLite task assets', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-canvas-cache-'));
  try {
    const inputRoot = path.join(rootDir, 'input');
    const outputRoot = path.join(rootDir, 'output');
    fs.mkdirSync(inputRoot, { recursive: true });
    fs.mkdirSync(outputRoot, { recursive: true });

    const files = {
      canvas: path.join(outputRoot, 'canvas-result.png'),
      canvasRemoteFallback: path.join(outputRoot, 'canvas-remote-fallback.png'),
      taskResult: path.join(outputRoot, 'task-result.png'),
      taskInput: path.join(inputRoot, 'task-input.png'),
      unused: path.join(outputRoot, 'unused.png'),
    };
    Object.values(files).forEach((filePath) => fs.writeFileSync(filePath, 'asset'));

    const urlsByPath = new Map(Object.entries(files).map(([name, filePath]) => [
      filePath,
      `forart-asset://${name.startsWith('taskInput') ? 'input' : 'output'}/${path.basename(filePath)}`,
    ]));
    const pathsByUrl = new Map([...urlsByPath].map(([filePath, url]) => [url, filePath]));
    const assetStore = {
      canvasAssetsRoot: () => rootDir,
      assetDirectory: (kind) => kind === 'input' ? inputRoot : outputRoot,
      resolveAssetUrl: (url) => pathsByUrl.get(String(url || '')) || '',
      assetUrl: (filePath) => urlsByPath.get(path.resolve(filePath)) || '',
    };
    const canvasStore = {
      listCanvases: () => [{ id: 'canvas-1' }],
      readCanvas: () => ({
        id: 'canvas-1',
        title: 'Canvas',
        nodes: [{
          id: 'node-1',
          data: {
            generatedImages: [{
              localUrl: urlsByPath.get(files.canvas),
              url: urlsByPath.get(files.canvasRemoteFallback),
            }],
          },
        }],
      }),
    };
    const generationTaskRepository = {
      listTaskRecords: () => [{
        task: {
          id: 'task-1',
          canvasId: 'canvas-1',
          target: { type: 'imageGenerator', nodeId: 'node-1' },
          referenceImages: [urlsByPath.get(files.taskInput)],
          result: { localUrl: urlsByPath.get(files.taskResult) },
        },
      }],
    };
    const cache = createCanvasCacheStore({
      assetStore,
      canvasStore,
      generationTaskRepository,
      shell: { openPath() {}, showItemInFolder() {} },
    });

    const assets = new Map(cache.scan().assets.map((asset) => [asset.fileName, asset]));
    assert.equal(assets.get('canvas-result.png').referenced, true);
    assert.equal(assets.get('canvas-remote-fallback.png').referenced, true);
    assert.equal(assets.get('task-result.png').referenced, true);
    assert.equal(assets.get('task-input.png').referenced, true);
    assert.equal(assets.get('unused.png').referenced, false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('cache cleanup does not remove a shared legacy thumbnail used by another asset', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-canvas-cache-thumb-'));
  try {
    const inputRoot = path.join(rootDir, 'input');
    const outputRoot = path.join(rootDir, 'output');
    const legacyJpg = path.join(inputRoot, 'same-name.jpg');
    const legacyPng = path.join(inputRoot, 'same-name.png');
    const sharedThumb = path.join(inputRoot, 'thumb', 'same-name.webp');
    fs.mkdirSync(path.dirname(sharedThumb), { recursive: true });
    fs.writeFileSync(legacyJpg, 'jpg');
    fs.writeFileSync(legacyPng, 'png');
    fs.writeFileSync(sharedThumb, 'thumb');

    const urlsByPath = new Map([
      [legacyJpg, 'forart-asset://canvas/input/same-name.jpg'],
      [legacyPng, 'forart-asset://canvas/input/same-name.png'],
      [sharedThumb, 'forart-asset://canvas/input/thumb/same-name.webp'],
    ]);
    const pathsByUrl = new Map([...urlsByPath].map(([filePath, url]) => [url, filePath]));
    const cache = createCanvasCacheStore({
      assetStore: {
        canvasAssetsRoot: () => rootDir,
        assetDirectory: (kind) => kind === 'input' ? inputRoot : outputRoot,
        resolveAssetUrl: (url) => pathsByUrl.get(String(url || '')) || '',
        assetUrl: (filePath) => urlsByPath.get(path.resolve(filePath)) || '',
      },
      canvasStore: {
        listCanvases: () => [{ id: 'canvas-1' }],
        readCanvas: () => ({ id: 'canvas-1', nodes: [{ id: 'node-1', data: { imageUrl: urlsByPath.get(legacyPng) } }] }),
      },
      generationTaskRepository: { listTaskRecords: () => [] },
      shell: { openPath() {}, showItemInFolder() {} },
    });

    const scan = cache.scan();
    const jpg = scan.assets.find((asset) => asset.filePath === legacyJpg);
    assert.equal(jpg.referenced, false);
    const result = cache.deleteAssets({ ids: [jpg.id] });
    assert.equal(result.deletedCount, 1);
    assert.equal(fs.existsSync(legacyPng), true);
    assert.equal(fs.existsSync(sharedThumb), true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
