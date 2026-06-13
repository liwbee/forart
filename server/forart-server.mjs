import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const SERVER_PORT = Number(process.env.PORT || 5175);
const SERVER_HOST = process.env.HOST || "0.0.0.0";
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_ROOT = path.join(ROOT_DIR, ".forart-data");
const CONFIG_DIR = path.resolve(process.env.FORART_CONFIG_DIR || path.join(DEFAULT_DATA_ROOT, "config"));
const DEFAULT_DATA_DIR = path.resolve(process.env.FORART_DATA_DIR || path.join(DEFAULT_DATA_ROOT, "library"));
const REVIEW_DIR = path.resolve(process.env.FORART_REVIEW_DIR || path.join(DEFAULT_DATA_ROOT, "review"));
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const LEGACY_CONFIG_PATH = path.join(ROOT_DIR, "config.json");
const DATABASE_FILENAME = "forart-library.sqlite";
const DEFAULT_PROJECT_NAME = "Default Project";
const DEFAULT_MODEL_NAME = "Untitled Model";
const DEFAULT_TAG_COLOR = "#6b7280";
const DEFAULT_OUTFIT_PROJECT_NAME = "Default Outfit Project";
const DEFAULT_OUTFIT_NAME = "Untitled Outfit";
const DEFAULT_ACTION_PROJECT_NAME = "Default Action Project";
const DEFAULT_ACTION_NAME = "Untitled Action";
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
let DATABASE_PATH = path.join(CONFIG_DIR, DATABASE_FILENAME);
let STORAGE_ROOT = "";
let appConfig = readAppConfig();
let db;

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
    if (tags.length >= 12) break;
  }
  return tags;
}

