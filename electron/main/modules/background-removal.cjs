const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const sharp = require('sharp');

// BiRefNet Lite FP16 model, loaded through Transformers.js on CPU.
const MODEL_ID = 'birefnet-lite-fp16-cpu';
const MODEL_URL = 'https://modelscope.cn/models/onnx-community/BiRefNet_lite-ONNX/resolve/master/onnx/model_fp16.onnx';
const CONFIG_URL = 'https://modelscope.cn/models/onnx-community/BiRefNet_lite-ONNX/resolve/master/config.json';
const PREPROCESSOR_URL = 'https://modelscope.cn/models/onnx-community/BiRefNet_lite-ONNX/resolve/master/preprocessor_config.json';
const MODEL_SIZE = 114538221;
const MODEL_SHA256 = 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402';
const CONFIG_SIZE = 81;
const PREPROCESSOR_SIZE = 391;
const MODEL_INPUT_SIZE = 1024;
let segmenterPromise = null;
let downloadPromise = null;
let downloadProgress = 0;
let persistentWorker = null;
let persistentWorkerRoot = '';
let nextJobId = 1;
const pendingJobs = new Map();

function paths(root) {
  const dir = path.join(root, 'models', 'background-removal');
  const modelDir = path.join(dir, 'birefnet-lite-fp16-cpu');
  return {
    dir,
    modelDir,
    model: path.join(modelDir, 'onnx', 'model_fp16.onnx'),
    config: path.join(modelDir, 'config.json'),
    preprocessor: path.join(modelDir, 'preprocessor_config.json'),
    meta: path.join(modelDir, 'model.json'),
  };
}

function legacyPaths(root) {
  const dir = path.join(root, 'models', 'background-removal');
  return [
    path.join(dir, 'bria-rmbg-2.0-web-cpu'),
    path.join(dir, 'birefnet-lite-fp32-cpu'),
    path.join(dir, 'rmbg-2.0-webgpu-fp16.onnx'),
    path.join(dir, 'rmbg-2.0-webgpu-fp16.json'),
    path.join(dir, 'rmbg-2.0-int8.onnx'),
    path.join(dir, 'rmbg-2.0-int8.json'),
  ];
}

async function removeLegacyModels(root) {
  for (const legacy of legacyPaths(root)) {
    await fs.rm(legacy, { recursive: true, force: true });
  }
}

async function status(root) {
  const p = paths(root);
  try {
    const s = await fs.stat(p.model);
    const m = JSON.parse(await fs.readFile(p.meta, 'utf8'));
    const downloaded = s.size === MODEL_SIZE && m.sha256 === MODEL_SHA256;
    return { id: MODEL_ID, downloaded, downloading: !!downloadPromise, size: MODEL_SIZE + CONFIG_SIZE + PREPROCESSOR_SIZE, downloadedBytes: downloaded ? MODEL_SIZE + CONFIG_SIZE + PREPROCESSOR_SIZE : downloadProgress };
  } catch {
    return { id: MODEL_ID, downloaded: false, downloading: !!downloadPromise, size: MODEL_SIZE + CONFIG_SIZE + PREPROCESSOR_SIZE, downloadedBytes: downloadProgress };
  }
}

async function download(root) {
  if (downloadPromise) return downloadPromise;
  downloadProgress = 0;
  downloadPromise = (async () => {
    const p = paths(root);
    await fs.mkdir(path.dirname(p.model), { recursive: true });
    const files = [
      { url: MODEL_URL, target: p.model, size: MODEL_SIZE, sha256: MODEL_SHA256 },
      { url: CONFIG_URL, target: p.config, size: CONFIG_SIZE },
      { url: PREPROCESSOR_URL, target: p.preprocessor, size: PREPROCESSOR_SIZE },
    ];
    let completed = 0;
    for (const item of files) {
      const tmp = item.target + '.download';
      const res = await fetch(item.url);
      if (!res.ok || !res.body) throw new Error('BiRefNet Lite 模型下载失败');
      const hash = crypto.createHash('sha256');
      const file = await fs.open(tmp, 'w');
      let bytes = 0;
      try {
        for await (const chunk of res.body) {
          const b = Buffer.from(chunk);
          hash.update(b);
          await file.write(b);
          bytes += b.length;
          downloadProgress = completed + bytes;
        }
      } finally {
        await file.close();
      }
      if (bytes !== item.size || (item.sha256 && hash.digest('hex') !== item.sha256)) {
        await fs.rm(tmp, { force: true });
        throw new Error('BiRefNet Lite 模型校验失败');
      }
      await fs.rename(tmp, item.target);
      completed += item.size;
    }
    await fs.writeFile(p.meta, JSON.stringify({ version: 'birefnet-lite', size: MODEL_SIZE, sha256: MODEL_SHA256, runtime: 'transformers.js-cpu' }));
    await removeLegacyModels(root);
    return status(root);
  })().finally(() => { downloadPromise = null; });
  return downloadPromise;
}

async function removeModel(root) {
  if (downloadPromise) throw new Error('模型正在下载，请稍后再卸载');
  if (pendingJobs.size) throw new Error('模型正在使用，请稍后再卸载');
  await disposePersistentWorker();
  const p = paths(root);
  await fs.rm(p.modelDir, { recursive: true, force: true });
  await removeLegacyModels(root);
  await fs.rm(`${p.model}.download`, { force: true });
  segmenterPromise = null;
  downloadProgress = 0;
  return status(root);
}

