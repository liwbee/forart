import { unlink } from "node:fs/promises";
import path from "node:path";
import { libraryAssetThumbnailStorageKey } from "./library-asset-thumbnails.mjs";

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function unlinkIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function processAssetCleanupJob(runtime, job) {
  try {
    const sourcePath = path.isAbsolute(job.storage_key)
      ? path.resolve(job.storage_key)
      : path.resolve(runtime.storageRoot, job.storage_key);
    if (!isInside(runtime.storageRoot, sourcePath)) throw new Error("Asset cleanup path is outside the storage root");
    await unlinkIfPresent(sourcePath);
    if (job.thumbnail_storage_key) {
      const thumbnailPath = path.isAbsolute(job.thumbnail_storage_key)
        ? path.resolve(job.thumbnail_storage_key)
        : path.resolve(runtime.runtimeDataDir, job.thumbnail_storage_key);
      if (!isInside(runtime.runtimeDataDir, thumbnailPath)) throw new Error("Asset thumbnail cleanup path is outside the Forart data root");
      await unlinkIfPresent(thumbnailPath);
    }
    await runtime.repository.completeAssetCleanup(job.asset_id);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await runtime.repository.failAssetCleanup(job.asset_id, detail).catch(() => {});
    console.warn(`[library-asset-cleanup] Failed to clean ${job.asset_id}: ${detail}`);
    return false;
  }
}

export async function recoverPendingAssetCleanups(runtime) {
  const jobs = await runtime.repository.listAssetCleanupJobs();
  for (const job of jobs) await processAssetCleanupJob(runtime, job);
  return jobs.length;
}

export async function recoverUnreferencedAssets(runtime) {
  const assetIds = await runtime.repository.listUnreferencedAssetIds();
  for (const assetId of assetIds) {
    const asset = await runtime.repository.getAsset(assetId);
    if (!asset) continue;
    const thumbnailStorageKey = libraryAssetThumbnailStorageKey(runtime, asset);
    const pending = await runtime.repository.takeAssetForCleanup(assetId, new Date().toISOString(), thumbnailStorageKey);
    if (pending?.job) await processAssetCleanupJob(runtime, pending.job);
  }
  return assetIds.length;
}
