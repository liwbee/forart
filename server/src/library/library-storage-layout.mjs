import { copyFileSync, existsSync, mkdirSync, renameSync, rmdirSync, unlinkSync } from "node:fs";
import path from "node:path";

const KIND_LABEL_KEYS = {
  model: "modelLibrary",
  outfit: "outfitLibrary",
  action: "actionLibrary",
};

function safePathPart(value, fallback) {
  const name = String(value || "").trim() || fallback;
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").replace(/[ .]+$/g, "").slice(0, 80) || fallback;
}

function assetSuffix(filename, mimeType) {
  const ext = path.extname(String(filename || "")).trim().toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  const value = String(mimeType || "").toLowerCase();
  if (value === "image/jpeg") return ".jpg";
  if (value === "image/webp") return ".webp";
  if (value === "image/gif") return ".gif";
  if (value === "image/svg+xml") return ".svg";
  return ".png";
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function absoluteAssetPath(runtime, asset) {
  return path.isAbsolute(asset.storage_key)
    ? path.resolve(asset.storage_key)
    : path.resolve(runtime.storageRoot, asset.storage_key);
}

function moveFile(source, target) {
  mkdirSync(path.dirname(target), { recursive: true });
  try {
    renameSync(source, target);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    copyFileSync(source, target);
    unlinkSync(source);
  }
}

function availableTarget(target, source) {
  if (path.resolve(target) === path.resolve(source) || !existsSync(target)) return target;
  const extension = path.extname(target);
  const stem = target.slice(0, target.length - extension.length);
  let index = 2;
  while (existsSync(`${stem}_${index}${extension}`)) index += 1;
  return `${stem}_${index}${extension}`;
}

function pruneEmptyParents(start, boundary) {
  let current = path.resolve(start);
  const root = path.resolve(boundary);
  while (current !== root && isInside(root, current)) {
    try {
      rmdirSync(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

export function libraryRootDirectory(runtime, kind) {
  const labelKey = KIND_LABEL_KEYS[kind];
  if (!labelKey) throw new Error(`Unsupported library kind: ${kind}`);
  return path.join(runtime.storageRoot, runtime.labels[labelKey]);
}

export function libraryProjectDirectory(runtime, kind, projectName) {
  return path.join(libraryRootDirectory(runtime, kind), safePathPart(projectName, `${kind}-project`));
}

export function libraryEntryDirectory(runtime, kind, projectName, entryName) {
  const projectDirectory = libraryProjectDirectory(runtime, kind, projectName);
  return kind === "model"
    ? path.join(projectDirectory, safePathPart(entryName, "model"))
    : projectDirectory;
}

export function libraryEntryFilename(kind, entryName, originalFilename, mimeType, index = 0) {
  const stem = safePathPart(entryName, kind);
  const suffix = assetSuffix(originalFilename, mimeType);
  return kind === "model"
    ? `${stem}_${String(index + 1).padStart(3, "0")}${suffix}`
    : `${stem}${suffix}`;
}

export function libraryProjectCoverDirectory(runtime, kind, projectName) {
  return path.join(libraryProjectDirectory(runtime, kind, projectName), "__project_cover__");
}

async function moveAsset(runtime, kind, asset, requestedTarget) {
  const source = absoluteAssetPath(runtime, asset);
  if (!isInside(runtime.storageRoot, source) || !isInside(runtime.storageRoot, requestedTarget)) {
    throw new Error("Library asset path is outside the storage root");
  }
  let target = requestedTarget;
  let movedAsset = false;
  if (path.resolve(source) !== path.resolve(target)) {
    if (existsSync(source)) {
      target = availableTarget(target, source);
      moveFile(source, target);
      movedAsset = true;
    } else if (!existsSync(target)) {
      return asset;
    }
  }
  const nextStorageKey = path.relative(runtime.storageRoot, target);
  const nextFilename = path.basename(target);
  const metadataChanged = asset.storage_key !== nextStorageKey || asset.filename !== nextFilename;
  if (!metadataChanged) return asset;
  const nextAsset = {
    ...asset,
    storage_key: nextStorageKey,
    filename: nextFilename,
  };
  try {
    await runtime.repository.updateAsset(asset.id, {
      storage_key: nextAsset.storage_key,
      filename: nextAsset.filename,
    });
  } catch (error) {
    if (movedAsset && existsSync(target) && !existsSync(source)) moveFile(target, source);
    throw error;
  }
  if (movedAsset) pruneEmptyParents(path.dirname(source), libraryRootDirectory(runtime, kind));
  return nextAsset;
}

async function listEntryAssetsInBatches(repository, kind, entryIds) {
  const rows = [];
  for (let offset = 0; offset < entryIds.length; offset += 500) {
    rows.push(...await repository.listEntryAssetsForEntries(kind, entryIds.slice(offset, offset + 500)));
  }
  return rows;
}

function entryAsset(runtimeLink) {
  return {
    id: runtimeLink.asset_id,
    storage_key: runtimeLink.storage_key,
    filename: runtimeLink.filename,
    mime_type: runtimeLink.mime_type,
  };
}

async function reconcileLibraryProject(runtime, kind, project, processedAssets) {
  const entries = await runtime.repository.listEntries(kind, project.id);
  const links = await listEntryAssetsInBatches(runtime.repository, kind, entries.map((entry) => entry.id));
  const linksByEntry = new Map(entries.map((entry) => [entry.id, []]));
  for (const link of links) linksByEntry.get(link.entry_id)?.push(link);
  const ownerLinks = await runtime.repository.listEntryAssetLinksForAssets(links.map((link) => link.asset_id));
  const ownerLinkIdByAsset = new Map();
  for (const link of ownerLinks) {
    if (!ownerLinkIdByAsset.has(link.asset_id)) ownerLinkIdByAsset.set(link.asset_id, link.id);
  }
  for (const entry of entries) {
    const entryLinks = linksByEntry.get(entry.id) || [];
    for (let index = 0; index < entryLinks.length; index += 1) {
      const link = entryLinks[index];
      if (processedAssets.has(link.asset_id)) continue;
      // Shared model images belong to their oldest link. This keeps their path
      // stable while still allowing the original model/project to be renamed.
      if (ownerLinkIdByAsset.get(link.asset_id) !== link.id) continue;
      const asset = entryAsset(link);
      const target = path.join(
        libraryEntryDirectory(runtime, kind, project.name, entry.name),
        libraryEntryFilename(kind, entry.name, asset.filename, asset.mime_type, index),
      );
      await moveAsset(runtime, kind, asset, target);
      processedAssets.add(asset.id);
    }
  }
  if (project.cover_asset_id && !processedAssets.has(project.cover_asset_id)) {
    const cover = await runtime.repository.getAsset(project.cover_asset_id);
    if (cover) {
      const target = path.join(libraryProjectCoverDirectory(runtime, kind, project.name), `cover${assetSuffix(cover.filename, cover.mime_type)}`);
      await moveAsset(runtime, kind, cover, target);
    }
  }
}

export async function reconcileLibraryProjectStorage(runtime, kind, projectId, processedAssets = new Set()) {
  const project = await runtime.repository.getProject(kind, projectId);
  if (!project) return;
  await reconcileLibraryProject(runtime, kind, project, processedAssets);
}

export async function reconcileLibraryStorage(runtime) {
  const processedAssets = new Set();
  for (const kind of ["model", "outfit", "action"]) {
    const projects = await runtime.repository.listProjects(kind);
    for (const project of projects) await reconcileLibraryProject(runtime, kind, project, processedAssets);
  }
}
