import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureLibraryAssetThumbnail, deleteLibraryAssetThumbnail, libraryAssetThumbnailStorageKey } from "./library-asset-thumbnails.mjs";
import { ensureDefaultProject, newId, normalizeLibraryTagColor, nowIso, validateFileNamePart } from "./library-runtime.mjs";
import { readSharpImageDimensions } from "../shared/image-thumbnail-sharp.mjs";
import { processAssetCleanupJob } from "./library-asset-cleanup.mjs";
import {
  libraryEntryDirectory,
  libraryProjectCoverDirectory,
  libraryProjectDirectory,
  reconcileLibraryProjectStorage,
} from "./library-storage-layout.mjs";

const PROMPT_LIMIT = 4000;

function normalizeTags(values) {
  const tags = [];
  for (const value of values || []) {
    const tag = String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function normalizeBulkEntryIds(values) {
  const ids = Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
  if (!ids.length) throw new Error("No entries selected");
  if (ids.length > 500) throw new Error("Bulk operation is limited to 500 entries");
  return ids;
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

function guessSuffix(filename, mimeType) {
  const ext = path.extname(String(filename || "")).trim().toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  const value = String(mimeType || "").toLowerCase();
  if (value === "image/jpeg") return ".jpg";
  if (value === "image/webp") return ".webp";
  if (value === "image/gif") return ".gif";
  if (value === "image/svg+xml") return ".svg";
  return ".png";
}

function safePathPart(value, fallback) {
  const name = String(value || "").trim() || fallback;
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").replace(/[ .]+$/g, "").slice(0, 80) || fallback;
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function sanitizeGender(value) {
  return value === "female" || value === "male" ? value : "unknown";
}

function entryMatchesTagFilter(entry, includeTagNames, excludeTagNames) {
  return includeTagNames.every((tagName) => entry.tags.includes(tagName))
    && excludeTagNames.every((tagName) => !entry.tags.includes(tagName));
}

export function createUnifiedLibraryService(runtime, { kind, localAssetUrl, localAssetThumbnailUrl } = {}) {
  const repository = runtime.repository;
  const storageRoot = runtime.storageRoot;
  const labels = runtime.labels;
  const config = {
    model: { defaultProject: labels.defaultProject, defaultEntry: labels.defaultModel, prefix: "model", source: "model-library", label: "model name" },
    outfit: { defaultProject: labels.defaultOutfitProject, defaultEntry: labels.defaultOutfit, prefix: "outfit", source: "outfit-library", label: "outfit name" },
    action: { defaultProject: labels.defaultActionProject, defaultEntry: labels.defaultAction, prefix: "action", source: "action-library", label: "action name" },
  }[kind];
  if (!config) throw new Error(`Unsupported library kind: ${kind}`);

  function assetUrl(assetId) {
    if (!assetId) return null;
    if (localAssetUrl) return localAssetUrl(assetId);
    return `/api/assets/${encodeURIComponent(assetId)}/file`;
  }

  function assetThumbnailUrl(assetId) {
    if (!assetId) return null;
    if (localAssetThumbnailUrl) return localAssetThumbnailUrl(assetId);
    return `/api/assets/${encodeURIComponent(assetId)}/thumb`;
  }

  function entryFilenameStem(entryName, index = 0) {
    const name = safePathPart(entryName, config.prefix);
    return kind === "model" ? `${name}_${String(index + 1).padStart(3, "0")}` : name;
  }

  async function projectWithCover(project) {
    return {
      ...project,
      cover_url: assetUrl(project?.cover_asset_id),
      cover_thumbnail_url: assetThumbnailUrl(project?.cover_asset_id),
    };
  }

  async function writeAsset(content, mimeType, originalFilename, { source, directory, filenameStem, dimensions } = {}) {
    const assetId = newId("asset");
    const suffix = guessSuffix(originalFilename, mimeType);
    const filenameBase = safePathPart(filenameStem || assetId, assetId);
    const targetDirectory = path.resolve(directory || path.join(storageRoot, ".forart", "assets"));
    if (!isInside(storageRoot, targetDirectory)) throw new Error("Invalid asset directory");
    ensureDir(targetDirectory);
    let filename = `${filenameBase}${suffix}`;
    let targetPath = path.join(targetDirectory, filename);
    if (existsSync(targetPath)) {
      filename = `${filenameBase}_${assetId.slice(-12)}${suffix}`;
      targetPath = path.join(targetDirectory, filename);
    }
    writeFileSync(targetPath, content);
    const info = dimensions || await readSharpImageDimensions(content, { mimeType });
    const asset = {
      id: assetId,
      storage_key: path.relative(storageRoot, targetPath),
      filename,
      mime_type: String(mimeType || "application/octet-stream"),
      width: Number(info?.width || 0),
      height: Number(info?.height || 0),
      size_bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      source: String(source || "library"),
      created_at: nowIso(),
    };
    return { asset, targetPath };
  }

  async function writeAssetInTransaction(content, mimeType, filename, options, work) {
    const { asset, targetPath } = await writeAsset(content, mimeType, filename, options);
    try {
      const result = await repository.transaction(async (tx) => {
        await tx.insertAsset(asset);
        return work(tx, asset);
      });
      await ensureLibraryAssetThumbnail(runtime, asset, targetPath);
      return result;
    } catch (error) {
      try {
        if (existsSync(targetPath)) unlinkSync(targetPath);
      } catch {}
      deleteLibraryAssetThumbnail(runtime, asset);
      throw error;
    }
  }

  async function projectExists(projectId) {
    return Boolean(await repository.getProject(kind, projectId));
  }

  async function loadEntry(entryId) {
    return repository.getEntry(kind, entryId);
  }

  async function listProjects() {
    const projects = await repository.listProjects(kind);
    return { projects: await Promise.all(projects.map(projectWithCover)) };
  }

  async function createProject(payload = {}) {
    const timestamp = nowIso();
    const name = validateFileNamePart(payload.name || config.defaultProject, "project name");
    if (await repository.projectNameExists(kind, name)) throw new Error("Project name must be unique");
    const project = {
      id: newId(`${config.prefix}_project`), kind, name, cover_asset_id: null,
      sort_order: await repository.nextProjectSortOrder(kind), created_at: timestamp, updated_at: timestamp,
    };
    return projectWithCover(await repository.insertProject(project));
  }

  async function updateProjectRecord(project, payload) {
    if (kind !== "outfit" || payload.name === undefined || payload.name === project.name) {
      return repository.updateProject(kind, project.id, { ...payload, updated_at: nowIso() });
    }

    return repository.transaction(async (tx) => {
      const entries = await tx.listEntriesOldestFirst(kind, project.id);
      const timestamp = nowIso();
      const renameToken = newId("outfit_rename");
      for (const entry of entries) {
        await tx.updateEntry(kind, entry.id, { name: `${renameToken}_${entry.id}`, updated_at: timestamp });
      }
      for (const [index, entry] of entries.entries()) {
        await tx.updateEntry(kind, entry.id, {
          name: `${payload.name}_${String(index + 1).padStart(3, "0")}`,
          updated_at: timestamp,
        });
      }
      return tx.updateProject(kind, project.id, { ...payload, updated_at: timestamp });
    });
  }

  async function updateProject(projectId, payload = {}) {
    const project = await repository.getProject(kind, projectId);
    if (!project) return null;
    if (payload.name !== undefined) {
      const name = validateFileNamePart(payload.name || config.defaultProject, "project name");
      if (await repository.projectNameExists(kind, name, projectId)) throw new Error("Project name must be unique");
      payload = { ...payload, name };
    }
    const next = await updateProjectRecord(project, payload);
    if (payload.name !== undefined && payload.name !== project.name) {
      await reconcileLibraryProjectStorage(runtime, kind, projectId);
    }
    return projectWithCover(next);
  }

  async function uploadProjectCover(projectId, payload = {}) {
    const project = await repository.getProject(kind, projectId);
    if (!project) return null;
    const decoded = parseDataUrl(payload.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
    if (!decoded) throw new Error("Invalid upload data");
    const previousAssetId = project.cover_asset_id;
    const result = await writeAssetInTransaction(decoded.buffer, decoded.mimeType, payload.filename || "image", {
      source: `${kind}-project-cover`, directory: libraryProjectCoverDirectory(runtime, kind, project.name), filenameStem: "cover",
    }, async (tx, asset) => {
      const next = await tx.updateProject(kind, projectId, { cover_asset_id: asset.id, updated_at: nowIso() });
      return projectWithCover(next);
    });
    await removeAssetIfUnused(previousAssetId);
    return result;
  }

  async function listTags(projectId) {
    if (!await projectExists(projectId)) return null;
    return repository.listTags(projectId);
  }

  async function ensureProjectTag(tx, projectId, name, color = "default") {
    const normalized = String(name || "").trim().replace(/\s+/g, " ").slice(0, 24);
    if (!normalized) return null;
    const existing = await tx.getTagByName(projectId, normalized);
    if (existing) return existing;
    const timestamp = nowIso();
    return tx.insertTagIfAbsent({
      id: newId("tag"), project_id: projectId, kind, name: normalized,
      color: normalizeLibraryTagColor(color), sort_order: await tx.nextTagSortOrder(projectId),
      created_at: timestamp, updated_at: timestamp,
    });
  }

  async function tagsByNames(tx, projectId, names, { requireExisting = false } = {}) {
    const output = [];
    for (const name of normalizeTags(names)) {
      const tag = requireExisting ? await tx.getTagByName(projectId, name) : await ensureProjectTag(tx, projectId, name);
      if (!tag && requireExisting) throw new Error(`Tag not found: ${name}`);
      if (tag) output.push(tag);
    }
    return output;
  }

  async function resolveTagNames(projectId, tagIds) {
    const ids = Array.from(new Set((tagIds || []).map(String).filter(Boolean)));
    const tags = await repository.listTagsByIds(projectId, ids);
    const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
    return ids.map((id) => tagsById.get(id)?.name).filter(Boolean);
  }

  async function updateEntryTags(tx, entryId, projectId, names) {
    const tags = await tagsByNames(tx, projectId, names);
    await tx.replaceEntryTags({ entryId, projectId, kind, tags });
  }

  async function materializeEntry(entry, relations = null) {
    if (!entry) return null;
    const tagRows = relations?.tags || await repository.tagsForEntry(entry.id);
    const assetRows = relations?.assets || await repository.listEntryAssets(kind, entry.id);
    const tags = tagRows.map((tag) => tag.name);
    const assets = assetRows.map((link) => normalizeEntryAsset(link));
    const cover = assets.find((asset) => Number(asset.is_cover) === 1) || assets[0] || null;
    const result = { ...entry, tags, cover_asset_id: cover?.asset_id || null };
    if (kind === "model") {
      result.cover_image_id = cover?.id || null;
      result.cover_url = assetUrl(cover?.asset_id);
      result.cover_thumbnail_url = assetThumbnailUrl(cover?.asset_id);
    } else {
      result.asset_id = cover?.asset_id || null;
      result.asset_url = assetUrl(cover?.asset_id);
      result.thumbnail_url = assetThumbnailUrl(cover?.asset_id);
    }
    return result;
  }

  function normalizeEntryAsset(link) {
    return {
      ...link,
      path: link.storage_key,
      asset_url: assetUrl(link.asset_id),
      thumbnail_url: assetThumbnailUrl(link.asset_id),
    };
  }

  async function listEntries(projectId, query = {}) {
    const project = await repository.getProject(kind, projectId);
    if (!project) return null;
    const includeTagNames = await resolveTagNames(projectId, query.tag_id || []);
    const excludeTagNames = await resolveTagNames(projectId, query.exclude_tag_id || []);
    const untaggedOnly = query.untagged === "1" || query.untagged === "true";
    const entryRows = await repository.listEntries(kind, projectId);
    const entryIds = entryRows.map((entry) => entry.id);
    const [tagRows, assetRows] = await Promise.all([
      repository.tagsForEntries(entryIds),
      repository.listEntryAssetsForEntries(kind, entryIds),
    ]);
    const tagsByEntry = new Map(entryIds.map((id) => [id, []]));
    const assetsByEntry = new Map(entryIds.map((id) => [id, []]));
    for (const tag of tagRows) tagsByEntry.get(tag.entry_id)?.push(tag);
    for (const asset of assetRows) assetsByEntry.get(asset.entry_id)?.push(asset);
    const entries = await Promise.all(entryRows.map((entry) => materializeEntry(entry, {
      tags: tagsByEntry.get(entry.id),
      assets: assetsByEntry.get(entry.id),
    })));
    const filtered = untaggedOnly
      ? entries.filter((entry) => !entry.tags.length)
      : includeTagNames.length || excludeTagNames.length
      ? entries.filter((entry) => entryMatchesTagFilter(entry, includeTagNames, excludeTagNames))
      : entries;
    if (kind === "model") {
      const gender = Array.isArray(query.gender) ? query.gender[0] || "" : query.gender || "";
      return { models: filtered.filter((entry) => (gender ? entry.gender === gender : true)) };
    }
    return { [kind === "outfit" ? "outfits" : "actions"]: filtered };
  }

  async function createEntry(projectId, payload = {}) {
    const project = await repository.getProject(kind, projectId);
    if (!project) return null;
    const timestamp = nowIso();
    const name = validateFileNamePart(payload.name || config.defaultEntry, config.label);
    if (await repository.entryNameExists(projectId, name)) throw new Error(`${config.label} must be unique within the project`);
    const id = newId(config.prefix);
    const entry = { id, project_id: projectId, kind, name, created_at: timestamp, updated_at: timestamp };
    const profile = kind === "model"
      ? { code: String(payload.code || nextCode([], project.name)), gender: sanitizeGender(payload.gender) }
      : kind === "action" ? { prompt: String(payload.prompt || "").slice(0, PROMPT_LIMIT) } : null;
    await repository.transaction(async (tx) => {
      const created = await tx.insertEntry(entry, profile);
      await updateEntryTags(tx, id, projectId, payload.tags || []);
      return created;
    });
    return materializeEntry(await repository.getEntry(kind, id));
  }

  function nextCode(_rows, projectName) {
    return `${safePathPart(projectName, "model")}_${Date.now().toString(36)}`;
  }

  async function createEntryFromFile(projectId, payload = {}) {
    const project = await repository.getProject(kind, projectId);
    if (!project) return null;
    const content = Buffer.isBuffer(payload.buffer) ? payload.buffer : Buffer.from(payload.buffer || "");
    if (!content.length) throw new Error("Invalid image data");
    const name = payload.name
      ? validateFileNamePart(payload.name, config.label)
      : `${safePathPart(project.name, config.prefix)}_${String((await repository.listEntries(kind, projectId)).length + 1).padStart(3, "0")}`;
    if (await repository.entryNameExists(projectId, name)) throw new Error(`${config.label} must be unique within the project`);
    const id = newId(config.prefix);
    const timestamp = nowIso();
    const result = await writeAssetInTransaction(content, payload.mime_type || "image/png", payload.filename || "image", {
      source: config.source,
      directory: libraryEntryDirectory(runtime, kind, project.name, name),
      filenameStem: entryFilenameStem(name),
    }, async (tx, asset) => {
      const entry = { id, project_id: projectId, kind, name, created_at: timestamp, updated_at: timestamp };
      const profile = kind === "model"
        ? { code: String(payload.code || nextCode([], project.name)), gender: sanitizeGender(payload.gender) }
        : kind === "action" ? { prompt: String(payload.prompt || "").slice(0, PROMPT_LIMIT) } : null;
      const created = await tx.insertEntry(entry, profile);
      await tx.insertEntryAsset({ id: newId("entry_asset"), entry_id: id, project_id: projectId, kind, asset_id: asset.id, role: "primary", is_cover: 1, caption: "", sort_order: 0, created_at: timestamp });
      const currentProject = await tx.getProject(kind, projectId);
      if (!currentProject?.cover_asset_id) await tx.updateProject(kind, projectId, { cover_asset_id: asset.id, updated_at: timestamp });
      await updateEntryTags(tx, id, projectId, payload.tags || []);
      return created;
    });
    return materializeEntry(await repository.getEntry(kind, id));
  }

  async function updateEntry(entryId, payload = {}) {
    const entry = await repository.getEntry(kind, entryId);
    if (!entry) return null;
    if (payload.name !== undefined) {
      const name = validateFileNamePart(payload.name || config.defaultEntry, config.label);
      if (await repository.entryNameExists(entry.project_id, name, entryId)) throw new Error(`${config.label} must be unique within the project`);
      payload = { ...payload, name };
    }
    await repository.transaction(async (tx) => {
      const values = { name: payload.name, updated_at: nowIso() };
      const profile = kind === "model" ? { gender: payload.gender === undefined ? undefined : sanitizeGender(payload.gender) }
        : kind === "action" ? { prompt: payload.prompt === undefined ? undefined : String(payload.prompt || "").slice(0, PROMPT_LIMIT) } : null;
      await tx.updateEntry(kind, entryId, values, profile);
      if (payload.tags !== undefined) await updateEntryTags(tx, entryId, entry.project_id, payload.tags);
      if (kind === "model" && payload.cover_image_id !== undefined) {
        const image = payload.cover_image_id ? await tx.getEntryAsset(payload.cover_image_id) : null;
        if (payload.cover_image_id && (!image || image.entry_id !== entryId)) throw new Error("Model image not found");
        await tx.clearEntryCover(entryId);
        if (image) await tx.updateEntryAsset(image.id, { is_cover: 1 });
      }
    });
    if (payload.name !== undefined && payload.name !== entry.name) {
      await reconcileLibraryProjectStorage(runtime, kind, entry.project_id);
    }
    return materializeEntry(await repository.getEntry(kind, entryId));
  }

  async function deleteEntry(entryId) {
    const entry = await repository.getEntry(kind, entryId);
    if (!entry) return null;
    const assetIds = (await repository.listEntryAssets(kind, entryId)).map((link) => link.asset_id);
    await repository.deleteEntry(kind, entryId);
    for (const assetId of assetIds) await removeAssetIfUnused(assetId);
    return { ok: true };
  }

  async function deleteProject(projectId) {
    const project = await repository.getProject(kind, projectId);
    if (!project) return null;
    const assetIds = await repository.listProjectAssetIds(kind, projectId);
    await repository.deleteProject(kind, projectId);
    await ensureDefaultProject(repository, kind, config.defaultProject, `${config.prefix}_project`);
    for (const assetId of assetIds) await removeAssetIfUnused(assetId);
    const projectDir = libraryProjectDirectory(runtime, kind, project.name);
    const projectStoragePrefix = `${path.relative(storageRoot, projectDir)}${path.sep}`;
    const hasRetainedAssets = await repository.assetStorageKeyExistsWithPrefix(projectStoragePrefix);
    if (!hasRetainedAssets && isInside(storageRoot, projectDir) && existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
    return { ok: true };
  }

  async function removeAssetIfUnused(assetId) {
    if (!assetId) return;
    const asset = await repository.getAsset(assetId);
    if (!asset) return;
    const thumbnailStorageKey = libraryAssetThumbnailStorageKey(runtime, asset);
    const pending = await repository.takeAssetForCleanup(assetId, nowIso(), thumbnailStorageKey);
    if (pending?.job) await processAssetCleanupJob(runtime, pending.job);
  }

  async function replaceEntryImage(entryId, payload = {}) {
    const entry = await repository.getEntry(kind, entryId);
    if (!entry) return null;
    const project = await repository.getProject(kind, entry.project_id);
    if (!project) return null;
    const decoded = parseDataUrl(payload.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
    if (!decoded) throw new Error("Invalid upload data");
    const previous = (await repository.listEntryAssets(kind, entryId)).find((link) => link.role === "primary") || null;
    const result = await writeAssetInTransaction(decoded.buffer, decoded.mimeType, payload.filename || "image", {
      source: config.source,
      directory: libraryEntryDirectory(runtime, kind, project.name, entry.name),
      filenameStem: entryFilenameStem(entry.name),
    }, async (tx, asset) => {
      if (previous) await tx.deleteEntryAsset(previous.id);
      await tx.insertEntryAsset({ id: newId("entry_asset"), entry_id: entry.id, project_id: entry.project_id, kind, asset_id: asset.id, role: "primary", is_cover: 1, caption: "", sort_order: 0, created_at: nowIso() });
      await tx.updateEntry(kind, entry.id, { updated_at: nowIso() });
      await tx.updateProject(kind, entry.project_id, { cover_asset_id: asset.id, updated_at: nowIso() });
      return tx.getEntry(kind, entry.id);
    });
    if (previous) await removeAssetIfUnused(previous.asset_id);
    await reconcileLibraryProjectStorage(runtime, kind, entry.project_id);
    return materializeEntry(await repository.getEntry(kind, entry.id));
  }

  async function createProjectTag(projectId, payload = {}) {
    if (!await projectExists(projectId)) return null;
    const name = String(payload.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
    if (!name) throw new Error("Tag name is required");
    return repository.transaction(async (tx) => {
      const timestamp = nowIso();
      const tag = await tx.insertTagIfAbsent({ id: newId("tag"), project_id: projectId, kind, name, color: normalizeLibraryTagColor(payload.color), sort_order: await tx.nextTagSortOrder(projectId), created_at: timestamp, updated_at: timestamp });
      const usage = (await tx.listTags(projectId)).find((item) => item.id === tag.id)?.usage_count || 0;
      return { ...tag, usage_count: usage };
    });
  }

  async function updateTag(projectId, tagId, payload = {}) {
    if (!await projectExists(projectId)) return null;
    const tag = await repository.getTag(projectId, tagId);
    if (!tag) return null;
    if (payload.name !== undefined) {
      const name = String(payload.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
      if (!name) throw new Error("Tag name is required");
      const existing = await repository.getTagByName(projectId, name);
      if (existing && existing.id !== tagId) throw new Error("Tag already exists");
      payload = { ...payload, name };
    }
    const next = await repository.updateTag(projectId, tagId, { ...payload, color: payload.color === undefined ? undefined : normalizeLibraryTagColor(payload.color), updated_at: nowIso() });
    return { ...next, usage_count: (await repository.listTags(projectId)).find((item) => item.id === tagId)?.usage_count || 0 };
  }

  async function deleteTag(projectId, tagId) {
    if (!await projectExists(projectId)) return null;
    await repository.deleteTag(projectId, tagId);
    return { ok: true };
  }

  async function existingProjectTagNames(projectId, names) {
    const normalized = normalizeTags(names);
    const existing = new Set((await repository.listTagsByNames(projectId, normalized)).map((tag) => tag.name));
    const missing = normalized.find((name) => !existing.has(name));
    if (missing) throw new Error(`Tag not found: ${missing}`);
    return normalized;
  }

  async function bulkEntries(payload = {}) {
    const projectId = String(payload.project_id || "").trim();
    if (!projectId) throw new Error("project_id is required");
    if (!await projectExists(projectId)) return null;
    const ids = normalizeBulkEntryIds(payload.entry_ids || []);
    const entryRows = await repository.listEntriesByIds(kind, ids);
    const entriesById = new Map(entryRows.map((entry) => [entry.id, entry]));
    const entries = [];
    for (const id of ids) {
      const entry = entriesById.get(id);
      if (!entry) throw new Error(`${config.label.replace(" name", "")} not found: ${id}`);
      if (entry.project_id !== projectId) throw new Error(`Selected ${kind}s must belong to the current project`);
      entries.push(entry);
    }
    const operation = String(payload.operation || "");
    if (operation === "add_tags" || operation === "remove_tags") {
      const tagNames = await existingProjectTagNames(projectId, payload.tags || []);
      await repository.transaction(async (tx) => {
        const [projectTags, currentRows] = await Promise.all([tx.listTags(projectId), tx.tagsForEntries(ids)]);
        const projectTagsByName = new Map(projectTags.map((tag) => [tag.name, tag]));
        const currentByEntry = new Map(ids.map((id) => [id, []]));
        for (const row of currentRows) currentByEntry.get(row.entry_id)?.push(row.name);
        const replacements = entries.map((entry) => {
          const current = currentByEntry.get(entry.id) || [];
          const next = operation === "add_tags" ? normalizeTags([...current, ...tagNames]) : current.filter((tag) => !tagNames.includes(tag));
          return { entryId: entry.id, tags: next.map((name) => projectTagsByName.get(name)).filter(Boolean) };
        });
        await tx.replaceEntriesTags({ entries: replacements, projectId, kind, updatedAt: nowIso() });
      });
      return { ok: true, kind, operation, project_id: projectId, requested: ids.length, updated: ids.length, deleted: 0, skipped: [], tags: (await listTags(projectId)).filter((tag) => tagNames.includes(tag.name)) };
    }
    if (operation === "delete") {
      for (const entry of entries) await deleteEntry(entry.id);
      return { ok: true, kind, operation, project_id: projectId, requested: ids.length, updated: 0, deleted: ids.length, skipped: [] };
    }
    throw new Error("Unsupported bulk operation");
  }

  async function addImage(modelId, payload = {}) {
    if (kind !== "model") throw new Error("Model images are only available for model entries");
    const model = await repository.getEntry(kind, modelId);
    if (!model) return null;
    const asset = await repository.getAsset(payload.asset_id);
    if (!asset) throw new Error("Asset not found");
    const links = await repository.listEntryAssets(kind, modelId);
    const timestamp = nowIso();
    const link = await repository.insertEntryAsset({ id: newId("image"), entry_id: modelId, project_id: model.project_id, kind, asset_id: asset.id, role: "gallery", is_cover: links.length ? 0 : 1, caption: String(payload.caption || ""), sort_order: Number(payload.sort_order || links.length), created_at: timestamp });
    return normalizeEntryAsset(link);
  }

  async function listImages(modelId) {
    if (kind !== "model") return null;
    const model = await repository.getEntry(kind, modelId);
    if (!model) return null;
    return { images: (await repository.listEntryAssets(kind, modelId)).map(normalizeEntryAsset) };
  }

  async function deleteImage(imageId) {
    if (kind !== "model") return null;
    const link = await repository.getEntryAsset(imageId);
    if (!link || link.kind !== kind) return null;
    await repository.deleteEntryAsset(imageId);
    if (Number(link.is_cover) === 1) {
      const next = (await repository.listEntryAssets(kind, link.entry_id))[0];
      if (next) await repository.updateEntryAsset(next.id, { is_cover: 1 });
    }
    await removeAssetIfUnused(link.asset_id);
    return { ok: true };
  }

  async function uploadEntryImage(entryId, payload) {
    return replaceEntryImage(entryId, payload);
  }

  async function uploadModelImage(modelId, payload = {}) {
    if (kind !== "model") throw new Error("Model images are only available for model entries");
    const model = await repository.getEntry(kind, modelId);
    if (!model) return null;
    const project = await repository.getProject(kind, model.project_id);
    if (!project) return null;
    const decoded = parseDataUrl(payload.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
    if (!decoded) throw new Error("Invalid upload data");
    const links = await repository.listEntryAssets(kind, modelId);
    const sortOrder = links.reduce((max, link) => Math.max(max, Number(link.sort_order || 0)), -1) + 1;
    const imageId = newId("image");
    await writeAssetInTransaction(decoded.buffer, decoded.mimeType, payload.filename || "image", {
      source: config.source,
      directory: libraryEntryDirectory(runtime, kind, project.name, model.name),
      filenameStem: entryFilenameStem(model.name, links.length),
    }, async (tx, asset) => {
      await tx.insertEntryAsset({ id: imageId, entry_id: model.id, project_id: model.project_id, kind, asset_id: asset.id, role: "gallery", is_cover: links.length ? 0 : 1, caption: "", sort_order: sortOrder, created_at: nowIso() });
      await tx.updateEntry(kind, model.id, { updated_at: nowIso() });
      return asset.id;
    });
    const link = await repository.getEntryAsset(imageId);
    return { image: normalizeEntryAsset(link), asset: { id: link.asset_id } };
  }

  async function importEntries(projectId, payload = {}) {
    if (!await projectExists(projectId)) return null;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (!entries.length) throw new Error("No rows selected for import");
    const imported = [];
    const failed = [];
    const rows = [];
    for (const entry of entries) {
      const images = kind === "model" && Array.isArray(entry.images) ? entry.images : [entry];
      const rowBase = { id: String(entry.id || newId(`${kind}-import-entry`)), stem: String(entry.stem || entry.name || ""), filename: String(entry.filename || images[0]?.filename || entry.name || "image"), relative_path: String(entry.relative_path || entry.filename || images[0]?.relative_path || images[0]?.filename || entry.name || ""), proposed_name: String(entry.name || ""), gender: sanitizeGender(entry.gender), thumbnail_url: String(entry.thumbnail_url || ""), selectable: true, selected: true, status: "ready", errors: [], warnings: Array.isArray(entry.warnings) ? entry.warnings : [] };
      try {
        const name = entry.name ? validateFileNamePart(entry.name, config.label) : undefined;
        if (name && await repository.entryNameExists(projectId, name)) throw new Error(`${config.label} must be unique within the project`);
        const tagNames = entry.tags?.length ? await existingProjectTagNames(projectId, entry.tags) : [];
        const created = kind === "model"
          ? await createImportedModel(projectId, { ...entry, name, images }, tagNames)
          : await createEntryFromFile(projectId, { ...entry, name, buffer: Buffer.from(String(entry.data || ""), "base64"), mime_type: entry.mime_type || "image/png", filename: entry.filename || "image", tags: tagNames });
        imported.push(created);
        rows.push({ ...rowBase, [`${kind}_id`]: created.id, final_status: rowBase.warnings.length ? "warning" : "imported" });
      } catch (error) {
        const failedRow = { ...rowBase, final_status: "failed", errors: [{ code: "import_failed", message: error instanceof Error ? error.message : String(error) }] };
        failed.push(failedRow);
        rows.push(failedRow);
      }
    }
    return { imported_count: imported.length, failed_count: failed.length, imported, not_selected: [], failed, rows };
  }

  async function createImportedModel(projectId, entry, tagNames) {
    const images = (entry.images || []).filter((image) => String(image?.data || "").trim());
    if (!images.length) return createEntry(projectId, { ...entry, tags: tagNames });
    const first = images[0];
    const created = await createEntryFromFile(projectId, { ...entry, name: entry.name, gender: entry.gender, buffer: Buffer.from(String(first.data || ""), "base64"), filename: first.filename || entry.filename || "image", mime_type: first.mime_type || entry.mime_type || "image/png", tags: tagNames });
    for (const [index, image] of images.slice(1).entries()) {
      const decoded = parseDataUrl(image.data ? `data:${image.mime_type || "image/png"};base64,${image.data}` : "");
      if (!decoded) continue;
      const project = await repository.getProject(kind, projectId);
      const asset = await writeAssetInTransaction(decoded.buffer, decoded.mimeType, image.filename || "image", {
        source: config.source,
        directory: libraryEntryDirectory(runtime, kind, project.name, created.name),
        filenameStem: entryFilenameStem(created.name, index + 1),
      }, async (tx, stored) => {
        const link = await tx.insertEntryAsset({ id: newId("image"), entry_id: created.id, project_id: projectId, kind, asset_id: stored.id, role: "gallery", is_cover: 0, caption: String(image.caption || ""), sort_order: Number(image.sort_order || 0), created_at: nowIso() });
        return link;
      });
      void asset;
    }
    return materializeEntry(await repository.getEntry(kind, created.id));
  }

  return {
    listProjects,
    createProject,
    updateProject,
    deleteProject,
    uploadProjectCover,
    listEntries,
    ...(kind === "model" ? { listModels: listEntries, createModel: createEntry, updateModel: updateEntry, deleteModel: deleteEntry, uploadImage: uploadModelImage, listImages, addImage, deleteImage } : {}),
    ...(kind === "outfit" ? { listOutfits: listEntries, createOutfitFromFile: createEntryFromFile, updateOutfit: updateEntry, deleteOutfit: deleteEntry, replaceOutfitImage: uploadEntryImage } : {}),
    ...(kind === "action" ? { listActions: listEntries, createActionFromFile: createEntryFromFile, updateAction: updateEntry, deleteAction: deleteEntry, replaceActionImage: uploadEntryImage, loadActionEntry: (id) => loadEntry(id).then(materialize), existingProjectTagNames } : {}),
    importEntries,
    bulkEntries,
    projectExists,
    listTags,
    createTag: createProjectTag,
    updateTag,
    deleteTag,
  };
}
