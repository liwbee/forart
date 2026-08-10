const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createAssetStore } = require('../electron/main/modules/asset-store.cjs');

test('saved canvas assets include original image dimensions', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-asset-dimensions-'));
  try {
    const { default: sharp } = await import('sharp');
    const buffer = await sharp({
      create: {
        width: 9,
        height: 12,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 1 },
      },
    }).png().toBuffer();
    const store = createAssetStore({
      rootDir,
      net: { fetch: async () => { throw new Error('Unexpected network request.'); } },
    });

    const saved = await store.saveAsset({
      dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
      kind: 'output',
      defaultName: 'result.png',
    });

    assert.equal(saved.width, 9);
    assert.equal(saved.height, 12);
    assert.match(saved.url, /^forart-asset:\/\/canvas\/output\//);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('internal canvas assets use unique UUID names and isolated thumbnail stems', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-asset-identity-'));
  try {
    const { default: sharp } = await import('sharp');
    const pngBuffer = await sharp({
      create: {
        width: 1024,
        height: 1536,
        channels: 4,
        background: { r: 80, g: 100, b: 120, alpha: 1 },
      },
    }).png().toBuffer();
    const jpgBuffer = await sharp(pngBuffer).jpeg().toBuffer();
    const store = createAssetStore({
      rootDir,
      net: { fetch: async () => { throw new Error('Unexpected network request.'); } },
    });

    const first = await store.saveAsset({
      dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
      kind: 'input',
      defaultName: 'same-name.png',
    });
    const second = await store.saveAsset({
      dataUrl: `data:image/jpeg;base64,${jpgBuffer.toString('base64')}`,
      kind: 'input',
      defaultName: 'same-name.jpg',
    });

    assert.match(first.fileName, /^asset_[0-9a-f-]{36}\.png$/);
    assert.match(second.fileName, /^asset_[0-9a-f-]{36}\.jpg$/);
    assert.notEqual(first.fileName, second.fileName);
    assert.equal(path.basename(first.thumbFilePath), `${path.parse(first.fileName).name}.webp`);
    assert.equal(path.basename(second.thumbFilePath), `${path.parse(second.fileName).name}.webp`);
    assert.notEqual(first.thumbFilePath, second.thumbFilePath);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
