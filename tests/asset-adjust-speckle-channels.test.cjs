/**
 * 回归测试：噪点(overlay composite) + 杂色(speckle) 同时启用时的通道数。
 *
 * composite 的 overlay 会让 libvips 给结果补一个 alpha 通道，所以无透明底的图在
 * writeWithSpeckle 里也是 4 通道。曾经这里按 metadata.hasAlpha 猜通道数，把 4 通道
 * 当 3 通道读，导出图会"褪成灰白 + 重影"（每 4 个像素有一个通道落在原始 alpha 字节上）。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');

const { createAssetStore } = require('../electron/main/modules/asset-store.cjs');

const WIDTH = 64;
const HEIGHT = 48;

/**
 * 三通道差异明显、且像素值互相独立的源图。
 *
 * 不能用渐变图：宽度是 4 的倍数时，列号本身就与 i%4 相关，会污染错位指纹的判断。
 * 用确定性伪随机噪声，保证 i%4 分组无偏，同时三通道均值拉开距离。
 */
async function writeProceduralSource(filePath, { alpha = false } = {}) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc(WIDTH * HEIGHT * channels);
  let seed = 0x2f6e2b1;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const base = [190, 110, 60];
  for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
    const offset = index * channels;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = base[channel] + (next() - 0.5) * 40;
      raw[offset + channel] = Math.max(0, Math.min(255, Math.round(value)));
    }
    if (alpha) raw[offset + 3] = 255;
  }
  await sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels } }).png().toFile(filePath);
}

/** 按像素序号 i%4 分组算通道均值：正常图四组应当一致，错位时会出现轮转的亮通道。 */
async function strideFingerprint(filePath) {
  const { data, info } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  const sums = [0, 1, 2, 3].map(() => [0, 0, 0]);
  const counts = [0, 0, 0, 0];
  for (let index = 0; index < info.width * info.height; index += 1) {
    const bucket = index % 4;
    for (let channel = 0; channel < 3; channel += 1) {
      sums[bucket][channel] += data[index * info.channels + channel];
    }
    counts[bucket] += 1;
  }
  return sums.map((total, bucket) => total.map((value) => value / counts[bucket]));
}

function assertNoStrideRotation(fingerprint) {
  for (let channel = 0; channel < 3; channel += 1) {
    const values = fingerprint.map((bucket) => bucket[channel]);
    const spread = Math.max(...values) - Math.min(...values);
    // 错位时每个 i%4 分组会轮流吃到 alpha 字节（≈255），差值在 20 以上；
    // 正常图的组间差异只来自噪声，个位数。
    assert.ok(spread < 8, `通道 ${channel} 在 i%4 上出现了错位轮转：${values.join('/')}`);
  }
}

function assertChannelsStayDistinct(fingerprint) {
  const means = [0, 1, 2].map((channel) => (
    fingerprint.reduce((sum, bucket) => sum + bucket[channel], 0) / fingerprint.length
  ));
  const spread = Math.max(...means) - Math.min(...means);
  assert.ok(spread > 20, `三通道被抹平成同一个值（出现灰白化）：${means.map(Math.round).join('/')}`);
}

for (const alpha of [false, true]) {
  test(`噪点+杂色同时导出不会串通道（${alpha ? '带透明通道' : '不透明'}源图）`, async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-adjust-'));
    const sourcePath = path.join(rootDir, 'source.png');
    await writeProceduralSource(sourcePath, { alpha });

    const store = createAssetStore({ rootDir, net: {} });
    const result = await store.adjustAsset({
      filePath: sourcePath,
      adjustments: { brightness: 1.2, contrast: 1.1, saturation: 1.2, hue: 20, noise: 40, speckle: 60 },
    });

    const meta = await sharp(result.filePath).metadata();
    assert.equal(meta.width, WIDTH);
    assert.equal(meta.height, HEIGHT);

    const fingerprint = await strideFingerprint(result.filePath);
    assertNoStrideRotation(fingerprint);
    assertChannelsStayDistinct(fingerprint);
  });
}

test('只调杂色（没有噪点层）仍是原来的输出形态', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-adjust-'));
  const sourcePath = path.join(rootDir, 'source.png');
  await writeProceduralSource(sourcePath);

  const store = createAssetStore({ rootDir, net: {} });
  const result = await store.adjustAsset({ filePath: sourcePath, adjustments: { speckle: 60 } });

  const meta = await sharp(result.filePath).metadata();
  assert.equal(meta.channels, 3, '没有噪点层时不应凭空多出 alpha 通道');
  const fingerprint = await strideFingerprint(result.filePath);
  assertNoStrideRotation(fingerprint);
  assertChannelsStayDistinct(fingerprint);
});
