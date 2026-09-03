const fs = require('fs');
const path = require('path');

function existingFile(value) {
  const candidate = String(value || '').trim();
  return candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ? candidate
    : '';
}

function optionalPackageBinary(packageName) {
  try {
    const value = require(packageName);
    return existingFile(typeof value === 'string' ? value : value?.path);
  } catch {
    return '';
  }
}

function bundledCandidates(binaryName, options = {}) {
  const executable = process.platform === 'win32' ? `${binaryName}.exe` : binaryName;
  const roots = [
    options.resourcesPath,
    typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    options.appRoot,
    path.resolve(__dirname, '..', '..', '..', '..'),
  ].filter(Boolean);
  return roots.flatMap((root) => [
    path.join(root, 'ffmpeg', executable),
    path.join(root, 'build', 'ffmpeg', executable),
    path.join(root, 'vendor', 'ffmpeg', process.platform, process.arch, executable),
  ]);
}

function resolveMediaBinary(binaryName, options = {}) {
  const environmentName = binaryName === 'ffprobe' ? 'FORART_FFPROBE_PATH' : 'FORART_FFMPEG_PATH';
  const configured = existingFile(options.configuredPath || process.env[environmentName]);
  if (configured) return configured;

  for (const candidate of bundledCandidates(binaryName, options)) {
    const bundled = existingFile(candidate);
    if (bundled) return bundled;
  }

  const packageBinary = binaryName === 'ffprobe'
    ? optionalPackageBinary('@ffprobe-installer/ffprobe') || optionalPackageBinary('ffprobe-static')
    : optionalPackageBinary('@ffmpeg-installer/ffmpeg') || optionalPackageBinary('ffmpeg-static');
  if (packageBinary) return packageBinary;

  // Development environments commonly provide these on PATH. Packaged builds
  // should put the two executables in resources/ffmpeg instead.
  return process.platform === 'win32' ? `${binaryName}.exe` : binaryName;
}

function resolveFfmpegPath(options) {
  return resolveMediaBinary('ffmpeg', options);
}

function resolveFfprobePath(options) {
  return resolveMediaBinary('ffprobe', options);
}

module.exports = {
  resolveFfmpegPath,
  resolveFfprobePath,
  resolveMediaBinary,
};