function sanitizeGender(value) {
  return value === "female" || value === "male" ? value : "unknown";
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function readAppConfig() {
  try {
    ensureDir(CONFIG_DIR);
    const configPath = existsSync(CONFIG_PATH) ? CONFIG_PATH : LEGACY_CONFIG_PATH;
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAppConfig(nextConfig) {
  appConfig = { ...nextConfig };
  ensureDir(CONFIG_DIR);
  writeFileSync(CONFIG_PATH, `${JSON.stringify(appConfig, null, 2)}\n`, "utf8");
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
  ensureDir(CONFIG_DIR);
  DATA_DIR = ensureDataDirWritable(targetDir);
  DATABASE_PATH = path.join(CONFIG_DIR, DATABASE_FILENAME);
  STORAGE_ROOT = DATA_DIR;
  ensureDir(STORAGE_ROOT);
}

function storageSettingsPayload() {
  const configured = Boolean(db && DATA_DIR);
  return {
    configured,
    data_dir: configured ? DATA_DIR : "",
    database_path: configured ? DATABASE_PATH : "",
    library_dir: configured ? STORAGE_ROOT : "",
    config_path: CONFIG_PATH,
  };
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

const STATIC_MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

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

function initDatabase() {
  db = new DatabaseSync(DATABASE_PATH);
  db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS model_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    cover_asset_id TEXT,
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
    project_id TEXT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '${DEFAULT_TAG_COLOR}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(kind, name)
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
`);
  const actionColumns = db.prepare("PRAGMA table_info(action_entries)").all().map((column) => column.name);
  if (!actionColumns.includes("prompt")) {
    db.exec("ALTER TABLE action_entries ADD COLUMN prompt TEXT NOT NULL DEFAULT '';");
  }
  ensureDefaultProject();
  ensureDefaultOutfitProject();
  ensureDefaultActionProject();
}

function switchDataDir(nextDataDir, { persist = false } = {}) {
  const previousDb = db;
  if (previousDb) {
    previousDb.close();
    db = undefined;
  }
  try {
    applyDataDir(nextDataDir);
    initDatabase();
    if (persist) {
      writeAppConfig({ ...appConfig, modelLibraryDataDir: DATA_DIR });
    }
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
    "INSERT INTO model_projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(newId("project"), name, timestamp, timestamp);
}

function ensureDefaultOutfitProject() {
  const row = db.prepare("SELECT id FROM outfit_projects ORDER BY created_at ASC LIMIT 1").get();
  if (row) return;
  const timestamp = nowIso();
  const name = validateFileNamePart(DEFAULT_OUTFIT_PROJECT_NAME, "project name");
  db.prepare(
    "INSERT INTO outfit_projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(newId("outfit_project"), name, timestamp, timestamp);
}

function ensureDefaultActionProject() {
  const row = db.prepare("SELECT id FROM action_projects ORDER BY created_at ASC LIMIT 1").get();
  if (row) return;
  const timestamp = nowIso();
  const name = validateFileNamePart(DEFAULT_ACTION_PROJECT_NAME, "project name");
  db.prepare(
    "INSERT INTO action_projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(newId("action_project"), name, timestamp, timestamp);
}

switchDataDir(process.env.FORART_DATA_DIR || appConfig.modelLibraryDataDir || DEFAULT_DATA_DIR, {
  persist: !existsSync(CONFIG_PATH),
});

function ensureStorageConfigured(res) {
  if (db) return true;
  sendJson(res, 409, { detail: "Asset library storage is unavailable. Check FORART_DATA_DIR or default data directory permissions.", code: "MODEL_LIBRARY_STORAGE_NOT_CONFIGURED" });
  return false;
}

function assetUrl(assetId) {
  return assetId ? `/api/assets/${assetId}/file` : null;
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
  return path.join(STORAGE_ROOT, "Model Library");
}

function projectDirForName(projectName) {
  return path.join(modelLibraryRoot(), folderName(projectName, "project name"));
}

function modelDirForNames(projectName, modelName) {
  return path.join(projectDirForName(projectName), folderName(modelName, "model name"));
}

function outfitLibraryRoot() {
  return path.join(STORAGE_ROOT, "Outfit Library");
}

function outfitProjectDirForName(projectName) {
  return path.join(outfitLibraryRoot(), folderName(projectName, "project name"));
}

function actionLibraryRoot() {
  return path.join(STORAGE_ROOT, "Action Library");
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

const REVIEW_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);

function normalizeReviewFolderName(value) {
  return String(value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function parseReviewFolderNames(value) {
  return new Set(
    String(value || "")
      .split(/[,，、\n]/)
      .map(normalizeReviewFolderName)
      .filter(Boolean)
  );
}

function reviewRoot() {
  ensureDir(REVIEW_DIR);
  return path.resolve(REVIEW_DIR);
}

function reviewDirectoryPath(relativePath = "") {
  const root = reviewRoot();
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const absolute = path.resolve(root, ...normalized.split("/").filter(Boolean));
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid review path");
  }
  return absolute;
}

function selectedReviewRootPath(selectedRoot = "") {
  if (!String(selectedRoot || "").trim()) throw new Error("Review root is required");
  return reviewDirectoryPath(selectedRoot);
}

function reviewAbsolutePath(relativePath = "", selectedRoot = "") {
  const root = selectedRoot ? selectedReviewRoot(selectedRoot) : reviewRoot();
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const absolute = path.resolve(root, ...normalized.split("/").filter(Boolean));
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid review path");
  }
  return absolute;
}

function selectedReviewRoot(selectedRoot = "") {
  const absolute = selectedReviewRootPath(selectedRoot);
  if (!existsSync(absolute)) throw new Error("Review root not found");
  if (!statSync(absolute).isDirectory()) throw new Error("Review root is not a directory");
  return absolute;
}

function reviewRelativePath(absolutePath, selectedRoot = "") {
  return path.relative(selectedReviewRoot(selectedRoot), absolutePath).split(path.sep).join("/");
}

function reviewRootOptions() {
  const root = reviewRoot();
  return listReviewDirectories(root).map((name) => ({ name, path: name }));
}

function reviewDirectoryListing(relativePath = "") {
  const absolute = reviewDirectoryPath(relativePath);
  if (!existsSync(absolute)) throw new Error("Review directory not found");
  if (!statSync(absolute).isDirectory()) throw new Error("Review path is not a directory");
  const normalizedPath = reviewRelativeFromRoot(absolute);
  return {
    review_dir: reviewRoot(),
    path: normalizedPath,
    parent_path: normalizedPath ? reviewRelativeFromRoot(path.dirname(absolute)) : "",
    directories: listReviewDirectories(absolute).map((name) => ({
      name,
      path: [normalizedPath, name].filter(Boolean).join("/"),
    })),
  };
}

function reviewRelativeFromRoot(absolutePath) {
  return path.relative(reviewRoot(), absolutePath).split(path.sep).filter(Boolean).join("/");
}

function isReviewImageFile(filePath) {
  return REVIEW_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function listReviewDirectories(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  } catch {
    return [];
  }
}

function hasReviewImageInDirectory(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isFile() && isReviewImageFile(path.join(dir, entry.name)));
  } catch {
    return false;
  }
}

function productHasModelImages(productDir, modelFolderValue) {
  const modelFolders = parseReviewFolderNames(modelFolderValue);
  if (!modelFolders.size) return false;
  for (const folderName of listReviewDirectories(productDir)) {
    if (modelFolders.has(normalizeReviewFolderName(folderName)) && hasReviewImageInDirectory(path.join(productDir, folderName))) return true;
  }
  return false;
}

function collectReviewImages(dir, selectedRoot = "") {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isReviewImageFile(path.join(dir, entry.name)))
      .map((entry) => {
        const absolutePath = path.join(dir, entry.name);
        const stats = statSync(absolutePath);
        const relativePath = reviewRelativePath(absolutePath, selectedRoot);
        const rootQuery = selectedRoot ? `&root=${encodeURIComponent(selectedRoot)}` : "";
        return {
          id: `${relativePath}-${stats.mtimeMs}-${stats.size}`,
          name: entry.name,
          relativePath,
          url: `/api/review/images?path=${encodeURIComponent(relativePath)}${rootQuery}`,
          size: stats.size,
          lastModified: Math.round(stats.mtimeMs),
        };
      })
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: "base" }));
  } catch {
    return [];
  }
}

function loadReviewProducts(modelFolderValue, selectedRoot = "") {
  const root = selectedReviewRoot(selectedRoot);
  return listReviewDirectories(root).map((productId) => {
    const productDir = path.join(root, productId);
    return {
      id: productId,
      hasModelImages: productHasModelImages(productDir, modelFolderValue),
      modelImages: [],
      detailImages: [],
      unknownImages: [],
    };
  });
}

function loadReviewProductImages(productId, modelFolderValue, detailFolderValue, selectedRoot = "") {
  const productDir = reviewAbsolutePath(productId, selectedRoot);
  if (!existsSync(productDir) || !statSync(productDir).isDirectory()) throw new Error("Product not found");
  const modelFolders = parseReviewFolderNames(modelFolderValue);
  const detailFolders = parseReviewFolderNames(detailFolderValue);
  const product = {
    id: productId,
    hasModelImages: false,
    modelImages: [],
    detailImages: [],
    unknownImages: [],
  };

  for (const folderName of listReviewDirectories(productDir)) {
    const images = collectReviewImages(path.join(productDir, folderName), selectedRoot);
    const normalized = normalizeReviewFolderName(folderName);
    if (modelFolders.has(normalized)) product.modelImages.push(...images);
    else if (detailFolders.has(normalized)) product.detailImages.push(...images);
    else product.unknownImages.push(...images);
  }

  product.modelImages.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: "base" }));
  product.detailImages.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: "base" }));
  product.unknownImages.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: "base" }));
  product.hasModelImages = product.modelImages.length > 0;
  return product;
}

function reviewIssuePath(selectedRoot = "") {
  return path.join(selectedReviewRoot(selectedRoot), "error.txt");
}

function readReviewIssueText(selectedRoot = "") {
  try {
    return readFileSync(reviewIssuePath(selectedRoot), "utf8");
  } catch {
    return "";
  }
}

function findReviewIssue(imagePath, selectedRoot = "") {
  const normalizedPath = String(imagePath || "").trim();
  if (!normalizedPath) return "";
  const name = path.basename(normalizedPath);
  const line = readReviewIssueText(selectedRoot)
    .split(/\r?\n/)
    .find((item) => item.startsWith(`${normalizedPath}  `) || item.startsWith(`${name}  `));
  if (!line) return "";
  return line.startsWith(`${normalizedPath}  `) ? line.slice(normalizedPath.length).trim() : line.slice(name.length).trim();
}

function saveReviewIssue(imagePath, issue, selectedRoot = "") {
  const normalizedPath = String(imagePath || "").trim();
  const nextIssue = String(issue || "").trim();
  if (!normalizedPath) throw new Error("Image path is required");
  if (!nextIssue) throw new Error("Issue is required");
  reviewAbsolutePath(normalizedPath, selectedRoot);
  const nextLine = `${normalizedPath}  ${nextIssue}`;
  const lines = readReviewIssueText(selectedRoot)
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith(`${normalizedPath}  `) && !line.startsWith(`${path.basename(normalizedPath)}  `));
  lines.push(nextLine);
  writeFileSync(reviewIssuePath(selectedRoot), `${lines.join("\n")}\n`, "utf8");
}

function handleReviewApi(req, res, url) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/review/status") {
    sendJson(res, 200, { configured: existsSync(reviewRoot()), review_dir: reviewRoot(), roots: reviewRootOptions() });
    return true;
  }

  if (method === "GET" && pathname === "/api/review/roots") {
    sendJson(res, 200, { review_dir: reviewRoot(), roots: reviewRootOptions() });
    return true;
  }

  if (method === "GET" && pathname === "/api/review/directories") {
    try {
      sendJson(res, 200, reviewDirectoryListing(url.searchParams.get("path") || ""));
    } catch (error) {
      sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (method === "GET" && pathname === "/api/review/products") {
    const selectedRoot = url.searchParams.get("root") || "";
    try {
      sendJson(res, 200, {
        review_dir: reviewRoot(),
        root: selectedRoot,
        products: loadReviewProducts(url.searchParams.get("model_folders") || "", selectedRoot),
      });
    } catch (error) {
      sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const productImagesMatch = pathname.match(/^\/api\/review\/products\/([^/]+)\/images$/);
  if (method === "GET" && productImagesMatch) {
    try {
      const product = loadReviewProductImages(
        decodeURIComponent(productImagesMatch[1]),
        url.searchParams.get("model_folders") || "",
        url.searchParams.get("detail_folders") || "",
        url.searchParams.get("root") || ""
      );
      sendJson(res, 200, { product });
    } catch (error) {
      sendJson(res, 404, { detail: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if ((method === "GET" || method === "HEAD") && pathname === "/api/review/images") {
    try {
      const imagePath = url.searchParams.get("path") || "";
      const absolutePath = reviewAbsolutePath(imagePath, url.searchParams.get("root") || "");
      if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) return sendText(res, 404, "Image not found");
      const contentType = STATIC_MIME_TYPES[path.extname(absolutePath).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, withCorsHeaders({ "content-type": contentType }));
      res.end(method === "HEAD" ? undefined : readFileSync(absolutePath));
    } catch (error) {
      sendText(res, 400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  if (pathname === "/api/review/issues") {
    if (method === "GET") {
      try {
        sendJson(res, 200, { issue: findReviewIssue(url.searchParams.get("path") || "", url.searchParams.get("root") || "") });
      } catch (error) {
        sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }
    if (method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          saveReviewIssue(payload?.path, payload?.issue, payload?.root || "");
          sendJson(res, 200, { ok: true });
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
  }

  return false;
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
  const actions = db.prepare(
    `
    SELECT ae.*, a.path AS asset_path, a.filename AS asset_filename, a.mime_type AS asset_mime_type
    FROM action_entries ae
    LEFT JOIN assets a ON a.id = ae.asset_id
    WHERE ae.project_id = ?
    ORDER BY ae.created_at ASC
    `
  ).all(project.id);
  for (const action of actions) {
    const nextActionName = nextActionNameForIndex(nextName, actions.indexOf(action) + 1);
    const assetPath = assetAbsolutePath(action.asset_path || "");
    const suffix = path.extname(assetPath || action.asset_filename || "") || guessSuffix(action.asset_filename || "", action.asset_mime_type || "");
    const nextPath = path.join(nextDir, `${nextActionName}${suffix}`);
    const currentPath = assetPath && existsSync(assetPath) ? assetPath : replacePathPrefix(assetPath || "", oldDir, nextDir);
    ensureDir(nextDir);
    if (currentPath && existsSync(currentPath) && path.resolve(currentPath) !== path.resolve(nextPath)) {
      if (existsSync(nextPath)) throw new Error(`Image file already exists: ${path.basename(nextPath)}`);
      renameSync(currentPath, nextPath);
    }
    db.prepare("UPDATE assets SET filename = ?, path = ? WHERE id = ?").run(path.basename(nextPath), assetRelativePath(nextPath), action.asset_id);
    db.prepare("UPDATE action_entries SET name = ?, updated_at = ? WHERE id = ?").run(nextActionName, nowIso(), action.id);
  }
  const coverAssetRows = db.prepare("SELECT cover_asset_id AS asset_id FROM action_projects WHERE id = ?").all(project.id);
  for (const row of coverAssetRows) {
    const asset = row.asset_id ? loadAsset(row.asset_id) : null;
    if (asset?.path) {
      db.prepare("UPDATE assets SET path = ? WHERE id = ?").run(assetRelativePath(replacePathPrefix(asset.path, oldDir, nextDir)), asset.id);
    }
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
  };
}

function outfitWithAssetAndTags(outfit) {
  return {
    ...outfit,
    tags: tagsForOutfit(outfit.id),
    asset_url: assetUrl(outfit.asset_id || null),
  };
}

function actionWithAssetAndTags(action) {
  return {
    ...action,
    tags: tagsForAction(action.id),
    asset_url: assetUrl(action.asset_id || null),
  };
}

function projectWithCover(project) {
  return {
    ...project,
    cover_url: assetUrl(project.cover_asset_id || null),
  };
}

function tagUsage(tagId) {
  return db.prepare("SELECT COUNT(*) AS total FROM library_entry_tags WHERE tag_id = ?").get(tagId)?.total || 0;
}

function listTags() {
  return db.prepare(
    `
    SELECT *
    FROM library_tags
    WHERE kind = 'model'
    ORDER BY sort_order ASC, name ASC
    `
  ).all().map((tag) => ({
    ...tag,
    usage_count: tagUsage(tag.id),
  }));
}

function listOutfitTags() {
  return db.prepare(
    `
    SELECT *
    FROM library_tags
    WHERE kind = 'outfit'
    ORDER BY sort_order ASC, name ASC
    `
  ).all().map((tag) => ({
    ...tag,
    usage_count: tagUsage(tag.id),
  }));
}

function listActionTags() {
  return db.prepare(
    `
    SELECT *
    FROM library_tags
    WHERE kind = 'action'
    ORDER BY sort_order ASC, name ASC
    `
  ).all().map((tag) => ({
    ...tag,
    usage_count: tagUsage(tag.id),
  }));
}

function nextOutfitNameForIndex(projectName, index) {
  return `${folderName(projectName, "project name")}_${String(index).padStart(3, "0")}`;
}

function nextActionNameForIndex(projectName, index) {
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

function nextActionName(projectId, projectName) {
  const prefix = `${folderName(projectName, "project name")}_`;
  const rows = db.prepare("SELECT name FROM action_entries WHERE project_id = ?").all(projectId);
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  let max = 0;
  for (const row of rows) {
    const match = pattern.exec(String(row.name || ""));
    if (match) max = Math.max(max, Number.parseInt(match[1], 10) || 0);
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
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

function writeAsset(content, mimeType, originalFilename, { source, subdir, filenameStem }) {
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
  const dims = imageDimensions(content, mimeType);
  const timestamp = nowIso();
  db.prepare(
    `
    INSERT INTO assets (id, filename, path, mime_type, width, height, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(assetId, path.basename(targetPath), assetRelativePath(targetPath), mimeType, dims.width, dims.height, source, timestamp);
  return db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId);
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
    sendJson(res, 200, {
      ok: true,
      storage_configured: Boolean(db && DATA_DIR),
      data_dir: DATA_DIR,
      config_path: CONFIG_PATH,
    });
    return true;
  }

  if (pathname === "/api/settings/storage") {
    if (method === "GET") {
      sendJson(res, 200, storageSettingsPayload());
      return true;
    }
    if (method === "PATCH") {
      parseJsonBody(req)
        .then((payload) => {
          const nextDir = String(payload?.data_dir || "").trim();
          if (!nextDir) return sendJson(res, 400, { detail: "Save path is required" });
          switchDataDir(nextDir, { persist: true });
          sendJson(res, 200, storageSettingsPayload());
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
  }

  if (!ensureStorageConfigured(res)) return true;

  if (method === "GET" && pathname === "/api/outfit-projects") {
    const projects = db.prepare("SELECT * FROM outfit_projects ORDER BY updated_at DESC, created_at DESC").all().map(projectWithCover);
    sendJson(res, 200, { projects });
    return true;
  }

  if (method === "POST" && pathname === "/api/outfit-projects") {
    parseJsonBody(req)
      .then((payload) => {
        const timestamp = nowIso();
        const id = newId("outfit_project");
        const name = validateFileNamePart(payload?.name || DEFAULT_OUTFIT_PROJECT_NAME, "project name");
        if (outfitProjectNameExists(name)) return sendJson(res, 400, { detail: "Project name must be unique" });
        db.prepare(
          "INSERT INTO outfit_projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
        ).run(id, name, timestamp, timestamp);
        sendJson(res, 200, projectWithCover(loadOutfitProject(id)));
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
        .then((payload) => {
          const data = payload || {};
          const project = loadOutfitProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Outfit project not found" });
          if (data.name !== undefined) {
            const nextName = validateFileNamePart(data.name || DEFAULT_OUTFIT_PROJECT_NAME, "project name");
            if (outfitProjectNameExists(nextName, projectId)) return sendJson(res, 400, { detail: "Project name must be unique" });
            if (nextName !== project.name) {
              renameOutfitProjectFolder(project, nextName);
              db.prepare("UPDATE outfit_projects SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), projectId);
            }
          }
          if (data.cover_asset_id !== undefined) {
            const coverAssetId = data.cover_asset_id ? String(data.cover_asset_id) : null;
            if (coverAssetId && !loadAsset(coverAssetId)) return sendJson(res, 404, { detail: "Asset not found" });
            db.prepare("UPDATE outfit_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(coverAssetId, nowIso(), projectId);
          }
          sendJson(res, 200, projectWithCover(loadOutfitProject(projectId)));
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
      const assetRows = db.prepare("SELECT asset_id FROM outfit_entries WHERE project_id = ?").all(projectId);
      const coverAssetRows = db.prepare("SELECT cover_asset_id AS asset_id FROM outfit_projects WHERE id = ?").all(projectId);
      db.prepare("DELETE FROM outfit_projects WHERE id = ?").run(projectId);
      for (const row of assetRows) removeAssetIfUnused(row.asset_id);
      for (const row of coverAssetRows) removeAssetIfUnused(row.asset_id);
      ensureDefaultOutfitProject();
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (tail === "cover/upload" && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const project = loadOutfitProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Outfit project not found" });
          const decoded = parseDataUrl(payload?.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const relDir = path.relative(STORAGE_ROOT, path.join(outfitProjectDirForName(project.name), "__project_cover__"));
          const asset = writeAsset(decoded.buffer, decoded.mimeType, payload?.filename || "image", {
            source: "outfit-project-cover",
            subdir: relDir,
            filenameStem: "cover",
          });
          db.prepare("UPDATE outfit_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, nowIso(), projectId);
          sendJson(res, 200, projectWithCover(loadOutfitProject(projectId)));
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "outfits" && method === "GET") {
      const tagId = url.searchParams.get("tag_id") || "";
      const project = loadOutfitProject(projectId);
      if (!project) {
        sendJson(res, 404, { detail: "Outfit project not found" });
        return true;
      }
      const outfits = db.prepare("SELECT * FROM outfit_entries WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC").all(projectId)
        .map(outfitWithAssetAndTags);
      const activeTag = tagId ? db.prepare("SELECT * FROM library_tags WHERE kind = 'outfit' AND id = ?").get(tagId) : null;
      const filtered = activeTag ? outfits.filter((outfit) => outfit.tags.includes(activeTag.name)) : outfits;
      sendJson(res, 200, { outfits: filtered });
      return true;
    }
    if (tail === "outfits" && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const project = loadOutfitProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Outfit project not found" });
          const decoded = parseDataUrl(payload?.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const timestamp = nowIso();
          const id = newId("outfit");
          const name = nextOutfitName(projectId, project.name);
          if (outfitNameExists(projectId, name)) return sendJson(res, 400, { detail: "Outfit name must be unique" });
          const relDir = path.relative(STORAGE_ROOT, outfitProjectDirForName(project.name));
          const asset = writeAsset(decoded.buffer, decoded.mimeType, payload?.filename || "image", {
            source: "outfit-library",
            subdir: relDir,
            filenameStem: name,
          });
          db.prepare(
            "INSERT INTO outfit_entries (id, project_id, name, asset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
          ).run(id, projectId, name, asset.id, timestamp, timestamp);
          db.prepare("UPDATE outfit_projects SET cover_asset_id = COALESCE(cover_asset_id, ?), updated_at = ? WHERE id = ?").run(asset.id, timestamp, projectId);
          sendJson(res, 200, outfitWithAssetAndTags(loadOutfit(id)));
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
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
          const outfit = loadOutfit(outfitId);
          if (!outfit) return sendJson(res, 404, { detail: "Outfit not found" });
          if (payload.tags !== undefined) {
            const nextTags = normalizeTags(payload.tags);
            db.prepare("DELETE FROM library_entry_tags WHERE kind = 'outfit' AND entry_id = ?").run(outfitId);
            for (const name of nextTags) {
              let tag = db.prepare("SELECT * FROM library_tags WHERE kind = 'outfit' AND name = ?").get(name);
              if (!tag) {
                const tagId = newId("tag");
                db.prepare(
                  "INSERT INTO library_tags (id, kind, project_id, name, color, sort_order, created_at, updated_at) VALUES (?, 'outfit', NULL, ?, ?, ?, ?, ?)"
                ).run(tagId, name, DEFAULT_TAG_COLOR, 0, nowIso(), nowIso());
                tag = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(tagId);
              }
              db.prepare(
                "INSERT OR IGNORE INTO library_entry_tags (id, kind, entry_id, tag_id, created_at) VALUES (?, 'outfit', ?, ?, ?)"
              ).run(newId("entrytag"), outfitId, tag.id, nowIso());
            }
            db.prepare("UPDATE outfit_entries SET updated_at = ? WHERE id = ?").run(nowIso(), outfitId);
          }
          sendJson(res, 200, outfitWithAssetAndTags(loadOutfit(outfitId)));
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
      db.prepare("DELETE FROM library_entry_tags WHERE kind = 'outfit' AND entry_id = ?").run(outfitId);
      db.prepare("UPDATE outfit_projects SET cover_asset_id = NULL WHERE cover_asset_id = ?").run(outfit.asset_id);
      db.prepare("DELETE FROM outfit_entries WHERE id = ?").run(outfitId);
      removeAssetIfUnused(outfit.asset_id);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (isImageUpload && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const outfit = loadOutfit(outfitId);
          if (!outfit) return sendJson(res, 404, { detail: "Outfit not found" });
          const project = loadOutfitProject(outfit.project_id);
          if (!project) return sendJson(res, 404, { detail: "Outfit project not found" });
          const decoded = parseDataUrl(payload?.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const previousAssetId = outfit.asset_id;
          const relDir = path.relative(STORAGE_ROOT, outfitProjectDirForName(project.name));
          const asset = writeAsset(decoded.buffer, decoded.mimeType, payload?.filename || "image", {
            source: "outfit-library",
            subdir: relDir,
            filenameStem: outfit.name || DEFAULT_OUTFIT_NAME,
          });
          const timestamp = nowIso();
          db.prepare("UPDATE outfit_entries SET asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, timestamp, outfitId);
          db.prepare("UPDATE outfit_projects SET cover_asset_id = CASE WHEN cover_asset_id = ? THEN ? ELSE cover_asset_id END, updated_at = ? WHERE id = ?")
            .run(previousAssetId, asset.id, timestamp, project.id);
          removeAssetIfUnused(previousAssetId);
          sendJson(res, 200, outfitWithAssetAndTags(loadOutfit(outfitId)));
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
  }

  const outfitTagMatch = pathname.match(/^\/api\/libraries\/outfit\/tags(?:\/([^/]+))?$/);
  if (outfitTagMatch) {
    const tagId = outfitTagMatch[1] ? decodeURIComponent(outfitTagMatch[1]) : "";
    if (method === "GET" && !tagId) {
      sendJson(res, 200, { tags: listOutfitTags() });
      return true;
    }
    if (method === "POST" && !tagId) {
      parseJsonBody(req)
        .then((payload) => {
          const name = String(payload?.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
          if (!name) return sendJson(res, 400, { detail: "Tag name is required" });
          const existing = db.prepare("SELECT * FROM library_tags WHERE kind = 'outfit' AND name = ?").get(name);
          if (existing) return sendJson(res, 200, { ...existing, usage_count: tagUsage(existing.id) });
          const timestamp = nowIso();
          const id = newId("tag");
          db.prepare(
            "INSERT INTO library_tags (id, kind, project_id, name, color, sort_order, created_at, updated_at) VALUES (?, 'outfit', NULL, ?, ?, ?, ?, ?)"
          ).run(id, name, DEFAULT_TAG_COLOR, db.prepare("SELECT COUNT(*) AS total FROM library_tags WHERE kind = 'outfit'").get().total + 1, timestamp, timestamp);
          const tag = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(id);
          sendJson(res, 200, { ...tag, usage_count: 0 });
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (method === "PATCH" && tagId) {
      parseJsonBody(req)
        .then((payload) => {
          const tag = db.prepare("SELECT * FROM library_tags WHERE id = ? AND kind = 'outfit'").get(tagId);
          if (!tag) return sendJson(res, 404, { detail: "Tag not found" });
          if (payload.name !== undefined) {
            const nextName = String(payload.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
            if (!nextName) return sendJson(res, 400, { detail: "Tag name is required" });
            const exists = db.prepare("SELECT id FROM library_tags WHERE kind = 'outfit' AND name = ? AND id <> ?").get(nextName, tagId);
            if (exists) return sendJson(res, 400, { detail: "Tag already exists" });
            db.prepare("UPDATE library_tags SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), tagId);
          }
          if (payload.sort_order !== undefined) {
            db.prepare("UPDATE library_tags SET sort_order = ?, updated_at = ? WHERE id = ?").run(Number(payload.sort_order || 0), nowIso(), tagId);
          }
          const next = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(tagId);
          sendJson(res, 200, { ...next, usage_count: tagUsage(tagId) });
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (method === "DELETE" && tagId) {
      const tag = db.prepare("SELECT * FROM library_tags WHERE id = ? AND kind = 'outfit'").get(tagId);
      if (!tag) {
        sendJson(res, 200, { ok: true });
        return true;
      }
      db.prepare("DELETE FROM library_entry_tags WHERE tag_id = ?").run(tagId);
      db.prepare("DELETE FROM library_tags WHERE id = ?").run(tagId);
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  if (method === "GET" && pathname === "/api/action-projects") {
    const projects = db.prepare("SELECT * FROM action_projects ORDER BY updated_at DESC, created_at DESC").all().map(projectWithCover);
    sendJson(res, 200, { projects });
    return true;
  }

  if (method === "POST" && pathname === "/api/action-projects") {
    parseJsonBody(req)
      .then((payload) => {
        const timestamp = nowIso();
        const id = newId("action_project");
        const name = validateFileNamePart(payload?.name || DEFAULT_ACTION_PROJECT_NAME, "project name");
        if (actionProjectNameExists(name)) return sendJson(res, 400, { detail: "Project name must be unique" });
        db.prepare(
          "INSERT INTO action_projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
        ).run(id, name, timestamp, timestamp);
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
          const data = payload || {};
          const project = loadActionProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Action project not found" });
          if (data.name !== undefined) {
            const nextName = validateFileNamePart(data.name || DEFAULT_ACTION_PROJECT_NAME, "project name");
            if (actionProjectNameExists(nextName, projectId)) return sendJson(res, 400, { detail: "Project name must be unique" });
            if (nextName !== project.name) {
              renameActionProjectFolder(project, nextName);
              db.prepare("UPDATE action_projects SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), projectId);
            }
          }
          if (data.cover_asset_id !== undefined) {
            const coverAssetId = data.cover_asset_id ? String(data.cover_asset_id) : null;
            if (coverAssetId && !loadAsset(coverAssetId)) return sendJson(res, 404, { detail: "Asset not found" });
            db.prepare("UPDATE action_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(coverAssetId, nowIso(), projectId);
          }
          sendJson(res, 200, projectWithCover(loadActionProject(projectId)));
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
      const assetRows = db.prepare("SELECT asset_id FROM action_entries WHERE project_id = ?").all(projectId);
      const coverAssetRows = db.prepare("SELECT cover_asset_id AS asset_id FROM action_projects WHERE id = ?").all(projectId);
      db.prepare("DELETE FROM action_projects WHERE id = ?").run(projectId);
      for (const row of assetRows) removeAssetIfUnused(row.asset_id);
      for (const row of coverAssetRows) removeAssetIfUnused(row.asset_id);
      ensureDefaultActionProject();
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (tail === "cover/upload" && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const project = loadActionProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Action project not found" });
          const decoded = parseDataUrl(payload?.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const relDir = path.relative(STORAGE_ROOT, path.join(actionProjectDirForName(project.name), "__project_cover__"));
          const asset = writeAsset(decoded.buffer, decoded.mimeType, payload?.filename || "image", {
            source: "action-project-cover",
            subdir: relDir,
            filenameStem: "cover",
          });
          db.prepare("UPDATE action_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, nowIso(), projectId);
          sendJson(res, 200, projectWithCover(loadActionProject(projectId)));
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "actions" && method === "GET") {
      const tagId = url.searchParams.get("tag_id") || "";
      const project = loadActionProject(projectId);
      if (!project) {
        sendJson(res, 404, { detail: "Action project not found" });
        return true;
      }
      const actions = db.prepare("SELECT * FROM action_entries WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC").all(projectId)
        .map(actionWithAssetAndTags);
      const activeTag = tagId ? db.prepare("SELECT * FROM library_tags WHERE kind = 'action' AND id = ?").get(tagId) : null;
      const filtered = activeTag ? actions.filter((action) => action.tags.includes(activeTag.name)) : actions;
      sendJson(res, 200, { actions: filtered });
      return true;
    }
    if (tail === "actions" && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const project = loadActionProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Action project not found" });
          const decoded = parseDataUrl(payload?.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const timestamp = nowIso();
          const id = newId("action");
          const name = nextActionName(projectId, project.name);
          if (actionNameExists(projectId, name)) return sendJson(res, 400, { detail: "Action name must be unique" });
          const relDir = path.relative(STORAGE_ROOT, actionProjectDirForName(project.name));
          const asset = writeAsset(decoded.buffer, decoded.mimeType, payload?.filename || "image", {
            source: "action-library",
            subdir: relDir,
            filenameStem: name,
          });
          db.prepare(
            "INSERT INTO action_entries (id, project_id, name, asset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
          ).run(id, projectId, name, asset.id, timestamp, timestamp);
          db.prepare("UPDATE action_projects SET cover_asset_id = COALESCE(cover_asset_id, ?), updated_at = ? WHERE id = ?").run(asset.id, timestamp, projectId);
          sendJson(res, 200, actionWithAssetAndTags(loadAction(id)));
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
  }

  const actionMatch = pathname.match(/^\/api\/actions\/([^/]+)(?:\/image\/upload)?$/);
  if (actionMatch) {
    const actionId = decodeURIComponent(actionMatch[1]);
    const isImageUpload = pathname.endsWith("/image/upload");
    if (!isImageUpload && method === "PATCH") {
      parseJsonBody(req)
        .then((payload) => {
          const action = loadAction(actionId);
          if (!action) return sendJson(res, 404, { detail: "Action not found" });
          if (payload.tags !== undefined) {
            const nextTags = normalizeTags(payload.tags);
            db.prepare("DELETE FROM library_entry_tags WHERE kind = 'action' AND entry_id = ?").run(actionId);
            for (const name of nextTags) {
              let tag = db.prepare("SELECT * FROM library_tags WHERE kind = 'action' AND name = ?").get(name);
              if (!tag) {
                const tagId = newId("tag");
                db.prepare(
                  "INSERT INTO library_tags (id, kind, project_id, name, color, sort_order, created_at, updated_at) VALUES (?, 'action', NULL, ?, ?, ?, ?, ?)"
                ).run(tagId, name, DEFAULT_TAG_COLOR, 0, nowIso(), nowIso());
                tag = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(tagId);
              }
              db.prepare(
                "INSERT OR IGNORE INTO library_entry_tags (id, kind, entry_id, tag_id, created_at) VALUES (?, 'action', ?, ?, ?)"
              ).run(newId("entrytag"), actionId, tag.id, nowIso());
            }
            db.prepare("UPDATE action_entries SET updated_at = ? WHERE id = ?").run(nowIso(), actionId);
          }
          if (payload.prompt !== undefined) {
            db.prepare("UPDATE action_entries SET prompt = ?, updated_at = ? WHERE id = ?").run(String(payload.prompt || "").slice(0, 4000), nowIso(), actionId);
          }
          sendJson(res, 200, actionWithAssetAndTags(loadAction(actionId)));
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
      db.prepare("DELETE FROM library_entry_tags WHERE kind = 'action' AND entry_id = ?").run(actionId);
      db.prepare("UPDATE action_projects SET cover_asset_id = NULL WHERE cover_asset_id = ?").run(action.asset_id);
      db.prepare("DELETE FROM action_entries WHERE id = ?").run(actionId);
      removeAssetIfUnused(action.asset_id);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (isImageUpload && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const action = loadAction(actionId);
          if (!action) return sendJson(res, 404, { detail: "Action not found" });
          const project = loadActionProject(action.project_id);
          if (!project) return sendJson(res, 404, { detail: "Action project not found" });
          const decoded = parseDataUrl(payload?.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const previousAssetId = action.asset_id;
          const relDir = path.relative(STORAGE_ROOT, actionProjectDirForName(project.name));
          const asset = writeAsset(decoded.buffer, decoded.mimeType, payload?.filename || "image", {
            source: "action-library",
            subdir: relDir,
            filenameStem: action.name || DEFAULT_ACTION_NAME,
          });
          const timestamp = nowIso();
          db.prepare("UPDATE action_entries SET asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, timestamp, actionId);
          db.prepare("UPDATE action_projects SET cover_asset_id = CASE WHEN cover_asset_id = ? THEN ? ELSE cover_asset_id END, updated_at = ? WHERE id = ?")
            .run(previousAssetId, asset.id, timestamp, project.id);
          removeAssetIfUnused(previousAssetId);
          sendJson(res, 200, actionWithAssetAndTags(loadAction(actionId)));
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
  }

  const actionTagMatch = pathname.match(/^\/api\/libraries\/action\/tags(?:\/([^/]+))?$/);
  if (actionTagMatch) {
    const tagId = actionTagMatch[1] ? decodeURIComponent(actionTagMatch[1]) : "";
    if (method === "GET" && !tagId) {
      sendJson(res, 200, { tags: listActionTags() });
      return true;
    }
    if (method === "POST" && !tagId) {
      parseJsonBody(req)
        .then((payload) => {
          const name = String(payload?.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
          if (!name) return sendJson(res, 400, { detail: "Tag name is required" });
          const existing = db.prepare("SELECT * FROM library_tags WHERE kind = 'action' AND name = ?").get(name);
          if (existing) return sendJson(res, 200, { ...existing, usage_count: tagUsage(existing.id) });
          const timestamp = nowIso();
          const id = newId("tag");
          db.prepare(
            "INSERT INTO library_tags (id, kind, project_id, name, color, sort_order, created_at, updated_at) VALUES (?, 'action', NULL, ?, ?, ?, ?, ?)"
          ).run(id, name, DEFAULT_TAG_COLOR, db.prepare("SELECT COUNT(*) AS total FROM library_tags WHERE kind = 'action'").get().total + 1, timestamp, timestamp);
          const tag = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(id);
          sendJson(res, 200, { ...tag, usage_count: 0 });
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (method === "PATCH" && tagId) {
      parseJsonBody(req)
        .then((payload) => {
          const tag = db.prepare("SELECT * FROM library_tags WHERE id = ? AND kind = 'action'").get(tagId);
          if (!tag) return sendJson(res, 404, { detail: "Tag not found" });
          if (payload.name !== undefined) {
            const nextName = String(payload.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
            if (!nextName) return sendJson(res, 400, { detail: "Tag name is required" });
            const exists = db.prepare("SELECT id FROM library_tags WHERE kind = 'action' AND name = ? AND id <> ?").get(nextName, tagId);
            if (exists) return sendJson(res, 400, { detail: "Tag already exists" });
            db.prepare("UPDATE library_tags SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), tagId);
          }
          if (payload.sort_order !== undefined) {
            db.prepare("UPDATE library_tags SET sort_order = ?, updated_at = ? WHERE id = ?").run(Number(payload.sort_order || 0), nowIso(), tagId);
          }
          const next = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(tagId);
          sendJson(res, 200, { ...next, usage_count: tagUsage(tagId) });
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (method === "DELETE" && tagId) {
      const tag = db.prepare("SELECT * FROM library_tags WHERE id = ? AND kind = 'action'").get(tagId);
      if (!tag) {
        sendJson(res, 200, { ok: true });
        return true;
      }
      db.prepare("DELETE FROM library_entry_tags WHERE tag_id = ?").run(tagId);
      db.prepare("DELETE FROM library_tags WHERE id = ?").run(tagId);
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  if (method === "GET" && pathname === "/api/model-projects") {
    const projects = db.prepare("SELECT * FROM model_projects ORDER BY updated_at DESC, created_at DESC").all().map(projectWithCover);
    sendJson(res, 200, { projects });
    return true;
  }

  if (method === "POST" && pathname === "/api/model-projects") {
    parseJsonBody(req)
      .then((payload) => {
        const timestamp = nowIso();
        const id = newId("project");
        const name = validateFileNamePart(payload?.name || DEFAULT_PROJECT_NAME, "project name");
        if (projectNameExists(name)) return sendJson(res, 400, { detail: "Project name must be unique" });
        db.prepare(
          "INSERT INTO model_projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
        ).run(id, name, timestamp, timestamp);
        const project = projectWithCover(loadProject(id));
        sendJson(res, 200, project);
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
          const data = payload || {};
          const project = loadProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Model project not found" });
          if (data.name !== undefined) {
            const nextName = validateFileNamePart(data.name || DEFAULT_PROJECT_NAME, "project name");
            if (projectNameExists(nextName, projectId)) return sendJson(res, 400, { detail: "Project name must be unique" });
            if (nextName !== project.name) {
              renameProjectFolder(project, nextName);
              db.prepare("UPDATE model_projects SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), projectId);
            }
          }
          if (data.cover_asset_id !== undefined) {
            const coverAssetId = data.cover_asset_id ? String(data.cover_asset_id) : null;
            if (coverAssetId && !loadAsset(coverAssetId)) return sendJson(res, 404, { detail: "Asset not found" });
            db.prepare("UPDATE model_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(coverAssetId, nowIso(), projectId);
          }
          sendJson(res, 200, projectWithCover(loadProject(projectId)));
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
      const modelRows = db.prepare("SELECT id FROM model_entries WHERE project_id = ?").all(projectId);
      const imageRows = db.prepare(
        "SELECT mi.asset_id FROM model_images mi JOIN model_entries me ON me.id = mi.model_id WHERE me.project_id = ?"
      ).all(projectId);
      const coverAssetRows = db.prepare("SELECT cover_asset_id AS asset_id FROM model_projects WHERE id = ?").all(projectId);
      db.prepare("DELETE FROM model_projects WHERE id = ?").run(projectId);
      for (const row of modelRows) {
        const imageAssets = db.prepare("SELECT asset_id FROM model_images WHERE model_id = ?").all(row.id);
        db.prepare("DELETE FROM model_images WHERE model_id = ?").run(row.id);
        for (const asset of imageAssets) removeAssetIfUnused(asset.asset_id);
      }
      for (const asset of imageRows) removeAssetIfUnused(asset.asset_id);
      for (const asset of coverAssetRows) removeAssetIfUnused(asset.asset_id);
      ensureDefaultProject();
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (tail === "cover/upload" && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const project = loadProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Model project not found" });
          const decoded = parseDataUrl(payload?.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const relDir = path.relative(STORAGE_ROOT, path.join(projectDirForName(project.name), "__project_cover__"));
          const asset = writeAsset(decoded.buffer, decoded.mimeType, payload?.filename || "image", {
            source: "model-project-cover",
            subdir: relDir,
            filenameStem: "cover",
          });
          db.prepare("UPDATE model_projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?").run(asset.id, nowIso(), projectId);
          sendJson(res, 200, projectWithCover(loadProject(projectId)));
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "models" && method === "GET") {
      const tagId = url.searchParams.get("tag_id") || "";
      const gender = url.searchParams.get("gender") || "";
      const project = loadProject(projectId);
      if (!project) {
        sendJson(res, 404, { detail: "Model project not found" });
        return true;
      }
      const models = db.prepare("SELECT * FROM model_entries WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC").all(projectId)
        .map(modelWithCoverAndTags)
        .filter((model) => (gender ? model.gender === gender : true));
      const activeTag = tagId ? db.prepare("SELECT * FROM library_tags WHERE id = ?").get(tagId) : null;
      const filtered = activeTag ? models.filter((model) => model.tags.includes(activeTag.name)) : models;
      sendJson(res, 200, { models: filtered });
      return true;
    }
    if (tail === "models" && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const project = loadProject(projectId);
          if (!project) return sendJson(res, 404, { detail: "Model project not found" });
          const timestamp = nowIso();
          const code = nextCode(projectId, project.name);
          const id = newId("model");
          const name = validateFileNamePart(payload?.name || DEFAULT_MODEL_NAME, "model name");
          if (modelNameExists(projectId, name)) return sendJson(res, 400, { detail: "Model name must be unique within the project" });
          db.prepare(
            "INSERT INTO model_entries (id, project_id, name, code, gender, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).run(id, projectId, name, code, sanitizeGender(payload?.gender), timestamp, timestamp);
          db.prepare("UPDATE model_projects SET updated_at = ? WHERE id = ?").run(timestamp, projectId);
          sendJson(res, 200, modelWithCoverAndTags(loadModel(id)));
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
          const model = loadModel(modelId);
          if (!model) return sendJson(res, 404, { detail: "Model not found" });
          if (payload.name !== undefined) {
            const nextName = validateFileNamePart(payload.name || DEFAULT_MODEL_NAME, "model name");
            if (modelNameExists(model.project_id, nextName, modelId)) return sendJson(res, 400, { detail: "Model name must be unique within the project" });
            if (nextName !== model.name) {
              renameModelFolderAndImages(model, nextName);
              db.prepare("UPDATE model_entries SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), modelId);
            }
          }
          if (payload.tags !== undefined) {
            const nextTags = normalizeTags(payload.tags);
            db.prepare("DELETE FROM library_entry_tags WHERE kind = 'model' AND entry_id = ?").run(modelId);
            for (const name of nextTags) {
              let tag = db.prepare("SELECT * FROM library_tags WHERE kind = 'model' AND name = ?").get(name);
              if (!tag) {
                const tagId = newId("tag");
                db.prepare(
                  "INSERT INTO library_tags (id, kind, project_id, name, color, sort_order, created_at, updated_at) VALUES (?, 'model', NULL, ?, ?, ?, ?, ?)"
                ).run(tagId, name, DEFAULT_TAG_COLOR, 0, nowIso(), nowIso());
                tag = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(tagId);
              }
              db.prepare(
                "INSERT OR IGNORE INTO library_entry_tags (id, kind, entry_id, tag_id, created_at) VALUES (?, 'model', ?, ?, ?)"
              ).run(newId("entrytag"), modelId, tag.id, nowIso());
            }
          }
          if (payload.cover_image_id !== undefined) {
            const coverImageId = payload.cover_image_id ? String(payload.cover_image_id) : null;
            if (coverImageId) {
              const image = db.prepare("SELECT id FROM model_images WHERE id = ? AND model_id = ?").get(coverImageId, modelId);
              if (!image) return sendJson(res, 404, { detail: "Model image not found" });
            }
            db.prepare("UPDATE model_entries SET cover_image_id = ?, updated_at = ? WHERE id = ?").run(coverImageId, nowIso(), modelId);
          }
          sendJson(res, 200, modelWithCoverAndTags(loadModel(modelId)));
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
      const imageRows = db.prepare("SELECT asset_id FROM model_images WHERE model_id = ?").all(modelId);
      db.prepare("DELETE FROM model_entries WHERE id = ?").run(modelId);
      for (const row of imageRows) removeAssetIfUnused(row.asset_id);
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
      }));
      sendJson(res, 200, { images });
      return true;
    }
    if (tail === "images" && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const model = loadModel(modelId);
          if (!model) return sendJson(res, 404, { detail: "Model not found" });
          const asset = loadAsset(payload?.asset_id);
          if (!asset) return sendJson(res, 404, { detail: "Asset not found" });
          const timestamp = nowIso();
          const imageId = newId("image");
          const sortOrder = Number(payload?.sort_order || 0);
          db.prepare(
            "INSERT INTO model_images (id, model_id, asset_id, caption, sort_order, created_at, mime_type, filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).run(imageId, modelId, asset.id, String(payload?.caption || ""), sortOrder, timestamp, asset.mime_type, asset.filename);
          sendJson(res, 200, {
            id: imageId,
            model_id: modelId,
            asset_id: asset.id,
            asset_url: assetUrl(asset.id),
            caption: String(payload?.caption || ""),
            sort_order: sortOrder,
            created_at: timestamp,
            mime_type: asset.mime_type,
            filename: asset.filename,
          });
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "images/upload" && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const model = loadModel(modelId);
          if (!model) return sendJson(res, 404, { detail: "Model not found" });
          const decoded = parseDataUrl(payload?.data ? `data:${payload.mime_type || "image/png"};base64,${payload.data}` : "");
          if (!decoded) return sendJson(res, 400, { detail: "Invalid upload data" });
          const project = loadProject(model.project_id);
          if (!project) return sendJson(res, 404, { detail: "Model project not found" });
          const modelName = folderName(model.name, "model name");
          const relDir = path.relative(STORAGE_ROOT, modelDirForNames(project.name, model.name));
          const sortOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM model_images WHERE model_id = ?").get(modelId)?.next || 0;
          const asset = writeAsset(decoded.buffer, decoded.mimeType, payload?.filename || "image", {
            source: "model-library",
            subdir: relDir,
            filenameStem: `${modelName}_${String(Number(sortOrder) + 1).padStart(3, "0")}`,
          });
          const timestamp = nowIso();
          const imageId = newId("image");
          db.prepare(
            "INSERT INTO model_images (id, model_id, asset_id, caption, sort_order, created_at, mime_type, filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).run(imageId, modelId, asset.id, "", Number(sortOrder), timestamp, asset.mime_type, asset.filename);
          db.prepare("UPDATE model_entries SET updated_at = ? WHERE id = ?").run(timestamp, modelId);
          sendJson(res, 200, {
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
          });
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
    db.prepare("UPDATE model_entries SET cover_image_id = NULL WHERE cover_image_id = ?").run(imageId);
    db.prepare("DELETE FROM model_images WHERE id = ?").run(imageId);
    removeAssetIfUnused(image.asset_id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const tagMatch = pathname.match(/^\/api\/libraries\/model\/tags(?:\/([^/]+))?$/);
  if (tagMatch) {
    const tagId = tagMatch[1] ? decodeURIComponent(tagMatch[1]) : "";
    if (method === "GET" && !tagId) {
      sendJson(res, 200, { tags: listTags() });
      return true;
    }
    if (method === "POST" && !tagId) {
      parseJsonBody(req)
        .then((payload) => {
          const name = String(payload?.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
          if (!name) return sendJson(res, 400, { detail: "Tag name is required" });
          const existing = db.prepare("SELECT * FROM library_tags WHERE kind = 'model' AND name = ?").get(name);
          if (existing) return sendJson(res, 200, { ...existing, usage_count: tagUsage(existing.id) });
          const timestamp = nowIso();
          const id = newId("tag");
          db.prepare(
            "INSERT INTO library_tags (id, kind, project_id, name, color, sort_order, created_at, updated_at) VALUES (?, 'model', NULL, ?, ?, ?, ?, ?)"
          ).run(id, name, DEFAULT_TAG_COLOR, db.prepare("SELECT COUNT(*) AS total FROM library_tags WHERE kind = 'model'").get().total + 1, timestamp, timestamp);
          const tag = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(id);
          sendJson(res, 200, { ...tag, usage_count: 0 });
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (method === "PATCH" && tagId) {
      parseJsonBody(req)
        .then((payload) => {
          const tag = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(tagId);
          if (!tag) return sendJson(res, 404, { detail: "Tag not found" });
          if (payload.name !== undefined) {
            const nextName = String(payload.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
            if (!nextName) return sendJson(res, 400, { detail: "Tag name is required" });
            const exists = db.prepare("SELECT id FROM library_tags WHERE kind = 'model' AND name = ? AND id <> ?").get(nextName, tagId);
            if (exists) return sendJson(res, 400, { detail: "Tag already exists" });
            db.prepare("UPDATE library_tags SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), tagId);
          }
          if (payload.sort_order !== undefined) {
            db.prepare("UPDATE library_tags SET sort_order = ?, updated_at = ? WHERE id = ?").run(Number(payload.sort_order || 0), nowIso(), tagId);
          }
          const next = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(tagId);
          sendJson(res, 200, { ...next, usage_count: tagUsage(tagId) });
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (method === "DELETE" && tagId) {
      const tag = db.prepare("SELECT * FROM library_tags WHERE id = ?").get(tagId);
      if (!tag) {
        sendJson(res, 200, { ok: true });
        return true;
      }
      db.prepare("DELETE FROM library_entry_tags WHERE tag_id = ?").run(tagId);
      db.prepare("DELETE FROM library_tags WHERE id = ?").run(tagId);
      sendJson(res, 200, { ok: true });
      return true;
    }
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

  return false;
}

const server = createServer((req, res) => {
  if (String(req.method || "").toUpperCase() === "OPTIONS") {
    res.writeHead(204, withCorsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (handleReviewApi(req, res, url)) return;
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

server.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`Forart Server API running at http://127.0.0.1:${SERVER_PORT}`);
  const urls = localNetworkUrls();
  if (urls.length) {
    console.log("LAN access:");
    for (const url of urls) console.log(`  ${url}`);
  }
});
