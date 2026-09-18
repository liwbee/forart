const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createCanvasAssetThumbnailStore } = require('../electron/main/modules/canvas-asset-thumbnails.cjs');

let sharpModule;
async function loadSharp() {
  if (!sharpModule) {
    sharpModule = (await import('sharp')).default;
    // libvips keeps read files inside its operation cache, which makes the
    // Windows temp dir unremovable at the end of the test.
    sharpModule.cache(false);
  }
  return sharpModule;
}

function createStore(rootDir) {
  return createCanvasAssetThumbnailStore({
    assetRoot: () => rootDir,
    assetUrl: (filePath) => `forart-asset://canvas/${path.relative(rootDir, filePath).replace(/\\/g, '/')}`,
  });
}

test('a deleted canvas thumbnail is rebuilt in place from its original image', async () => {
  const sharp = await loadSharp();
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-canvas-thumb-rebuild-'));
  try {
    const store = createStore(rootDir);
    const sourcePath = path.join(rootDir, 'output', 'sample.png');
    const thumbnailPath = path.join(rootDir, 'output', 'thumb', 'sample.webp');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    await sharp({
      create: { width: 2400, height: 1200, channels: 4, background: { r: 30, g: 60, b: 90, alpha: 1 } },
    }).png().toFile(sourcePath);

    assert.equal(store.canvasAssetSourcePathForThumbnail(thumbnailPath), sourcePath);
    assert.equal(fs.existsSync(thumbnailPath), false);

    const rebuilt = await store.ensureCanvasAssetThumbnailForFile(thumbnailPath);

    assert.equal(rebuilt.thumbFilePath, thumbnailPath);
    assert.equal(store.canvasAssetSourcePathForThumbnail(thumbnailPath), sourcePath);
    // Read from a buffer: metadata reads from a path keep the file handle open.
    const metadata = await sharp(fs.readFileSync(thumbnailPath)).metadata();
    assert.deepEqual({ width: metadata.width, height: metadata.height }, { width: 800, height: 400 });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
  }
});

test('thumbnail rebuild only resolves paths inside the canvas thumb directories', async () => {
  const sharp = await loadSharp();
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-canvas-thumb-guard-'));
  try {
    const store = createStore(rootDir);
    const sourcePath = path.join(rootDir, 'output', 'sample.png');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    await sharp({
      create: { width: 900, height: 600, channels: 3, background: { r: 12, g: 24, b: 36 } },
    }).png().toFile(sourcePath);

    assert.equal(store.canvasAssetSourcePathForThumbnail(sourcePath), '');
    assert.equal(store.canvasAssetSourcePathForThumbnail(path.join(rootDir, 'output', 'thumb', 'missing.webp')), '');
    assert.deepEqual(await store.ensureCanvasAssetThumbnailForFile(sourcePath), {});
    assert.deepEqual(await store.ensureCanvasAssetThumbnailForFile(path.join(rootDir, '..', 'outside.webp')), {});
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
  }
});
