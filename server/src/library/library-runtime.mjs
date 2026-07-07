import { DatabaseSync } from "node:sqlite";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const LIBRARY_DATABASE_FILENAME = "forart-library.sqlite";
export const LIBRARY_TAG_COLORS = ["default", "red", "yellow", "brown", "blue", "green", "purple"];

const LIBRARY_TAG_COLOR_SET = new Set(LIBRARY_TAG_COLORS);

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

export function libraryLabels(language = "zh-CN") {
  return language === "en-US"
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
}

export function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix = "") {
  const base = crypto.randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${base}` : base;
}

export function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeLibraryTagColor(value) {
  const next = String(value || "").trim();
  return LIBRARY_TAG_COLOR_SET.has(next) ? next : "default";
}

export function validateFileNamePart(value, label) {
  const name = normalizeName(value);
  if (!name) throw new Error(`${label} is required`);
  if (name.length > 80) throw new Error(`${label} must be 80 characters or fewer`);
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

function ensureDataDirWritable(targetDir) {
  const resolved = path.resolve(String(targetDir || "").trim());
  if (!resolved) throw new Error("Save path is required");
  ensureDir(resolved);
  const probe = path.join(resolved, ".forart-write-test");
  writeFileSync(probe, "ok", "utf8");
  unlinkSync(probe);
  return resolved;
}

function ensureDefaultProject(db, labels) {
  const row = db.prepare("SELECT id FROM model_projects ORDER BY created_at ASC LIMIT 1").get();
  if (row) return;
  const timestamp = nowIso();
  const name = validateFileNamePart(labels.defaultProject, "project name");
  db.prepare("INSERT INTO model_projects (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId("project"), name, 0, timestamp, timestamp);
}

function ensureDefaultOutfitProject(db, labels) {
  const row = db.prepare("SELECT id FROM outfit_projects ORDER BY created_at ASC LIMIT 1").get();
  if (row) return;
  const timestamp = nowIso();
  const name = validateFileNamePart(labels.defaultOutfitProject, "project name");
  db.prepare("INSERT INTO outfit_projects (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId("outfit_project"), name, 0, timestamp, timestamp);
}

function ensureDefaultActionProject(db, labels) {
  const row = db.prepare("SELECT id FROM action_projects ORDER BY created_at ASC LIMIT 1").get();
  if (row) return;
  const timestamp = nowIso();
  const name = validateFileNamePart(labels.defaultActionProject, "project name");
  db.prepare("INSERT INTO action_projects (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId("action_project"), name, 0, timestamp, timestamp);
}

function ensureProjectSortOrder(db, tableName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === "sort_order")) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
    const rows = db.prepare(`SELECT id FROM ${tableName} ORDER BY updated_at DESC, created_at DESC`).all();
    const update = db.prepare(`UPDATE ${tableName} SET sort_order = ? WHERE id = ?`);
    rows.forEach((row, index) => update.run(index + 1, row.id));
  }
}

function ensureLibraryTagColor(db) {
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

function initDatabase(db, labels) {
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
  ensureProjectSortOrder(db, "model_projects");
  ensureProjectSortOrder(db, "outfit_projects");
  ensureProjectSortOrder(db, "action_projects");
  ensureLibraryTagColor(db);
  db.exec(`
  CREATE INDEX IF NOT EXISTS idx_model_projects_sort ON model_projects(sort_order ASC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_outfit_projects_sort ON outfit_projects(sort_order ASC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_action_projects_sort ON action_projects(sort_order ASC, created_at DESC);
`);
  ensureDefaultProject(db, labels);
  ensureDefaultOutfitProject(db, labels);
  ensureDefaultActionProject(db, labels);
}

export function createLibraryRuntime({
  dataDir,
  databaseDir,
  databaseFilename = LIBRARY_DATABASE_FILENAME,
  canvasStorageRoot,
  language = "zh-CN",
}) {
  const labels = libraryLabels(language);
  const resolvedDataDir = ensureDataDirWritable(dataDir);
  const resolvedDatabaseDir = path.resolve(databaseDir || path.join(resolvedDataDir, ".forart", "database"));
  ensureDir(resolvedDatabaseDir);
  const databasePath = path.join(resolvedDatabaseDir, databaseFilename);
  const db = new DatabaseSync(databasePath);
  initDatabase(db, labels);

  return {
    db,
    labels,
    dataDir: resolvedDataDir,
    storageRoot: resolvedDataDir,
    databaseDir: resolvedDatabaseDir,
    databasePath,
    databaseFilename,
    canvasStorageRoot: path.resolve(canvasStorageRoot || resolvedDataDir),
    storageSettingsPayload() {
      return { configured: Boolean(db && resolvedDataDir) };
    },
    close() {
      db.close();
    },
  };
}
