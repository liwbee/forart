const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseVideoProbeOutput } = require('../electron/main/modules/media/video-probe.cjs');
const { captureVideoFrame } = require('../electron/main/modules/media/video-frame.cjs');
const { createLocalFileResponse, parseSingleByteRange } = require('../electron/main/modules/local-file-response.cjs');

test('video probe normalizes rotated dimensions and duration', () => {
  const result = parseVideoProbeOutput({
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, duration: '3.25', tags: { rotate: '90' } }],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
  });
  assert.deepEqual(result, {
    width: 1920,
    height: 1080,
    durationMs: 3250,
    codec: 'h264',
    pixelFormat: '',
    container: 'mov,mp4,m4a,3gp,3g2,mj2',
  });
});

test('range parser supports open-ended, suffix, and invalid ranges', () => {
  assert.deepEqual(parseSingleByteRange('bytes=10-', 100), { start: 10, end: 99 });
  assert.deepEqual(parseSingleByteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseSingleByteRange('bytes=95-120', 100), { start: 95, end: 99 });
  assert.deepEqual(parseSingleByteRange('bytes=100-101', 100), { unsatisfiable: true });
});

test('local media responses explicitly allow CORS canvas use', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forart-media-response-'));
  const filePath = path.join(directory, 'clip.mp4');
  try {
    await fs.promises.writeFile(filePath, Buffer.from('video'));
    const response = await createLocalFileResponse({ method: 'GET', headers: new Headers() }, filePath);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('main-process frame capture passes the requested timestamp to ffmpeg', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forart-video-frame-'));
  const sourcePath = path.join(directory, 'clip.mp4');
  const calls = [];
  try {
    await fs.promises.writeFile(sourcePath, Buffer.from('video'));
    const result = await captureVideoFrame({
      sourcePath,
      timeSeconds: 12.3456,
      ffmpegPath: 'ffmpeg-test',
      run: async (command, args) => {
        calls.push({ command, args });
        await fs.promises.writeFile(args.at(-1), Buffer.from('png-frame'));
      },
    });
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.buffer.toString(), 'png-frame');
    assert.equal(calls[0].command, 'ffmpeg-test');
    assert.equal(calls[0].args[calls[0].args.indexOf('-ss') + 1], '12.346');
    assert.equal(fs.existsSync(sourcePath), true);
    assert.equal(fs.existsSync(calls[0].args.at(-1)), false);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('last-frame capture seeks relative to the end of the video', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forart-video-last-frame-'));
  const sourcePath = path.join(directory, 'clip.mp4');
  let args = [];
  try {
    await fs.promises.writeFile(sourcePath, Buffer.from('video'));
    await captureVideoFrame({
      sourcePath,
      mode: 'last',
      ffmpegPath: 'ffmpeg-test',
      run: async (_command, nextArgs) => {
        args = nextArgs;
        await fs.promises.writeFile(nextArgs.at(-1), Buffer.from('png-frame'));
      },
    });
    assert.equal(args[args.indexOf('-sseof') + 1], '-5.000');
    assert.equal(args.includes('-ss'), false);
    assert.equal(args[args.indexOf('-update') + 1], '1');
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('remote frame capture streams the video to a temporary file and removes it', async () => {
  let downloadedInput = '';
  const result = await captureVideoFrame({
    sourceUrl: 'https://example.test/video.mp4?token=test',
    timeSeconds: 2,
    net: {
      fetch: async () => new Response(Buffer.from('remote-video'), {
        headers: { 'Content-Type': 'video/mp4' },
      }),
    },
    ffmpegPath: 'ffmpeg-test',
    run: async (_command, args) => {
      downloadedInput = args[args.indexOf('-i') + 1];
      assert.equal(fs.existsSync(downloadedInput), true);
      await fs.promises.writeFile(args.at(-1), Buffer.from('png-frame'));
    },
  });
  assert.equal(result.buffer.toString(), 'png-frame');
  assert.equal(fs.existsSync(downloadedInput), false);
});
