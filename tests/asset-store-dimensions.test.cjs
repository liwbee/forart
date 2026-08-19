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

test('generated output assets are encoded and named as PNG while input assets keep their format', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-asset-output-png-'));
  try {
    const { default: sharp } = await import('sharp');
    const jpegBuffer = await sharp({
      create: {
        width: 7,
        height: 5,
        channels: 3,
        background: { r: 140, g: 90, b: 40 },
      },
    }).jpeg().toBuffer();
    const store = createAssetStore({
      rootDir,
      net: { fetch: async () => { throw new Error('Unexpected network request.'); } },
    });

    const input = await store.saveAsset({
      dataUrl: `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`,
      kind: 'input',
    });
    const output = await store.saveAsset({
      dataUrl: `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`,
      kind: 'output',
    });

    assert.equal(path.extname(input.filePath), '.jpg');
    assert.equal((await sharp(input.filePath).metadata()).format, 'jpeg');
    assert.equal(path.extname(output.filePath), '.png');
    assert.equal((await sharp(output.filePath).metadata()).format, 'png');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('generated output ignores a misleading text/plain response type and saves valid PNG', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-asset-plain-mime-'));
  try {
    const { default: sharp } = await import('sharp');
    const pngBuffer = await sharp({
      create: {
        width: 6,
        height: 4,
        channels: 4,
        background: { r: 20, g: 60, b: 100, alpha: 1 },
      },
    }).png().toBuffer();
    const store = createAssetStore({
      rootDir,
      net: {
        fetch: async () => ({
          ok: true,
          headers: { get: () => 'text/plain' },
          arrayBuffer: async () => pngBuffer,
        }),
      },
    });

    const saved = await store.saveAsset({ url: 'https://example.test/result', kind: 'output' });

    assert.equal(path.extname(saved.filePath), '.png');
    assert.equal((await sharp(saved.filePath).metadata()).format, 'png');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('PNG result downloads replace legacy extensions and contain PNG bytes', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-result-png-'));
  const downloadsPath = path.join(rootDir, 'downloads');
  try {
    const { default: sharp } = await import('sharp');
    const jpegBuffer = await sharp({
      create: {
        width: 8,
        height: 3,
        channels: 3,
        background: { r: 210, g: 170, b: 130 },
      },
    }).jpeg().toBuffer();
    const store = createAssetStore({
      rootDir,
      net: { fetch: async () => { throw new Error('Unexpected network request.'); } },
    });

    const saved = await store.saveResult({
      dataUrl: `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`,
      defaultName: 'legacy-result.plain',
      convertToPng: true,
    }, downloadsPath);

    assert.equal(path.basename(saved.filePath), 'legacy-result.png');
    assert.equal((await sharp(saved.filePath).metadata()).format, 'png');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('result downloads preserve original JPEG bytes and extension when PNG conversion is disabled', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-result-original-'));
  const downloadsPath = path.join(rootDir, 'downloads');
  try {
    const { default: sharp } = await import('sharp');
    const jpegBuffer = await sharp({
      create: {
        width: 8,
        height: 3,
        channels: 3,
        background: { r: 210, g: 170, b: 130 },
      },
    }).jpeg().toBuffer();
    const store = createAssetStore({
      rootDir,
      net: { fetch: async () => { throw new Error('Unexpected network request.'); } },
    });

    const saved = await store.saveResult({
      dataUrl: `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`,
      defaultName: 'uploaded-original.jpg',
      convertToPng: false,
    }, downloadsPath);

    assert.equal(path.basename(saved.filePath), 'uploaded-original.jpg');
    assert.deepEqual(fs.readFileSync(saved.filePath), jpegBuffer);
    assert.equal((await sharp(saved.filePath).metadata()).format, 'jpeg');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('download can consume the normalized local URL returned by generation', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-local-result-download-'));
  const downloadsPath = path.join(rootDir, 'downloads');
  try {
    const { default: sharp } = await import('sharp');
    const sourceBuffer = await sharp({
      create: {
        width: 7,
        height: 5,
        channels: 4,
        background: { r: 40, g: 120, b: 200, alpha: 1 },
      },
    }).png().toBuffer();
    const store = createAssetStore({
      rootDir,
      net: { fetch: async () => { throw new Error('Unexpected network request.'); } },
    });

    const generated = await store.saveAsset({
      dataUrl: `data:image/png;base64,${sourceBuffer.toString('base64')}`,
      defaultName: 'generated.png',
      kind: 'output',
    });
    const downloaded = await store.saveResult({
      url: generated.url,
      defaultName: 'downloaded-from-local.png',
      convertToPng: true,
    }, downloadsPath);

    assert.deepEqual(fs.readFileSync(generated.filePath), sourceBuffer);
    assert.deepEqual(fs.readFileSync(downloaded.filePath), sourceBuffer);
    assert.equal((await sharp(downloaded.filePath).metadata()).format, 'png');
    assert.deepEqual(await sharp(downloaded.filePath).metadata().then((metadata) => ({
      width: metadata.width,
      height: metadata.height,
    })), { width: 7, height: 5 });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
