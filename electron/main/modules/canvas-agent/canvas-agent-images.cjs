const fs = require('fs');
const path = require('path');

function dataUrlFromBuffer(buffer, mime = 'image/png') {
  return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
}

async function loadImageBuffer({ net, assetStore, source }) {
  const value = String(source || '').trim();
  if (!value) throw new Error('Image source is empty.');
  const dataMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
  if (dataMatch) return { buffer: Buffer.from(dataMatch[2], 'base64'), mime: dataMatch[1] };

  const localPath = assetStore?.resolveAssetUrl?.(value) || (fs.existsSync(value) ? value : '');
  if (localPath && fs.existsSync(localPath)) {
    return { buffer: fs.readFileSync(localPath), mime: mimeFromExtension(path.extname(localPath)) };
  }
  const response = await net.fetch(value, { credentials: 'omit' });
  if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mime: response.headers.get('content-type')?.split(';')[0] || 'image/png',
  };
}

function mimeFromExtension(extension) {
  const value = String(extension || '').toLowerCase();
  if (value === '.jpg' || value === '.jpeg') return 'image/jpeg';
  if (value === '.webp') return 'image/webp';
  return 'image/png';
}

function imageSourceForContext(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  // Renderer image-generator inputs use imageUrl; smart-reverse inputs use
  // assetUrl. Accept both so the Agent receives the same references shown in
  // the canvas UI.
  return item.imageUrl || item.assetUrl || item.localUrl || item.url || '';
}

async function resolveImageParts({ net, assetStore, sources, maxImages } = {}) {
  const values = (Array.isArray(sources) ? sources : [])
    .map(imageSourceForContext)
    .map((value) => String(value).trim())
    .filter(Boolean);
  const limitedValues = Number.isFinite(Number(maxImages)) && Number(maxImages) > 0
    ? values.slice(0, Math.round(Number(maxImages)))
    : values;
  const parts = [];
  for (const source of limitedValues) {
    const loaded = await loadImageBuffer({ net, assetStore, source });
    const { default: sharp } = await import('sharp');
    const resized = await sharp(loaded.buffer, { animated: false })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 86 })
      .toBuffer();
    parts.push({ type: 'file', data: dataUrlFromBuffer(resized, 'image/jpeg'), mediaType: 'image/jpeg' });
  }
  return parts;
}

module.exports = { imageSourceForContext, resolveImageParts };
