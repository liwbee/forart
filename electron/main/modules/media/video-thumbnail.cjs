const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { runProcess } = require('./video-probe.cjs');
const { resolveFfmpegPath } = require('./ffmpeg-paths.cjs');

function thumbnailSeekSeconds(durationMs) {
  const durationSeconds = Math.max(0, Number(durationMs || 0) / 1000);
  if (!durationSeconds) return 0;
  return Math.min(5, Math.max(0.1, durationSeconds * 0.1));
}

async function generateVideoThumbnail({ sourcePath, targetPath, durationMs = 0, ffmpegPath, run = runProcess } = {}) {
  if (!sourcePath || !targetPath) throw new Error('Video thumbnail paths are required.');
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryFrame = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}-${randomUUID()}.png`);
  const temporaryTarget = `${targetPath}.${randomUUID()}.tmp.webp`;
  try {
    const seek = thumbnailSeekSeconds(durationMs);
    await run(ffmpegPath || resolveFfmpegPath(), [
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', seek.toFixed(3),
      '-i', sourcePath,
      '-map', '0:v:0',
      '-frames:v', '1',
      '-an',
      '-y',
      temporaryFrame,
    ], { timeoutMs: 60_000 });
    const { default: sharp } = await import('sharp');
    await sharp(temporaryFrame, { animated: false })
      .rotate()
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(temporaryTarget);
    await fs.promises.rm(targetPath, { force: true });
    await fs.promises.rename(temporaryTarget, targetPath);
    return { filePath: targetPath };
  } finally {
    await Promise.all([
      fs.promises.rm(temporaryFrame, { force: true }).catch(() => undefined),
      fs.promises.rm(temporaryTarget, { force: true }).catch(() => undefined),
    ]);
  }
}

module.exports = {
  generateVideoThumbnail,
  thumbnailSeekSeconds,
};
