import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { validateFileNamePart } from "./library-runtime.mjs";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const PROMPT_LIMIT = 4000;

function rowIdFor(kind, value) {
  return crypto.createHash("sha1").update(`${kind}:${value}`).digest("hex").slice(0, 24);
}

function normalizeStem(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isSupportedImage(filePath) {
  return SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function mimeTypeForImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function compareByName(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function decodeTextBuffer(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    try {
      return new TextDecoder("gb18030").decode(buffer).replace(/^\uFEFF/, "");
    } catch {
      return buffer.toString("utf8").replace(/^\uFEFF/, "");
    }
  }
}

function readPromptFile(filePath) {
  const text = decodeTextBuffer(readFileSync(filePath));
  if (text.length <= PROMPT_LIMIT) {
    return { prompt: text, truncated: false, originalLength: text.length };
  }
  return {
    prompt: text.slice(0, PROMPT_LIMIT),
    truncated: true,
    originalLength: text.length,
  };
}

function isDirectory(filePath) {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function scanFolder(sourcePath) {
  const sourceRoot = path.resolve(String(sourcePath || "").trim());
  if (!sourceRoot || !existsSync(sourceRoot) || !isDirectory(sourceRoot)) {
    throw new Error("Import folder does not exist or is not a folder");
  }

  const imageByStem = new Map();
  const textByStem = new Map();
  const entries = readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort(compareByName);

  for (const fileName of entries) {
    const absolutePath = path.join(sourceRoot, fileName);
    const ext = path.extname(fileName).toLowerCase();
    if (SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
      const stem = path.basename(fileName, path.extname(fileName));
      const list = imageByStem.get(stem) || [];
      list.push({ fileName, path: absolutePath });
      imageByStem.set(stem, list);
    } else if (ext === ".txt") {
      const stem = path.basename(fileName, path.extname(fileName));
      textByStem.set(stem, { fileName, path: absolutePath });
    }
  }

  return { sourceRoot, imageByStem, textByStem };
}

function actionNameExists(db, projectId, name) {
  return Boolean(db.prepare("SELECT id FROM action_entries WHERE project_id = ? AND name = ?").get(projectId, name));
}

function projectExists(db, projectId) {
  return Boolean(db.prepare("SELECT id FROM action_projects WHERE id = ?").get(projectId));
}

function rowStatusFor(errors, warnings) {
  if (errors.some((error) => error.code === "missing_image")) return "missing_image";
  if (errors.some((error) => error.code === "missing_text")) return "missing_text";
  if (errors.some((error) => error.code === "duplicate_name")) return "duplicate_name";
  if (errors.some((error) => error.code === "ambiguous_image")) return "ambiguous_image";
  if (errors.some((error) => error.code === "invalid_name")) return "invalid_name";
  if (errors.length) return "unreadable";
  if (warnings.length) return "warning";
  return "ready";
}

function buildPreviewRows({ db, projectId, sourceRoot, imageByStem, textByStem }) {
  const stems = Array.from(new Set([...imageByStem.keys(), ...textByStem.keys()])).sort(compareByName);
  const rows = [];

  for (const stem of stems) {
    const images = imageByStem.get(stem) || [];
    const text = textByStem.get(stem) || null;
    const image = images.length === 1 ? images[0] : null;
    const proposedName = normalizeStem(stem);
    const errors = [];
    const warnings = [];

    if (!images.length) errors.push({ code: "missing_image", message: "Missing matching image file" });
    if (images.length > 1) errors.push({ code: "ambiguous_image", message: "Multiple image files share the same filename stem" });
    if (!text) errors.push({ code: "missing_text", message: "Missing matching .txt file" });

    if (proposedName) {
      try {
        validateFileNamePart(proposedName, "action name");
      } catch (error) {
        errors.push({ code: "invalid_name", message: error instanceof Error ? error.message : String(error) });
      }
      if (actionNameExists(db, projectId, proposedName)) {
        errors.push({ code: "duplicate_name", message: "Action name already exists in this project" });
      }
    } else {
      errors.push({ code: "invalid_name", message: "Action name is required" });
    }

    if (image?.path && !isRegularFile(image.path)) errors.push({ code: "unreadable_image", message: "Image file is unreadable" });

    if (text?.path) {
      try {
        const promptInfo = readPromptFile(text.path);
        if (promptInfo.truncated) {
          warnings.push({
            code: "prompt_truncated",
            message: `Prompt is ${promptInfo.originalLength} characters and will be truncated to ${PROMPT_LIMIT}`,
          });
        }
      } catch (error) {
        errors.push({ code: "unreadable_text", message: error instanceof Error ? error.message : String(error) });
      }
    }

    const rowIdSeed = image?.path || text?.path || stem;
    const row = {
      id: rowIdFor("action-import-row", path.relative(sourceRoot, rowIdSeed) || stem),
      stem,
      filename: image?.fileName || text?.fileName || stem,
      relative_path: image?.path
        ? path.relative(sourceRoot, image.path)
        : text?.path
          ? path.relative(sourceRoot, text.path)
          : stem,
      image_path: image?.path || null,
      text_path: text?.path || null,
      proposed_name: proposedName,
      selectable: true,
      selected: errors.length === 0,
      status: rowStatusFor(errors, warnings),
      errors,
      warnings,
    };
    rows.push(row);
  }

  return rows;
}

export function createActionFolderImportService(runtime, actionService) {
  const db = runtime.db;

  function previewActionFolderImport(projectId, payload = {}) {
    if (!projectExists(db, projectId)) return null;
    const { sourceRoot, imageByStem, textByStem } = scanFolder(payload.source_path);
    const rows = buildPreviewRows({ db, projectId, sourceRoot, imageByStem, textByStem });
    const readyRows = rows.filter((row) => !row.errors.length);
    return {
      preview_id: rowIdFor("action-import-preview", `${sourceRoot}:${Date.now()}:${Math.random()}`),
      source_path: sourceRoot,
      project_id: projectId,
      total_images: Array.from(imageByStem.values()).reduce((total, images) => total + images.length, 0),
      total_text_files: textByStem.size,
      ready_count: readyRows.length,
      selected_count: readyRows.length,
      blocking_error_count: rows.filter((row) => row.errors.length).length,
      warning_count: rows.filter((row) => row.warnings.length).length,
      rows,
    };
  }

  function importActionEntries(projectId, payload = {}) {
    if (!projectExists(db, projectId)) return null;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (!entries.length) throw new Error("No rows selected for import");

    const imported = [];
    const failed = [];
    const rows = [];

    for (const entry of entries) {
      const rowBase = {
        id: String(entry.id || rowIdFor("action-import-entry", `${entry.name || ""}:${entry.filename || ""}`)),
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
        const name = entry.name ? validateFileNamePart(entry.name, "action name") : "";
        if (name && actionNameExists(db, projectId, name)) throw new Error("Action name must be unique");
        const tagNames = Array.isArray(entry.tags) && entry.tags.length
          ? actionService.existingProjectTagNames(projectId, entry.tags)
          : [];
        const imageData = String(entry.data || "");
        if (!imageData) throw new Error("Invalid image data");
        const action = actionService.createActionFromFile(projectId, {
          ...(name ? { name } : {}),
          prompt: String(entry.prompt || "").slice(0, PROMPT_LIMIT),
          filename: entry.filename || "image",
          mime_type: entry.mime_type || "image/png",
          buffer: Buffer.from(imageData, "base64"),
          thumbnail_data_url: entry.thumbnail_data_url,
        });
        if (tagNames.length) actionService.updateAction(action.id, { tags: tagNames });
        const importedAction = tagNames.length ? actionService.loadActionEntry(action.id) || action : action;
        imported.push(importedAction);
        rows.push({ ...rowBase, action_id: action.id, final_status: rowBase.warnings.length ? "warning" : "imported" });
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

  return {
    previewActionFolderImport,
    importActionEntries,
  };
}

export function isActionFolderImportImage(filePath) {
  return isSupportedImage(filePath) && isRegularFile(filePath);
}
