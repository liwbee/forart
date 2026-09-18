const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createCanvasAssetThumbnailStore } = require('./canvas-asset-thumbnails.cjs');
const { applyImageAdjustments, imageAdjustmentPlan } = require('./image-adjustments.cjs');
const { isInside } = require('./path-guard.cjs');
const { probeVideo } = require('./media/video-probe.cjs');

const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.heic', '.heif', '.jpg', '.jpeg', '.png', '.svg', '.webp']);
const VIDEO_MIME_BY_EXTENSION = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/x-m4v'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
]);

function importedAssetType(filePath, mimeType = '') {
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  const extension = path.extname(String(filePath || '')).toLowerCase();
  if (normalizedMime.startsWith('video/') || VIDEO_MIME_BY_EXTENSION.has(extension)) return 'video';
  if (normalizedMime.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  return '';
}

function importedAssetMimeType(filePath, mimeType = '', assetType = importedAssetType(filePath, mimeType)) {
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  if (normalizedMime.startsWith(`${assetType}/`)) return normalizedMime;
  const extension = path.extname(String(filePath || '')).toLowerCase();
  if (assetType === 'video') return VIDEO_MIME_BY_EXTENSION.get(extension) || 'video/mp4';
  return normalizedMime || '';
}

function importedAssetBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
  return null;
}

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

async function convertImageBufferToPng(buffer) {
  const { default: sharp } = await import('sharp');
  const image = sharp(buffer, { animated: false });
  const metadata = await image.metadata();
  if (metadata.format === 'png') return buffer;
  return image
    .rotate()
    .png()
    .toBuffer();
}

