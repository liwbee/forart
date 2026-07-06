import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  newId,
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

export function createOutfitLibraryService(runtime, options = {}) {
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

  function outfitLibraryRoot() {
    return path.join(storageRoot, labels.outfitLibrary);
  }

  function removeDirectoryInsideLibrary(directory) {
    const libraryRoot = outfitLibraryRoot();
    const target = path.resolve(directory);
    if (!isPathInside(libraryRoot, target)) throw new Error("Refusing to delete a folder outside the outfit library");
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }

  function projectDirForName(projectName) {
    return path.join(outfitLibraryRoot(), folderName(projectName, "project name"));
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
    return db.prepare("SELECT * FROM outfit_projects WHERE id = ?").get(projectId) || null;
  }

  function loadOutfit(outfitId) {
    return db.prepare("SELECT * FROM outfit_entries WHERE id = ?").get(outfitId) || null;
  }

  function projectExists(projectId) {
    return Boolean(loadProject(projectId));
  }

  function loadAsset(assetId) {
    return db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) || null;
  }

  function projectNameExists(name, exceptProjectId = "") {
    return Boolean(db.prepare("SELECT id FROM outfit_projects WHERE name = ? AND id <> ?").get(name, exceptProjectId));
  }

  function outfitNameExists(projectId, name, exceptOutfitId = "") {
    return Boolean(db.prepare("SELECT id FROM outfit_entries WHERE project_id = ? AND name = ? AND id <> ?").get(projectId, name, exceptOutfitId));
  }

  function tagUsage(tagId) {
    return db.prepare("SELECT COUNT(*) AS total FROM library_entry_tags WHERE tag_id = ?").get(tagId)?.total || 0;
  }

  function tagsForOutfit(outfitId) {
    return db.prepare(
      `
      SELECT t.name
      FROM library_entry_tags et
      JOIN library_tags t ON t.id = et.tag_id
      WHERE et.kind = 'outfit' AND et.entry_id = ?
      ORDER BY t.sort_order ASC, et.created_at ASC
      `
    ).all(outfitId).map((row) => row.name);
  }

  function outfitWithAssetAndTags(outfit) {
    return {
      ...outfit,
      tags: tagsForOutfit(outfit.id),
      asset_url: assetUrl(outfit.asset_id || null),
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
      WHERE kind = 'outfit' AND project_id = ?
      ORDER BY sort_order ASC, name ASC
      `
    ).all(projectId).map((tag) => ({ ...tag, usage_count: tagUsage(tag.id) }));
  }

  function createProjectTag(projectId, name) {
    const existing = db.prepare("SELECT * FROM library_tags WHERE kind = 'outfit' AND project_id = ? AND name = ?").get(projectId, name);
    if (existing) return { ...existing, usage_count: tagUsage(existing.id) };
    const timestamp = nowIso();
    const id = newId("tag");
    const sortOrder = db.prepare("SELECT COUNT(*) AS total FROM library_tags WHERE kind = 'outfit' AND project_id = ?").get(projectId)?.total || 0;
    db.prepare("INSERT INTO library_tags (id, kind, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, "outfit", projectId, name, sortOrder + 1, timestamp, timestamp);
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
    db.prepare("DELETE FROM library_entry_tags WHERE kind = 'outfit' AND entry_id = ?").run(entryId);
    for (const name of nextTags) {
      const tag = ensureProjectTag(projectId, name);
      if (!tag) continue;
      db.prepare("INSERT OR IGNORE INTO library_entry_tags (id, kind, entry_id, tag_id, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(newId("entrytag"), "outfit", entryId, tag.id, nowIso());
    }
  }

  function existingProjectTagNames(projectId, names) {
    const nextTags = normalizeTags(names);
    if (!nextTags.length) throw new Error("At least one tag is required");
    const missing = nextTags.filter((name) => !db.prepare("SELECT id FROM library_tags WHERE kind = 'outfit' AND project_id = ? AND name = ?").get(projectId, name));
    if (missing.length) throw new Error(`Tag not found: ${missing[0]}`);
    return nextTags;
  }

  function resolveTagNames(projectId, tagIds) {
    const uniqueTagIds = Array.from(new Set((tagIds || []).map((tagId) => String(tagId || "").trim()).filter(Boolean)));
    if (!uniqueTagIds.length) return [];
    return uniqueTagIds
      .map((tagId) => db.prepare("SELECT name FROM library_tags WHERE kind = 'outfit' AND project_id = ? AND id = ?").get(projectId, tagId)?.name)
      .filter(Boolean);
  }

  function entryMatchesTagFilter(entry, includeTagNames, excludeTagNames) {
    return includeTagNames.every((tagName) => entry.tags.includes(tagName))
      && excludeTagNames.every((tagName) => !entry.tags.includes(tagName));
  }

  function deleteProjectTags(projectId) {
    const tags = db.prepare("SELECT id FROM library_tags WHERE kind = 'outfit' AND project_id = ?").all(projectId);
    for (const tag of tags) db.prepare("DELETE FROM library_entry_tags WHERE tag_id = ?").run(tag.id);
    db.prepare("DELETE FROM library_tags WHERE kind = 'outfit' AND project_id = ?").run(projectId);
  }

  function nextOutfitNameForIndex(projectName, index) {
    return `${folderName(projectName, "project name")}_${String(index).padStart(3, "0")}`;
  }

  function nextOutfitName(projectId, projectName) {
    const prefix = `${folderName(projectName, "project name")}_`;
    const rows = db.prepare("SELECT name FROM outfit_entries WHERE project_id = ?").all(projectId);
    const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
    let max = 0;
    for (const row of rows) {
      const match = pattern.exec(String(row.name || ""));
      if (match) max = Math.max(max, Number.parseInt(match[1], 10) || 0);
    }
    return `${prefix}${String(max + 1).padStart(3, "0")}`;
  }

  function renameProjectFolder(project, nextName) {
    const oldDir = projectDirForName(project.name);
    const nextDir = projectDirForName(nextName);
    renameDirectoryIfNeeded(oldDir, nextDir);
    const outfits = db.prepare(
      `
      SELECT oe.*, a.path AS asset_path, a.filename AS asset_filename, a.mime_type AS asset_mime_type
      FROM outfit_entries oe
      LEFT JOIN assets a ON a.id = oe.asset_id
      WHERE oe.project_id = ?
      ORDER BY oe.created_at ASC
      `
    ).all(project.id);
    outfits.forEach((outfit, index) => {
      const nextOutfitName = nextOutfitNameForIndex(nextName, index + 1);
      const assetPath = assetAbsolutePath(outfit.asset_path || "");
      const suffix = path.extname(assetPath || outfit.asset_filename || "") || guessSuffix(outfit.asset_filename || "", outfit.asset_mime_type || "");
      const nextPath = path.join(nextDir, `${nextOutfitName}${suffix}`);
      const currentPath = assetPath && existsSync(assetPath) ? assetPath : replacePathPrefix(assetPath || "", oldDir, nextDir);
      ensureDir(nextDir);
      if (currentPath && existsSync(currentPath) && path.resolve(currentPath) !== path.resolve(nextPath)) {
        if (existsSync(nextPath)) throw new Error(`Image file already exists: ${path.basename(nextPath)}`);
        renameSync(currentPath, nextPath);
      }
      db.prepare("UPDATE assets SET filename = ?, path = ? WHERE id = ?").run(path.basename(nextPath), assetRelativePath(nextPath), outfit.asset_id);
      db.prepare("UPDATE outfit_entries SET name = ?, updated_at = ? WHERE id = ?").run(nextOutfitName, nowIso(), outfit.id);
    });
    const coverAssetRows = db.prepare("SELECT cover_asset_id AS asset_id FROM outfit_projects WHERE id = ?").all(project.id);
    for (const row of coverAssetRows) {
      const asset = row.asset_id ? loadAsset(row.asset_id) : null;
      if (asset?.path) {
        db.prepare("UPDATE assets SET path = ? WHERE id = ?").run(assetRelativePath(replacePathPrefix(asset.path, oldDir, nextDir)), asset.id);
      }
    }
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
    const row = db.prepare("SELECT id FROM outfit_projects ORDER BY created_at ASC LIMIT 1").get();
    if (row) return;
    const timestamp = nowIso();
    const name = validateFileNamePart(labels.defaultOutfitProject, "project name");
    db.prepare("INSERT INTO outfit_projects (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(newId("outfit_project"), name, 0, timestamp, timestamp);
  }

  function listProjects() {
    return { projects: db.prepare("SELECT * FROM outfit_projects ORDER BY sort_order ASC, created_at DESC").all().map(projectWithCover) };
  }

  function createProject(payload = {}) {
    const timestamp = nowIso();
    const id = newId("outfit_project");
    const name = validateFileNamePart(payload.name || labels.defaultOutfitProject, "project name");
    if (projectNameExists(name)) throw new Error("Project name must be unique");
    const sortOrder = db.prepare("SELECT COALESCE(MIN(sort_order), 0) - 1 AS next FROM outfit_projects").get()?.next || 0;
    db.prepare("INSERT INTO outfit_projects (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, name, sortOrder, timestamp, timestamp);
    return projectWithCover(loadProject(id));
  }

  function updateProject(projectId, payload = {}) {
    const project = loadProject(projectId);
    if (!project) return null;
    return runDbTransaction(db, () => {
      if (payload.name !== undefined) {
        const nextName = validateFileNamePart(payload.name || labels.defaultOutfitProject, "project name");
        if (projectNameExists(nextName, projectId)) throw new Error("Project name must be unique");
        if (nextName !== project.name) {
          renameProjectFolder(project, nextName);
          db.prepare("UPDATE outfit_projects SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), projectId);
        }
      }
      if (payload.cover_asset_id !== undefined) {
        const coverAssetId = payload.cover_asset_id ? String(payload.cover_asset_id) : null;
        if (coverAssetId && !loadAsset(coverAssetId)) throw new Error("Asset not found");
        db.prepare("UPDATE outfit_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(coverAssetId, nowIso(), projectId);
      }
      if (payload.sort_order !== undefined) {
        db.prepare("UPDATE outfit_projects SET sort_order = ?, updated_at = ? WHERE id = ?").run(Number(payload.sort_order || 0), nowIso(), projectId);
      }
      return projectWithCover(loadProject(projectId));
    });
  }

  function deleteProject(projectId) {
    const project = loadProject(projectId);
    if (!project) return null;
    const projectDir = projectDirForName(project.name);
    const assetRows = db.prepare("SELECT asset_id FROM outfit_entries WHERE project_id = ?").all(projectId);
    const coverAssetRows = db.prepare("SELECT cover_asset_id AS asset_id FROM outfit_projects WHERE id = ?").all(projectId);
    runDbTransaction(db, () => {
      deleteProjectTags(projectId);
      db.prepare("DELETE FROM outfit_projects WHERE id = ?").run(projectId);
      for (const row of assetRows) removeAssetIfUnused(row.asset_id);
      for (const row of coverAssetRows) removeAssetIfUnused(row.asset_id);
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
      source: "outfit-project-cover",
      subdir: relDir,
      filenameStem: "cover",
    }, (asset) => {
      db.prepare("UPDATE outfit_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, nowIso(), projectId);
      return projectWithCover(loadProject(projectId));
    });
  }

  function listOutfits(projectId, query = {}) {
    const project = loadProject(projectId);
    if (!project) return null;
    const includeTagNames = resolveTagNames(projectId, query.tag_id || []);
    const excludeTagNames = resolveTagNames(projectId, query.exclude_tag_id || []);
    const untaggedOnly = query.untagged === "1" || query.untagged === "true";
    const outfits = db.prepare("SELECT * FROM outfit_entries WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC").all(projectId)
      .map(outfitWithAssetAndTags);
    const filtered = untaggedOnly
      ? outfits.filter((outfit) => !outfit.tags.length)
      : includeTagNames.length || excludeTagNames.length
      ? outfits.filter((outfit) => entryMatchesTagFilter(outfit, includeTagNames, excludeTagNames))
      : outfits;
    return { outfits: filtered };
  }

  function createOutfitFromFile(projectId, payload = {}) {
    const project = loadProject(projectId);
    if (!project) return null;
    const content = Buffer.isBuffer(payload.buffer) ? payload.buffer : Buffer.from(payload.buffer || "");
    if (!content.length) throw new Error("Invalid image data");
    const timestamp = nowIso();
    const id = newId("outfit");
    const name = payload.name
      ? validateFileNamePart(payload.name, "outfit name")
      : nextOutfitName(projectId, project.name);
    if (outfitNameExists(projectId, name)) throw new Error("Outfit name must be unique");
    const relDir = path.relative(storageRoot, projectDirForName(project.name));
    return writeAssetInTransaction(content, String(payload.mime_type || "image/png"), payload.filename || "image", {
      source: "outfit-library",
      subdir: relDir,
      filenameStem: name,
    }, (asset) => {
      db.prepare("INSERT INTO outfit_entries (id, project_id, name, asset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, projectId, name, asset.id, timestamp, timestamp);
      db.prepare("UPDATE outfit_projects SET cover_asset_id = COALESCE(cover_asset_id, ?), updated_at = ? WHERE id = ?").run(asset.id, timestamp, projectId);
      return outfitWithAssetAndTags(loadOutfit(id));
    });
  }

  function importEntries(projectId, payload = {}) {
    if (!loadProject(projectId)) return null;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (!entries.length) throw new Error("No rows selected for import");
    const imported = [];
    const failed = [];
    const rows = [];
    for (const entry of entries) {
      const rowBase = {
        id: String(entry.id || newId("outfit-import-entry")),
        stem: String(entry.stem || entry.name || ""),
        filename: String(entry.filename || entry.name || "image"),
        relative_path: String(entry.relative_path || entry.filename || entry.name || ""),
        image_path: null,
        text_path: null,
        proposed_name: String(entry.name || ""),
        thumbnail_url: String(entry.thumbnail_url || ""),
        selectable: true,
        selected: true,
        status: "ready",
        errors: [],
        warnings: Array.isArray(entry.warnings) ? entry.warnings : [],
      };
      try {
        const name = entry.name ? validateFileNamePart(entry.name, "outfit name") : "";
        if (name && outfitNameExists(projectId, name)) throw new Error("Outfit name must be unique");
        const tagNames = Array.isArray(entry.tags) && entry.tags.length
          ? existingProjectTagNames(projectId, entry.tags)
          : [];
        const imageData = String(entry.data || "");
        if (!imageData) throw new Error("Invalid image data");
        const outfit = createOutfitFromFile(projectId, {
          ...(name ? { name } : {}),
          filename: entry.filename || "image",
          mime_type: entry.mime_type || "image/png",
          buffer: Buffer.from(imageData, "base64"),
        });
        if (tagNames.length) updateOutfit(outfit.id, { tags: tagNames });
        const importedOutfit = tagNames.length ? outfitWithAssetAndTags(loadOutfit(outfit.id)) : outfit;
        imported.push(importedOutfit);
        rows.push({ ...rowBase, outfit_id: outfit.id, final_status: rowBase.warnings.length ? "warning" : "imported" });
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

  function updateOutfit(outfitId, payload = {}) {
    const outfit = loadOutfit(outfitId);
    if (!outfit) return null;
    return runDbTransaction(db, () => {
      if (payload.name !== undefined) {
        const nextName = validateFileNamePart(payload.name || labels.defaultOutfit, "outfit name");
        if (outfitNameExists(outfit.project_id, nextName, outfitId)) throw new Error("Outfit name must be unique");
        if (nextName !== outfit.name) {
          const project = loadProject(outfit.project_id);
          if (!project) throw new Error("Outfit project not found");
          const asset = outfit.asset_id ? loadAsset(outfit.asset_id) : null;
          if (asset?.path) {
            const currentPath = assetAbsolutePath(asset.path);
            const targetDir = projectDirForName(project.name);
            const suffix = path.extname(currentPath || asset.filename || "") || guessSuffix(asset.filename || "", asset.mime_type || "");
            const nextPath = path.join(targetDir, `${folderName(nextName, "outfit name")}${suffix}`);
            if (path.resolve(currentPath) !== path.resolve(nextPath)) {
              ensureDir(targetDir);
              if (existsSync(currentPath)) {
                if (existsSync(nextPath)) throw new Error(`Image file already exists: ${path.basename(nextPath)}`);
                renameSync(currentPath, nextPath);
              }
              db.prepare("UPDATE assets SET filename = ?, path = ? WHERE id = ?").run(path.basename(nextPath), assetRelativePath(nextPath), asset.id);
            }
          }
          db.prepare("UPDATE outfit_entries SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), outfitId);
        }
      }
      if (payload.tags !== undefined) {
        updateEntryTags(outfitId, outfit.project_id, payload.tags);
        db.prepare("UPDATE outfit_entries SET updated_at = ? WHERE id = ?").run(nowIso(), outfitId);
      }
      return outfitWithAssetAndTags(loadOutfit(outfitId));
    });
  }

  function deleteOutfit(outfitId) {
    const outfit = loadOutfit(outfitId);
    if (!outfit) return null;
    runDbTransaction(db, () => deleteOutfitInsideTransaction(outfit));
    return { ok: true };
  }

  function deleteOutfitInsideTransaction(outfit) {
    db.prepare("DELETE FROM library_entry_tags WHERE kind = 'outfit' AND entry_id = ?").run(outfit.id);
    db.prepare("UPDATE outfit_projects SET cover_asset_id = NULL WHERE cover_asset_id = ?").run(outfit.asset_id);
    db.prepare("DELETE FROM outfit_entries WHERE id = ?").run(outfit.id);
    removeAssetIfUnused(outfit.asset_id);
  }

  function loadBulkOutfits(projectId, entryIds) {
    if (!loadProject(projectId)) return null;
    const ids = normalizeBulkEntryIds(entryIds);
    const outfits = ids.map((id) => loadOutfit(id));
    const missingIndex = outfits.findIndex((outfit) => !outfit);
    if (missingIndex >= 0) throw new Error(`Outfit not found: ${ids[missingIndex]}`);
    const wrongProject = outfits.find((outfit) => outfit.project_id !== projectId);
    if (wrongProject) throw new Error("Selected outfits must belong to the current project");
    return { ids, outfits };
  }

  function bulkEntries(payload = {}) {
    const projectId = String(payload.project_id || "").trim();
    if (!projectId) throw new Error("project_id is required");
    const operation = String(payload.operation || "").trim();
    const loaded = loadBulkOutfits(projectId, payload.entry_ids || []);
    if (!loaded) return null;
    const timestamp = nowIso();
    if (operation === "add_tags" || operation === "remove_tags") {
      const tagNames = existingProjectTagNames(projectId, payload.tags || []);
      return runDbTransaction(db, () => {
        for (const outfit of loaded.outfits) {
          const current = tagsForOutfit(outfit.id);
          const nextTags = operation === "add_tags"
            ? normalizeTags([...current, ...tagNames])
            : current.filter((name) => !tagNames.includes(name));
          updateEntryTags(outfit.id, projectId, nextTags);
          db.prepare("UPDATE outfit_entries SET updated_at = ? WHERE id = ?").run(timestamp, outfit.id);
        }
        return {
          ok: true,
          kind: "outfit",
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
      runDbTransaction(db, () => {
        for (const outfit of loaded.outfits) deleteOutfitInsideTransaction(outfit);
      });
      return {
        ok: true,
        kind: "outfit",
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

  function replaceOutfitImage(outfitId, payload = {}) {
    const outfit = loadOutfit(outfitId);
    if (!outfit) return null;
    const project = loadProject(outfit.project_id);
    if (!project) throw new Error("Outfit project not found");
    const decoded = parseDataUrl(payload.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
    if (!decoded) throw new Error("Invalid upload data");
    const previousAssetId = outfit.asset_id;
    const relDir = path.relative(storageRoot, projectDirForName(project.name));
    const timestamp = nowIso();
    return writeAssetInTransaction(decoded.buffer, decoded.mimeType, payload.filename || "image", {
      source: "outfit-library",
      subdir: relDir,
      filenameStem: outfit.name || labels.defaultOutfit,
    }, (asset) => {
      db.prepare("UPDATE outfit_entries SET asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, timestamp, outfitId);
      db.prepare("UPDATE outfit_projects SET cover_asset_id = CASE WHEN cover_asset_id = ? THEN ? ELSE cover_asset_id END, updated_at = ? WHERE id = ?")
        .run(previousAssetId, asset.id, timestamp, project.id);
      removeAssetIfUnused(previousAssetId);
      return outfitWithAssetAndTags(loadOutfit(outfitId));
    });
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
      const tag = db.prepare("SELECT * FROM library_tags WHERE id = ? AND kind = 'outfit' AND project_id = ?").get(tagId, projectId);
      if (!tag) return null;
      if (payload.name !== undefined) {
        const nextName = String(payload.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
        if (!nextName) throw new Error("Tag name is required");
        const exists = db.prepare("SELECT id FROM library_tags WHERE kind = 'outfit' AND project_id = ? AND name = ? AND id <> ?").get(projectId, nextName, tagId);
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
    const tag = db.prepare("SELECT * FROM library_tags WHERE id = ? AND kind = 'outfit' AND project_id = ?").get(tagId, projectId);
    if (!tag) return { ok: true };
    runDbTransaction(db, () => {
      db.prepare("DELETE FROM library_entry_tags WHERE tag_id = ?").run(tagId);
      db.prepare("DELETE FROM library_tags WHERE id = ?").run(tagId);
    });
    return { ok: true };
  }

  return {
    listProjects,
    createProject,
    updateProject,
    deleteProject,
    uploadProjectCover,
    listOutfits,
    createOutfitFromFile,
    importEntries,
    updateOutfit,
    deleteOutfit,
    bulkEntries,
    replaceOutfitImage,
    projectExists,
    listTags,
    createTag,
    updateTag,
    deleteTag,
  };
}
