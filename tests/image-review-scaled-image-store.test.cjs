const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { createImageReviewStore } = require('../electron/main/modules/image-review-store.cjs');
const { createImageReviewScaledImageStore } = require('../electron/main/modules/image-review-scaled-image-store.cjs');

test('image review returns separate original and scaled image URLs', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-review-url-'));
  const product = path.join(root, 'SKU-001', 'model');
  fs.mkdirSync(product, { recursive: true });
  const imagePath = path.join(product, 'image.png');
  fs.writeFileSync(imagePath, Buffer.from('image'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const store = createImageReviewStore();
  store.authorizeRoot(root);
  const productImages = await store.loadProductImages({ root, productId: 'SKU-001', modelFolders: 'model', detailFolders: '' });
  const image = productImages.modelImages[0];
  assert.equal(Object.hasOwn(image, 'url'), false);
  assert.match(image.originalUrl, /^forart-review:\/\//);
  assert.match(image.thumbnailUrl, /^forart-review-thumb:\/\//);
  assert.match(image.previewUrl, /^forart-review-preview:\/\//);
  assert.equal(store.resolveScaledImageUrl(image.thumbnailUrl).size, 132);
  assert.equal(store.resolveScaledImageUrl(image.previewUrl).size, 700);
});

test('image review scaled image store limits concurrency and reuses memory entries', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-review-thumb-'));
  const imagePath = path.join(root, 'image.png');
  await sharp({
    create: { width: 900, height: 600, channels: 4, background: { r: 32, g: 64, b: 96, alpha: 1 } },
  }).png().toFile(imagePath);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const store = createImageReviewScaledImageStore({ maxConcurrent: 1, maxBytes: 1024 * 1024 });
  const [first, second] = await Promise.all([
    store.generate(imagePath, 132),
    store.generate(imagePath, 132),
  ]);
  assert.equal(first.buffer, second.buffer);
  assert.equal(store.stats().entries, 1);
  assert.ok(first.buffer.byteLength < 1024 * 1024);
  assert.equal((await sharp(first.buffer).metadata()).width, 132);

  store.clear();
  assert.equal(store.stats().entries, 0);
});

test('image review scaled image store does not run queued work after clear', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-review-clear-'));
  const imagePath = path.join(root, 'image.png');
  fs.writeFileSync(imagePath, Buffer.from('image'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  let releaseFirst;
  let started = 0;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const sharpFactory = () => ({
    rotate() { return this; },
    resize() { return this; },
    webp() { return this; },
    async metadata() { return { hasAlpha: false }; },
    async toBuffer() {
      started += 1;
      if (started === 1) await firstGate;
      return Buffer.from(`result-${started}`);
    },
  });
  const store = createImageReviewScaledImageStore({ maxConcurrent: 1, sharpFactory });
  const active = store.generate(imagePath, 132);
  for (let attempt = 0; attempt < 20 && store.stats().active < 1; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(store.stats().active, 1);
  const queued = store.generate(imagePath, 700);
  for (let attempt = 0; attempt < 20 && store.stats().queued < 1; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(store.stats().active, 1);
  assert.equal(store.stats().queued, 1);
  const queuedRejection = assert.rejects(queued, (error) => error?.code === 'IMAGE_REVIEW_CACHE_CLEARED');

  store.clear();
  const replacement = store.generate(imagePath, 700);
  releaseFirst();

  await active;
  await queuedRejection;
  await replacement;
  assert.equal(started, 2);
  assert.equal(store.stats().entries, 1);
});

test('image review scaled image store preserves alpha pixels losslessly', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-review-alpha-'));
  const imagePath = path.join(root, 'alpha.png');
  const sourcePixels = Buffer.from([
    255, 0, 0, 1,
    0, 255, 0, 64,
    0, 0, 255, 128,
    255, 255, 0, 255,
  ]);
  await sharp(sourcePixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toFile(imagePath);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const store = createImageReviewScaledImageStore();
  const result = await store.generate(imagePath, 132);
  const decoded = await sharp(result.buffer).ensureAlpha().raw().toBuffer();

  assert.equal(result.contentType, 'image/webp');
  assert.deepEqual(decoded, sourcePixels);
});
