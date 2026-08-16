import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createDatabaseRuntime, LIBRARY_DATABASE_FILENAME } from "../db/database-runtime.mjs";
import { createLibraryRepository } from "../db/repositories/library-repository.mjs";
import { recoverPendingAssetCleanups, recoverUnreferencedAssets } from "./library-asset-cleanup.mjs";
import { reconcileLibraryStorage } from "./library-storage-layout.mjs";

export { LIBRARY_DATABASE_FILENAME };
export const LIBRARY_TAG_COLORS = ["default", "red", "yellow", "brown", "blue", "green", "purple"];

const LIBRARY_TAG_COLOR_SET = new Set(LIBRARY_TAG_COLORS);
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const RESERVED_FILE_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
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
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) throw new Error(`${label} cannot contain Windows or Linux filename characters: < > : " / \\ | ? *`);
  if (name === "." || name === ".." || /[ .]$/.test(name)) throw new Error(`${label} cannot end with a space or period, and cannot be . or ..`);
  if (RESERVED_FILE_NAMES.has(name.split(".")[0].toUpperCase())) throw new Error(`${label} cannot use a Windows reserved name`);
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

export async function ensureDefaultProject(repository, kind, name, prefix) {
  if (await repository.countProjects(kind)) return;
  const timestamp = nowIso();
  await repository.insertProjectIfAbsent({
    id: newId(prefix),
    kind,
    name: validateFileNamePart(name, "project name"),
    cover_asset_id: null,
    sort_order: 0,
    created_at: timestamp,
    updated_at: timestamp,
  });
}

export async function createLibraryRuntime({
  dataDir,
  runtimeDataDir,
  databaseDir,
  databaseFilename = LIBRARY_DATABASE_FILENAME,
  canvasStorageRoot,
  language = "zh-CN",
  driver = process.env.FORART_DB_DRIVER || "sqlite",
  databaseUrl = "",
} = {}) {
  const labels = libraryLabels(language);
  const resolvedDataDir = ensureDataDirWritable(dataDir);
  if (!String(runtimeDataDir || "").trim()) throw new Error("Forart runtime data directory is required");
  const resolvedRuntimeDataDir = ensureDataDirWritable(runtimeDataDir);
  const resolvedDriver = String(driver || "sqlite").toLowerCase();
  const resolvedDatabaseDir = resolvedDriver === "sqlite"
    ? path.resolve(databaseDir || path.join(resolvedDataDir, ".forart", "database"))
    : "";
  if (resolvedDatabaseDir) ensureDir(resolvedDatabaseDir);
  const resolvedDatabasePath = resolvedDriver === "sqlite" ? path.join(resolvedDatabaseDir, databaseFilename) : "";
  const database = await createDatabaseRuntime({ driver: resolvedDriver, databasePath: resolvedDatabasePath, databaseUrl });
  try {
    const repository = createLibraryRepository(database.db, { driver: resolvedDriver });

    await repository.transaction(async (tx) => {
      await ensureDefaultProject(tx, "model", labels.defaultProject, "project");
      await ensureDefaultProject(tx, "outfit", labels.defaultOutfitProject, "outfit_project");
      await ensureDefaultProject(tx, "action", labels.defaultActionProject, "action_project");
    });

    const runtime = {
      db: database.db,
      databaseRuntime: database,
      repository,
      labels,
      driver: resolvedDriver,
      dataDir: resolvedDataDir,
      runtimeDataDir: resolvedRuntimeDataDir,
      thumbnailRoot: path.join(resolvedRuntimeDataDir, "thumb", "library-assets"),
      storageRoot: resolvedDataDir,
      databaseDir: resolvedDatabaseDir,
      databasePath: database.databasePath,
      databaseFilename: resolvedDriver === "sqlite" ? databaseFilename : "postgresql",
      canvasStorageRoot: path.resolve(canvasStorageRoot || resolvedDataDir),
      storageSettingsPayload() {
        return { configured: Boolean(database.db && resolvedDataDir), driver: resolvedDriver };
      },
      async checkDatabase() {
        await database.check();
      },
      async close() {
        await database.close();
      },
    };
    await recoverPendingAssetCleanups(runtime);
    await reconcileLibraryStorage(runtime);
    await recoverUnreferencedAssets(runtime);
    return runtime;
  } catch (error) {
    await database.close().catch(() => {});
    throw error;
  }
}
