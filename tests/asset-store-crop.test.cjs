const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createAssetStore } = require('../electron/main/modules/asset-store.cjs');

/**
 * 造一张 400×300 的四色图：左上红、右上绿、左下蓝、右下黄。
 * 这样任何一次裁剪落在哪个象限，读一个像素就能看出来。
 */
async function createQuadrantImage(filePath) {
  const { default: sharp } = await import('sharp');
  const quadrant = (background) => sharp({
    create: { width: 200, height: 150, channels: 4, background },
  }).png().toBuffer();
  const [red, green, blue, yellow] = await Promise.all([
    quadrant({ r: 255, g: 0, b: 0, alpha: 1 }),
    quadrant({ r: 0, g: 255, b: 0, alpha: 1 }),
    quadrant({ r: 0, g: 0, b: 255, alpha: 1 }),
    quadrant({ r: 255, g: 255, b: 0, alpha: 1 }),
  ]);
  await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite([
      { input: red, left: 0, top: 0 },
      { input: green, left: 200, top: 0 },
      { input: blue, left: 0, top: 150 },
      { input: yellow, left: 200, top: 150 },
    ])
    .png()
    .toFile(filePath);
}

async function readCenterPixel(filePath) {
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  const x = Math.floor(info.width / 2);
  const y = Math.floor(info.height / 2);
  const offset = (y * info.width + x) * info.channels;
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
}

async function withStore(run) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-crop-asset-'));
  try {
    const store = createAssetStore({
      rootDir,
      net: { fetch: async () => { throw new Error('Unexpected network request.'); } },
    });
    const sourcePath = path.join(rootDir, 'source.png');
    await createQuadrantImage(sourcePath);
    await run({ store, sourcePath, rootDir });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

test('percent crop lands on the selected region instead of the top-left corner', async () => {
  await withStore(async ({ store, sourcePath }) => {
    // 右下角：x/y 各 50%，宽高各 50%（选区完全在右下象限里）。
    const cropped = await store.cropAsset({
      filePath: sourcePath,
      unit: 'percent',
      x: 50,
      y: 50,
      width: 50,
      height: 50,
      defaultName: 'crop.png',
    });

    assert.equal(cropped.width, 200);
    assert.equal(cropped.height, 150);
    const pixel = await readCenterPixel(cropped.filePath);
    // 以前按缩略图坐标算的时候，这里会切到左上角的红色区域。
    assert.deepEqual(pixel, { r: 255, g: 255, b: 0 });
  });
});

test('percent crop converts against the real source size', async () => {
  await withStore(async ({ store, sourcePath }) => {
    const cropped = await store.cropAsset({
      filePath: sourcePath,
      unit: 'percent',
      x: 0,
      y: 0,
      width: 25,
      height: 40,
      defaultName: 'crop.png',
    });

    assert.equal(cropped.width, 100);
    assert.equal(cropped.height, 120);
    const pixel = await readCenterPixel(cropped.filePath);
    assert.deepEqual(pixel, { r: 255, g: 0, b: 0 });
  });
});

test('pixel crop payloads keep working', async () => {
  await withStore(async ({ store, sourcePath }) => {
    const cropped = await store.cropAsset({
      filePath: sourcePath,
      x: 200,
      y: 150,
      width: 200,
      height: 150,
      defaultName: 'crop.png',
    });

    assert.equal(cropped.width, 200);
    assert.equal(cropped.height, 150);
    const pixel = await readCenterPixel(cropped.filePath);
    assert.deepEqual(pixel, { r: 255, g: 255, b: 0 });
  });
});
