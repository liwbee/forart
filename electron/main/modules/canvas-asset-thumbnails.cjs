const fs = require('fs');
const path = require('path');

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

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

  async function ensureCanvasAssetThumbnail({ filePath = '', mimeType = '' } = {}) {
    const sourcePath = resolveCanvasAssetPath(filePath);
    if (!sourcePath || !fs.existsSync(sourcePath)) return {};
    const targetPath = canvasAssetThumbPath(sourcePath);
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

module.exports = { createCanvasAssetThumbnailStore };
