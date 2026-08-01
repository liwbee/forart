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
