import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createAdminContext } from "./src/admin/admin-context.mjs";
import { createAdminRouter } from "./src/http/admin-router.mjs";
import { createCanvasExchangeContext } from "./src/canvas-exchange/canvas-exchange-context.mjs";
import { createCanvasExchangeRouter } from "./src/http/canvas-exchange-router.mjs";
import { sendJson, sendText, withCorsHeaders } from "./src/http/responses.mjs";
import { createForartServer } from "./src/server-app.mjs";
import { createActionFolderImportService } from "./src/library/action-folder-import-service.mjs";
import { createActionLibraryService } from "./src/library/action-library-service.mjs";
import { createModelLibraryService } from "./src/library/model-library-service.mjs";
import { createOutfitLibraryService } from "./src/library/outfit-library-service.mjs";
import { ensureLibraryAssetThumbnail } from "./src/library/library-asset-thumbnails.mjs";
import { parseRequest } from "./src/shared/validation.mjs";
import { localNetworkUrls } from "./src/shared/network-addresses.mjs";
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
const DEFAULT_OUTFIT_PROJECT_NAME = LIBRARY_LABELS.defaultOutfitProject;
const DEFAULT_ACTION_PROJECT_NAME = LIBRARY_LABELS.defaultActionProject;
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

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "") {
  const base = crypto.randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${base}` : base;
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

function initDatabase() {
  db = new Database(DATABASE_PATH);
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

function getActionLibraryService() {
  return createActionLibraryService(actionImportRuntime());
}

function getOutfitLibraryService() {
  return createOutfitLibraryService(actionImportRuntime());
}

function getModelLibraryService() {
  return createModelLibraryService(actionImportRuntime());
}

function loadAsset(assetId) {
  return db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) || null;
}

function assetAbsolutePath(value) {
  const text = String(value || "");
  return path.isAbsolute(text) ? text : path.join(STORAGE_ROOT, text);
}
function handleServiceBulkEntriesApi(req, res, service) {
  parseJsonBody(req)
    .then((payload) => {
      const parsed = parseRequest(libraryBulkEntriesPayloadSchema, payload || {});
      if (!parsed.ok) return sendJson(res, parsed.status, parsed.body);
      const result = service.bulkEntries(parsed.value);
      if (!result) return sendJson(res, 404, { detail: "Project not found" });
      sendJson(res, 200, result);
    })
    .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
  return true;
}

function handleServiceTagApi(req, res, { service, projectId, tagId }) {
  const parsedQuery = parseRequest(libraryTagProjectQuerySchema, { project_id: projectId });
  if (!parsedQuery.ok) {
    sendJson(res, parsedQuery.status, parsedQuery.body);
    return true;
  }
  const parsedProjectId = parsedQuery.value.project_id;
  if (!service.projectExists(parsedProjectId)) {
    sendJson(res, 404, { detail: "Project not found" });
    return true;
  }
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" && !tagId) {
    sendJson(res, 200, { tags: service.listTags(parsedProjectId) });
    return true;
  }
  if (method === "POST" && !tagId) {
    parseJsonBody(req)
      .then((payload) => {
        const parsedBody = parseRequest(libraryCreateTagPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        sendJson(res, 200, service.createTag(parsedProjectId, parsedBody.value));
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
        const next = service.updateTag(parsedProjectId, tagId, parsedBody.value);
        if (!next) return sendJson(res, 404, { detail: "Tag not found" });
        sendJson(res, 200, next);
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
    sendJson(res, 200, service.deleteTag(parsedProjectId, tagId));
    return true;
  }
  return false;
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
    sendJson(res, 200, getOutfitLibraryService().listProjects());
    return true;
  }

  if (method === "POST" && pathname === "/api/outfit-projects") {
    parseJsonBody(req)
      .then((payload) => {
        const parsedBody = parseRequest(libraryCreateProjectPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        sendJson(res, 200, getOutfitLibraryService().createProject(parsedBody.value));
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
          const nextProject = getOutfitLibraryService().updateProject(projectId, parsedBody.value);
          if (!nextProject) return sendJson(res, 404, { detail: "Outfit project not found" });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "" && method === "DELETE") {
      const result = getOutfitLibraryService().deleteProject(projectId);
      if (!result) {
        sendJson(res, 404, { detail: "Outfit project not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (tail === "cover/upload" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextProject = await getOutfitLibraryService().uploadProjectCover(projectId, parsedBody.value);
          if (!nextProject) return sendJson(res, 404, { detail: "Outfit project not found" });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "outfits" && method === "GET") {
      const result = getOutfitLibraryService().listOutfits(projectId, {
        tag_id: url.searchParams.getAll("tag_id"),
        exclude_tag_id: url.searchParams.getAll("exclude_tag_id"),
        untagged: url.searchParams.get("untagged") || "",
      });
      if (!result) {
        sendJson(res, 404, { detail: "Outfit project not found" });
        return true;
      }
      sendJson(res, 200, result);
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
          const nextOutfit = getOutfitLibraryService().updateOutfit(outfitId, parsedBody.value);
          if (!nextOutfit) return sendJson(res, 404, { detail: "Outfit not found" });
          sendJson(res, 200, nextOutfit);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (!isImageUpload && method === "DELETE") {
      const result = getOutfitLibraryService().deleteOutfit(outfitId);
      if (!result) {
        sendJson(res, 404, { detail: "Outfit not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (isImageUpload && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextOutfit = await getOutfitLibraryService().replaceOutfitImage(outfitId, parsedBody.value);
          if (!nextOutfit) return sendJson(res, 404, { detail: "Outfit not found" });
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
    if (handleServiceTagApi(req, res, { service: getOutfitLibraryService(), projectId, tagId })) return true;
  }

  if (pathname === "/api/libraries/outfit/entries/bulk" && method === "POST") {
    return handleServiceBulkEntriesApi(req, res, getOutfitLibraryService());
  }

  if (method === "GET" && pathname === "/api/action-projects") {
    sendJson(res, 200, getActionLibraryService().listProjects());
    return true;
  }

  if (method === "POST" && pathname === "/api/action-projects") {
    parseJsonBody(req)
      .then((payload) => {
        const parsedBody = parseRequest(libraryCreateProjectPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        sendJson(res, 200, getActionLibraryService().createProject(parsedBody.value));
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
          const nextProject = getActionLibraryService().updateProject(projectId, parsedBody.value);
          if (!nextProject) return sendJson(res, 404, { detail: "Action project not found" });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "" && method === "DELETE") {
      const result = getActionLibraryService().deleteProject(projectId);
      if (!result) {
        sendJson(res, 404, { detail: "Action project not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (tail === "cover/upload" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextProject = await getActionLibraryService().uploadProjectCover(projectId, parsedBody.value);
          if (!nextProject) return sendJson(res, 404, { detail: "Action project not found" });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "actions" && method === "GET") {
      const result = getActionLibraryService().listActions(projectId, {
        tag_id: url.searchParams.getAll("tag_id"),
        exclude_tag_id: url.searchParams.getAll("exclude_tag_id"),
        untagged: url.searchParams.get("untagged") || "",
      });
      if (!result) {
        sendJson(res, 404, { detail: "Action project not found" });
        return true;
      }
      sendJson(res, 200, result);
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
          const nextAction = getActionLibraryService().updateAction(actionId, parsedBody.value);
          if (!nextAction) return sendJson(res, 404, { detail: "Action not found" });
          sendJson(res, 200, nextAction);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (!isImageUpload && method === "DELETE") {
      const result = getActionLibraryService().deleteAction(actionId);
      if (!result) {
        sendJson(res, 404, { detail: "Action not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (isImageUpload && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextAction = await getActionLibraryService().replaceActionImage(actionId, parsedBody.value);
          if (!nextAction) return sendJson(res, 404, { detail: "Action not found" });
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
    if (handleServiceTagApi(req, res, { service: getActionLibraryService(), projectId, tagId })) return true;
  }

  if (pathname === "/api/libraries/action/entries/bulk" && method === "POST") {
    return handleServiceBulkEntriesApi(req, res, getActionLibraryService());
  }

  if (method === "GET" && pathname === "/api/model-projects") {
    sendJson(res, 200, getModelLibraryService().listProjects());
    return true;
  }

  if (method === "POST" && pathname === "/api/model-projects") {
    parseJsonBody(req)
      .then((payload) => {
        const parsedBody = parseRequest(libraryCreateProjectPayloadSchema, payload || {});
        if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
        sendJson(res, 200, getModelLibraryService().createProject(parsedBody.value));
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
          const nextProject = getModelLibraryService().updateProject(projectId, parsedBody.value);
          if (!nextProject) return sendJson(res, 404, { detail: "Model project not found" });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "" && method === "DELETE") {
      const result = getModelLibraryService().deleteProject(projectId);
      if (!result) {
        sendJson(res, 404, { detail: "Model project not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (tail === "cover/upload" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const nextProject = await getModelLibraryService().uploadProjectCover(projectId, parsedBody.value);
          if (!nextProject) return sendJson(res, 404, { detail: "Model project not found" });
          sendJson(res, 200, nextProject);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "models" && method === "GET") {
      const result = getModelLibraryService().listModels(projectId, {
        tag_id: url.searchParams.getAll("tag_id"),
        exclude_tag_id: url.searchParams.getAll("exclude_tag_id"),
        untagged: url.searchParams.get("untagged") || "",
        gender: url.searchParams.get("gender") || "",
      });
      if (!result) {
        sendJson(res, 404, { detail: "Model project not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (tail === "models" && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const parsedBody = parseRequest(libraryCreateModelPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const model = getModelLibraryService().createModel(projectId, parsedBody.value);
          if (!model) return sendJson(res, 404, { detail: "Model project not found" });
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
          const nextModel = getModelLibraryService().updateModel(modelId, parsedBody.value);
          if (!nextModel) return sendJson(res, 404, { detail: "Model not found" });
          sendJson(res, 200, nextModel);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (tail === "" && method === "DELETE") {
      const result = getModelLibraryService().deleteModel(modelId);
      if (!result) {
        sendJson(res, 404, { detail: "Model not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (tail === "images" && method === "GET") {
      const result = getModelLibraryService().listImages(modelId);
      if (!result) {
        sendJson(res, 404, { detail: "Model not found" });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }
    if (tail === "images" && method === "POST") {
      parseJsonBody(req)
        .then((payload) => {
          const parsedBody = parseRequest(libraryAddModelImagePayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const image = getModelLibraryService().addImage(modelId, parsedBody.value);
          if (!image) return sendJson(res, 404, { detail: "Model not found" });
          sendJson(res, 200, image);
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          sendJson(res, detail === "Asset not found" ? 404 : 400, { detail });
        });
      return true;
    }
    if (tail === "images/upload" && method === "POST") {
      parseJsonBody(req)
        .then(async (payload) => {
          const parsedBody = parseRequest(libraryAssetUploadPayloadSchema, payload || {});
          if (!parsedBody.ok) return sendJson(res, parsedBody.status, parsedBody.body);
          const result = await getModelLibraryService().uploadImage(modelId, parsedBody.value);
          if (!result) return sendJson(res, 404, { detail: "Model not found" });
          sendJson(res, 200, result);
        })
        .catch((error) => sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) }));
      return true;
    }
  }

  const imageMatch = pathname.match(/^\/api\/model-images\/([^/]+)$/);
  if (imageMatch && method === "DELETE") {
    const imageId = decodeURIComponent(imageMatch[1]);
    const result = getModelLibraryService().deleteImage(imageId);
    if (!result) {
      sendJson(res, 404, { detail: "Model image not found" });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  const tagMatch = pathname.match(/^\/api\/libraries\/model\/tags(?:\/([^/]+))?$/);
  if (tagMatch) {
    const tagId = tagMatch[1] ? decodeURIComponent(tagMatch[1]) : "";
    const projectId = url.searchParams.get("project_id") || "";
    if (handleServiceTagApi(req, res, { service: getModelLibraryService(), projectId, tagId })) return true;
  }

  if (pathname === "/api/libraries/model/entries/bulk" && method === "POST") {
    return handleServiceBulkEntriesApi(req, res, getModelLibraryService());
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

function handleRequest(req, res) {
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
}

function handleServerError(error) {
  if (error?.code === "EADDRINUSE") {
    console.error(`Forart Server API port is already in use: http://127.0.0.1:${SERVER_PORT}`);
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
}

const appServer = createForartServer({ handleRequest, onError: handleServerError });

appServer.start({ port: SERVER_PORT, host: SERVER_HOST }).then(() => {
  console.log(`Forart Server API running at http://127.0.0.1:${SERVER_PORT}`);
  const urls = localNetworkUrls(SERVER_PORT);
  if (urls.length) {
    console.log("LAN access:");
    for (const url of urls) console.log(`  ${url}`);
  }
}).catch(handleServerError);
