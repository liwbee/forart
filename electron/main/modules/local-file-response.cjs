const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const MIME_BY_EXTENSION = new Map([
  ['.avif', 'image/avif'], ['.gif', 'image/gif'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.webp', 'image/webp'],
  ['.mp4', 'video/mp4'], ['.m4v', 'video/x-m4v'], ['.mov', 'video/quicktime'], ['.webm', 'video/webm'],
]);

function mimeTypeForFile(filePath) {
  return MIME_BY_EXTENSION.get(path.extname(String(filePath || '')).toLowerCase()) || 'application/octet-stream';
}

function parseSingleByteRange(header, size) {
  const text = String(header || '').trim();
  if (!text) return null;
  const match = text.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || size <= 0) return { unsatisfiable: true };
  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) return { unsatisfiable: true };
  let start;
  let end;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { unsatisfiable: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
      return { unsatisfiable: true };
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function headerValue(request, name) {
  if (request?.headers?.get) return request.headers.get(name) || '';
  const headers = request?.headers || {};
  return headers[name] || headers[name.toLowerCase()] || '';
}

async function createLocalFileResponse(request, filePath) {
  const stats = await fs.promises.stat(filePath);
  const size = stats.size;
  const range = parseSingleByteRange(headerValue(request, 'range'), size);
  const commonHeaders = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Type': mimeTypeForFile(filePath),
  };
  if (range?.unsatisfiable) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, 'Content-Range': `bytes */${size}` },
    });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, size - 1);
  const length = size ? end - start + 1 : 0;
  const headers = { ...commonHeaders, 'Content-Length': String(length) };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  if (String(request?.method || 'GET').toUpperCase() === 'HEAD' || size === 0) {
    return new Response(null, { status: range ? 206 : 200, headers });
  }
  const body = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
  return new Response(body, { status: range ? 206 : 200, headers });
}

module.exports = {
  createLocalFileResponse,
  mimeTypeForFile,
  parseSingleByteRange,
};
