import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const THUMB_DIR = path.join("thumb", "library-assets");
const THUMB_EXT = ".webp";
const MIN_LONG_EDGE = 512;
const MAX_LONG_EDGE = 1280;
const SCALE = 0.5;
const WEBP_QUALITY = 78;
const MAX_CONCURRENT_GENERATION = 2;

const inFlightByKey = new Map();
const queue = [];
let activeCount = 0;

function logThumbnailError(message, error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[library-thumbnail] ${message}: ${detail}`);
}

function runLimited(work) {
  return new Promise((resolve) => {
    queue.push({ work, resolve });
    drainQueue();
  });
}

function drainQueue() {
  while (activeCount < MAX_CONCURRENT_GENERATION && queue.length) {
    const item = queue.shift();
    activeCount += 1;
    Promise.resolve()
      .then(item.work)
      .then((value) => item.resolve(value))
      .catch((error) => {
        logThumbnailError("Unexpected generation failure", error);
        item.resolve(null);
      })
      .finally(() => {
        activeCount -= 1;
        drainQueue();
      });
  }
}

function safeAssetId(assetId) {
  const value = String(assetId || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid asset id");
  return value;
}

function databaseDir(runtime) {
  return runtime?.databaseDir || path.dirname(runtime?.databasePath || "");
}

export function libraryAssetThumbnailRoot(runtime) {
  const root = databaseDir(runtime);
  if (!root) throw new Error("Library database directory is not configured");
  return path.join(root, THUMB_DIR);
}

export function libraryAssetThumbnailPath(runtime, assetId) {
  return path.join(libraryAssetThumbnailRoot(runtime), `${safeAssetId(assetId)}${THUMB_EXT}`);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function parseImageDataUrl(value) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(value || ""));
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), buffer: Buffer.from(match[2], "base64") };
}

export function saveUploadedLibraryAssetThumbnail(runtime, assetId, dataUrl) {
  if (!dataUrl) return false;
  try {
    const parsed = parseImageDataUrl(dataUrl);
    if (!parsed?.buffer?.length) return false;
    if (parsed.mimeType !== "image/webp") return false;
    const target = libraryAssetThumbnailPath(runtime, assetId);
    ensureDir(path.dirname(target));
    writeFileSync(target, parsed.buffer);
    return true;
  } catch (error) {
    logThumbnailError(`Failed to save uploaded thumbnail for ${assetId}`, error);
    return false;
  }
}

export function deleteLibraryAssetThumbnail(runtime, assetId) {
  if (!assetId) return;
  try {
    const target = libraryAssetThumbnailPath(runtime, assetId);
    if (existsSync(target)) unlinkSync(target);
  } catch (error) {
    logThumbnailError(`Failed to delete thumbnail for ${assetId}`, error);
  }
}

function isSvg(asset, sourcePath) {
  const mimeType = String(asset?.mime_type || "").toLowerCase();
  return mimeType === "image/svg+xml" || path.extname(String(sourcePath || "")).toLowerCase() === ".svg";
}

async function generateLibraryAssetThumbnail(runtime, asset, sourcePath) {
  if (!asset?.id || !sourcePath || isSvg(asset, sourcePath) || !existsSync(sourcePath)) return null;
  const target = libraryAssetThumbnailPath(runtime, asset.id);
  if (existsSync(target)) return { filePath: target, mimeType: "image/webp" };

  try {
    const image = sharp(sourcePath, { animated: false }).rotate();
    const metadata = await image.metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    const longEdge = Math.max(width, height);
    if (!width || !height || longEdge < MIN_LONG_EDGE) return null;

    const nextLongEdge = Math.min(Math.round(longEdge * SCALE), MAX_LONG_EDGE);
    if (nextLongEdge >= longEdge) return null;
    const ratio = nextLongEdge / longEdge;
    const nextWidth = Math.max(1, Math.round(width * ratio));
    const nextHeight = Math.max(1, Math.round(height * ratio));

    ensureDir(path.dirname(target));
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await image
      .resize({ width: nextWidth, height: nextHeight, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(temp);
    renameSync(temp, target);
    return { filePath: target, mimeType: "image/webp" };
  } catch (error) {
    logThumbnailError(`Failed to generate thumbnail for ${asset.id}`, error);
    return null;
  }
}

export function ensureLibraryAssetThumbnail(runtime, asset, sourcePath) {
  if (!asset?.id) return Promise.resolve(null);
  let existingPath = "";
  try {
    existingPath = libraryAssetThumbnailPath(runtime, asset.id);
    if (existsSync(existingPath)) return Promise.resolve({ filePath: existingPath, mimeType: "image/webp" });
  } catch (error) {
    logThumbnailError(`Failed to resolve thumbnail path for ${asset.id}`, error);
    return Promise.resolve(null);
  }

  const key = `${databaseDir(runtime)}:${asset.id}`;
  if (inFlightByKey.has(key)) return inFlightByKey.get(key);
  const task = runLimited(() => generateLibraryAssetThumbnail(runtime, asset, sourcePath))
    .finally(() => inFlightByKey.delete(key));
  inFlightByKey.set(key, task);
  return task;
}
