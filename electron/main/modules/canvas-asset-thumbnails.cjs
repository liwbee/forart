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

  return {
    canvasAssetKind,
    canvasAssetThumbPath,
    ensureCanvasAssetThumbnail,
    resolveCanvasAssetPath,
  };
}

module.exports = { VIDEO_EXTENSIONS, createCanvasAssetThumbnailStore };
