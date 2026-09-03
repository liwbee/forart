const { spawn } = require('child_process');
const { resolveFfprobePath } = require('./ffmpeg-paths.cjs');

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options.spawnOptions,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error('Video metadata probe timed out.'));
    }, Math.max(1, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)));
    timeout.unref?.();

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    }

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new Error('Video metadata output is too large.'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_OUTPUT_BYTES) stderr.push(chunk);
    });
    child.once('error', (error) => finish(new Error(`Unable to start ffprobe: ${error.message}`)));
    child.once('close', (code) => {
      const output = Buffer.concat(stdout).toString('utf8');
      const errorOutput = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        finish(new Error(errorOutput || `ffprobe exited with code ${code}.`));
        return;
      }
      finish(null, { stdout: output, stderr: errorOutput });
    });
  });
}

function finitePositive(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function parseRotation(stream) {
  const tagRotation = Number(stream?.tags?.rotate);
  if (Number.isFinite(tagRotation)) return tagRotation;
  const rotationSideData = Array.isArray(stream?.side_data_list)
    ? stream.side_data_list.find((item) => Number.isFinite(Number(item?.rotation)))
    : null;
  return Number(rotationSideData?.rotation || 0);
}

function parseVideoProbeOutput(input) {
  const payload = typeof input === 'string' ? JSON.parse(input) : input;
  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  const stream = streams.find((item) => item?.codec_type === 'video' && !item?.disposition?.attached_pic);
  if (!stream) throw new Error('The selected file does not contain a playable video stream.');

  let width = Math.round(finitePositive(stream.width));
  let height = Math.round(finitePositive(stream.height));
  const rotation = ((parseRotation(stream) % 360) + 360) % 360;
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  if (!width || !height) throw new Error('Unable to read video dimensions.');

  const durationSeconds = finitePositive(stream.duration) || finitePositive(payload?.format?.duration);
  return {
    width,
    height,
    durationMs: Math.max(0, Math.round(durationSeconds * 1000)),
    codec: String(stream.codec_name || ''),
    pixelFormat: String(stream.pix_fmt || ''),
    container: String(payload?.format?.format_name || ''),
  };
}

async function probeVideo(filePath, options = {}) {
  const ffprobePath = options.ffprobePath || resolveFfprobePath(options);
  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,pix_fmt,width,height,duration:stream_tags=rotate:stream_side_data=rotation:stream_disposition=attached_pic',
    filePath,
  ];
  const result = await (options.runProcess || runProcess)(ffprobePath, args, options);
  return parseVideoProbeOutput(result.stdout);
}

module.exports = {
  parseVideoProbeOutput,
  probeVideo,
  runProcess,
};
