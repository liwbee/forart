const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { runProcess } = require('./video-probe.cjs');
const { resolveFfmpegPath } = require('./ffmpeg-paths.cjs');

/**
 * Extract one video frame in the main process.  This is used as a fallback for
 * remote videos that cannot opt into CORS: ffmpeg reads the bytes directly and
 * the renderer never draws a cross-origin resource onto a canvas.
 */
async function captureVideoFrame({ sourceUrl, sourcePath, timeSeconds = 0, mode = 'current', net, ffmpegPath, run = runProcess } = {}) {
  const temporaryFiles = [];
  let inputPath = String(sourcePath || '').trim();
  try {
    if (!inputPath) {
      const url = String(sourceUrl || '').trim();
      if (!url) throw new Error('Video source is empty.');
      if (!/^(https?:|forart-asset:)/i.test(url)) throw new Error('Video source protocol is not supported.');
      if (!net?.fetch) throw new Error('Video download is unavailable.');
      const response = await net.fetch(url);
      if (!response.ok) throw new Error(`Unable to download video (${response.status}).`);
      const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim();
      const extension = contentType === 'video/webm' ? '.webm' : contentType === 'video/quicktime' ? '.mov' : '.mp4';
      inputPath = path.join(os.tmpdir(), `forart-video-${randomUUID()}${extension}`);
      temporaryFiles.push(inputPath);
      if (response.body) {
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(inputPath));
      } else {
        await fs.promises.writeFile(inputPath, Buffer.from(await response.arrayBuffer()));
      }
    }
    if (!fs.existsSync(inputPath)) throw new Error('Video source not found.');
    const outputPath = path.join(os.tmpdir(), `forart-frame-${randomUUID()}.png`);
    temporaryFiles.push(outputPath);
    const timestamp = Math.max(0, Number(timeSeconds) || 0);
    const seekArgs = mode === 'last'
      ? ['-sseof', '-5.000']
      : ['-ss', timestamp.toFixed(3)];
    const outputArgs = mode === 'last'
      // Decode only the final few seconds and overwrite one PNG for every
      // decoded frame. The file left behind is the actual last frame, even
      // when the final timestamp is relatively far from the video duration.
      ? ['-update', '1']
      : ['-frames:v', '1'];
    await run(ffmpegPath || resolveFfmpegPath(), [
      '-hide_banner',
      '-loglevel', 'error',
      ...seekArgs,
      '-i', inputPath,
      '-map', '0:v:0',
      ...outputArgs,
      '-an',
      '-y', outputPath,
    ], { timeoutMs: 60_000 });
    const buffer = await fs.promises.readFile(outputPath);
    if (!buffer.length) throw new Error('Video frame is empty.');
    return { buffer, mimeType: 'image/png' };
  } finally {
    await Promise.all(temporaryFiles.map((filePath) => fs.promises.rm(filePath, { force: true }).catch(() => undefined)));
  }
}

module.exports = { captureVideoFrame };
