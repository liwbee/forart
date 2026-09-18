const fs = require('fs');
const path = require('path');
const { isInside } = require('./path-guard.cjs');
const { probeVideo } = require('./media/video-probe.cjs');
const { generateVideoThumbnail } = require('./media/video-thumbnail.cjs');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm']);

function canvasAssetKind(filePath) {
  const parent = path.basename(path.dirname(filePath));
  return parent === 'output' ? 'output' : 'input';
}

function canvasAssetThumbPath(filePath) {
  const parsed = path.parse(filePath || 'canvas-image.png');
  return path.join(path.dirname(filePath), 'thumb', `${parsed.name || 'canvas-image'}.webp`);
}

function createCanvasAssetThumbnailStore({ assetRoot, assetUrl }) {
  function resolveCanvasAssetPath(filePath) {
    const target = path.resolve(String(filePath || ''));
    if (!isInside(assetRoot(), target) || path.basename(path.dirname(target)) === 'thumb') return '';
    return target;
  }

  /**
   * `thumb/<name>.webp` 反查同目录下的原图。节点数据里已经存了缩略图 URL，
   * 删掉缩略图缓存后只有能反查回原图，才能用同一个 URL 就地重建。
   */
  function canvasAssetSourcePathForThumbnail(filePath) {
    const target = path.resolve(String(filePath || ''));
    if (!isInside(assetRoot(), target) || path.basename(path.dirname(target)) !== 'thumb') return '';
    if (path.extname(target).toLowerCase() !== '.webp') return '';
    const sourceDirectory = path.dirname(path.dirname(target));
    const stem = path.parse(target).name;
    let entries = [];
    try {
      entries = fs.readdirSync(sourceDirectory);
    } catch {
      return '';
    }
    const match = entries.filter((name) => path.parse(name).name === stem).sort()[0];
    if (!match) return '';
    const sourcePath = path.join(sourceDirectory, match);
    return fs.existsSync(sourcePath) ? sourcePath : '';
  }

  async function ensureCanvasAssetThumbnail({ filePath = '', mimeType = '', durationMs = 0 } = {}) {
    const sourcePath = resolveCanvasAssetPath(filePath);
    if (!sourcePath || !fs.existsSync(sourcePath)) return {};
    const targetPath = canvasAssetThumbPath(sourcePath);
    const isVideo = String(mimeType).toLowerCase().startsWith('video/')
      || VIDEO_EXTENSIONS.has(path.extname(sourcePath).toLowerCase());
    if (isVideo) {
      if (!fs.existsSync(targetPath)) {
        let resolvedDurationMs = Math.max(0, Number(durationMs || 0));
        if (!resolvedDurationMs) {
          const metadata = await probeVideo(sourcePath);
          resolvedDurationMs = metadata.durationMs;
        }
        await generateVideoThumbnail({ sourcePath, targetPath, durationMs: resolvedDurationMs });
      }
      return {
        thumbUrl: assetUrl(targetPath),
        thumbFilePath: targetPath,
      };
    }
    const { generateSharpImageThumbnail } = await import('../../../server/src/shared/image-thumbnail-sharp.mjs');
    const result = await generateSharpImageThumbnail({
      key: `canvas:${sourcePath}`,
      sourcePath,
      targetPath,
      mimeType,
      logger: (message) => console.warn(`[canvas-thumbnail] ${message}`),
    });
    if (!result?.filePath) return {};
    return {
      thumbUrl: assetUrl(result.filePath),
      thumbFilePath: result.filePath,
    };
  }

  /** 缩略图文件缺失时按原图重建，路径与 URL 都保持不变。 */
  async function ensureCanvasAssetThumbnailForFile(filePath) {
    const sourcePath = canvasAssetSourcePathForThumbnail(filePath);
    if (!sourcePath) return {};
    if (path.resolve(canvasAssetThumbPath(sourcePath)) !== path.resolve(String(filePath))) return {};
    return ensureCanvasAssetThumbnail({ filePath: sourcePath });
  }

  return {
    canvasAssetKind,
    canvasAssetThumbPath,
    canvasAssetSourcePathForThumbnail,
    ensureCanvasAssetThumbnail,
    ensureCanvasAssetThumbnailForFile,
    resolveCanvasAssetPath,
  };
}

module.exports = { VIDEO_EXTENSIONS, canvasAssetThumbPath, createCanvasAssetThumbnailStore };
