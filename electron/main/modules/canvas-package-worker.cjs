const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { parentPort, workerData } = require('node:worker_threads');
const archiver = require('archiver');
const unzipper = require('unzipper');

const PACKAGE_FORMAT = 'forart.canvas.package';

function postProgress(phase, loadedBytes, totalBytes) {
  const loaded = Math.max(0, Number(loadedBytes || 0));
  const total = Math.max(0, Number(totalBytes || 0));
  parentPort.postMessage({
    type: 'progress',
    progress: {
      phase,
      loadedBytes: loaded,
      totalBytes: total,
      percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
    },
  });
}

function safePackagePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  const clean = path.posix.normalize(normalized);
  if (!clean || clean.startsWith('../') || clean.includes('/../') || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) return '';
  return clean;
}

async function replaceFile(partPath, targetPath) {
  await fs.promises.rm(targetPath, { force: true });
  await fs.promises.rename(partPath, targetPath);
}

async function writeJson({ targetPath, json }) {
  const partPath = `${targetPath}.part`;
  const buffer = Buffer.from(String(json || ''), 'utf8');
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.rm(partPath, { force: true });
  postProgress('writing', 0, buffer.length);
  await fs.promises.writeFile(partPath, buffer);
  postProgress('writing', buffer.length, buffer.length);
  await replaceFile(partPath, targetPath);
  return { filePath: targetPath };
}

async function pack({ targetPath, manifestJson, canvasJson, assets = [] }) {
  const partPath = `${targetPath}.part`;
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.rm(partPath, { force: true });

  const manifestBuffer = Buffer.from(String(manifestJson || ''), 'utf8');
  const canvasBuffer = Buffer.from(String(canvasJson || ''), 'utf8');
  const assetBytes = assets.reduce((total, asset) => total + Math.max(0, Number(asset.sizeBytes || 0)), 0);
  const totalBytes = manifestBuffer.length + canvasBuffer.length + assetBytes;

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(partPath);
    const archive = new archiver.ZipArchive({ zlib: { level: 6 } });
    output.once('close', resolve);
    output.once('error', reject);
    archive.once('error', reject);
    archive.on('warning', (error) => {
      if (error?.code !== 'ENOENT') reject(error);
    });
    archive.on('progress', (progress) => {
      const processed = manifestBuffer.length + canvasBuffer.length + Math.max(0, Number(progress?.fs?.processedBytes || 0));
      postProgress('packing', Math.min(totalBytes, processed), totalBytes);
    });
    archive.pipe(output);
    archive.append(manifestBuffer, { name: 'manifest.json' });
    archive.append(canvasBuffer, { name: 'canvas.json' });
    for (const asset of assets) {
      archive.file(asset.sourceFilePath, { name: safePackagePath(asset.packagePath) });
    }
    postProgress('packing', manifestBuffer.length + canvasBuffer.length, totalBytes);
    archive.finalize().catch(reject);
  });

  await replaceFile(partPath, targetPath);
  postProgress('packing', totalBytes, totalBytes);
  return { filePath: targetPath };
}

async function readJson({ filePath }) {
  const stat = await fs.promises.stat(filePath);
  postProgress('reading', 0, stat.size);
  const text = await fs.promises.readFile(filePath, 'utf8');
  postProgress('reading', stat.size, stat.size);
  return { value: JSON.parse(text) };
}

async function unpack({ filePath, stagingRoot }) {
  const directory = await unzipper.Open.file(filePath);
  const entries = new Map(directory.files.map((entry) => [safePackagePath(entry.path), entry]));
  const manifestEntry = entries.get('manifest.json');
  const canvasEntry = entries.get('canvas.json');
  if (!manifestEntry || !canvasEntry) throw new Error('Invalid Forart canvas package.');

  const manifest = JSON.parse((await manifestEntry.buffer()).toString('utf8'));
  if (manifest?.format !== PACKAGE_FORMAT) throw new Error('Unsupported canvas package format.');
  const canvas = JSON.parse((await canvasEntry.buffer()).toString('utf8'));
  const packageAssets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const assets = packageAssets.flatMap((asset) => {
    const packagePath = safePackagePath(asset?.packagePath);
    const entry = packagePath ? entries.get(packagePath) : null;
    return entry && entry.type === 'File' ? [{ asset, entry, packagePath }] : [];
  });
  const totalBytes = assets.reduce((total, item) => total + Math.max(0, Number(item.entry.uncompressedSize || item.asset.sizeBytes || 0)), 0);
  let loadedBytes = 0;
  const extractedAssets = [];
  postProgress('extracting', 0, totalBytes);

  for (const { asset, entry, packagePath } of assets) {
    const targetPath = path.join(stagingRoot, ...packagePath.split('/'));
    const partPath = `${targetPath}.part`;
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        loadedBytes += chunk.length;
        postProgress('extracting', loadedBytes, totalBytes);
        callback(null, chunk);
      },
    });
    await pipeline(entry.stream(), counter, fs.createWriteStream(partPath));
    await replaceFile(partPath, targetPath);
    extractedAssets.push({
      id: String(asset.id || ''),
      kind: asset.kind === 'output' ? 'output' : 'input',
      originalUrl: String(asset.originalUrl || ''),
      fileName: String(asset.fileName || path.basename(packagePath)),
      stagedFilePath: targetPath,
    });
  }

  postProgress('extracting', totalBytes, totalBytes);
  return { manifest, canvas, extractedAssets };
}

async function run() {
  if (workerData.operation === 'write-json') return writeJson(workerData);
  if (workerData.operation === 'pack') return pack(workerData);
  if (workerData.operation === 'read-json') return readJson(workerData);
  if (workerData.operation === 'unpack') return unpack(workerData);
  throw new Error(`Unsupported canvas package worker operation: ${workerData.operation}`);
}

run()
  .then((result) => parentPort.postMessage({ type: 'result', result }))
  .catch((error) => parentPort.postMessage({
    type: 'error',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : '',
  }));
