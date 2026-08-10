const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createCanvasAssetThumbnailStore } = require('./canvas-asset-thumbnails.cjs');

function uniqueFilePath(directory, fileName) {
  const parsed = path.parse(fileName || 'generated-image.png');
  const safeBase = (parsed.name || 'generated-image').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const ext = parsed.ext || '.png';
  let candidate = path.join(directory, `${safeBase}${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${safeBase}-${index}${ext}`);
    index += 1;
  }
  return candidate;
}

function normalizeAssetExtension(value, fallback = '.png') {
  const raw = String(value || '').trim().toLowerCase();
  const extension = raw.startsWith('.') ? raw : path.extname(raw);
  if (extension === '.jpeg') return '.jpg';
  if (extension === '.svg+xml') return '.svg';
  if (/^\.[a-z0-9]{2,8}$/.test(extension)) return extension;
  return fallback;
}

function internalAssetFilePath(directory, extension) {
  const safeExtension = normalizeAssetExtension(extension);
  let candidate;
  do {
    candidate = path.join(directory, `asset_${randomUUID()}${safeExtension}`);
  } while (fs.existsSync(candidate));
  return candidate;
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function extensionFromMime(mimeType) {
  const subtype = String(mimeType || '').split('/')[1] || '';
  if (!subtype) return '';
  return `.${subtype.replace('jpeg', 'jpg').replace(/[^a-z0-9.+-]/gi, '')}`;
}

async function readImageDimensions(buffer) {
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(buffer, { animated: false }).metadata();
  let width = Number(metadata.width || 0);
  let height = Number(metadata.height || 0);
  if ([5, 6, 7, 8].includes(Number(metadata.orientation || 0))) {
    [width, height] = [height, width];
  }
  return { width, height };
}

function createAssetStore({ rootDir, net }) {
  function canvasAssetsRoot() {
    const root = path.join(rootDir, 'CanvasAssests');
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  function assetDirectory(kind) {
    const safeKind = kind === 'output' ? 'output' : 'input';
    const directory = path.join(canvasAssetsRoot(), safeKind);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  function resolveAssetUrl(source) {
    try {
      const parsed = new URL(String(source || ''));
      if (parsed.protocol !== 'forart-asset:') return '';
      if (parsed.host !== 'canvas') return '';
      const rawPath = decodeURIComponent((parsed.host + parsed.pathname).replace(/^canvas\/?/, ''));
      const assetRoot = canvasAssetsRoot();
      const target = path.resolve(assetRoot, rawPath.replace(/^\/+/, ''));
      if (!isInside(assetRoot, target)) return '';
      return target;
    } catch {
      return '';
    }
  }

  function assetUrl(filePath) {
    const assetRoot = canvasAssetsRoot();
    const relative = path.relative(assetRoot, filePath).replace(/\\/g, '/');
    let version = '';
    try {
      version = String(Math.trunc(fs.statSync(filePath).mtimeMs || 0));
    } catch {
      version = '';
    }
    const url = 'forart-asset://canvas/' + relative.split('/').map(encodeURIComponent).join('/');
    return version ? `${url}?v=${encodeURIComponent(version)}` : url;
  }

  const thumbnailStore = createCanvasAssetThumbnailStore({
    assetRoot: canvasAssetsRoot,
    assetUrl,
  });

  async function readImageSource(payload = {}) {
    if (payload.filePath && fs.existsSync(payload.filePath)) {
      return {
        buffer: fs.readFileSync(payload.filePath),
        extension: path.extname(payload.filePath) || '.png',
      };
    }
    const source = String(payload.dataUrl || payload.url || '');
    const dataMatch = source.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
    if (dataMatch) {
      return {
        buffer: Buffer.from(dataMatch[2], 'base64'),
        extension: extensionFromMime(dataMatch[1]) || '.png',
      };
    }

    const localAsset = resolveAssetUrl(source);
    if (localAsset && fs.existsSync(localAsset)) {
      return {
        buffer: fs.readFileSync(localAsset),
        extension: path.extname(localAsset) || '.png',
      };
    }

    const response = await net.fetch(source);
    if (!response.ok) throw new Error('Failed to download image: ' + response.status);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      extension: extensionFromMime(response.headers.get('content-type')) || path.extname(new URL(source).pathname) || '.png',
    };
  }

  async function saveAsset(payload = {}) {
    const source = await readImageSource(payload);
    const directory = assetDirectory(payload.kind);
    const filePath = internalAssetFilePath(directory, source.extension);
    fs.writeFileSync(filePath, source.buffer);
    const dimensions = await readImageDimensions(source.buffer);
    const thumb = await thumbnailStore.ensureCanvasAssetThumbnail({ filePath });
    return {
      url: assetUrl(filePath),
      ...thumb,
      fileName: path.basename(filePath),
      filePath,
      ...dimensions,
    };
  }

  async function saveBufferAsset(payload = {}) {
    const buffer = Buffer.isBuffer(payload.buffer) ? payload.buffer : Buffer.from(payload.buffer || '');
    if (!buffer.length) throw new Error('Image data is empty.');
    const directory = assetDirectory(payload.kind);
    const extension = extensionFromMime(payload.mimeType) || path.extname(payload.defaultName || '') || '.png';
    const filePath = internalAssetFilePath(directory, extension);
    fs.writeFileSync(filePath, buffer);
    const suppliedWidth = Number(payload.width || 0);
    const suppliedHeight = Number(payload.height || 0);
    const dimensions = suppliedWidth > 0 && suppliedHeight > 0
      ? { width: suppliedWidth, height: suppliedHeight }
      : await readImageDimensions(buffer);
    const thumb = await thumbnailStore.ensureCanvasAssetThumbnail({ filePath, mimeType: payload.mimeType || 'image/png' });
    return {
      url: assetUrl(filePath),
      ...thumb,
      fileName: path.basename(filePath),
      filePath,
      ...dimensions,
    };
  }

  async function importAssetFile(payload = {}) {
    const sourceValue = String(payload.filePath || '').trim();
    if (!sourceValue) throw new Error('Imported image not found.');
    const sourcePath = path.resolve(sourceValue);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw new Error('Imported image not found.');
    const directory = assetDirectory(payload.kind);
    const extension = path.extname(payload.fileName || sourcePath) || '.png';
    const filePath = internalAssetFilePath(directory, extension);
    try {
      await fs.promises.rename(sourcePath, filePath);
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error;
      await fs.promises.copyFile(sourcePath, filePath);
      await fs.promises.unlink(sourcePath);
    }
    return {
      url: assetUrl(filePath),
      fileName: path.basename(filePath),
      filePath,
    };
  }

  async function saveAssetThumbnail(payload = {}) {
    const sourcePath = payload.filePath && fs.existsSync(payload.filePath)
      ? payload.filePath
      : resolveAssetUrl(payload.url || '');
    if (!sourcePath || !fs.existsSync(sourcePath)) return {};
    return thumbnailStore.ensureCanvasAssetThumbnail({ filePath: sourcePath });
  }

  async function ensureAssetThumbnail(payload = {}) {
    return saveAssetThumbnail(payload);
  }

  async function cropAsset(payload = {}) {
    const sourcePath = payload.filePath && fs.existsSync(payload.filePath)
      ? payload.filePath
      : resolveAssetUrl(payload.url || '');
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Source image not found.');
    const left = Math.max(0, Math.round(Number(payload.x || 0)));
    const top = Math.max(0, Math.round(Number(payload.y || 0)));
    const width = Math.max(1, Math.round(Number(payload.width || 0)));
    const height = Math.max(1, Math.round(Number(payload.height || 0)));
    const { default: sharp } = await import('sharp');
    const normalized = await sharp(sourcePath, { animated: false })
      .rotate()
      .png()
      .toBuffer({ resolveWithObject: true });
    const sourceWidth = Math.max(1, Number(normalized.info.width || 0));
    const sourceHeight = Math.max(1, Number(normalized.info.height || 0));
    const extractLeft = Math.min(left, sourceWidth - 1);
    const extractTop = Math.min(top, sourceHeight - 1);
    const extractWidth = Math.max(1, Math.min(width, sourceWidth - extractLeft));
    const extractHeight = Math.max(1, Math.min(height, sourceHeight - extractTop));
    const directory = assetDirectory('output');
    const filePath = internalAssetFilePath(directory, '.png');
    const output = await sharp(normalized.data)
      .extract({ left: extractLeft, top: extractTop, width: extractWidth, height: extractHeight })
      .png()
      .toFile(filePath);
    const thumb = await thumbnailStore.ensureCanvasAssetThumbnail({ filePath, mimeType: 'image/png' });
    return {
      url: assetUrl(filePath),
      ...thumb,
      fileName: path.basename(filePath),
      filePath,
      width: Number(output.width || extractWidth),
      height: Number(output.height || extractHeight),
    };
  }

  async function saveResult(payload = {}, downloadsPath) {
    const source = await readImageSource(payload);
    const directory = path.resolve(String(payload.directory || '').trim() || downloadsPath);
    fs.mkdirSync(directory, { recursive: true });
    const filePath = uniqueFilePath(directory, payload.defaultName || ('generated-image' + (source.extension || '.png')));
    fs.writeFileSync(filePath, source.buffer);
    return { canceled: false, filePath };
  }

  return {
    assetDirectory,
    assetUrl,
    canvasAssetsRoot,
    importAssetFile,
    readImageSource,
    resolveAssetUrl,
    saveAsset,
    saveBufferAsset,
    saveAssetThumbnail,
    ensureAssetThumbnail,
    cropAsset,
    saveResult,
  };
}

module.exports = { createAssetStore, extensionFromMime, internalAssetFilePath, isInside, uniqueFilePath };
