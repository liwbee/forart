import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createAdminContext } from "./src/admin/admin-context.mjs";
import { createAdminRouter } from "./src/http/admin-router.mjs";
import { createCanvasExchangeContext } from "./src/canvas-exchange/canvas-exchange-context.mjs";
import { createCanvasExchangeRouter } from "./src/http/canvas-exchange-router.mjs";
import { createActionFolderImportService } from "./src/library/action-folder-import-service.mjs";
import { createActionLibraryService } from "./src/library/action-library-service.mjs";
import { createModelLibraryService } from "./src/library/model-library-service.mjs";
import { createOutfitLibraryService } from "./src/library/outfit-library-service.mjs";
import {
  deleteLibraryAssetThumbnail,
  ensureLibraryAssetThumbnail,
} from "./src/library/library-asset-thumbnails.mjs";
import { readSharpImageDimensions } from "./src/shared/image-thumbnail-sharp.mjs";
import { parseRequest } from "./src/shared/validation.mjs";
import {
  libraryAddModelImagePayloadSchema,
  libraryAssetUploadPayloadSchema,
  libraryBulkEntriesPayloadSchema,
  libraryCreateModelPayloadSchema,
  libraryCreateProjectPayloadSchema,
  libraryCreateTagPayloadSchema,
  libraryImportEntriesPayloadSchema,
  libraryTagProjectQuerySchema,
  libraryTagRouteParamsSchema,
  libraryUpdateActionPayloadSchema,
  libraryUpdateModelPayloadSchema,
  libraryUpdateOutfitPayloadSchema,
  libraryUpdateProjectPayloadSchema,
  libraryUpdateTagPayloadSchema,
} from "./src/library/library-route-schemas.mjs";

const SERVER_PORT = Number(process.env.PORT || 6980);
const SERVER_HOST = process.env.HOST || "0.0.0.0";
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = path.join(SERVER_DIR, "admin");
const DEFAULT_DATA_ROOT = path.join(ROOT_DIR, ".forart-data");
const DATABASE_DIR = path.resolve(process.env.FORART_DATABASE_DIR || path.join(DEFAULT_DATA_ROOT, "database"));
const LIBRARY_DIR = path.resolve(process.env.FORART_LIBRARY_DIR || path.join(DEFAULT_DATA_ROOT, "library"));
const CANVAS_STORAGE_ROOT = path.resolve(process.env.FORART_CANVAS_STORAGE_ROOT || process.env.FORART_LIBRARY_DIR || LIBRARY_DIR);
const DATABASE_FILENAME = "forart-library.sqlite";
const LIBRARY_TAG_COLORS = ["default", "red", "yellow", "brown", "blue", "green", "purple"];
const LIBRARY_TAG_COLOR_SET = new Set(LIBRARY_TAG_COLORS);
const SERVER_LANGUAGE = process.env.FORART_LANGUAGE === "en-US" ? "en-US" : "zh-CN";
const LIBRARY_LABELS = SERVER_LANGUAGE === "en-US"
  ? {
    modelLibrary: "Model Library",
    outfitLibrary: "Outfit Library",
    actionLibrary: "Action Library",
    defaultProject: "Default Project",
    defaultModel: "Untitled Model",
    defaultOutfitProject: "Default Outfit Project",
    defaultOutfit: "Untitled Outfit",
    defaultActionProject: "Default Action Project",
    defaultAction: "Untitled Action",
  }
  : {
    modelLibrary: "模特库",
    outfitLibrary: "穿搭库",
    actionLibrary: "动作库",
    defaultProject: "默认项目",
    defaultModel: "未命名模特",
    defaultOutfitProject: "默认穿搭项目",
    defaultOutfit: "未命名穿搭",
    defaultActionProject: "默认动作项目",
    defaultAction: "未命名动作",
  };
const DEFAULT_PROJECT_NAME = LIBRARY_LABELS.defaultProject;
const DEFAULT_MODEL_NAME = LIBRARY_LABELS.defaultModel;
const DEFAULT_OUTFIT_PROJECT_NAME = LIBRARY_LABELS.defaultOutfitProject;
const DEFAULT_OUTFIT_NAME = LIBRARY_LABELS.defaultOutfit;
const DEFAULT_ACTION_PROJECT_NAME = LIBRARY_LABELS.defaultActionProject;
const DEFAULT_ACTION_NAME = LIBRARY_LABELS.defaultAction;
const RESERVED_FILE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

let DATA_DIR = "";
let DATABASE_PATH = path.join(DATABASE_DIR, DATABASE_FILENAME);
let STORAGE_ROOT = "";
let db;
let activeActionImportRuntime = null;
let activeActionImportService = null;
const SERVER_STARTED_AT = new Date();

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
  "access-control-max-age": "86400",
};

function withCorsHeaders(headers = {}) {
  return { ...CORS_HEADERS, ...headers };
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeLibraryTagColor(value) {
  const next = String(value || "").trim();
  return LIBRARY_TAG_COLOR_SET.has(next) ? next : "default";
}

function newId(prefix = "") {
  const base = crypto.randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${base}` : base;
}

function safePathPart(value, fallback) {
  const name = String(value || "").trim() || fallback;
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").replace(/[ .]+$/g, "").slice(0, 80) || fallback;
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function validateFileNamePart(value, label) {
  const name = normalizeName(value);
  if (!name) {
    throw new Error(`${label} is required`);
  }
  if (name.length > 80) {
    throw new Error(`${label} must be 80 characters or fewer`);
  }
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) {
    throw new Error(`${label} cannot contain Windows or Linux filename characters: < > : " / \\ | ? *`);
  }
  if (name === "." || name === ".." || /[ .]$/.test(name)) {
    throw new Error(`${label} cannot end with a space or period, and cannot be . or ..`);
  }
  if (RESERVED_FILE_NAMES.has(name.split(".")[0].toUpperCase())) {
    throw new Error(`${label} cannot use a Windows reserved name`);
  }
  return name;
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

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function resolveDataDir(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Save path is required");
  return path.resolve(raw);
}

function ensureDataDirWritable(targetDir) {
  const resolved = resolveDataDir(targetDir);
  ensureDir(resolved);
  const probe = path.join(resolved, ".forart-write-test");
  writeFileSync(probe, "ok", "utf8");
  unlinkSync(probe);
  return resolved;
}

function applyDataDir(targetDir) {
  ensureDir(DATABASE_DIR);
  DATA_DIR = ensureDataDirWritable(targetDir);
  DATABASE_PATH = path.join(DATABASE_DIR, DATABASE_FILENAME);
  STORAGE_ROOT = DATA_DIR;
  ensureDir(STORAGE_ROOT);
}

function storageSettingsPayload() {
  return { configured: Boolean(db && DATA_DIR) };
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, withCorsHeaders({ "content-type": "application/json; charset=utf-8" }));
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, withCorsHeaders({ "content-type": contentType }));
  res.end(text);
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

