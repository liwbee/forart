const fs = require('fs');
const path = require('path');

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

function thumbFileNameFor(fileName) {
  const parsed = path.parse(fileName || 'canvas-image.png');
  const safeBase = (parsed.name || 'canvas-image').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  return `${safeBase}.webp`;
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

  function thumbDirectory(kind) {
    const directory = path.join(assetDirectory(kind), 'thumb');
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
    return 'forart-asset://canvas/' + relative.split('/').map(encodeURIComponent).join('/');
  }

  async function readImageSource(payload = {}) {
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

  function readDataUrlImage(dataUrl) {
    const dataMatch = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
    if (!dataMatch) return null;
    return {
      buffer: Buffer.from(dataMatch[2], 'base64'),
      extension: extensionFromMime(dataMatch[1]) || '.webp',
    };
  }

  function saveThumbnail(payload = {}, sourceFileName = '') {
    const thumbSource = readDataUrlImage(payload.thumbDataUrl);
    if (!thumbSource) return null;
    const filePath = path.join(thumbDirectory(payload.kind), thumbFileNameFor(sourceFileName || payload.defaultName));
    fs.writeFileSync(filePath, thumbSource.buffer);
    return {
      thumbUrl: assetUrl(filePath),
      thumbFilePath: filePath,
    };
  }

  async function saveAsset(payload = {}) {
    const source = await readImageSource(payload);
    const directory = assetDirectory(payload.kind);
    const defaultName = payload.defaultName || ('canvas-image' + (source.extension || '.png'));
    const filePath = uniqueFilePath(directory, defaultName);
    fs.writeFileSync(filePath, source.buffer);
    const thumb = saveThumbnail(payload, path.basename(filePath));
    return {
      url: assetUrl(filePath),
      ...(thumb || {}),
      fileName: path.basename(filePath),
      filePath,
    };
  }

  async function saveAssetThumbnail(payload = {}) {
    const sourcePath = resolveAssetUrl(payload.url || payload.filePath || '');
    if (!sourcePath || !fs.existsSync(sourcePath)) return {};
    const thumb = saveThumbnail({
      ...payload,
      kind: path.basename(path.dirname(sourcePath)) === 'output' ? 'output' : 'input',
    }, path.basename(sourcePath));
    return thumb || {};
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
    readImageSource,
    resolveAssetUrl,
    saveAsset,
    saveAssetThumbnail,
    saveResult,
  };
}

module.exports = { createAssetStore, extensionFromMime, isInside, uniqueFilePath };
