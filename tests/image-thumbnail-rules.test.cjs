const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

let thumbnailModule;
async function loadThumbnailModule() {
  thumbnailModule ||= await import('../server/src/shared/image-thumbnail-sharp.mjs');
  return thumbnailModule;
}

let sharpModule;
async function loadSharp() {
  if (!sharpModule) {
    sharpModule = (await import('sharp')).default;
    // libvips keeps files it read inside its operation cache, which makes the
    // Windows temp dir unremovable at the end of the test.
    sharpModule.cache(false);
  }
  return sharpModule;
}

function removeTempDir(rootDir) {
  // Windows keeps sharp's input handles open long enough to trip EPERM on rm.
  fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
}

function longEdge(metadata) {
  return Math.max(Number(metadata.width || 0), Number(metadata.height || 0));
}

test('image thumbnails cap their long edge at 800px', async () => {
  const { generateSharpImageThumbnail, IMAGE_THUMBNAIL_RULES } = await loadThumbnailModule();
  const sharp = await loadSharp();
  assert.equal(IMAGE_THUMBNAIL_RULES.maxLongEdge, 800);
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-thumbnail-rules-'));
  try {
    const sourcePath = path.join(rootDir, 'source.png');
    const targetPath = path.join(rootDir, 'thumb', 'source.webp');
    await sharp({
      create: { width: 2400, height: 1200, channels: 4, background: { r: 12, g: 34, b: 56, alpha: 1 } },
    }).png().toFile(sourcePath);

    const generated = await generateSharpImageThumbnail({ key: 'rules:new', sourcePath, targetPath, logger: () => {} });

    assert.equal(generated?.filePath, targetPath);
    const metadata = await sharp(targetPath).metadata();
    assert.equal(longEdge(metadata), 800);
  } finally {
    removeTempDir(rootDir);
  }
});

test('cached thumbnails newer than their source are reused as they are', async () => {
  const { generateSharpImageThumbnail } = await loadThumbnailModule();
  const sharp = await loadSharp();
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-thumbnail-cached-'));
  try {
    const sourcePath = path.join(rootDir, 'source.png');
    const targetPath = path.join(rootDir, 'thumb', 'source.webp');
    await sharp({
      create: { width: 3200, height: 1600, channels: 4, background: { r: 90, g: 40, b: 10, alpha: 1 } },
    }).png().toFile(sourcePath);
    // A thumbnail cached by an older build. Deleting the cache is what triggers
    // a rebuild; an existing cache file is reused until then.
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    await sharp({
      create: { width: 1280, height: 640, channels: 3, background: { r: 200, g: 200, b: 200 } },
    }).webp().toFile(targetPath);

    const generated = await generateSharpImageThumbnail({ key: 'rules:cached', sourcePath, targetPath, logger: () => {} });

    assert.equal(generated?.filePath, targetPath);
    const metadata = await sharp(targetPath).metadata();
    assert.equal(longEdge(metadata), 1280);
  } finally {
    removeTempDir(rootDir);
  }
});

test('images below the minimum long edge keep falling back to the original', async () => {
  const { generateSharpImageThumbnail } = await loadThumbnailModule();
  const sharp = await loadSharp();
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-thumbnail-small-'));
  try {
    const sourcePath = path.join(rootDir, 'small.png');
    const targetPath = path.join(rootDir, 'thumb', 'small.webp');
    await sharp({
      create: { width: 320, height: 240, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
    }).png().toFile(sourcePath);

    const generated = await generateSharpImageThumbnail({ key: 'rules:small', sourcePath, targetPath, logger: () => {} });

    assert.equal(generated, null);
    assert.equal(fs.existsSync(targetPath), false);
  } finally {
    removeTempDir(rootDir);
  }
});
