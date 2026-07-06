import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  newId,
  normalizeName,
  nowIso,
  validateFileNamePart,
} from "./library-runtime.mjs";

function safePathPart(value, fallback) {
  const name = String(value || "").trim() || fallback;
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").replace(/[ .]+$/g, "").slice(0, 80) || fallback;
}

function folderName(value, label) {
  return validateFileNamePart(value, label);
}

function sanitizeGender(value) {
  return value === "female" || value === "male" ? value : "unknown";
}

const defaultModelNames = {
  female: "New Female Model",
  male: "New Male Model",
  unknown: "Untitled Model",
};

function normalizeTags(values) {
  const tags = [];
  for (const value of values || []) {
    const tag = String(value || "").trim().replace(/\s+/g, " ");
    if (tag && !tags.includes(tag)) tags.push(tag.slice(0, 24));
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
  if (ext) return ext;
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".bin";
}

function imageDimensions() {
  return { width: 0, height: 0 };
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function isPathInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function runDbTransaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

export function createModelLibraryService(runtime, options = {}) {
  const db = runtime.db;
  const labels = runtime.labels;
  const storageRoot = runtime.storageRoot;
  const localAssetUrl = typeof options.localAssetUrl === "function" ? options.localAssetUrl : null;

  function assetUrl(assetId) {
    if (!assetId) return null;
    if (localAssetUrl) return localAssetUrl(assetId);
    return `/api/assets/${assetId}/file`;
  }

  function assetRelativePath(value) {
    const text = String(value || "");
    if (!text) return "";
    const absolute = path.isAbsolute(text) ? text : path.join(storageRoot, text);
    return path.relative(storageRoot, absolute);
  }

  function assetAbsolutePath(value) {
    const text = String(value || "");
    return path.isAbsolute(text) ? text : path.join(storageRoot, text);
  }

  function modelLibraryRoot() {
    return path.join(storageRoot, labels.modelLibrary);
  }

  function removeDirectoryInsideLibrary(directory) {
    const libraryRoot = modelLibraryRoot();
    const target = path.resolve(directory);
    if (!isPathInside(libraryRoot, target)) throw new Error("Refusing to delete a folder outside the model library");
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }

  function projectDirForName(projectName) {
    return path.join(modelLibraryRoot(), folderName(projectName, "project name"));
  }

  function modelDirForNames(projectName, modelName) {
    return path.join(projectDirForName(projectName), folderName(modelName, "model name"));
  }

  function replacePathPrefix(value, oldPrefix, nextPrefix) {
    const oldText = path.resolve(oldPrefix);
    const nextText = path.resolve(nextPrefix);
    const current = path.resolve(assetAbsolutePath(value));
    if (current === oldText) return nextText;
    const marker = oldText.endsWith(path.sep) ? oldText : `${oldText}${path.sep}`;
    if (!current.startsWith(marker)) return value;
    return path.join(nextText, current.slice(marker.length));
  }

  function renameDirectoryIfNeeded(oldDir, nextDir) {
    const oldPath = path.resolve(oldDir);
    const nextPath = path.resolve(nextDir);
    if (oldPath === nextPath || !existsSync(oldPath)) return;
    if (existsSync(nextPath)) throw new Error("Target folder already exists. Use a unique name.");
    ensureDir(path.dirname(nextPath));
    renameSync(oldPath, nextPath);
  }

  function loadProject(projectId) {
    return db.prepare("SELECT * FROM model_projects WHERE id = ?").get(projectId) || null;
  }

  function loadModel(modelId) {
    return db.prepare("SELECT * FROM model_entries WHERE id = ?").get(modelId) || null;
  }

  function projectExists(projectId) {
    return Boolean(loadProject(projectId));
  }

  function loadAsset(assetId) {
    return db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) || null;
  }

  function projectNameExists(name, exceptProjectId = "") {
    return Boolean(db.prepare("SELECT id FROM model_projects WHERE name = ? AND id <> ?").get(name, exceptProjectId));
  }

  function modelNameExists(projectId, name, exceptModelId = "") {
    return Boolean(db.prepare("SELECT id FROM model_entries WHERE project_id = ? AND name = ? AND id <> ?").get(projectId, name, exceptModelId));
  }

  function tagUsage(tagId) {
    return db.prepare("SELECT COUNT(*) AS total FROM library_entry_tags WHERE tag_id = ?").get(tagId)?.total || 0;
  }

  function tagsForModel(modelId) {
    return db.prepare(
      `
      SELECT t.name
      FROM library_entry_tags et
      JOIN library_tags t ON t.id = et.tag_id
      WHERE et.kind = 'model' AND et.entry_id = ?
      ORDER BY t.sort_order ASC, et.created_at ASC
      `
    ).all(modelId).map((row) => row.name);
  }

  function modelWithCoverAndTags(model) {
    const manual = model.cover_image_id ? db.prepare("SELECT * FROM model_images WHERE id = ? AND model_id = ?").get(model.cover_image_id, model.id) : null;
    const fallback = db.prepare("SELECT * FROM model_images WHERE model_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1").get(model.id);
    const cover = manual || fallback || null;
    return {
      ...model,
      tags: tagsForModel(model.id),
      cover_image_id: cover?.id || null,
      cover_asset_id: cover?.asset_id || null,
      cover_url: assetUrl(cover?.asset_id || null),
    };
  }

  function projectWithCover(project) {
    return {
      ...project,
      cover_url: assetUrl(project.cover_asset_id || null),
    };
  }

  function listTags(projectId) {
    return db.prepare(
      `
      SELECT *
      FROM library_tags
      WHERE kind = 'model' AND project_id = ?
      ORDER BY sort_order ASC, name ASC
      `
    ).all(projectId).map((tag) => ({ ...tag, usage_count: tagUsage(tag.id) }));
  }

  function createProjectTag(projectId, name) {
    const existing = db.prepare("SELECT * FROM library_tags WHERE kind = 'model' AND project_id = ? AND name = ?").get(projectId, name);
    if (existing) return { ...existing, usage_count: tagUsage(existing.id) };
    const timestamp = nowIso();
    const id = newId("tag");
    const sortOrder = db.prepare("SELECT COUNT(*) AS total FROM library_tags WHERE kind = 'model' AND project_id = ?").get(projectId)?.total || 0;
    db.prepare("INSERT INTO library_tags (id, kind, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, "model", projectId, name, sortOrder + 1, timestamp, timestamp);
    const tag = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(id);
    return { ...tag, usage_count: 0 };
  }

  function ensureProjectTag(projectId, name) {
    const tagName = String(name || "").trim().replace(/\s+/g, " ").slice(0, 24);
    if (!tagName) return null;
    return createProjectTag(projectId, tagName);
  }

  function updateEntryTags(entryId, projectId, names) {
    const nextTags = normalizeTags(names);
    db.prepare("DELETE FROM library_entry_tags WHERE kind = 'model' AND entry_id = ?").run(entryId);
    for (const name of nextTags) {
      const tag = ensureProjectTag(projectId, name);
      if (!tag) continue;
      db.prepare("INSERT OR IGNORE INTO library_entry_tags (id, kind, entry_id, tag_id, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(newId("entrytag"), "model", entryId, tag.id, nowIso());
    }
  }

  function existingProjectTagNames(projectId, names) {
    const nextTags = normalizeTags(names);
    if (!nextTags.length) throw new Error("At least one tag is required");
    const missing = nextTags.filter((name) => !db.prepare("SELECT id FROM library_tags WHERE kind = 'model' AND project_id = ? AND name = ?").get(projectId, name));
    if (missing.length) throw new Error(`Tag not found: ${missing[0]}`);
    return nextTags;
  }

  function resolveTagNames(projectId, tagIds) {
    const uniqueTagIds = Array.from(new Set((tagIds || []).map((tagId) => String(tagId || "").trim()).filter(Boolean)));
    if (!uniqueTagIds.length) return [];
    return uniqueTagIds
      .map((tagId) => db.prepare("SELECT name FROM library_tags WHERE kind = 'model' AND project_id = ? AND id = ?").get(projectId, tagId)?.name)
      .filter(Boolean);
  }

  function entryMatchesTagFilter(entry, includeTagNames, excludeTagNames) {
    return includeTagNames.every((tagName) => entry.tags.includes(tagName))
      && excludeTagNames.every((tagName) => !entry.tags.includes(tagName));
  }

  function deleteProjectTags(projectId) {
    const tags = db.prepare("SELECT id FROM library_tags WHERE kind = 'model' AND project_id = ?").all(projectId);
    for (const tag of tags) db.prepare("DELETE FROM library_entry_tags WHERE tag_id = ?").run(tag.id);
    db.prepare("DELETE FROM library_tags WHERE kind = 'model' AND project_id = ?").run(projectId);
  }

  function nextCode(projectId, projectName) {
    const prefix = safePathPart(projectName, "model");
    const rows = db.prepare("SELECT code FROM model_entries WHERE project_id = ?").all(projectId);
    const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
    let max = 0;
    for (const row of rows) {
      const match = pattern.exec(String(row.code || ""));
      if (match) max = Math.max(max, Number.parseInt(match[1], 10) || 0);
    }
    return `${prefix}${String(max + 1).padStart(3, "0")}`;
  }

  function nextModelName(projectId, gender) {
    const normalizedGender = sanitizeGender(gender);
    const base = defaultModelNames[normalizedGender] || labels.defaultModel;
    for (let index = 1; index < 1000; index += 1) {
      const name = `${base}${String(index).padStart(3, "0")}`;
      if (!modelNameExists(projectId, name)) return name;
    }
    return `${base}${Date.now()}`;
  }

  function renameProjectFolder(project, nextName) {
    const oldDir = projectDirForName(project.name);
    const nextDir = projectDirForName(nextName);
    renameDirectoryIfNeeded(oldDir, nextDir);
    const assets = db.prepare(
      `
      SELECT DISTINCT a.id, a.path
      FROM assets a
      LEFT JOIN model_images mi ON mi.asset_id = a.id
      LEFT JOIN model_entries me ON me.id = mi.model_id
      WHERE me.project_id = ? OR a.id = ?
      `
    ).all(project.id, project.cover_asset_id || "");
    for (const asset of assets) {
      db.prepare("UPDATE assets SET path = ? WHERE id = ?").run(assetRelativePath(replacePathPrefix(asset.path, oldDir, nextDir)), asset.id);
    }
  }

  function renameModelFolderAndImages(model, nextName) {
    const project = loadProject(model.project_id);
    if (!project) throw new Error("Model project not found");
    const oldDir = modelDirForNames(project.name, model.name);
    const nextDir = modelDirForNames(project.name, nextName);
    renameDirectoryIfNeeded(oldDir, nextDir);
    ensureDir(nextDir);
    const images = db.prepare(
      `
      SELECT mi.*, a.path AS asset_path
      FROM model_images mi
      JOIN assets a ON a.id = mi.asset_id
      WHERE mi.model_id = ?
      ORDER BY mi.sort_order ASC, mi.created_at ASC
      `
    ).all(model.id);
    images.forEach((image, index) => {
      const assetPath = assetAbsolutePath(image.asset_path || "");
      const suffix = path.extname(assetPath || image.filename || "") || guessSuffix(image.filename || "", image.mime_type || "");
      const filename = `${folderName(nextName, "model name")}_${String(index + 1).padStart(3, "0")}${suffix}`;
      const currentPath = assetPath && existsSync(assetPath) ? assetPath : replacePathPrefix(assetPath || "", oldDir, nextDir);
      const nextPath = path.join(nextDir, filename);
      if (currentPath && existsSync(currentPath) && path.resolve(currentPath) !== path.resolve(nextPath)) {
        if (existsSync(nextPath)) throw new Error(`Image file already exists: ${filename}`);
        renameSync(currentPath, nextPath);
      }
      db.prepare("UPDATE assets SET filename = ?, path = ? WHERE id = ?").run(filename, assetRelativePath(nextPath), image.asset_id);
      db.prepare("UPDATE model_images SET filename = ? WHERE id = ?").run(filename, image.id);
    });
  }

  function writeAsset(content, mimeType, originalFilename, { source, subdir, filenameStem }) {
    const assetId = newId("asset");
    const suffix = guessSuffix(originalFilename, mimeType);
    const filenameBase = safePathPart(filenameStem || assetId, assetId);
    const filename = `${filenameBase}${suffix}`;
    const targetDir = path.resolve(storageRoot, subdir || ".");
    if (!targetDir.startsWith(path.resolve(storageRoot))) throw new Error("Invalid asset directory");
    ensureDir(targetDir);
    let targetPath = path.join(targetDir, filename);
    if (existsSync(targetPath)) targetPath = path.join(targetDir, `${filenameBase}_${assetId.slice(0, 8)}${suffix}`);
    writeFileSync(targetPath, content);
    const dims = imageDimensions(content, mimeType);
    const timestamp = nowIso();
    try {
      db.prepare(
        `
        INSERT INTO assets (id, filename, path, mime_type, width, height, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(assetId, path.basename(targetPath), assetRelativePath(targetPath), mimeType, dims.width, dims.height, source, timestamp);
      return db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId);
    } catch (error) {
      try {
        unlinkSync(targetPath);
      } catch {}
      throw error;
    }
  }

  function writeAssetInTransaction(content, mimeType, originalFilename, options, work) {
    let asset = null;
    try {
      return runDbTransaction(db, () => {
        asset = writeAsset(content, mimeType, originalFilename, options);
        return work(asset);
      });
    } catch (error) {
      if (asset?.path) {
        try {
          unlinkSync(assetAbsolutePath(asset.path));
        } catch {}
      }
      throw error;
    }
  }

  function removeAssetIfUnused(assetId) {
    if (!assetId) return;
    const refs = db.prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM model_images WHERE asset_id = ?) +
        (SELECT COUNT(*) FROM model_projects WHERE cover_asset_id = ?) +
        (SELECT COUNT(*) FROM outfit_entries WHERE asset_id = ?) +
        (SELECT COUNT(*) FROM outfit_projects WHERE cover_asset_id = ?) +
        (SELECT COUNT(*) FROM action_entries WHERE asset_id = ?) +
        (SELECT COUNT(*) FROM action_projects WHERE cover_asset_id = ?)
        AS total
      `
    ).get(assetId, assetId, assetId, assetId, assetId, assetId)?.total || 0;
    if (refs > 0) return;
    const asset = loadAsset(assetId);
    if (asset?.path) {
      try {
        unlinkSync(assetAbsolutePath(asset.path));
      } catch {}
    }
    db.prepare("DELETE FROM assets WHERE id = ?").run(assetId);
  }

  function ensureDefaultProject() {
    const row = db.prepare("SELECT id FROM model_projects ORDER BY created_at ASC LIMIT 1").get();
    if (row) return;
    const timestamp = nowIso();
    const name = validateFileNamePart(labels.defaultProject, "project name");
    db.prepare("INSERT INTO model_projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(newId("project"), name, timestamp, timestamp);
  }

  function listProjects() {
    return { projects: db.prepare("SELECT * FROM model_projects ORDER BY updated_at DESC, created_at DESC").all().map(projectWithCover) };
  }

  function createProject(payload = {}) {
    const timestamp = nowIso();
    const id = newId("project");
    const name = validateFileNamePart(payload.name || labels.defaultProject, "project name");
    if (projectNameExists(name)) throw new Error("Project name must be unique");
    db.prepare("INSERT INTO model_projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, name, timestamp, timestamp);
    return projectWithCover(loadProject(id));
  }

  function updateProject(projectId, payload = {}) {
    const project = loadProject(projectId);
    if (!project) return null;
    return runDbTransaction(db, () => {
      if (payload.name !== undefined) {
        const nextName = validateFileNamePart(payload.name || labels.defaultProject, "project name");
        if (projectNameExists(nextName, projectId)) throw new Error("Project name must be unique");
        if (nextName !== project.name) {
          renameProjectFolder(project, nextName);
          db.prepare("UPDATE model_projects SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), projectId);
        }
      }
      if (payload.cover_asset_id !== undefined) {
        const coverAssetId = payload.cover_asset_id ? String(payload.cover_asset_id) : null;
        if (coverAssetId && !loadAsset(coverAssetId)) throw new Error("Asset not found");
        db.prepare("UPDATE model_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(coverAssetId, nowIso(), projectId);
      }
      return projectWithCover(loadProject(projectId));
    });
  }

  function deleteProject(projectId) {
    const project = loadProject(projectId);
    if (!project) return null;
    const projectDir = projectDirForName(project.name);
    const modelRows = db.prepare("SELECT id FROM model_entries WHERE project_id = ?").all(projectId);
    const imageRows = db.prepare("SELECT mi.asset_id FROM model_images mi JOIN model_entries me ON me.id = mi.model_id WHERE me.project_id = ?").all(projectId);
    const coverAssetRows = db.prepare("SELECT cover_asset_id AS asset_id FROM model_projects WHERE id = ?").all(projectId);
    runDbTransaction(db, () => {
      deleteProjectTags(projectId);
      db.prepare("DELETE FROM model_projects WHERE id = ?").run(projectId);
      for (const row of modelRows) {
        const imageAssets = db.prepare("SELECT asset_id FROM model_images WHERE model_id = ?").all(row.id);
        db.prepare("DELETE FROM model_images WHERE model_id = ?").run(row.id);
        for (const asset of imageAssets) removeAssetIfUnused(asset.asset_id);
      }
      for (const asset of imageRows) removeAssetIfUnused(asset.asset_id);
      for (const asset of coverAssetRows) removeAssetIfUnused(asset.asset_id);
      ensureDefaultProject();
    });
    removeDirectoryInsideLibrary(projectDir);
    return { ok: true };
  }

  function uploadProjectCover(projectId, payload = {}) {
    const project = loadProject(projectId);
    if (!project) return null;
    const decoded = parseDataUrl(payload.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
    if (!decoded) throw new Error("Invalid upload data");
    const relDir = path.relative(storageRoot, path.join(projectDirForName(project.name), "__project_cover__"));
    return writeAssetInTransaction(decoded.buffer, decoded.mimeType, payload.filename || "image", {
      source: "model-project-cover",
      subdir: relDir,
      filenameStem: "cover",
    }, (asset) => {
      db.prepare("UPDATE model_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, nowIso(), projectId);
      return projectWithCover(loadProject(projectId));
    });
  }

  function listModels(projectId, query = {}) {
    const project = loadProject(projectId);
    if (!project) return null;
    const includeTagNames = resolveTagNames(projectId, query.tag_id || []);
    const excludeTagNames = resolveTagNames(projectId, query.exclude_tag_id || []);
    const untaggedOnly = query.untagged === "1" || query.untagged === "true";
    const gender = Array.isArray(query.gender) ? query.gender[0] || "" : query.gender || "";
    const models = db.prepare("SELECT * FROM model_entries WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC").all(projectId)
      .map(modelWithCoverAndTags)
      .filter((model) => (gender ? model.gender === gender : true));
    const filtered = untaggedOnly
      ? models.filter((model) => !model.tags.length)
      : includeTagNames.length || excludeTagNames.length
      ? models.filter((model) => entryMatchesTagFilter(model, includeTagNames, excludeTagNames))
      : models;
    return { models: filtered };
  }

  function createModel(projectId, payload = {}) {
    const project = loadProject(projectId);
    if (!project) return null;
    const timestamp = nowIso();
    const code = nextCode(projectId, project.name);
    const id = newId("model");
    const name = validateFileNamePart(payload.name || labels.defaultModel, "model name");
    if (modelNameExists(projectId, name)) throw new Error("Model name must be unique within the project");
    return runDbTransaction(db, () => {
      db.prepare("INSERT INTO model_entries (id, project_id, name, code, gender, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, projectId, name, code, sanitizeGender(payload.gender), timestamp, timestamp);
      db.prepare("UPDATE model_projects SET updated_at = ? WHERE id = ?").run(timestamp, projectId);
      return modelWithCoverAndTags(loadModel(id));
    });
  }

  function importEntryImages(entry) {
    if (Array.isArray(entry.images)) return entry.images;
    if (entry.data) {
      return [{
        filename: entry.filename,
        mime_type: entry.mime_type,
        data: entry.data,
        caption: entry.caption,
      }];
    }
    return [];
  }

  function createModelFromImportEntry(projectId, entry = {}, tagNames = []) {
    const project = loadProject(projectId);
    if (!project) return null;
    const gender = sanitizeGender(entry.gender);
    const name = entry.name
      ? validateFileNamePart(entry.name, "model name")
      : nextModelName(projectId, gender);
    if (modelNameExists(projectId, name)) throw new Error("Model name must be unique within the project");

    const images = importEntryImages(entry);
    const timestamp = nowIso();
    const modelId = newId("model");
    const code = nextCode(projectId, project.name);
    const writtenAssets = [];

    try {
      return runDbTransaction(db, () => {
        db.prepare("INSERT INTO model_entries (id, project_id, name, code, gender, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(modelId, projectId, name, code, gender, timestamp, timestamp);
        db.prepare("UPDATE model_projects SET updated_at = ? WHERE id = ?").run(timestamp, projectId);

        const modelName = folderName(name, "model name");
        const relDir = path.relative(storageRoot, modelDirForNames(project.name, name));
        const imageIds = [];
        images.forEach((image, index) => {
          const decoded = parseDataUrl(image?.data ? `data:${image.mime_type || "image/png"};base64,${image.data}` : "");
          if (!decoded) throw new Error("Invalid image data");
          const sortOrder = Number.isFinite(Number(image.sort_order)) ? Number(image.sort_order) : index;
          const asset = writeAsset(decoded.buffer, decoded.mimeType, image.filename || "image", {
            source: "model-library",
            subdir: relDir,
            filenameStem: `${modelName}_${String(index + 1).padStart(3, "0")}`,
          });
          writtenAssets.push(asset);
          const imageId = newId("image");
          db.prepare("INSERT INTO model_images (id, model_id, asset_id, caption, sort_order, created_at, mime_type, filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .run(imageId, modelId, asset.id, String(image.caption || ""), sortOrder, timestamp, asset.mime_type, asset.filename);
          imageIds.push(imageId);
        });

        if (imageIds.length) {
          const coverIndex = Math.max(0, Math.min(Number(entry.cover_index || 0), imageIds.length - 1));
          db.prepare("UPDATE model_entries SET cover_image_id = ?, updated_at = ? WHERE id = ?").run(imageIds[coverIndex], timestamp, modelId);
        }
        if (tagNames.length) updateEntryTags(modelId, projectId, tagNames);

        return modelWithCoverAndTags(loadModel(modelId));
      });
    } catch (error) {
      for (const asset of writtenAssets) {
        if (asset?.path) {
          try {
            unlinkSync(assetAbsolutePath(asset.path));
          } catch {}
        }
      }
      throw error;
    }
  }

  function importEntries(projectId, payload = {}) {
    if (!loadProject(projectId)) return null;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (!entries.length) throw new Error("No rows selected for import");
    const imported = [];
    const failed = [];
    const rows = [];
    for (const entry of entries) {
      const images = importEntryImages(entry);
      const rowBase = {
        id: String(entry.id || newId("model-import-entry")),
        stem: String(entry.stem || entry.name || ""),
        filename: String(entry.filename || images[0]?.filename || entry.name || "image"),
        relative_path: String(entry.relative_path || entry.filename || images[0]?.relative_path || images[0]?.filename || entry.name || ""),
        proposed_name: String(entry.name || ""),
        gender: sanitizeGender(entry.gender),
        thumbnail_url: String(entry.thumbnail_url || ""),
        selectable: true,
        selected: true,
        status: "ready",
        errors: [],
        warnings: Array.isArray(entry.warnings) ? entry.warnings : [],
      };
      try {
        const name = entry.name ? validateFileNamePart(entry.name, "model name") : "";
        if (name && modelNameExists(projectId, name)) throw new Error("Model name must be unique within the project");
        const tagNames = Array.isArray(entry.tags) && entry.tags.length
          ? existingProjectTagNames(projectId, entry.tags)
          : [];
        const model = createModelFromImportEntry(projectId, { ...entry, ...(name ? { name } : {}) }, tagNames);
        imported.push(model);
        rows.push({ ...rowBase, model_id: model.id, final_status: rowBase.warnings.length ? "warning" : "imported" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedRow = { ...rowBase, final_status: "failed", errors: [{ code: "import_failed", message }] };
        failed.push(failedRow);
        rows.push(failedRow);
      }
    }
    return {
      imported_count: imported.length,
      failed_count: failed.length,
      imported,
      not_selected: [],
      failed,
      rows,
    };
  }

  function updateModel(modelId, payload = {}) {
    const model = loadModel(modelId);
    if (!model) return null;
    return runDbTransaction(db, () => {
      if (payload.name !== undefined) {
        const nextName = validateFileNamePart(payload.name || labels.defaultModel, "model name");
        if (modelNameExists(model.project_id, nextName, modelId)) throw new Error("Model name must be unique within the project");
        if (nextName !== model.name) {
          renameModelFolderAndImages(model, nextName);
          db.prepare("UPDATE model_entries SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), modelId);
        }
      }
      if (payload.tags !== undefined) updateEntryTags(modelId, model.project_id, payload.tags);
      if (payload.cover_image_id !== undefined) {
        const coverImageId = payload.cover_image_id ? String(payload.cover_image_id) : null;
        if (coverImageId) {
          const image = db.prepare("SELECT id FROM model_images WHERE id = ? AND model_id = ?").get(coverImageId, modelId);
          if (!image) throw new Error("Model image not found");
        }
        db.prepare("UPDATE model_entries SET cover_image_id = ?, updated_at = ? WHERE id = ?").run(coverImageId, nowIso(), modelId);
      }
      return modelWithCoverAndTags(loadModel(modelId));
    });
  }

  function deleteModel(modelId) {
    const model = loadModel(modelId);
    if (!model) return null;
    const project = loadProject(model.project_id);
    const modelDir = project ? modelDirForNames(project.name, model.name) : "";
    runDbTransaction(db, () => deleteModelInsideTransaction(model));
    if (modelDir) removeDirectoryInsideLibrary(modelDir);
    return { ok: true };
  }

  function deleteModelInsideTransaction(model) {
    const imageRows = db.prepare("SELECT asset_id FROM model_images WHERE model_id = ?").all(model.id);
    db.prepare("DELETE FROM library_entry_tags WHERE kind = 'model' AND entry_id = ?").run(model.id);
    db.prepare("DELETE FROM model_entries WHERE id = ?").run(model.id);
    for (const row of imageRows) removeAssetIfUnused(row.asset_id);
  }

  function loadBulkModels(projectId, entryIds) {
    if (!loadProject(projectId)) return null;
    const ids = normalizeBulkEntryIds(entryIds);
    const models = ids.map((id) => loadModel(id));
    const missingIndex = models.findIndex((model) => !model);
    if (missingIndex >= 0) throw new Error(`Model not found: ${ids[missingIndex]}`);
    const wrongProject = models.find((model) => model.project_id !== projectId);
    if (wrongProject) throw new Error("Selected models must belong to the current project");
    return { ids, models };
  }

  function bulkEntries(payload = {}) {
    const projectId = String(payload.project_id || "").trim();
    if (!projectId) throw new Error("project_id is required");
    const operation = String(payload.operation || "").trim();
    const loaded = loadBulkModels(projectId, payload.entry_ids || []);
    if (!loaded) return null;
    const timestamp = nowIso();
    if (operation === "add_tags" || operation === "remove_tags") {
      const tagNames = existingProjectTagNames(projectId, payload.tags || []);
      return runDbTransaction(db, () => {
        for (const model of loaded.models) {
          const current = tagsForModel(model.id);
          const nextTags = operation === "add_tags"
            ? normalizeTags([...current, ...tagNames])
            : current.filter((name) => !tagNames.includes(name));
          updateEntryTags(model.id, projectId, nextTags);
          db.prepare("UPDATE model_entries SET updated_at = ? WHERE id = ?").run(timestamp, model.id);
        }
        return {
          ok: true,
          kind: "model",
          operation,
          project_id: projectId,
          requested: loaded.ids.length,
          updated: loaded.ids.length,
          deleted: 0,
          skipped: [],
          tags: listTags(projectId).filter((tag) => tagNames.includes(tag.name)),
        };
      });
    }
    if (operation === "delete") {
      const directories = loaded.models.map((model) => {
        const project = loadProject(model.project_id);
        return project ? modelDirForNames(project.name, model.name) : "";
      }).filter(Boolean);
      runDbTransaction(db, () => {
        for (const model of loaded.models) deleteModelInsideTransaction(model);
      });
      for (const directory of directories) removeDirectoryInsideLibrary(directory);
      return {
        ok: true,
        kind: "model",
        operation,
        project_id: projectId,
        requested: loaded.ids.length,
        updated: 0,
        deleted: loaded.ids.length,
        skipped: [],
      };
    }
    throw new Error("Unsupported bulk operation");
  }

  function listImages(modelId) {
    const model = loadModel(modelId);
    if (!model) return null;
    const images = db.prepare(
      `
      SELECT mi.*, a.path AS asset_path
      FROM model_images mi
      LEFT JOIN assets a ON a.id = mi.asset_id
      WHERE mi.model_id = ?
      ORDER BY mi.sort_order ASC, mi.created_at ASC
      `
    ).all(modelId).map((image) => ({ ...image, asset_url: image.asset_id ? assetUrl(image.asset_id) : null }));
    return { images };
  }

  function addImage(modelId, payload = {}) {
    const model = loadModel(modelId);
    if (!model) return null;
    const asset = loadAsset(payload.asset_id);
    if (!asset) throw new Error("Asset not found");
    const timestamp = nowIso();
    const imageId = newId("image");
    const sortOrder = Number(payload.sort_order || 0);
    return runDbTransaction(db, () => {
      db.prepare("INSERT INTO model_images (id, model_id, asset_id, caption, sort_order, created_at, mime_type, filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(imageId, modelId, asset.id, String(payload.caption || ""), sortOrder, timestamp, asset.mime_type, asset.filename);
      return {
        id: imageId,
        model_id: modelId,
        asset_id: asset.id,
        asset_url: assetUrl(asset.id),
        caption: String(payload.caption || ""),
        sort_order: sortOrder,
        created_at: timestamp,
        mime_type: asset.mime_type,
        filename: asset.filename,
      };
    });
  }

  function uploadImage(modelId, payload = {}) {
    const model = loadModel(modelId);
    if (!model) return null;
    const decoded = parseDataUrl(payload.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
    if (!decoded) throw new Error("Invalid upload data");
    const project = loadProject(model.project_id);
    if (!project) throw new Error("Model project not found");
    const modelName = folderName(model.name, "model name");
    const relDir = path.relative(storageRoot, modelDirForNames(project.name, model.name));
    const sortOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM model_images WHERE model_id = ?").get(modelId)?.next || 0;
    const timestamp = nowIso();
    const imageId = newId("image");
    return writeAssetInTransaction(decoded.buffer, decoded.mimeType, payload.filename || "image", {
      source: "model-library",
      subdir: relDir,
      filenameStem: `${modelName}_${String(Number(sortOrder) + 1).padStart(3, "0")}`,
    }, (asset) => {
      db.prepare("INSERT INTO model_images (id, model_id, asset_id, caption, sort_order, created_at, mime_type, filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(imageId, modelId, asset.id, "", Number(sortOrder), timestamp, asset.mime_type, asset.filename);
      db.prepare("UPDATE model_entries SET updated_at = ? WHERE id = ?").run(timestamp, modelId);
      return {
        image: {
          id: imageId,
          model_id: modelId,
          asset_id: asset.id,
          asset_url: assetUrl(asset.id),
          caption: "",
          sort_order: Number(sortOrder),
          created_at: timestamp,
          mime_type: asset.mime_type,
          filename: asset.filename,
        },
        asset: { id: asset.id },
      };
    });
  }

  function deleteImage(imageId) {
    const image = db.prepare("SELECT * FROM model_images WHERE id = ?").get(imageId);
    if (!image) return null;
    runDbTransaction(db, () => {
      db.prepare("UPDATE model_entries SET cover_image_id = NULL WHERE cover_image_id = ?").run(imageId);
      db.prepare("DELETE FROM model_images WHERE id = ?").run(imageId);
      removeAssetIfUnused(image.asset_id);
    });
    return { ok: true };
  }

  function createTag(projectId, payload = {}) {
    if (!loadProject(projectId)) return null;
    const name = String(payload.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
    if (!name) throw new Error("Tag name is required");
    return runDbTransaction(db, () => createProjectTag(projectId, name));
  }

  function updateTag(projectId, tagId, payload = {}) {
    if (!loadProject(projectId)) return null;
    return runDbTransaction(db, () => {
      const tag = db.prepare("SELECT * FROM library_tags WHERE id = ? AND kind = 'model' AND project_id = ?").get(tagId, projectId);
      if (!tag) return null;
      if (payload.name !== undefined) {
        const nextName = String(payload.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
        if (!nextName) throw new Error("Tag name is required");
        const exists = db.prepare("SELECT id FROM library_tags WHERE kind = 'model' AND project_id = ? AND name = ? AND id <> ?").get(projectId, nextName, tagId);
        if (exists) throw new Error("Tag already exists");
        db.prepare("UPDATE library_tags SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), tagId);
      }
      if (payload.sort_order !== undefined) {
        db.prepare("UPDATE library_tags SET sort_order = ?, updated_at = ? WHERE id = ?").run(Number(payload.sort_order || 0), nowIso(), tagId);
      }
      const next = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(tagId);
      return { ...next, usage_count: tagUsage(tagId) };
    });
  }

  function deleteTag(projectId, tagId) {
    if (!loadProject(projectId)) return null;
    const tag = db.prepare("SELECT * FROM library_tags WHERE id = ? AND kind = 'model' AND project_id = ?").get(tagId, projectId);
    if (!tag) return { ok: true };
    runDbTransaction(db, () => {
      db.prepare("DELETE FROM library_entry_tags WHERE tag_id = ?").run(tagId);
      db.prepare("DELETE FROM library_tags WHERE id = ?").run(tagId);
    });
    return { ok: true };
  }

  function readAsset(assetId) {
    const asset = loadAsset(assetId);
    if (!asset) return null;
    return {
      asset,
      data: readFileSync(assetAbsolutePath(asset.path)),
    };
  }

  return {
    listProjects,
    createProject,
    updateProject,
    deleteProject,
    uploadProjectCover,
    listModels,
    createModel,
    importEntries,
    updateModel,
    deleteModel,
    bulkEntries,
    listImages,
    addImage,
    uploadImage,
    deleteImage,
    projectExists,
    listTags,
    createTag,
    updateTag,
    deleteTag,
    readAsset,
  };
}