function pngFileName(fileName) {
  const parsed = path.parse(String(fileName || 'generated-image'));
  return `${parsed.name || 'generated-image'}.png`;
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
    const output = payload.kind === 'output'
      ? { buffer: await convertImageBufferToPng(source.buffer), extension: '.png' }
      : source;
    const directory = assetDirectory(payload.kind);
    const filePath = internalAssetFilePath(directory, output.extension);
    fs.writeFileSync(filePath, output.buffer);
    const dimensions = await readImageDimensions(output.buffer);
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

  async function importUserAssetFile(payload = {}) {
    const sourceValue = String(payload.filePath || '').trim();
    const sourcePath = sourceValue ? path.resolve(sourceValue) : '';
    const sourceStats = sourcePath
      ? await fs.promises.stat(sourcePath).catch(() => null)
      : null;
    const sourceBuffer = importedAssetBuffer(payload.bytes);
    if (!sourceStats?.isFile() && !sourceBuffer?.length) {
      throw new Error('Imported asset not found.');
    }

    const assetType = importedAssetType(payload.fileName || sourcePath, payload.mimeType);
    if (!assetType) throw new Error('Only image, MP4, WebM, MOV, and M4V assets are supported.');
    const mimeType = importedAssetMimeType(payload.fileName || sourcePath, payload.mimeType, assetType);
    const directory = assetDirectory('input');
    const extension = path.extname(payload.fileName || sourcePath).toLowerCase()
      || extensionFromMime(mimeType)
      || (assetType === 'video' ? '.mp4' : '.png');
    const filePath = internalAssetFilePath(directory, extension);
    if (sourceStats?.isFile()) {
      await fs.promises.copyFile(sourcePath, filePath);
    } else {
      await fs.promises.writeFile(filePath, sourceBuffer);
    }

    try {
      const metadata = assetType === 'video'
        ? await probeVideo(filePath)
        : await readImageDimensions(await fs.promises.readFile(filePath));
      const thumb = await thumbnailStore.ensureCanvasAssetThumbnail({
        filePath,
        mimeType,
        durationMs: metadata.durationMs,
      });
      return {
        url: assetUrl(filePath),
        ...thumb,
        fileName: String(payload.fileName || path.basename(sourcePath || filePath)),
        storedFileName: path.basename(filePath),
        filePath,
        assetType,
        mimeType,
        width: metadata.width,
        height: metadata.height,
        durationMs: Number(metadata.durationMs || 0),
        sizeBytes: sourceStats?.size ?? sourceBuffer.length,
        ...(assetType === 'video' ? { codec: metadata.codec || '' } : {}),
      };
    } catch (error) {
      await fs.promises.rm(filePath, { force: true }).catch(() => undefined);
      throw error;
    }
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

  async function ensureAssetThumbnailForFile(filePath) {
    return thumbnailStore.ensureCanvasAssetThumbnailForFile(filePath);
  }

  async function cropAsset(payload = {}) {
    const sourcePath = payload.filePath && fs.existsSync(payload.filePath)
      ? payload.filePath
      : resolveAssetUrl(payload.url || '');
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Source image not found.');
    const { default: sharp } = await import('sharp');
    const normalized = await sharp(sourcePath, { animated: false })
      .rotate()
      .png()
      .toBuffer({ resolveWithObject: true });
    const sourceWidth = Math.max(1, Number(normalized.info.width || 0));
    const sourceHeight = Math.max(1, Number(normalized.info.height || 0));
    // 选区可以用百分比给（推荐）：只有这里才知道源图的真实尺寸，
    // 渲染端即便拿着缩略图预览、或者节点没记原图尺寸，裁剪位置也不会错位。
    const usesPercent = payload.unit === 'percent' || payload.unit === '%';
    const toPixels = (value, total) => {
      const ratio = Math.min(100, Math.max(0, Number(value || 0))) / 100;
      return Math.round(ratio * total);
    };
    const left = usesPercent ? toPixels(payload.x, sourceWidth) : Math.max(0, Math.round(Number(payload.x || 0)));
    const top = usesPercent ? toPixels(payload.y, sourceHeight) : Math.max(0, Math.round(Number(payload.y || 0)));
    const width = usesPercent
      ? Math.max(1, toPixels(payload.width, sourceWidth))
      : Math.max(1, Math.round(Number(payload.width || 0)));
    const height = usesPercent
      ? Math.max(1, toPixels(payload.height, sourceHeight))
      : Math.max(1, Math.round(Number(payload.height || 0)));
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

  function resolveImageSourcePath(payload = {}) {
    const sourcePath = payload.filePath && fs.existsSync(payload.filePath)
      ? payload.filePath
      : resolveAssetUrl(payload.url || '');
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Source image not found.');
    return sourcePath;
  }

  /** 读像素尺寸，EXIF 方向按 rotate() 之后的结果算。 */
  async function readImageFileDimensions(sourcePath) {
    const { default: sharp } = await import('sharp');
    const metadata = await sharp(sourcePath, { animated: false }).metadata();
    const swap = [5, 6, 7, 8].includes(Number(metadata.orientation || 0));
    return {
      width: Math.max(1, Number(swap ? metadata.height : metadata.width) || 0),
      height: Math.max(1, Number(swap ? metadata.width : metadata.height) || 0),
      hasAlpha: Boolean(metadata.hasAlpha),
    };
  }

  /**
   * 高斯噪点层。
   *
   * libvips 的合成按预乘 alpha 计算，且合成结果一定带 alpha 通道，所以：
   *   1. overlay 会把底图整个盖住，带透明通道的图要用底图自己的 alpha 做一次
   *      dest-in 把透明度还回去；
   *   2. 预乘混合只影响 0 < alpha < 1 的像素，也就是抠图素材的软边那一圈，
   *      不透明主体不受影响；
   *   3. 加噪点后输出一定带 alpha 通道，且噪点本身几乎不可压缩，PNG 会明显变大。
   */
  async function compositeNoiseLayer(pipeline, { width, height, sigma, alphaSourcePath = '' }) {
    const { default: sharp } = await import('sharp');
    const noise = await sharp({
      create: {
        width,
        height,
        channels: 3,
        noise: { type: 'gaussian', mean: 128, sigma },
      },
    }).png().toBuffer();
    // 覆盖式混合：中间调最明显，像胶片颗粒（加性杂色不走这里，见 writeWithSpeckle）。
    const layers = [{ input: noise, blend: 'overlay' }];
    if (alphaSourcePath) {
      const mask = await sharp(alphaSourcePath, { animated: false })
        .rotate()
        .resize({ width, height, fit: 'fill' })
        .png()
        .toBuffer();
      layers.push({ input: mask, blend: 'dest-in' });
    }
    pipeline.composite(layers);
  }

  /**
   * 图片调整（亮度/对比度/饱和度/色相/灰度/模糊/噪点）的导出入口。
   *
   * 预览走 adjustPreview，两者共用 image-adjustments.cjs 里那套运算，
   * 所以"预览所见即成片所得"，不是靠两套近似凑出来的。
   */
  async function adjustAsset(payload = {}) {
    const sourcePath = resolveImageSourcePath(payload);
    const { default: sharp } = await import('sharp');
    const directory = assetDirectory('output');
    const filePath = internalAssetFilePath(directory, '.png');
    const source = await readImageFileDimensions(sourcePath);
    const plan = imageAdjustmentPlan(payload.adjustments, {
      longEdge: Math.max(source.width, source.height),
    });
    // rotate() 先把 EXIF 方向摆正，之后所有调整都在正向像素上做，和预览一致。
    const pipeline = applyImageAdjustments(sharp(sourcePath, { animated: false }).rotate(), payload.adjustments, {
      longEdge: Math.max(source.width, source.height),
    });
    if (plan.noiseSigma > 0) {
      await compositeNoiseLayer(pipeline, {
        width: source.width,
        height: source.height,
        sigma: plan.noiseSigma,
        alphaSourcePath: source.hasAlpha ? sourcePath : '',
      });
    }
    // 杂色（PS「添加杂色 · 高斯分布」）是"逐通道加一个以 0 为中心的高斯随机数再钳位"，
    // 有正有负；libvips 的混合模式没有减法，所以这一档不走 composite，直接改原始像素。
    const output = plan.speckleSigma > 0
      ? await writeWithSpeckle(pipeline, filePath, {
        width: source.width,
        height: source.height,
        channels: source.hasAlpha ? 4 : 3,
        sigma: plan.speckleSigma,
      })
      : await pipeline.png().toFile(filePath);
    const thumb = await thumbnailStore.ensureCanvasAssetThumbnail({ filePath, mimeType: 'image/png' });
    return {
      url: assetUrl(filePath),
      ...thumb,
      fileName: path.basename(filePath),
      filePath,
      width: Number(output.width || 0),
      height: Number(output.height || 0),
    };
  }

  /**
   * Photoshop「添加杂色 · 高斯分布」的等价实现（不勾「单色」那一档）。
   *
   * 每个通道各取一个 N(0, σ) 的随机数加到像素上，再钳位到 0-255；alpha 通道不动。
   * 噪声由 libvips 生成（快），只有加法这一步在 JS 里做，且结果写回同一个缓冲区，
   * 避免为 5000 万像素的图再多分配一份。
   */
  async function writeWithSpeckle(pipeline, filePath, { width, height, channels, sigma }) {
    const { default: sharp } = await import('sharp');
    const pixels = await pipeline.raw().toBuffer();
    const noise = await sharp({
      create: { width, height, channels: 3, noise: { type: 'gaussian', mean: 128, sigma } },
    }).raw().toBuffer();
    const pixelCount = width * height;
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * channels;
      const noiseOffset = index * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = pixels[offset + channel] + (noise[noiseOffset + channel] - 128);
        pixels[offset + channel] = value < 0 ? 0 : value > 255 ? 255 : value;
      }
    }
    return sharp(pixels, { raw: { width, height, channels } }).png().toFile(filePath);
  }

  async function saveResult(payload = {}, downloadsPath) {
    const source = await readImageSource(payload);
    const buffer = payload.convertToPng
      ? await convertImageBufferToPng(source.buffer)
      : source.buffer;
    const defaultName = payload.convertToPng
      ? pngFileName(payload.defaultName)
      : payload.defaultName || ('generated-image' + (source.extension || '.png'));
    const directory = path.resolve(String(payload.directory || '').trim() || downloadsPath);
    fs.mkdirSync(directory, { recursive: true });
    const filePath = uniqueFilePath(directory, defaultName);
    fs.writeFileSync(filePath, buffer);
    return { canceled: false, filePath };
  }

  return {
    assetDirectory,
    assetUrl,
    canvasAssetsRoot,
    importAssetFile,
    importUserAssetFile,
    readImageSource,
    resolveAssetUrl,
    saveAsset,
    saveBufferAsset,
    saveAssetThumbnail,
    ensureAssetThumbnail,
    ensureAssetThumbnailForFile,
    cropAsset,
    adjustAsset,
    saveResult,
  };
}

module.exports = {
  IMAGE_EXTENSIONS,
  VIDEO_MIME_BY_EXTENSION,
  createAssetStore,
  extensionFromMime,
  importedAssetMimeType,
  importedAssetBuffer,
  importedAssetType,
  internalAssetFilePath,
  isInside,
  uniqueFilePath,
};
