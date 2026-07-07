import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { generateSharpImageThumbnail } from "../shared/image-thumbnail-sharp.mjs";

const THUMB_DIR = path.join("thumb", "library-assets");
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

export function deleteLibraryAssetThumbnail(runtime, assetId) {
  if (!assetId) return;
  try {
    const target = libraryAssetThumbnailPath(runtime, assetId);
    if (existsSync(target)) unlinkSync(target);
  } catch (error) {
    logThumbnailError(`Failed to delete thumbnail for ${assetId}`, error);
  }
}

export function ensureLibraryAssetThumbnail(runtime, asset, sourcePath) {
  if (!asset?.id) return Promise.resolve(null);
  let targetPath = "";
  try {
    targetPath = libraryAssetThumbnailPath(runtime, asset.id);
  } catch (error) {
    logThumbnailError(`Failed to resolve thumbnail path for ${asset.id}`, error);
    return Promise.resolve(null);
  }
  return generateSharpImageThumbnail({
    key: `library:${databaseDir(runtime)}:${asset.id}`,
    sourcePath,
    targetPath,
    mimeType: asset.mime_type || "",
    logger: (message) => console.warn(`[library-thumbnail] ${message}`),
  });
}
