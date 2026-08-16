import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { generateSharpImageThumbnail } from "../shared/image-thumbnail-sharp.mjs";

const THUMB_EXT = ".webp";

function logThumbnailError(message, error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[library-thumbnail] ${message}: ${detail}`);
}

function safeAssetId(assetId) {
  const value = String(assetId || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid asset id");
  return value;
}

export function libraryAssetThumbnailRoot(runtime) {
  const root = String(runtime?.thumbnailRoot || "").trim();
  if (!root) throw new Error("Forart data directory is not configured");
  return path.resolve(root);
}

export function libraryAssetThumbnailPath(runtime, asset) {
  return path.join(libraryAssetThumbnailRoot(runtime, asset), `${safeAssetId(asset?.id)}${THUMB_EXT}`);
}

export function libraryAssetThumbnailStorageKey(runtime, asset) {
  const target = libraryAssetThumbnailPath(runtime, asset);
  return path.relative(runtime.runtimeDataDir, target);
}

export function deleteLibraryAssetThumbnail(runtime, asset) {
  if (!asset?.id) return;
  try {
    const target = libraryAssetThumbnailPath(runtime, asset);
    if (existsSync(target)) unlinkSync(target);
  } catch (error) {
    logThumbnailError(`Failed to delete thumbnail for ${asset.id}`, error);
  }
}

export function ensureLibraryAssetThumbnail(runtime, asset, sourcePath) {
  if (!asset?.id) return Promise.resolve(null);
  let targetPath = "";
  try {
    targetPath = libraryAssetThumbnailPath(runtime, asset);
  } catch (error) {
    logThumbnailError(`Failed to resolve thumbnail path for ${asset.id}`, error);
    return Promise.resolve(null);
  }
  return generateSharpImageThumbnail({
    key: `library:${targetPath}:${asset.id}`,
    sourcePath,
    targetPath,
    mimeType: asset.mime_type || "",
    logger: (message) => console.warn(`[library-thumbnail] ${message}`),
  });
}