async function getSegmenter(root, onModelState) {
  if (!segmenterPromise) {
    const p = paths(root);
    if (!(await status(root)).downloaded) throw new Error('请先在 Agent 设置中下载 BiRefNet Lite 模型');
    onModelState?.('loading');
    segmenterPromise = import('@huggingface/transformers').then(async ({ pipeline, env }) => {
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      const segmenter = await pipeline('background-removal', p.modelDir, {
        device: 'cpu',
        dtype: 'fp16',
        local_files_only: true,
        subfolder: 'onnx',
        model_file_name: 'model',
      });
      onModelState?.('ready');
      return segmenter;
    }).catch((error) => {
      segmenterPromise = null;
      onModelState?.('error');
      throw error;
    });
  }
  return segmenterPromise;
}

async function prepareModelImage(input) {
  const decoded = await sharp(input)
    .rotate()
    .removeAlpha()
    .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { RawImage } = await import('@huggingface/transformers');
  return new RawImage(
    new Uint8ClampedArray(decoded.data),
    decoded.info.width,
    decoded.info.height,
    decoded.info.channels,
  );
}

async function encodeResultAtOriginalSize(input, output) {
  const source = await sharp(input)
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = source.info;
  const mask = await sharp(Buffer.from(output.data), {
    raw: { width: output.width, height: output.height, channels: output.channels },
  })
    .extractChannel(output.channels - 1)
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer();
  return sharp(source.data, { raw: { width, height, channels } })
    .joinChannel(mask, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

// RMBG returns a normalized foreground alpha (foreground 1, background 0).
function modelValueToAlphaByte(value) {
  const normalized = Number(value);
  const clamped = Number.isFinite(normalized) ? Math.max(0, Math.min(1, normalized)) : 0;
  return Math.round(clamped * 255);
}

function alphaMaskFromModel(values, width, height) {
  const mask = Buffer.alloc(width * height);
  for (let i = 0; i < mask.length; i += 1) mask[i] = modelValueToAlphaByte(values[i]);
  return mask;
}

async function removeInternal(root, input, onModelState) {
  const image = await prepareModelImage(input);
  const segmenter = await getSegmenter(root, onModelState);
  const output = await segmenter(image);
  return encodeResultAtOriginalSize(input, output);
}
function rejectPendingJobs(error) {
  for (const { reject } of pendingJobs.values()) reject(error);
  pendingJobs.clear();
}

function getPersistentWorker(root) {
  if (persistentWorker && persistentWorkerRoot === root) return persistentWorker;
  if (persistentWorker) {
    void disposePersistentWorker();
  }
  const worker = new Worker(__filename, { workerData: { root } });
  persistentWorker = worker;
  persistentWorkerRoot = root;
  worker.on('message', (message) => {
    if (message?.type === 'model-state') {
      for (const pending of pendingJobs.values()) pending.onModelState?.(message.state);
      return;
    }
    const pending = pendingJobs.get(message?.id);
    if (!pending) return;
    pendingJobs.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(Buffer.from(message.result));
  });
  worker.on('error', (error) => {
    if (persistentWorker !== worker) return;
    persistentWorker = null;
    persistentWorkerRoot = '';
    rejectPendingJobs(error);
  });
  worker.on('exit', (code) => {
    if (persistentWorker !== worker) return;
    persistentWorker = null;
    persistentWorkerRoot = '';
    if (code !== 0) rejectPendingJobs(new Error(`抠图 Worker 已退出（代码 ${code}）`));
  });
  return worker;
}

async function disposePersistentWorker() {
  const worker = persistentWorker;
  persistentWorker = null;
  persistentWorkerRoot = '';
  if (!worker) return;
  rejectPendingJobs(new Error('抠图 Worker 已停止'));
  await worker.terminate();
}

async function remove(root, input, onModelState) {
  if (!isMainThread) return removeInternal(root, input, onModelState);
  const worker = getPersistentWorker(root);
  const id = nextJobId++;
  return new Promise((resolve, reject) => {
    pendingJobs.set(id, { resolve, reject, onModelState });
    worker.postMessage({ id, input });
  });
}

if (!isMainThread && workerData) {
  let workerQueue = Promise.resolve();
  parentPort.on('message', (message) => {
    workerQueue = workerQueue.then(async () => {
      try {
        const result = await removeInternal(workerData.root, Buffer.from(message.input), (state) => {
          parentPort.postMessage({ type: 'model-state', state });
        });
        parentPort.postMessage({ id: message.id, result });
      } catch (error) {
        parentPort.postMessage({ id: message.id, error: String(error.message || error) });
      }
    });
  });
}

function registerBackgroundRemovalIpc({ ipcMain, dataRoot, app }) {
  ipcMain.handle('background-removal:status', () => status(dataRoot));
  ipcMain.handle('background-removal:download', () => download(dataRoot));
  ipcMain.handle('background-removal:remove-model', () => removeModel(dataRoot));
  ipcMain.handle('background-removal:run', async (event, p) => {
    const input = p?.bytes ? Buffer.from(p.bytes) : await fs.readFile(String(p?.filePath || ''));
    return remove(dataRoot, input, (state) => {
      if (!event.sender.isDestroyed()) event.sender.send('background-removal:model-state', state);
    });
  });
  app?.once?.('will-quit', () => { void disposePersistentWorker(); });
}
module.exports = { registerBackgroundRemovalIpc, status, download, remove, removeModel, disposePersistentWorker, modelValueToAlphaByte, alphaMaskFromModel, prepareModelImage, encodeResultAtOriginalSize };
