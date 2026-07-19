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
            generatedImages: [{ localUrl: urlsByPath.get(files.canvas) }],
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
    assert.equal(assets.get('task-result.png').referenced, true);
    assert.equal(assets.get('task-input.png').referenced, true);
    assert.equal(assets.get('unused.png').referenced, false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
