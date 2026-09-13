const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  alphaMaskFromModel,
  modelValueToAlphaByte,
  removeModel,
  status,
  prepareModelImage,
  encodeResultAtOriginalSize,
} = require('../electron/main/modules/background-removal.cjs');

test('RMBG model values are converted to PNG alpha', () => {
  assert.equal(modelValueToAlphaByte(0), 0, 'background should stay transparent');
  assert.equal(modelValueToAlphaByte(1), 255, 'foreground should become opaque');
  assert.equal(modelValueToAlphaByte(0.5), 128);
  assert.equal(modelValueToAlphaByte(-1), 0);
  assert.equal(modelValueToAlphaByte(2), 255);
});

test('alpha mask conversion keeps the model dimensions and ordering', () => {
  assert.deepEqual(
    [...alphaMaskFromModel(new Float32Array([0, 1, 0.25, 0.75]), 2, 2)],
    [0, 255, 64, 191],
  );
});

test('background removal pre-resizes inputs to avoid the Transformers.js Node colourspace bug', async () => {
  const sharp = require('sharp');
  const input = await sharp({
    create: { width: 37, height: 19, channels: 3, background: { r: 120, g: 80, b: 40 } },
  }).png().toBuffer();
  const image = await prepareModelImage(input);
  assert.equal(image.width, 1024);
  assert.equal(image.height, 1024);
  assert.equal(image.channels, 3);
});

test('background removal restores the source aspect ratio after model inference', async () => {
  const sharp = require('sharp');
  const input = await sharp({
    create: { width: 37, height: 19, channels: 3, background: { r: 120, g: 80, b: 40 } },
  }).png().toBuffer();
  const output = {
    width: 1024,
    height: 1024,
    channels: 4,
    data: new Uint8ClampedArray(1024 * 1024 * 4),
  };
  for (let i = 3; i < output.data.length; i += 4) output.data[i] = 255;
  const result = await encodeResultAtOriginalSize(input, output);
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.width, 37);
  assert.equal(metadata.height, 19);
  assert.equal(metadata.channels, 4);
});

test('unloading the background removal model removes current and legacy model files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forart-rmbg-unload-'));
  const modelDir = path.join(root, 'models', 'background-removal');
  fs.mkdirSync(modelDir, { recursive: true });
  fs.mkdirSync(path.join(modelDir, 'birefnet-lite-fp16-cpu', 'onnx'), { recursive: true });
  for (const name of [
    'birefnet-lite-fp16-cpu/onnx/model_fp16.onnx',
    'birefnet-lite-fp16-cpu/config.json',
    'birefnet-lite-fp16-cpu/preprocessor_config.json',
    'birefnet-lite-fp16-cpu/model.json',
    'bria-rmbg-2.0-web-cpu/onnx/model_quantized.onnx',
    'bria-rmbg-2.0-web-cpu/config.json',
    'birefnet-lite-fp32-cpu/onnx/model.onnx',
    'rmbg-2.0-webgpu-fp16.onnx',
    'rmbg-2.0-webgpu-fp16.json',
    'rmbg-2.0-int8.onnx',
    'rmbg-2.0-int8.json',
  ]) {
    fs.mkdirSync(path.dirname(path.join(modelDir, name)), { recursive: true });
    fs.writeFileSync(path.join(modelDir, name), 'test');
  }
  const result = await removeModel(root);
  assert.equal(result.downloaded, false);
  assert.equal(fs.existsSync(modelDir + '/birefnet-lite-fp16-cpu'), false);
  assert.equal(fs.existsSync(modelDir + '/bria-rmbg-2.0-web-cpu'), false);
  assert.equal(fs.existsSync(modelDir + '/birefnet-lite-fp32-cpu'), false);
  assert.equal(fs.existsSync(modelDir + '/rmbg-2.0-webgpu-fp16.onnx'), false);
  assert.equal(fs.existsSync(modelDir + '/rmbg-2.0-int8.onnx'), false);
  assert.equal((await status(root)).downloaded, false);
});