function initDatabase() {
  db = new DatabaseSync(DATABASE_PATH);
  db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS model_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    cover_asset_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS model_entries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    gender TEXT NOT NULL DEFAULT 'unknown',
    cover_image_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, name),
    FOREIGN KEY(project_id) REFERENCES model_projects(id) ON DELETE CASCADE,
    FOREIGN KEY(cover_image_id) REFERENCES model_images(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS model_images (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    mime_type TEXT,
    filename TEXT,
    FOREIGN KEY(model_id) REFERENCES model_entries(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS outfit_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    cover_asset_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outfit_entries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, name),
    FOREIGN KEY(project_id) REFERENCES outfit_projects(id) ON DELETE CASCADE,
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS action_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    cover_asset_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS action_entries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, name),
    FOREIGN KEY(project_id) REFERENCES action_projects(id) ON DELETE CASCADE,
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS library_tags (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'default',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(kind, project_id, name)
  );
  CREATE TABLE IF NOT EXISTS library_entry_tags (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(kind, entry_id, tag_id),
    FOREIGN KEY(tag_id) REFERENCES library_tags(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_model_projects_name_unique ON model_projects(name);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_model_entries_project_name_unique ON model_entries(project_id, name);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_outfit_projects_name_unique ON outfit_projects(name);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_outfit_entries_project_name_unique ON outfit_entries(project_id, name);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_action_projects_name_unique ON action_projects(name);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_action_entries_project_name_unique ON action_entries(project_id, name);
  CREATE INDEX IF NOT EXISTS idx_model_entries_project_updated ON model_entries(project_id, updated_at DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_model_images_model_sort ON model_images(model_id, sort_order ASC, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_outfit_entries_project_updated ON outfit_entries(project_id, updated_at DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_action_entries_project_updated ON action_entries(project_id, updated_at DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_library_tags_kind_project_sort ON library_tags(kind, project_id, sort_order ASC, name ASC);
  CREATE INDEX IF NOT EXISTS idx_library_entry_tags_kind_entry ON library_entry_tags(kind, entry_id);
  CREATE INDEX IF NOT EXISTS idx_library_entry_tags_tag ON library_entry_tags(tag_id);
`);
  ensureProjectSortOrder("model_projects");
  ensureProjectSortOrder("outfit_projects");
  ensureProjectSortOrder("action_projects");
  ensureLibraryTagColor();
  db.exec(`
  CREATE INDEX IF NOT EXISTS idx_model_projects_sort ON model_projects(sort_order ASC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_outfit_projects_sort ON outfit_projects(sort_order ASC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_action_projects_sort ON action_projects(sort_order ASC, created_at DESC);
`);
  ensureDefaultProject();
  ensureDefaultOutfitProject();
  ensureDefaultActionProject();
}

function runDbTransaction(work) {
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

function ensureProjectSortOrder(tableName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === "sort_order")) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
    const rows = db.prepare(`SELECT id FROM ${tableName} ORDER BY updated_at DESC, created_at DESC`).all();
    const update = db.prepare(`UPDATE ${tableName} SET sort_order = ? WHERE id = ?`);
    rows.forEach((row, index) => update.run(index + 1, row.id));
  }
}

function ensureLibraryTagColor() {
  const columns = db.prepare("PRAGMA table_info(library_tags)").all();
  if (!columns.some((column) => column.name === "color")) {
    db.exec("ALTER TABLE library_tags ADD COLUMN color TEXT NOT NULL DEFAULT 'default'");
  }
  const allowed = LIBRARY_TAG_COLORS.map((color) => `'${color}'`).join(", ");
  db.exec(`
    UPDATE library_tags
    SET color = 'default'
    WHERE color IS NULL
       OR color = ''
       OR color NOT IN (${allowed})
  `);
}

function switchDataDir(nextDataDir) {
  const previousDb = db;
  if (previousDb) {
    previousDb.close();
    db = undefined;
  }
  try {
    applyDataDir(nextDataDir);
    initDatabase();
  } catch (error) {
    if (db) {
      db.close();
      db = undefined;
    }
    if (previousDb) db = previousDb;
    throw error;
  }
}

function ensureDefaultProject() {
  const row = db.prepare("SELECT id FROM model_projects ORDER BY created_at ASC LIMIT 1").get();
  if (row) return;
  const timestamp = nowIso();
  const name = validateFileNamePart(DEFAULT_PROJECT_NAME, "project name");
  db.prepare(
    "INSERT INTO model_projects (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(newId("project"), name, 0, timestamp, timestamp);
}

function ensureDefaultOutfitProject() {
  const row = db.prepare("SELECT id FROM outfit_projects ORDER BY created_at ASC LIMIT 1").get();
  if (row) return;
  const timestamp = nowIso();
  const name = validateFileNamePart(DEFAULT_OUTFIT_PROJECT_NAME, "project name");
  db.prepare(
    "INSERT INTO outfit_projects (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(newId("outfit_project"), name, 0, timestamp, timestamp);
}

function ensureDefaultActionProject() {
  const row = db.prepare("SELECT id FROM action_projects ORDER BY created_at ASC LIMIT 1").get();
  if (row) return;
  const timestamp = nowIso();
  const name = validateFileNamePart(DEFAULT_ACTION_PROJECT_NAME, "project name");
  db.prepare(
    "INSERT INTO action_projects (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(newId("action_project"), name, 0, timestamp, timestamp);
}

switchDataDir(LIBRARY_DIR);

const adminContext = createAdminContext({
  serverHost: SERVER_HOST,
  serverPort: SERVER_PORT,
  startedAt: SERVER_STARTED_AT,
  databaseFilename: DATABASE_FILENAME,
  getDataDir: () => DATA_DIR,
  getDatabaseDir: () => DATABASE_DIR,
  getDatabasePath: () => DATABASE_PATH,
  getStorageRoot: () => STORAGE_ROOT,
  getCanvasStorageRoot: () => CANVAS_STORAGE_ROOT,
  getDb: () => db,
});

const handleAdminRoute = createAdminRouter({
  adminRoot: ADMIN_ROOT,
  context: adminContext,
});

const canvasExchangeContext = createCanvasExchangeContext({
  getStorageRoot: () => CANVAS_STORAGE_ROOT,
});

const handleCanvasExchangeRoute = createCanvasExchangeRouter({
  context: canvasExchangeContext,
});

function ensureStorageConfigured(res) {
  if (db) return true;
  sendJson(res, 409, { detail: "Asset library storage is unavailable. Check FORART_LIBRARY_DIR or default library directory permissions.", code: "MODEL_LIBRARY_STORAGE_NOT_CONFIGURED" });
  return false;
}

function actionImportRuntime() {
  return {
    db,
    labels: LIBRARY_LABELS,
    storageRoot: STORAGE_ROOT,
    databaseDir: DATABASE_DIR,
    databasePath: DATABASE_PATH,
  };
}

function getActionImportService() {
  if (activeActionImportService && activeActionImportRuntime?.db === db && activeActionImportRuntime?.storageRoot === STORAGE_ROOT) {
    return activeActionImportService;
  }
  activeActionImportRuntime = actionImportRuntime();
  const actionService = createActionLibraryService(activeActionImportRuntime);
  activeActionImportService = createActionFolderImportService(activeActionImportRuntime, actionService);
  return activeActionImportService;
}

function getOutfitLibraryService() {
  return createOutfitLibraryService(actionImportRuntime());
}

function getModelLibraryService() {
  return createModelLibraryService(actionImportRuntime());
}

function assetUrl(assetId) {
  return assetId ? `/api/assets/${assetId}/file` : null;
}

function assetThumbnailUrl(assetId) {
  return assetId ? `/api/assets/${assetId}/thumb` : null;
}

function loadProject(projectId) {
  return db.prepare("SELECT * FROM model_projects WHERE id = ?").get(projectId) || null;
}

function loadModel(modelId) {
  return db.prepare("SELECT * FROM model_entries WHERE id = ?").get(modelId) || null;
}

function loadOutfitProject(projectId) {
  return db.prepare("SELECT * FROM outfit_projects WHERE id = ?").get(projectId) || null;
}

function loadOutfit(outfitId) {
  return db.prepare("SELECT * FROM outfit_entries WHERE id = ?").get(outfitId) || null;
}

function loadActionProject(projectId) {
  return db.prepare("SELECT * FROM action_projects WHERE id = ?").get(projectId) || null;
}

function loadAction(actionId) {
  return db.prepare("SELECT * FROM action_entries WHERE id = ?").get(actionId) || null;
}

function loadAsset(assetId) {
  return db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) || null;
}

function projectNameExists(name, exceptProjectId = "") {
  return Boolean(db.prepare("SELECT id FROM model_projects WHERE name = ? AND id <> ?").get(name, exceptProjectId));
}

function outfitProjectNameExists(name, exceptProjectId = "") {
  return Boolean(db.prepare("SELECT id FROM outfit_projects WHERE name = ? AND id <> ?").get(name, exceptProjectId));
}

function actionProjectNameExists(name, exceptProjectId = "") {
  return Boolean(db.prepare("SELECT id FROM action_projects WHERE name = ? AND id <> ?").get(name, exceptProjectId));
}

function modelNameExists(projectId, name, exceptModelId = "") {
  return Boolean(
    db.prepare("SELECT id FROM model_entries WHERE project_id = ? AND name = ? AND id <> ?").get(projectId, name, exceptModelId)
  );
}

function outfitNameExists(projectId, name, exceptOutfitId = "") {
  return Boolean(
    db.prepare("SELECT id FROM outfit_entries WHERE project_id = ? AND name = ? AND id <> ?").get(projectId, name, exceptOutfitId)
  );
}

function actionNameExists(projectId, name, exceptActionId = "") {
  return Boolean(
    db.prepare("SELECT id FROM action_entries WHERE project_id = ? AND name = ? AND id <> ?").get(projectId, name, exceptActionId)
  );
}

function modelLibraryRoot() {
  return path.join(STORAGE_ROOT, LIBRARY_LABELS.modelLibrary);
}

function projectDirForName(projectName) {
  return path.join(modelLibraryRoot(), folderName(projectName, "project name"));
}

function modelDirForNames(projectName, modelName) {
  return path.join(projectDirForName(projectName), folderName(modelName, "model name"));
}

function outfitLibraryRoot() {
  return path.join(STORAGE_ROOT, LIBRARY_LABELS.outfitLibrary);
}

function outfitProjectDirForName(projectName) {
  return path.join(outfitLibraryRoot(), folderName(projectName, "project name"));
}

function actionLibraryRoot() {
  return path.join(STORAGE_ROOT, LIBRARY_LABELS.actionLibrary);
}

function actionProjectDirForName(projectName) {
  return path.join(actionLibraryRoot(), folderName(projectName, "project name"));
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

function assetRelativePath(value) {
  const text = String(value || "");
  if (!text) return "";
  const absolute = path.isAbsolute(text) ? text : path.join(STORAGE_ROOT, text);
  return path.relative(STORAGE_ROOT, absolute);
}

function assetAbsolutePath(value) {
  const text = String(value || "");
  return path.isAbsolute(text) ? text : path.join(STORAGE_ROOT, text);
}

function renameDirectoryIfNeeded(oldDir, nextDir) {
  const oldPath = path.resolve(oldDir);
  const nextPath = path.resolve(nextDir);
  if (oldPath === nextPath || !existsSync(oldPath)) return;
  if (existsSync(nextPath)) {
    throw new Error("Target folder already exists. Use a unique name.");
  }
  ensureDir(path.dirname(nextPath));
  renameSync(oldPath, nextPath);
}

function isPathInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function removeDirectoryInside(root, directory, errorLabel) {
  const target = path.resolve(directory);
  if (!isPathInside(root, target)) throw new Error(`Refusing to delete a folder outside the ${errorLabel}`);
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
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

function renameOutfitProjectFolder(project, nextName) {
  const oldDir = outfitProjectDirForName(project.name);
  const nextDir = outfitProjectDirForName(nextName);
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
  for (const outfit of outfits) {
    const nextOutfitName = nextOutfitNameForIndex(nextName, outfits.indexOf(outfit) + 1);
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
  }
  const coverAssetRows = db.prepare("SELECT cover_asset_id AS asset_id FROM outfit_projects WHERE id = ?").all(project.id);
  for (const row of coverAssetRows) {
    const asset = row.asset_id ? loadAsset(row.asset_id) : null;
    if (asset?.path) {
      db.prepare("UPDATE assets SET path = ? WHERE id = ?").run(assetRelativePath(replacePathPrefix(asset.path, oldDir, nextDir)), asset.id);
    }
  }
}

function renameActionProjectFolder(project, nextName) {
  const oldDir = actionProjectDirForName(project.name);
  const nextDir = actionProjectDirForName(nextName);
  renameDirectoryIfNeeded(oldDir, nextDir);
  const assetRows = db.prepare(
    `
    SELECT DISTINCT a.id, a.path
    FROM assets a
    LEFT JOIN action_entries ae ON ae.asset_id = a.id
    LEFT JOIN action_projects ap ON ap.cover_asset_id = a.id
    WHERE ae.project_id = ? OR ap.id = ?
    `
  ).all(project.id, project.id);
  for (const asset of assetRows) {
    if (asset?.path) db.prepare("UPDATE assets SET path = ? WHERE id = ?").run(assetRelativePath(replacePathPrefix(asset.path, oldDir, nextDir)), asset.id);
  }
}

function renameSingleLibraryAsset(assetId, nextName, targetDir, nameLabel) {
  const asset = assetId ? loadAsset(assetId) : null;
  if (!asset?.path) return;
  const currentPath = assetAbsolutePath(asset.path);
  const suffix = path.extname(currentPath || asset.filename || "") || guessSuffix(asset.filename || "", asset.mime_type || "");
  const nextPath = path.join(targetDir, `${folderName(nextName, nameLabel)}${suffix}`);
  if (path.resolve(currentPath) === path.resolve(nextPath)) return;
  ensureDir(targetDir);
  if (existsSync(currentPath)) {
    if (existsSync(nextPath)) throw new Error(`Image file already exists: ${path.basename(nextPath)}`);
    renameSync(currentPath, nextPath);
  }
  db.prepare("UPDATE assets SET filename = ?, path = ? WHERE id = ?").run(path.basename(nextPath), assetRelativePath(nextPath), asset.id);
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
    const oldPath = assetPath;
    const currentPath = oldPath && existsSync(oldPath) ? oldPath : replacePathPrefix(oldPath || "", oldDir, nextDir);
    const nextPath = path.join(nextDir, filename);
    if (currentPath && existsSync(currentPath) && path.resolve(currentPath) !== path.resolve(nextPath)) {
      if (existsSync(nextPath)) throw new Error(`Image file already exists: ${filename}`);
      renameSync(currentPath, nextPath);
    }
    db.prepare("UPDATE assets SET filename = ?, path = ? WHERE id = ?").run(filename, assetRelativePath(nextPath), image.asset_id);
    db.prepare("UPDATE model_images SET filename = ? WHERE id = ?").run(filename, image.id);
  });
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

function tagsForAction(actionId) {
  return db.prepare(
    `
    SELECT t.name
    FROM library_entry_tags et
    JOIN library_tags t ON t.id = et.tag_id
    WHERE et.kind = 'action' AND et.entry_id = ?
    ORDER BY t.sort_order ASC, et.created_at ASC
    `
  ).all(actionId).map((row) => row.name);
}

function modelWithCoverAndTags(model) {
  const manual = model.cover_image_id ? db.prepare("SELECT * FROM model_images WHERE id = ? AND model_id = ?").get(model.cover_image_id, model.id) : null;
  const fallback = db.prepare(
    "SELECT * FROM model_images WHERE model_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1"
  ).get(model.id);
  const cover = manual || fallback || null;
  return {
    ...model,
    tags: tagsForModel(model.id),
    cover_image_id: cover?.id || null,
    cover_asset_id: cover?.asset_id || null,
    cover_url: assetUrl(cover?.asset_id || null),
    cover_thumbnail_url: assetThumbnailUrl(cover?.asset_id || null),
  };
}

function outfitWithAssetAndTags(outfit) {
  return {
    ...outfit,
    tags: tagsForOutfit(outfit.id),
    asset_url: assetUrl(outfit.asset_id || null),
    thumbnail_url: assetThumbnailUrl(outfit.asset_id || null),
  };
}

function actionWithAssetAndTags(action) {
  return {
    ...action,
    tags: tagsForAction(action.id),
    asset_url: assetUrl(action.asset_id || null),
    thumbnail_url: assetThumbnailUrl(action.asset_id || null),
  };
}

function projectWithCover(project) {
  return {
    ...project,
    cover_url: assetUrl(project.cover_asset_id || null),
    cover_thumbnail_url: assetThumbnailUrl(project.cover_asset_id || null),
  };
}

function tagUsage(tagId) {
  return db.prepare("SELECT COUNT(*) AS total FROM library_entry_tags WHERE tag_id = ?").get(tagId)?.total || 0;
}

function deleteProjectTags(kind, projectId) {
  const tags = db.prepare("SELECT id FROM library_tags WHERE kind = ? AND project_id = ?").all(kind, projectId);
  for (const tag of tags) db.prepare("DELETE FROM library_entry_tags WHERE tag_id = ?").run(tag.id);
  db.prepare("DELETE FROM library_tags WHERE kind = ? AND project_id = ?").run(kind, projectId);
}

function listTags(kind, projectId) {
  return db.prepare(
    `
    SELECT *
    FROM library_tags
    WHERE kind = ? AND project_id = ?
    ORDER BY sort_order ASC, name ASC
    `
  ).all(kind, projectId).map((tag) => ({
    ...tag,
    usage_count: tagUsage(tag.id),
  }));
}

function projectExistsForKind(kind, projectId) {
  if (kind === "model") return Boolean(loadProject(projectId));
  if (kind === "outfit") return Boolean(loadOutfitProject(projectId));
  if (kind === "action") return Boolean(loadActionProject(projectId));
  return false;
}

function createProjectTag(kind, projectId, name, color = "default") {
  const existing = db.prepare("SELECT * FROM library_tags WHERE kind = ? AND project_id = ? AND name = ?").get(kind, projectId, name);
  if (existing) return { ...existing, usage_count: tagUsage(existing.id) };
  const timestamp = nowIso();
  const id = newId("tag");
  const tagColor = normalizeLibraryTagColor(color);
  const sortOrder = db.prepare("SELECT COUNT(*) AS total FROM library_tags WHERE kind = ? AND project_id = ?").get(kind, projectId)?.total || 0;
  db.prepare(
    "INSERT INTO library_tags (id, kind, project_id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, kind, projectId, name, tagColor, sortOrder + 1, timestamp, timestamp);
  const tag = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(id);
  return { ...tag, usage_count: 0 };
}

function ensureProjectTag(kind, projectId, name) {
  const tagName = String(name || "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (!tagName) return null;
  return createProjectTag(kind, projectId, tagName);
}

function updateEntryTags(kind, entryId, projectId, names) {
  const nextTags = normalizeTags(names);
  db.prepare("DELETE FROM library_entry_tags WHERE kind = ? AND entry_id = ?").run(kind, entryId);
  for (const name of nextTags) {
    const tag = ensureProjectTag(kind, projectId, name);
    if (!tag) continue;
    db.prepare(
      "INSERT OR IGNORE INTO library_entry_tags (id, kind, entry_id, tag_id, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(newId("entrytag"), kind, entryId, tag.id, nowIso());
  }
}

function resolveTagNames(kind, projectId, tagIds) {
  const uniqueTagIds = Array.from(new Set(tagIds.map((tagId) => String(tagId || "").trim()).filter(Boolean)));
  if (!uniqueTagIds.length) return [];
  return uniqueTagIds
    .map((tagId) => db.prepare("SELECT name FROM library_tags WHERE kind = ? AND project_id = ? AND id = ?").get(kind, projectId, tagId)?.name)
    .filter(Boolean);
}

function entryMatchesTagFilter(entry, includeTagNames, excludeTagNames) {
  return includeTagNames.every((tagName) => entry.tags.includes(tagName))
    && excludeTagNames.every((tagName) => !entry.tags.includes(tagName));
}

function existingProjectTagNames(kind, projectId, names) {
  const nextTags = normalizeTags(names);
  if (!nextTags.length) throw new Error("At least one tag is required");
  const missing = nextTags.filter((name) => !db.prepare("SELECT id FROM library_tags WHERE kind = ? AND project_id = ? AND name = ?").get(kind, projectId, name));
  if (missing.length) throw new Error(`Tag not found: ${missing[0]}`);
  return nextTags;
}

function loadBulkEntries(kind, projectId, entryIds) {
  if (!projectExistsForKind(kind, projectId)) return null;
  const ids = normalizeBulkEntryIds(entryIds);
  const loadEntry = kind === "model" ? loadModel : kind === "outfit" ? loadOutfit : loadAction;
  const entries = ids.map((id) => loadEntry(id));
  const missingIndex = entries.findIndex((entry) => !entry);
  if (missingIndex >= 0) throw new Error(`${kind} entry not found: ${ids[missingIndex]}`);
  const wrongProject = entries.find((entry) => entry.project_id !== projectId);
  if (wrongProject) throw new Error("Selected entries must belong to the current project");
  return { ids, entries };
}

function tagsForEntryKind(kind, entryId) {
  if (kind === "model") return tagsForModel(entryId);
  if (kind === "outfit") return tagsForOutfit(entryId);
  if (kind === "action") return tagsForAction(entryId);
  return [];
}

function updateEntryTimestamp(kind, entryId, timestamp) {
  if (kind === "model") db.prepare("UPDATE model_entries SET updated_at = ? WHERE id = ?").run(timestamp, entryId);
  if (kind === "outfit") db.prepare("UPDATE outfit_entries SET updated_at = ? WHERE id = ?").run(timestamp, entryId);
  if (kind === "action") db.prepare("UPDATE action_entries SET updated_at = ? WHERE id = ?").run(timestamp, entryId);
}

function deleteEntryInsideTransaction(kind, entry) {
  if (kind === "model") {
    const imageRows = db.prepare("SELECT asset_id FROM model_images WHERE model_id = ?").all(entry.id);
    db.prepare("DELETE FROM library_entry_tags WHERE kind = 'model' AND entry_id = ?").run(entry.id);
    db.prepare("DELETE FROM model_entries WHERE id = ?").run(entry.id);
    for (const row of imageRows) removeAssetIfUnused(row.asset_id);
    return;
  }
  if (kind === "outfit") {
    db.prepare("DELETE FROM library_entry_tags WHERE kind = 'outfit' AND entry_id = ?").run(entry.id);
    db.prepare("UPDATE outfit_projects SET cover_asset_id = NULL WHERE cover_asset_id = ?").run(entry.asset_id);
    db.prepare("DELETE FROM outfit_entries WHERE id = ?").run(entry.id);
    removeAssetIfUnused(entry.asset_id);
    return;
  }
  if (kind === "action") {
    db.prepare("DELETE FROM library_entry_tags WHERE kind = 'action' AND entry_id = ?").run(entry.id);
    db.prepare("UPDATE action_projects SET cover_asset_id = NULL WHERE cover_asset_id = ?").run(entry.asset_id);
    db.prepare("DELETE FROM action_entries WHERE id = ?").run(entry.id);
    removeAssetIfUnused(entry.asset_id);
  }
}

function directoryForEntry(kind, entry) {
  if (kind !== "model") return "";
  const project = loadProject(entry.project_id);
  return project ? modelDirForNames(project.name, entry.name) : "";
}

function removeEntryDirectory(kind, directory) {
  if (!directory) return;
  if (kind === "model") removeDirectoryInside(modelLibraryRoot(), directory, "model library");
}

function bulkLibraryEntries(kind, payload = {}) {
  const projectId = String(payload.project_id || "").trim();
  if (!projectId) throw new Error("project_id is required");
  const operation = String(payload.operation || "").trim();
  const loaded = loadBulkEntries(kind, projectId, payload.entry_ids || []);
  if (!loaded) return null;
  const timestamp = nowIso();
  if (operation === "add_tags" || operation === "remove_tags") {
    const tagNames = existingProjectTagNames(kind, projectId, payload.tags || []);
    return runDbTransaction(() => {
      for (const entry of loaded.entries) {
        const current = tagsForEntryKind(kind, entry.id);
        const nextTags = operation === "add_tags"
          ? normalizeTags([...current, ...tagNames])
          : current.filter((name) => !tagNames.includes(name));
        updateEntryTags(kind, entry.id, projectId, nextTags);
        updateEntryTimestamp(kind, entry.id, timestamp);
      }
      return {
        ok: true,
        kind,
        operation,
        project_id: projectId,
        requested: loaded.ids.length,
        updated: loaded.ids.length,
        deleted: 0,
        skipped: [],
        tags: listTags(kind, projectId).filter((tag) => tagNames.includes(tag.name)),
      };
    });
  }
  if (operation === "delete") {
    const directories = loaded.entries.map((entry) => directoryForEntry(kind, entry)).filter(Boolean);
    runDbTransaction(() => {
      for (const entry of loaded.entries) deleteEntryInsideTransaction(kind, entry);
    });
    for (const directory of directories) removeEntryDirectory(kind, directory);
    return {
      ok: true,
      kind,
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

function handleBulkLibraryEntriesApi(req, res, kind) {
  parseJsonBody(req)
    .then((payload) => {
      const parsed = parseRequest(libraryBulkEntriesPayloadSchema, payload || {});
      if (!parsed.ok) return sendJson(res, parsed.status, parsed.body);
      const result = bulkLibraryEntries(kind, parsed.value);
      if (!result) return sendJson(res, 404, { detail: "Project not found" });
      sendJson(res, 200, result);
    })
    .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
  return true;
}

function handleProjectTagApi(req, res, { kind, projectId, tagId }) {
  const parsedQuery = parseRequest(libraryTagProjectQuerySchema, { project_id: projectId });
  if (!parsedQuery.ok) {
    sendJson(res, parsedQuery.status, parsedQuery.body);
    return true;
  }
  const parsedProjectId = parsedQuery.value.project_id;
  if (!projectExistsForKind(kind, parsedProjectId)) {
    sendJson(res, 404, { detail: "Project not found" });
    return true;
  }
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" && !tagId) {
    sendJson(res, 200, { tags: listTags(kind, parsedProjectId) });
    return true;
  }
  if (method === "POST" && !tagId) {
    parseJsonBody(req)
      .then((payload) => {
        const parsedBody = parseRequest(libraryCreateTagPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        const tag = runDbTransaction(() => createProjectTag(kind, parsedProjectId, parsedBody.value.name, parsedBody.value.color));
        sendJson(res, 200, tag);
      })
      .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (method === "PATCH" && tagId) {
    const parsedParams = parseRequest(libraryTagRouteParamsSchema, { project_id: parsedProjectId, tag_id: tagId });
    if (!parsedParams.ok) {
      sendJson(res, parsedParams.status, parsedParams.body);
      return true;
    }
    parseJsonBody(req)
      .then((payload) => {
        const parsedBody = parseRequest(libraryUpdateTagPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        const data = parsedBody.value;
        const next = runDbTransaction(() => {
          const tag = db.prepare("SELECT * FROM library_tags WHERE id = ? AND kind = ? AND project_id = ?").get(tagId, kind, parsedProjectId);
          if (!tag) return null;
          if (data.name !== undefined) {
            const nextName = data.name;
            const exists = db.prepare("SELECT id FROM library_tags WHERE kind = ? AND project_id = ? AND name = ? AND id <> ?").get(kind, parsedProjectId, nextName, tagId);
            if (exists) throw new Error("Tag already exists");
            db.prepare("UPDATE library_tags SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), tagId);
          }
          if (data.sort_order !== undefined) {
            db.prepare("UPDATE library_tags SET sort_order = ?, updated_at = ? WHERE id = ?").run(data.sort_order, nowIso(), tagId);
          }
          if (data.color !== undefined) {
            db.prepare("UPDATE library_tags SET color = ?, updated_at = ? WHERE id = ?").run(data.color, nowIso(), tagId);
          }
          return db.prepare("SELECT * FROM library_tags WHERE id = ?").get(tagId);
        });
        if (!next) return sendJson(res, 404, { detail: "Tag not found" });
        sendJson(res, 200, { ...next, usage_count: tagUsage(tagId) });
      })
      .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (method === "DELETE" && tagId) {
    const parsedParams = parseRequest(libraryTagRouteParamsSchema, { project_id: parsedProjectId, tag_id: tagId });
    if (!parsedParams.ok) {
      sendJson(res, parsedParams.status, parsedParams.body);
      return true;
    }
    const tag = db.prepare("SELECT * FROM library_tags WHERE id = ? AND kind = ? AND project_id = ?").get(tagId, kind, parsedProjectId);
    if (!tag) {
      sendJson(res, 200, { ok: true });
      return true;
    }
    runDbTransaction(() => {
      db.prepare("DELETE FROM library_entry_tags WHERE tag_id = ?").run(tagId);
      db.prepare("DELETE FROM library_tags WHERE id = ?").run(tagId);
    });
    sendJson(res, 200, { ok: true });
    return true;
  }
  return false;
}

function nextOutfitNameForIndex(projectName, index) {
  return `${folderName(projectName, "project name")}_${String(index).padStart(3, "0")}`;
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

function writeAsset(content, mimeType, originalFilename, { source, subdir, filenameStem, dimensions }) {
  const assetId = newId("asset");
  const suffix = guessSuffix(originalFilename, mimeType);
  const filenameBase = safePathPart(filenameStem || assetId, assetId);
  const filename = `${filenameBase}${suffix}`;
  const targetDir = path.resolve(STORAGE_ROOT, subdir || ".");
  if (!targetDir.startsWith(path.resolve(STORAGE_ROOT))) {
    throw new Error("Invalid asset directory");
  }
  ensureDir(targetDir);
  let targetPath = path.join(targetDir, filename);
  if (existsSync(targetPath)) {
    targetPath = path.join(targetDir, `${filenameBase}_${assetId.slice(0, 8)}${suffix}`);
  }
  writeFileSync(targetPath, content);
  const dims = dimensions || { width: 0, height: 0 };
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

async function writeAssetInTransaction(content, mimeType, originalFilename, options, work) {
  let asset = null;
  try {
    const dimensions = await readSharpImageDimensions(content, { mimeType });
    const result = runDbTransaction(() => {
      asset = writeAsset(content, mimeType, originalFilename, { ...options, dimensions });
      return work(asset);
    });
    await ensureLibraryAssetThumbnail(actionImportRuntime(), asset, assetAbsolutePath(asset.path));
    return result;
  } catch (error) {
    if (asset?.path) {
      try {
        unlinkSync(assetAbsolutePath(asset.path));
      } catch {}
      deleteLibraryAssetThumbnail(actionImportRuntime(), asset.id);
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
  deleteLibraryAssetThumbnail(actionImportRuntime(), assetId);
  db.prepare("DELETE FROM assets WHERE id = ?").run(assetId);
}

function clearLibraryTables() {
  db.exec(`
    DELETE FROM library_entry_tags;
    DELETE FROM library_tags;
    DELETE FROM model_images;
    DELETE FROM model_entries;
    DELETE FROM model_projects;
    DELETE FROM outfit_entries;
    DELETE FROM outfit_projects;
    DELETE FROM action_entries;
    DELETE FROM action_projects;
    DELETE FROM assets;
  `);
}

function handleModelLibraryApi(req, res, url) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/settings/storage") {
    if (method === "GET") {
      sendJson(res, 200, storageSettingsPayload());
      return true;
    }
  }

  if (!ensureStorageConfigured(res)) return true;

  if (method === "GET" && pathname === "/api/outfit-projects") {
    const projects = db.prepare("SELECT * FROM outfit_projects ORDER BY sort_order ASC, created_at DESC").all().map(projectWithCover);
    sendJson(res, 200, { projects });
    return true;
  }

  if (method === "POST" && pathname === "/api/outfit-projects") {
    parseJsonBody(req)
      .then((payload) => {
        const parsedBody = parseRequest(libraryCreateProjectPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        const data = parsedBody.value;
        const timestamp = nowIso();
        const id = newId("outfit_project");
        const name = validateFileNamePart(data.name || DEFAULT_OUTFIT_PROJECT_NAME, "project name");
        if (outfitProjectNameExists(name)) return sendJson(res, 400, { detail: "Project name must be unique" });
        const sortOrder = db.prepare("SELECT COALESCE(MIN(sort_order), 0) - 1 AS next FROM outfit_projects").get()?.next || 0;
        db.prepare(
          "INSERT INTO outfit_projects (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run(id, name, sortOrder, timestamp, timestamp);
        sendJson(res, 200, projectWithCover(loadOutfitProject(id)));
      })
      .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  const outfitImportEntriesMatch = pathname.match(/^\/api\/outfit-projects\/([^/]+)\/outfits\/import-entries$/);
  if (outfitImportEntriesMatch && method === "POST") {
    parseJsonBody(req)
      .then(async (payload) => {
        const parsedBody = parseRequest(libraryImportEntriesPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        const projectId = decodeURIComponent(outfitImportEntriesMatch[1]);
        const result = await getOutfitLibraryService().importEntries(projectId, parsedBody.value);
        if (!result) return sendJson(res, 404, { detail: "Outfit project not found" });
        sendJson(res, 200, result);
      })
      .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  const outfitProjectMatch = pathname.match(/^\/api\/outfit-projects\/([^/]+)(?:\/(cover\/upload|outfits))?$/);
  if (outfitProjectMatch) {
    const projectId = decodeURIComponent(outfitProjectMatch[1]);
    const tail = outfitProjectMatch[2] || "";
    if (tail === "" && method === "PATCH") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryUpdateProjectPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const project = loadOutfitProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Outfit project not found" });
          const nextProject = runDbTransaction(() => {
            if (data.name !== undefined) {
              const nextName = validateFileNamePart(data.name || DEFAULT_OUTFIT_PROJECT_NAME, "project name");
              if (outfitProjectNameExists(nextName, projectId)) throw new Error("Project name must be unique");
              if (nextName !== project.name) {
                renameOutfitProjectFolder(project, nextName);
                db.prepare("UPDATE outfit_projects SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), projectId);
              }
            }
            if (data.cover_asset_id !== undefined) {
              const coverAssetId = data.cover_asset_id;
              if (coverAssetId && !loadAsset(coverAssetId)) throw new Error("Asset not found");
              db.prepare("UPDATE outfit_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(coverAssetId, nowIso(), projectId);
            }
            if (data.sort_order !== undefined) {
              db.prepare("UPDATE outfit_projects SET sort_order = ?, updated_at = ? WHERE id = ?").run(data.sort_order, nowIso(), projectId);
            }
            return projectWithCover(loadOutfitProject(projectId));
          });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "" && method === "DELETE") {
      const project = loadOutfitProject(projectId);
      if (!project) {
        sendJson(res, 404, { detail: "Outfit project not found" });
        return true;
      }
      const projectDir = outfitProjectDirForName(project.name);
      const assetRows = db.prepare("SELECT asset_id FROM outfit_entries WHERE project_id = ?").all(projectId);
      const coverAssetRows = db.prepare("SELECT cover_asset_id AS asset_id FROM outfit_projects WHERE id = ?").all(projectId);
      runDbTransaction(() => {
        deleteProjectTags("outfit", projectId);
        db.prepare("DELETE FROM outfit_projects WHERE id = ?").run(projectId);
        for (const row of assetRows) removeAssetIfUnused(row.asset_id);
        for (const row of coverAssetRows) removeAssetIfUnused(row.asset_id);
        ensureDefaultOutfitProject();
      });
      removeDirectoryInside(outfitLibraryRoot(), projectDir, "outfit library");
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (tail === "cover/upload" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const project = loadOutfitProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Outfit project not found" });
          const decoded = parseDataUrl(`data:${data.mime_type};base64,${data.data}`);
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const relDir = path.relative(STORAGE_ROOT, path.join(outfitProjectDirForName(project.name), "__project_cover__"));
          const nextProject = await writeAssetInTransaction(
            decoded.buffer,
            decoded.mimeType,
            data.filename,
            {
              source: "outfit-project-cover",
              subdir: relDir,
              filenameStem: "cover",
            },
            (asset) => {
              db.prepare("UPDATE outfit_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, nowIso(), projectId);
              return projectWithCover(loadOutfitProject(projectId));
            }
          );
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "outfits" && method === "GET") {
      const includeTagNames = resolveTagNames("outfit", projectId, url.searchParams.getAll("tag_id"));
      const excludeTagNames = resolveTagNames("outfit", projectId, url.searchParams.getAll("exclude_tag_id"));
      const untaggedOnly = url.searchParams.get("untagged") === "1" || url.searchParams.get("untagged") === "true";
      const project = loadOutfitProject(projectId);
      if (!project) {
        sendJson(res, 404, { detail: "Outfit project not found" });
        return true;
      }
      const outfits = db.prepare("SELECT * FROM outfit_entries WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC").all(projectId)
        .map(outfitWithAssetAndTags);
      const filtered = untaggedOnly
        ? outfits.filter((outfit) => !outfit.tags.length)
        : includeTagNames.length || excludeTagNames.length
        ? outfits.filter((outfit) => entryMatchesTagFilter(outfit, includeTagNames, excludeTagNames))
        : outfits;
      sendJson(res, 200, { outfits: filtered });
      return true;
    }
  }

  const outfitMatch = pathname.match(/^\/api\/outfits\/([^/]+)(?:\/image\/upload)?$/);
  if (outfitMatch) {
    const outfitId = decodeURIComponent(outfitMatch[1]);
    const isImageUpload = pathname.endsWith("/image/upload");
    if (!isImageUpload && method === "PATCH") {
      parseJsonBody(req)
        .then((payload) => {
          const parsedBody = parseRequest(libraryUpdateOutfitPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const outfit = loadOutfit(outfitId);
          if (!outfit) return sendJson(res, 404, { detail: "Outfit not found" });
          const nextOutfit = runDbTransaction(() => {
            if (data.name !== undefined) {
              const nextName = validateFileNamePart(data.name || DEFAULT_OUTFIT_NAME, "outfit name");
              if (outfitNameExists(outfit.project_id, nextName, outfitId)) throw new Error("Outfit name must be unique");
              if (nextName !== outfit.name) {
                const project = loadOutfitProject(outfit.project_id);
                if (!project) throw new Error("Outfit project not found");
                renameSingleLibraryAsset(outfit.asset_id, nextName, outfitProjectDirForName(project.name), "outfit name");
                db.prepare("UPDATE outfit_entries SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), outfitId);
              }
            }
            if (data.tags !== undefined) {
              updateEntryTags("outfit", outfitId, outfit.project_id, data.tags);
              db.prepare("UPDATE outfit_entries SET updated_at = ? WHERE id = ?").run(nowIso(), outfitId);
            }
            return outfitWithAssetAndTags(loadOutfit(outfitId));
          });
          sendJson(res, 200, nextOutfit);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (!isImageUpload && method === "DELETE") {
      const outfit = loadOutfit(outfitId);
      if (!outfit) {
        sendJson(res, 404, { detail: "Outfit not found" });
        return true;
      }
      runDbTransaction(() => {
        db.prepare("DELETE FROM library_entry_tags WHERE kind = 'outfit' AND entry_id = ?").run(outfitId);
        db.prepare("UPDATE outfit_projects SET cover_asset_id = NULL WHERE cover_asset_id = ?").run(outfit.asset_id);
        db.prepare("DELETE FROM outfit_entries WHERE id = ?").run(outfitId);
        removeAssetIfUnused(outfit.asset_id);
      });
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (isImageUpload && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const outfit = loadOutfit(outfitId);
          if (!outfit) return sendJson(res, 404, { detail: "Outfit not found" });
          const project = loadOutfitProject(outfit.project_id);
          if (!project) return sendJson(res, 404, { detail: "Outfit project not found" });
          const decoded = parseDataUrl(`data:${data.mime_type};base64,${data.data}`);
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const previousAssetId = outfit.asset_id;
          const relDir = path.relative(STORAGE_ROOT, outfitProjectDirForName(project.name));
          const timestamp = nowIso();
          const nextOutfit = await writeAssetInTransaction(
            decoded.buffer,
            decoded.mimeType,
            data.filename,
            {
              source: "outfit-library",
              subdir: relDir,
              filenameStem: outfit.name || DEFAULT_OUTFIT_NAME,
            },
            (asset) => {
              db.prepare("UPDATE outfit_entries SET asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, timestamp, outfitId);
              db.prepare("UPDATE outfit_projects SET cover_asset_id = CASE WHEN cover_asset_id = ? THEN ? ELSE cover_asset_id END, updated_at = ? WHERE id = ?")
                .run(previousAssetId, asset.id, timestamp, project.id);
              removeAssetIfUnused(previousAssetId);
              return outfitWithAssetAndTags(loadOutfit(outfitId));
            }
          );
          sendJson(res, 200, nextOutfit);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
  }

  const outfitTagMatch = pathname.match(/^\/api\/libraries\/outfit\/tags(?:\/([^/]+))?$/);
  if (outfitTagMatch) {
    const tagId = outfitTagMatch[1] ? decodeURIComponent(outfitTagMatch[1]) : "";
    const projectId = url.searchParams.get("project_id") || "";
    if (handleProjectTagApi(req, res, { kind: "outfit", projectId, tagId })) return true;
  }

  if (pathname === "/api/libraries/outfit/entries/bulk" && method === "POST") {
    return handleBulkLibraryEntriesApi(req, res, "outfit");
  }

  if (method === "GET" && pathname === "/api/action-projects") {
    const projects = db.prepare("SELECT * FROM action_projects ORDER BY sort_order ASC, created_at DESC").all().map(projectWithCover);
    sendJson(res, 200, { projects });
    return true;
  }

  if (method === "POST" && pathname === "/api/action-projects") {
    parseJsonBody(req)
      .then((payload) => {
        const parsedBody = parseRequest(libraryCreateProjectPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        const data = parsedBody.value;
        const timestamp = nowIso();
        const id = newId("action_project");
        const name = validateFileNamePart(data.name || DEFAULT_ACTION_PROJECT_NAME, "project name");
        if (actionProjectNameExists(name)) return sendJson(res, 400, { detail: "Project name must be unique" });
        const sortOrder = db.prepare("SELECT COALESCE(MIN(sort_order), 0) - 1 AS next FROM action_projects").get()?.next || 0;
        db.prepare(
          "INSERT INTO action_projects (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run(id, name, sortOrder, timestamp, timestamp);
        sendJson(res, 200, projectWithCover(loadActionProject(id)));
      })
      .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  const actionProjectMatch = pathname.match(/^\/api\/action-projects\/([^/]+)(?:\/(cover\/upload|actions))?$/);
  if (actionProjectMatch) {
    const projectId = decodeURIComponent(actionProjectMatch[1]);
    const tail = actionProjectMatch[2] || "";
    if (tail === "" && method === "PATCH") {
      parseJsonBody(req)
        .then((payload) => {
          const parsedBody = parseRequest(libraryUpdateProjectPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const project = loadActionProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Action project not found" });
          const nextProject = runDbTransaction(() => {
            if (data.name !== undefined) {
              const nextName = validateFileNamePart(data.name || DEFAULT_ACTION_PROJECT_NAME, "project name");
              if (actionProjectNameExists(nextName, projectId)) throw new Error("Project name must be unique");
              if (nextName !== project.name) {
                renameActionProjectFolder(project, nextName);
                db.prepare("UPDATE action_projects SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), projectId);
              }
            }
            if (data.cover_asset_id !== undefined) {
              const coverAssetId = data.cover_asset_id;
              if (coverAssetId && !loadAsset(coverAssetId)) throw new Error("Asset not found");
              db.prepare("UPDATE action_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(coverAssetId, nowIso(), projectId);
            }
            if (data.sort_order !== undefined) {
              db.prepare("UPDATE action_projects SET sort_order = ?, updated_at = ? WHERE id = ?").run(data.sort_order, nowIso(), projectId);
            }
            return projectWithCover(loadActionProject(projectId));
          });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "" && method === "DELETE") {
      const project = loadActionProject(projectId);
      if (!project) {
        sendJson(res, 404, { detail: "Action project not found" });
        return true;
      }
      const projectDir = actionProjectDirForName(project.name);
      const assetRows = db.prepare("SELECT asset_id FROM action_entries WHERE project_id = ?").all(projectId);
      const coverAssetRows = db.prepare("SELECT cover_asset_id AS asset_id FROM action_projects WHERE id = ?").all(projectId);
      runDbTransaction(() => {
        deleteProjectTags("action", projectId);
        db.prepare("DELETE FROM action_projects WHERE id = ?").run(projectId);
        for (const row of assetRows) removeAssetIfUnused(row.asset_id);
        for (const row of coverAssetRows) removeAssetIfUnused(row.asset_id);
        ensureDefaultActionProject();
      });
      removeDirectoryInside(actionLibraryRoot(), projectDir, "action library");
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (tail === "cover/upload" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const project = loadActionProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Action project not found" });
          const decoded = parseDataUrl(`data:${data.mime_type};base64,${data.data}`);
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const relDir = path.relative(STORAGE_ROOT, path.join(actionProjectDirForName(project.name), "__project_cover__"));
          const nextProject = await writeAssetInTransaction(
            decoded.buffer,
            decoded.mimeType,
            data.filename,
            {
              source: "action-project-cover",
              subdir: relDir,
              filenameStem: "cover",
            },
            (asset) => {
              db.prepare("UPDATE action_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, nowIso(), projectId);
              return projectWithCover(loadActionProject(projectId));
            }
          );
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "actions" && method === "GET") {
      const includeTagNames = resolveTagNames("action", projectId, url.searchParams.getAll("tag_id"));
      const excludeTagNames = resolveTagNames("action", projectId, url.searchParams.getAll("exclude_tag_id"));
      const untaggedOnly = url.searchParams.get("untagged") === "1" || url.searchParams.get("untagged") === "true";
      const project = loadActionProject(projectId);
      if (!project) {
        sendJson(res, 404, { detail: "Action project not found" });
        return true;
      }
      const actions = db.prepare("SELECT * FROM action_entries WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC").all(projectId)
        .map(actionWithAssetAndTags);
      const filtered = untaggedOnly
        ? actions.filter((action) => !action.tags.length)
        : includeTagNames.length || excludeTagNames.length
        ? actions.filter((action) => entryMatchesTagFilter(action, includeTagNames, excludeTagNames))
        : actions;
      sendJson(res, 200, { actions: filtered });
      return true;
    }
  }

  const actionImportEntriesMatch = pathname.match(/^\/api\/action-projects\/([^/]+)\/actions\/import-entries$/);
  if (actionImportEntriesMatch && method === "POST") {
    parseJsonBody(req)
      .then(async (payload) => {
        const parsedBody = parseRequest(libraryImportEntriesPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        const projectId = decodeURIComponent(actionImportEntriesMatch[1]);
        const result = await getActionImportService().importActionEntries(projectId, parsedBody.value);
        if (!result) return sendJson(res, 404, { detail: "Action project not found" });
        sendJson(res, 200, result);
      })
      .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  const actionMatch = pathname.match(/^\/api\/actions\/([^/]+)(?:\/image\/upload)?$/);
  if (actionMatch) {
    const actionId = decodeURIComponent(actionMatch[1]);
    const isImageUpload = pathname.endsWith("/image/upload");
    if (!isImageUpload && method === "PATCH") {
      parseJsonBody(req)
        .then((payload) => {
          const parsedBody = parseRequest(libraryUpdateActionPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const action = loadAction(actionId);
          if (!action) return sendJson(res, 404, { detail: "Action not found" });
          const nextAction = runDbTransaction(() => {
            if (data.name !== undefined) {
              const nextName = validateFileNamePart(data.name || DEFAULT_ACTION_NAME, "action name");
              if (actionNameExists(action.project_id, nextName, actionId)) throw new Error("Action name must be unique");
              if (nextName !== action.name) {
                const project = loadActionProject(action.project_id);
                if (!project) throw new Error("Action project not found");
                renameSingleLibraryAsset(action.asset_id, nextName, actionProjectDirForName(project.name), "action name");
                db.prepare("UPDATE action_entries SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), actionId);
              }
            }
            if (data.tags !== undefined) {
              updateEntryTags("action", actionId, action.project_id, data.tags);
              db.prepare("UPDATE action_entries SET updated_at = ? WHERE id = ?").run(nowIso(), actionId);
            }
            if (data.prompt !== undefined) {
              db.prepare("UPDATE action_entries SET prompt = ?, updated_at = ? WHERE id = ?").run(data.prompt, nowIso(), actionId);
            }
            return actionWithAssetAndTags(loadAction(actionId));
          });
          sendJson(res, 200, nextAction);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (!isImageUpload && method === "DELETE") {
      const action = loadAction(actionId);
      if (!action) {
        sendJson(res, 404, { detail: "Action not found" });
        return true;
      }
      runDbTransaction(() => {
        db.prepare("DELETE FROM library_entry_tags WHERE kind = 'action' AND entry_id = ?").run(actionId);
        db.prepare("UPDATE action_projects SET cover_asset_id = NULL WHERE cover_asset_id = ?").run(action.asset_id);
        db.prepare("DELETE FROM action_entries WHERE id = ?").run(actionId);
        removeAssetIfUnused(action.asset_id);
      });
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (isImageUpload && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const action = loadAction(actionId);
          if (!action) return sendJson(res, 404, { detail: "Action not found" });
          const project = loadActionProject(action.project_id);
          if (!project) return sendJson(res, 404, { detail: "Action project not found" });
          const decoded = parseDataUrl(`data:${data.mime_type};base64,${data.data}`);
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const previousAssetId = action.asset_id;
          const relDir = path.relative(STORAGE_ROOT, actionProjectDirForName(project.name));
          const timestamp = nowIso();
          const nextAction = await writeAssetInTransaction(
            decoded.buffer,
            decoded.mimeType,
            data.filename,
            {
              source: "action-library",
              subdir: relDir,
              filenameStem: action.name || DEFAULT_ACTION_NAME,
            },
            (asset) => {
              db.prepare("UPDATE action_entries SET asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, timestamp, actionId);
              db.prepare("UPDATE action_projects SET cover_asset_id = CASE WHEN cover_asset_id = ? THEN ? ELSE cover_asset_id END, updated_at = ? WHERE id = ?")
                .run(previousAssetId, asset.id, timestamp, project.id);
              removeAssetIfUnused(previousAssetId);
              return actionWithAssetAndTags(loadAction(actionId));
            }
          );
          sendJson(res, 200, nextAction);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
  }

  const actionTagMatch = pathname.match(/^\/api\/libraries\/action\/tags(?:\/([^/]+))?$/);
  if (actionTagMatch) {
    const tagId = actionTagMatch[1] ? decodeURIComponent(actionTagMatch[1]) : "";
    const projectId = url.searchParams.get("project_id") || "";
    if (handleProjectTagApi(req, res, { kind: "action", projectId, tagId })) return true;
  }

  if (pathname === "/api/libraries/action/entries/bulk" && method === "POST") {
    return handleBulkLibraryEntriesApi(req, res, "action");
  }

  if (method === "GET" && pathname === "/api/model-projects") {
    const projects = db.prepare("SELECT * FROM model_projects ORDER BY sort_order ASC, created_at DESC").all().map(projectWithCover);
    sendJson(res, 200, { projects });
    return true;
  }

  if (method === "POST" && pathname === "/api/model-projects") {
    parseJsonBody(req)
      .then((payload) => {
        const parsedBody = parseRequest(libraryCreateProjectPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        const data = parsedBody.value;
        const timestamp = nowIso();
        const id = newId("project");
        const name = validateFileNamePart(data.name || DEFAULT_PROJECT_NAME, "project name");
        if (projectNameExists(name)) return sendJson(res, 400, { detail: "Project name must be unique" });
        const sortOrder = db.prepare("SELECT COALESCE(MIN(sort_order), 0) - 1 AS next FROM model_projects").get()?.next || 0;
        db.prepare(
          "INSERT INTO model_projects (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run(id, name, sortOrder, timestamp, timestamp);
        const project = projectWithCover(loadProject(id));
        sendJson(res, 200, project);
      })
      .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  const modelImportEntriesMatch = pathname.match(/^\/api\/model-projects\/([^/]+)\/models\/import-entries$/);
  if (modelImportEntriesMatch && method === "POST") {
    parseJsonBody(req)
      .then(async (payload) => {
        const parsedBody = parseRequest(libraryImportEntriesPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        const projectId = decodeURIComponent(modelImportEntriesMatch[1]);
        const result = await getModelLibraryService().importEntries(projectId, parsedBody.value);
        if (!result) return sendJson(res, 404, { detail: "Model project not found" });
        sendJson(res, 200, result);
      })
      .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  const projectMatch = pathname.match(/^\/api\/model-projects\/([^/]+)(?:\/(cover\/upload|models))?$/);
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    const tail = projectMatch[2] || "";
    if (tail === "" && method === "PATCH") {
      parseJsonBody(req)
        .then((payload) => {
          const parsedBody = parseRequest(libraryUpdateProjectPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const project = loadProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Model project not found" });
          const nextProject = runDbTransaction(() => {
            if (data.name !== undefined) {
              const nextName = validateFileNamePart(data.name || DEFAULT_PROJECT_NAME, "project name");
              if (projectNameExists(nextName, projectId)) throw new Error("Project name must be unique");
              if (nextName !== project.name) {
                renameProjectFolder(project, nextName);
                db.prepare("UPDATE model_projects SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), projectId);
              }
            }
            if (data.cover_asset_id !== undefined) {
              const coverAssetId = data.cover_asset_id;
              if (coverAssetId && !loadAsset(coverAssetId)) throw new Error("Asset not found");
              db.prepare("UPDATE model_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(coverAssetId, nowIso(), projectId);
            }
            if (data.sort_order !== undefined) {
              db.prepare("UPDATE model_projects SET sort_order = ?, updated_at = ? WHERE id = ?").run(data.sort_order, nowIso(), projectId);
            }
            return projectWithCover(loadProject(projectId));
          });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "" && method === "DELETE") {
      const project = loadProject(projectId);
      if (!project) {
        sendJson(res, 404, { detail: "Model project not found" });
        return true;
      }
      const projectDir = projectDirForName(project.name);
      const modelRows = db.prepare("SELECT id FROM model_entries WHERE project_id = ?").all(projectId);
      const imageRows = db.prepare(
        "SELECT mi.asset_id FROM model_images mi JOIN model_entries me ON me.id = mi.model_id WHERE me.project_id = ?"
      ).all(projectId);
      const coverAssetRows = db.prepare("SELECT cover_asset_id AS asset_id FROM model_projects WHERE id = ?").all(projectId);
      runDbTransaction(() => {
        deleteProjectTags("model", projectId);
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
      removeDirectoryInside(modelLibraryRoot(), projectDir, "model library");
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (tail === "cover/upload" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const project = loadProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Model project not found" });
          const decoded = parseDataUrl(`data:${data.mime_type};base64,${data.data}`);
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const relDir = path.relative(STORAGE_ROOT, path.join(projectDirForName(project.name), "__project_cover__"));
          const nextProject = await writeAssetInTransaction(
            decoded.buffer,
            decoded.mimeType,
            data.filename,
            {
              source: "model-project-cover",
              subdir: relDir,
              filenameStem: "cover",
            },
            (asset) => {
              db.prepare("UPDATE model_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, nowIso(), projectId);
              return projectWithCover(loadProject(projectId));
            }
          );
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "models" && method === "GET") {
      const includeTagNames = resolveTagNames("model", projectId, url.searchParams.getAll("tag_id"));
      const excludeTagNames = resolveTagNames("model", projectId, url.searchParams.getAll("exclude_tag_id"));
      const untaggedOnly = url.searchParams.get("untagged") === "1" || url.searchParams.get("untagged") === "true";
      const gender = url.searchParams.get("gender") || "";
      const project = loadProject(projectId);
      if (!project) {
        sendJson(res, 404, { detail: "Model project not found" });
        return true;
      }
      const models = db.prepare("SELECT * FROM model_entries WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC").all(projectId)
        .map(modelWithCoverAndTags)
        .filter((model) => (gender ? model.gender === gender : true));
      const filtered = untaggedOnly
        ? models.filter((model) => !model.tags.length)
        : includeTagNames.length || excludeTagNames.length
        ? models.filter((model) => entryMatchesTagFilter(model, includeTagNames, excludeTagNames))
        : models;
      sendJson(res, 200, { models: filtered });
      return true;
    }
    if (tail === "models" && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const parsedBody = parseRequest(libraryCreateModelPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const project = loadProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Model project not found" });
          const timestamp = nowIso();
          const code = nextCode(projectId, project.name);
          const id = newId("model");
          const name = validateFileNamePart(data.name || DEFAULT_MODEL_NAME, "model name");
          if (modelNameExists(projectId, name)) return sendJson(res, 400, { detail: "Model name must be unique within the project" });
          const model = runDbTransaction(() => {
            db.prepare(
              "INSERT INTO model_entries (id, project_id, name, code, gender, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).run(id, projectId, name, code, data.gender, timestamp, timestamp);
            db.prepare("UPDATE model_projects SET updated_at = ? WHERE id = ?").run(timestamp, projectId);
            return modelWithCoverAndTags(loadModel(id));
          });
          sendJson(res, 200, model);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
  }

  const modelMatch = pathname.match(/^\/api\/models\/([^/]+)(?:\/(images|images\/upload))?$/);
  if (modelMatch) {
    const modelId = decodeURIComponent(modelMatch[1]);
    const tail = modelMatch[2] || "";
    if (tail === "" && method === "PATCH") {
      parseJsonBody(req)
        .then((payload) => {
          const parsedBody = parseRequest(libraryUpdateModelPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const model = loadModel(modelId);
          if (!model) return sendJson(res, 404, { detail: "Model not found" });
          const nextModel = runDbTransaction(() => {
            if (data.name !== undefined) {
              const nextName = validateFileNamePart(data.name || DEFAULT_MODEL_NAME, "model name");
              if (modelNameExists(model.project_id, nextName, modelId)) throw new Error("Model name must be unique within the project");
              if (nextName !== model.name) {
                renameModelFolderAndImages(model, nextName);
                db.prepare("UPDATE model_entries SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), modelId);
              }
            }
            if (data.tags !== undefined) {
              updateEntryTags("model", modelId, model.project_id, data.tags);
            }
            if (data.cover_image_id !== undefined) {
              const coverImageId = data.cover_image_id;
              if (coverImageId) {
                const image = db.prepare("SELECT id FROM model_images WHERE id = ? AND model_id = ?").get(coverImageId, modelId);
                if (!image) throw new Error("Model image not found");
              }
              db.prepare("UPDATE model_entries SET cover_image_id = ?, updated_at = ? WHERE id = ?").run(coverImageId, nowIso(), modelId);
            }
            return modelWithCoverAndTags(loadModel(modelId));
          });
          sendJson(res, 200, nextModel);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "" && method === "DELETE") {
      const model = loadModel(modelId);
      if (!model) {
        sendJson(res, 404, { detail: "Model not found" });
        return true;
      }
      const project = loadProject(model.project_id);
      const modelDir = project ? modelDirForNames(project.name, model.name) : "";
      const imageRows = db.prepare("SELECT asset_id FROM model_images WHERE model_id = ?").all(modelId);
      runDbTransaction(() => {
        db.prepare("DELETE FROM library_entry_tags WHERE kind = 'model' AND entry_id = ?").run(modelId);
        db.prepare("DELETE FROM model_entries WHERE id = ?").run(modelId);
        for (const row of imageRows) removeAssetIfUnused(row.asset_id);
      });
      if (modelDir) removeDirectoryInside(modelLibraryRoot(), modelDir, "model library");
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (tail === "images" && method === "GET") {
      const model = loadModel(modelId);
      if (!model) {
        sendJson(res, 404, { detail: "Model not found" });
        return true;
      }
      const images = db.prepare(
        `
        SELECT mi.*, a.path AS asset_path
        FROM model_images mi
        LEFT JOIN assets a ON a.id = mi.asset_id
        WHERE mi.model_id = ?
        ORDER BY mi.sort_order ASC, mi.created_at ASC
        `
      ).all(modelId).map((image) => ({
        ...image,
        asset_url: image.asset_id ? assetUrl(image.asset_id) : null,
        thumbnail_url: image.asset_id ? assetThumbnailUrl(image.asset_id) : null,
      }));
      sendJson(res, 200, { images });
      return true;
    }
    if (tail === "images" && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const parsedBody = parseRequest(libraryAddModelImagePayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const model = loadModel(modelId);
          if (!model) return sendJson(res, 404, { detail: "Model not found" });
          const asset = loadAsset(data.asset_id);
          if (!asset) return sendJson(res, 404, { detail: "Asset not found" });
          const timestamp = nowIso();
          const imageId = newId("image");
          const sortOrder = data.sort_order === undefined ? 0 : data.sort_order;
          const image = runDbTransaction(() => {
            db.prepare(
              "INSERT INTO model_images (id, model_id, asset_id, caption, sort_order, created_at, mime_type, filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            ).run(imageId, modelId, asset.id, data.caption || "", sortOrder, timestamp, asset.mime_type, asset.filename);
            return {
              id: imageId,
              model_id: modelId,
              asset_id: asset.id,
              asset_url: assetUrl(asset.id),
              thumbnail_url: assetThumbnailUrl(asset.id),
              caption: data.caption || "",
              sort_order: sortOrder,
              created_at: timestamp,
              mime_type: asset.mime_type,
              filename: asset.filename,
            };
          });
          sendJson(res, 200, image);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "images/upload" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const data = parsedBody.value;
          const model = loadModel(modelId);
          if (!model) return sendJson(res, 404, { detail: "Model not found" });
          const decoded = parseDataUrl(`data:${data.mime_type};base64,${data.data}`);
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const project = loadProject(model.project_id);
          if (!project) return sendJson(res, 404, { detail: "Model project not found" });
          const modelName = folderName(model.name, "model name");
          const relDir = path.relative(STORAGE_ROOT, modelDirForNames(project.name, model.name));
          const sortOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM model_images WHERE model_id = ?").get(modelId)?.next || 0;
          const timestamp = nowIso();
          const imageId = newId("image");
          const result = await writeAssetInTransaction(
            decoded.buffer,
            decoded.mimeType,
            data.filename,
            {
              source: "model-library",
              subdir: relDir,
              filenameStem: `${modelName}_${String(Number(sortOrder) + 1).padStart(3, "0")}`,
            },
            (asset) => {
              db.prepare(
                "INSERT INTO model_images (id, model_id, asset_id, caption, sort_order, created_at, mime_type, filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
              ).run(imageId, modelId, asset.id, "", Number(sortOrder), timestamp, asset.mime_type, asset.filename);
              db.prepare("UPDATE model_entries SET updated_at = ? WHERE id = ?").run(timestamp, modelId);
              return {
                image: {
                  id: imageId,
                  model_id: modelId,
                  asset_id: asset.id,
                  asset_url: assetUrl(asset.id),
                  thumbnail_url: assetThumbnailUrl(asset.id),
                  caption: "",
                  sort_order: Number(sortOrder),
                  created_at: timestamp,
                  mime_type: asset.mime_type,
                  filename: asset.filename,
                },
                asset: { id: asset.id },
              };
            }
          );
          sendJson(res, 200, result);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
  }

  const imageMatch = pathname.match(/^\/api\/model-images\/([^/]+)$/);
  if (imageMatch && method === "DELETE") {
    const imageId = decodeURIComponent(imageMatch[1]);
    const image = db.prepare("SELECT * FROM model_images WHERE id = ?").get(imageId);
    if (!image) {
      sendJson(res, 404, { detail: "Model image not found" });
      return true;
    }
    runDbTransaction(() => {
      db.prepare("UPDATE model_entries SET cover_image_id = NULL WHERE cover_image_id = ?").run(imageId);
      db.prepare("DELETE FROM model_images WHERE id = ?").run(imageId);
      removeAssetIfUnused(image.asset_id);
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  const tagMatch = pathname.match(/^\/api\/libraries\/model\/tags(?:\/([^/]+))?$/);
  if (tagMatch) {
    const tagId = tagMatch[1] ? decodeURIComponent(tagMatch[1]) : "";
    const projectId = url.searchParams.get("project_id") || "";
    if (handleProjectTagApi(req, res, { kind: "model", projectId, tagId })) return true;
  }

  if (pathname === "/api/libraries/model/entries/bulk" && method === "POST") {
    return handleBulkLibraryEntriesApi(req, res, "model");
  }

  const assetMatch = pathname.match(/^\/api\/assets\/([^/]+)\/(file|download)$/);
  if (assetMatch && (method === "GET" || method === "HEAD")) {
    const assetId = decodeURIComponent(assetMatch[1]);
    const disposition = assetMatch[2] === "download" ? "attachment" : "inline";
    const asset = loadAsset(assetId);
    if (!asset) {
      sendText(res, 404, "Asset not found");
      return true;
    }
    try {
      const data = readFileSync(assetAbsolutePath(asset.path));
      res.writeHead(200, withCorsHeaders({
        "content-type": asset.mime_type || "application/octet-stream",
        "content-disposition": `${disposition}; filename="${encodeURIComponent(asset.filename)}"`,
      }));
      res.end(method === "HEAD" ? undefined : data);
    } catch (error) {
      sendText(res, 404, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const assetThumbMatch = pathname.match(/^\/api\/assets\/([^/]+)\/thumb$/);
  if (assetThumbMatch && (method === "GET" || method === "HEAD")) {
    const assetId = decodeURIComponent(assetThumbMatch[1]);
    const asset = loadAsset(assetId);
    if (!asset) {
      sendText(res, 404, "Asset not found");
      return true;
    }
    const sourcePath = assetAbsolutePath(asset.path);
    ensureLibraryAssetThumbnail(actionImportRuntime(), asset, sourcePath)
      .then((thumbnail) => {
        const filePath = thumbnail?.filePath && existsSync(thumbnail.filePath) ? thumbnail.filePath : sourcePath;
        const contentType = thumbnail?.filePath && existsSync(thumbnail.filePath)
          ? "image/webp"
          : asset.mime_type || "application/octet-stream";
        try {
          const data = readFileSync(filePath);
          res.writeHead(200, withCorsHeaders({
            "content-type": contentType,
            "content-disposition": `inline; filename="${encodeURIComponent(path.basename(filePath))}"`,
          }));
          res.end(method === "HEAD" ? undefined : data);
        } catch (error) {
          sendText(res, 404, error instanceof Error ? error.message : String(error));
        }
      })
      .catch((error) => {
        console.warn(`[library-thumbnail] Failed to serve thumbnail for ${assetId}: ${error instanceof Error ? error.message : String(error)}`);
        try {
          const data = readFileSync(sourcePath);
          res.writeHead(200, withCorsHeaders({
            "content-type": asset.mime_type || "application/octet-stream",
            "content-disposition": `inline; filename="${encodeURIComponent(asset.filename)}"`,
          }));
          res.end(method === "HEAD" ? undefined : data);
        } catch (readError) {
          sendText(res, 404, readError instanceof Error ? readError.message : String(readError));
        }
      });
    return true;
  }

  return false;
}

const server = createServer((req, res) => {
  if (String(req.method || "").toUpperCase() === "OPTIONS") {
    res.writeHead(204, withCorsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (handleAdminRoute(req, res, url)) return;
  if (handleCanvasExchangeRoute(req, res, url)) return;
  if (handleModelLibraryApi(req, res, url)) return;
  sendJson(res, 404, { detail: "API route not found" });
});

function localNetworkUrls() {
  const urls = [];
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === "IPv4" && !item.internal) {
        urls.push(`http://${item.address}:${SERVER_PORT}`);
      }
    }
  }
  return urls;
}

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Forart Server API port is already in use: http://127.0.0.1:${SERVER_PORT}`);
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
});

server.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`Forart Server API running at http://127.0.0.1:${SERVER_PORT}`);
  const urls = localNetworkUrls();
  if (urls.length) {
    console.log("LAN access:");
    for (const url of urls) console.log(`  ${url}`);
  }
});
