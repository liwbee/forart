import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import sharp from "sharp";

export const IMAGE_THUMBNAIL_RULES = {
  scale: 0.5,
  maxLongEdge: 1280,
  minLongEdge: 512,
  webpQuality: 78,
};

const limit = pLimit(2);
const inFlight = new Map();

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function isSvgImage({ sourcePath = "", mimeType = "" } = {}) {
  return String(mimeType || "").toLowerCase() === "image/svg+xml"
    || path.extname(String(sourcePath || "")).toLowerCase() === ".svg";
}

function logThumbnailError(logger, message, error) {
  if (!logger) return;
  const detail = error instanceof Error ? error.message : String(error);
  logger(`${message}: ${detail}`);
}

function isThumbnailFresh(sourcePath, targetPath) {
  if (!existsSync(sourcePath) || !existsSync(targetPath)) return false;
  try {
    return statSync(targetPath).mtimeMs >= statSync(sourcePath).mtimeMs;
  } catch {
    return false;
  }
}

async function generateSharpImageThumbnailNow({ sourcePath, targetPath, mimeType = "", logger = console.warn } = {}) {
  if (!sourcePath || !targetPath || isSvgImage({ sourcePath, mimeType }) || !existsSync(sourcePath)) return null;
  if (isThumbnailFresh(sourcePath, targetPath)) return { filePath: targetPath, mimeType: "image/webp" };

  try {
    const image = sharp(sourcePath, { animated: false }).rotate();
    const metadata = await image.metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    const longEdge = Math.max(width, height);
    if (!width || !height || longEdge < IMAGE_THUMBNAIL_RULES.minLongEdge) return null;

    const nextLongEdge = Math.min(Math.round(longEdge * IMAGE_THUMBNAIL_RULES.scale), IMAGE_THUMBNAIL_RULES.maxLongEdge);
    if (nextLongEdge >= longEdge) return null;
    const ratio = nextLongEdge / longEdge;
    const nextWidth = Math.max(1, Math.round(width * ratio));
    const nextHeight = Math.max(1, Math.round(height * ratio));

    ensureDir(path.dirname(targetPath));
    const temp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await image
      .resize({ width: nextWidth, height: nextHeight, fit: "inside", withoutEnlargement: true })
      .webp({ quality: IMAGE_THUMBNAIL_RULES.webpQuality })
      .toFile(temp);
    renameSync(temp, targetPath);
    return { filePath: targetPath, mimeType: "image/webp" };
  } catch (error) {
    logThumbnailError(logger, `Failed to generate thumbnail for ${sourcePath}`, error);
    return null;
  }
}

export function generateSharpImageThumbnail({ key, sourcePath, targetPath, mimeType = "", logger = console.warn } = {}) {
  if (!sourcePath || !targetPath) return Promise.resolve(null);
  if (isThumbnailFresh(sourcePath, targetPath)) return Promise.resolve({ filePath: targetPath, mimeType: "image/webp" });
  const taskKey = String(key || targetPath);
  if (inFlight.has(taskKey)) return inFlight.get(taskKey);
  const task = limit(() => generateSharpImageThumbnailNow({ sourcePath, targetPath, mimeType, logger }))
    .finally(() => inFlight.delete(taskKey));
  inFlight.set(taskKey, task);
  return task;
}

export async function readSharpImageDimensions(input, { mimeType = "", logger = console.warn } = {}) {
  if (!input || isSvgImage({ sourcePath: typeof input === "string" ? input : "", mimeType })) {
    return { width: 0, height: 0 };
  }
  try {
    const metadata = await sharp(input, { animated: false }).metadata();
    const orientation = Number(metadata.orientation || 0);
    const shouldSwap = orientation >= 5 && orientation <= 8;
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    return {
      width: shouldSwap ? height : width,
      height: shouldSwap ? width : height,
    };
  } catch (error) {
    logThumbnailError(logger, "Failed to read image dimensions", error);
    return { width: 0, height: 0 };
  }
}
