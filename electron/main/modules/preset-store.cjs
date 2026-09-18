/**
 * 调色预设的存储。
 *
 * 预设是"用户内容"（会增删、要排序），不是设置，所以单独存一个
 * `<rootDir>/image-presets.json`，写盘方式和 canvas-store / config-store 一致：
 * 先写临时文件再 rename，避免中途崩溃留下半个文件。
 *
 * 结构：
 *   { version, order: [id...], items: { [id]: { id, name, adjustments, createdAt, updatedAt } } }
 */
const fs = require('fs');
const path = require('path');

const VERSION = 1;
const MAX_PRESETS = 200;
const MAX_NAME_LENGTH = 60;

/** 和 image-adjustments.cjs 保持同一套范围，坏数据进来也不会污染画布。 */
const ADJUSTMENT_LIMITS = {
  brightness: [0.2, 2],
  contrast: [0.2, 2],
  saturation: [0, 2],
  grayscale: [0, 1],
  hue: [-180, 180],
  clarity: [0, 100],
  blur: [0, 40],
  noise: [0, 100],
  speckle: [0, 400],
};
const ADJUSTMENT_FALLBACKS = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  grayscale: 0,
  hue: 0,
  clarity: 0,
  blur: 0,
  noise: 0,
  speckle: 0,
};

function safeString(value) {
  return String(value ?? '').trim();
}

function normalizeAdjustments(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const [key, fallback] of Object.entries(ADJUSTMENT_FALLBACKS)) {
    const numeric = Number(source[key]);
    const [min, max] = ADJUSTMENT_LIMITS[key];
    result[key] = Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
  }
  return result;
}

function normalizePreset(value, fallbackId) {
  const source = value && typeof value === 'object' ? value : {};
  const id = safeString(source.id) || fallbackId;
  if (!id) return null;
  const createdAt = Number(source.createdAt);
  const updatedAt = Number(source.updatedAt);
  return {
    id,
    name: safeString(source.name).slice(0, MAX_NAME_LENGTH),
    adjustments: normalizeAdjustments(source.adjustments),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function createPresetStore({ rootDir }) {
  function filePath() {
    return path.join(rootDir, 'image-presets.json');
  }

  function readRaw() {
    try {
      return JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    } catch {
      return {};
    }
  }

  function writeRaw(payload) {
    const targetPath = filePath();
    const targetDir = path.dirname(targetPath);
    const temporaryPath = path.join(targetDir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
    fs.mkdirSync(targetDir, { recursive: true });
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(payload || {}, null, 2)}\n`, 'utf8');
      fs.renameSync(temporaryPath, targetPath);
    } catch (error) {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {}
      throw error;
    }
  }

  function load() {
    const raw = readRaw();
    const sourceItems = raw && typeof raw.items === 'object' && raw.items ? raw.items : {};
    const items = {};
    for (const [key, value] of Object.entries(sourceItems)) {
      if (Object.keys(items).length >= MAX_PRESETS) break;
      const preset = normalizePreset(value, safeString(key));
      if (preset) items[preset.id] = preset;
    }
    // order 里可能有失效 id，也可能漏掉新加的项，这里统一补齐/去重。
    const order = [];
    for (const value of Array.isArray(raw?.order) ? raw.order : []) {
      const id = safeString(value);
      if (items[id] && !order.includes(id)) order.push(id);
    }
    for (const id of Object.keys(items)) {
      if (!order.includes(id)) order.push(id);
    }
    return { version: VERSION, order, items };
  }

  function save(payload) {
    const sourceItems = payload && typeof payload.items === 'object' && payload.items ? payload.items : {};
    const items = {};
    for (const [key, value] of Object.entries(sourceItems)) {
      if (Object.keys(items).length >= MAX_PRESETS) break;
      const preset = normalizePreset(value, safeString(key));
      if (preset) items[preset.id] = preset;
    }
    const order = [];
    for (const value of Array.isArray(payload?.order) ? payload.order : []) {
      const id = safeString(value);
      if (items[id] && !order.includes(id)) order.push(id);
    }
    for (const id of Object.keys(items)) {
      if (!order.includes(id)) order.push(id);
    }
    const next = { version: VERSION, order, items };
    writeRaw(next);
    return next;
  }

  return { load, save, filePath };
}

module.exports = { createPresetStore };
