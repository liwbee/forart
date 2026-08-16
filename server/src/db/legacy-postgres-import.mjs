import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { createDatabaseRuntime } from "./database-runtime.mjs";

const LEGACY_TABLES = Object.freeze([
  "model_projects",
  "model_entries",
  "model_images",
  "outfit_projects",
  "outfit_entries",
  "action_projects",
  "action_entries",
  "library_tags",
  "library_entry_tags",
  "assets",
]);

export const LIBRARY_IMPORT_TABLES = Object.freeze([
  "assets",
  "library_projects",
  "library_entries",
  "model_profiles",
  "action_profiles",
  "library_entry_assets",
  "library_tags",
  "library_entry_tags",
]);

const TARGET_CLEAR_ORDER = Object.freeze([
  "asset_cleanup_jobs",
  "library_entry_tags",
  "library_entry_assets",
  "action_profiles",
  "model_profiles",
  "library_tags",
  "library_entries",
  "library_projects",
  "assets",
]);

function tableNames(database) {
  return new Set(database.prepare("select name from sqlite_master where type = 'table'").all().map((row) => row.name));
}

function requireSourceSchema(database) {
  const tables = tableNames(database);
  const hasLegacy = LEGACY_TABLES.every((name) => tables.has(name));
  const hasCurrent = LIBRARY_IMPORT_TABLES.every((name) => tables.has(name));
  if (hasLegacy) return "legacy";
  if (hasCurrent) return "current";
  const recognized = [...LEGACY_TABLES, ...LIBRARY_IMPORT_TABLES].filter((name) => tables.has(name));
  throw new Error(
    recognized.length
      ? `SQLite source has an incomplete Forart library schema. Recognized tables: ${recognized.join(", ")}`
      : "SQLite source is not a recognized Forart library database",
  );
}

function sqliteCount(database, tableName) {
  return Number(database.prepare(`select count(*) as count from "${tableName}"`).get()?.count || 0);
}

function legacyCounts(database) {
  return {
    assets: sqliteCount(database, "assets"),
    library_projects: sqliteCount(database, "model_projects")
      + sqliteCount(database, "outfit_projects")
      + sqliteCount(database, "action_projects"),
    library_entries: sqliteCount(database, "model_entries")
      + sqliteCount(database, "outfit_entries")
      + sqliteCount(database, "action_entries"),
    model_profiles: sqliteCount(database, "model_entries"),
    action_profiles: sqliteCount(database, "action_entries"),
    library_entry_assets: sqliteCount(database, "model_images")
      + sqliteCount(database, "outfit_entries")
      + sqliteCount(database, "action_entries"),
    library_tags: sqliteCount(database, "library_tags"),
    library_entry_tags: sqliteCount(database, "library_entry_tags"),
  };
}

function columnNames(database, tableName) {
  return new Set(database.prepare(`pragma table_info("${tableName}")`).all().map((column) => column.name));
}

function prepareLegacySnapshot(databasePath) {
  const database = new Database(databasePath);
  const applied = [];
  try {
    for (const tableName of ["model_projects", "outfit_projects", "action_projects"]) {
      if (columnNames(database, tableName).has("sort_order")) continue;
      database.exec(`alter table "${tableName}" add column sort_order integer not null default 0`);
      const rows = database.prepare(`select id from "${tableName}" order by updated_at desc, created_at desc`).all();
      const update = database.prepare(`update "${tableName}" set sort_order = ? where id = ?`);
      database.transaction(() => rows.forEach((row, index) => update.run(index + 1, row.id)))();
      applied.push(`${tableName}.sort_order`);
    }
    if (!columnNames(database, "library_tags").has("color")) {
      database.exec("alter table library_tags add column color text not null default 'default'");
      applied.push("library_tags.color");
    }
    database.prepare(`
      update library_tags
      set color = 'default'
      where color is null or color = '' or color not in ('default', 'red', 'yellow', 'brown', 'blue', 'green', 'purple')
    `).run();
    return applied;
  } finally {
    database.close();
  }
}

function isInsideOrSame(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normalizedAssetLocation(libraryRoot, storageKey) {
  const value = String(storageKey || "").trim();
  if (!value) return { filePath: "", storageKey: "" };
  const windowsAbsolute = /^[a-zA-Z]:[\\/]/.test(value);
  if (path.isAbsolute(value) || (process.platform === "win32" && windowsAbsolute)) {
    const filePath = path.resolve(value);
    const relative = path.relative(path.resolve(libraryRoot), filePath);
    return { filePath, storageKey: relative.split(path.sep).join("/") };
  }
  if (windowsAbsolute) return { filePath: value, storageKey: value };
  const segments = value.split(/[\\/]+/);
  return {
    filePath: path.resolve(libraryRoot, ...segments),
    storageKey: segments.join("/"),
  };
}

async function queryRows(db, tableName) {
  return db.selectFrom(tableName).selectAll().execute();
}

async function readNormalizedRows(db) {
  const entries = await Promise.all(LIBRARY_IMPORT_TABLES.map(async (tableName) => [tableName, await queryRows(db, tableName)]));
  return Object.fromEntries(entries);
}

function normalizedCounts(rows) {
  return Object.fromEntries(LIBRARY_IMPORT_TABLES.map((tableName) => [tableName, rows[tableName].length]));
}

function countDifferences(expected, actual) {
  return LIBRARY_IMPORT_TABLES
    .filter((tableName) => Number(expected[tableName]) !== Number(actual[tableName]))
    .map((tableName) => `${tableName}: expected ${expected[tableName]}, normalized ${actual[tableName]}`);
}

function validateAssetFiles(rows, libraryRoot) {
  const missingFiles = [];
  const outsideLibraryRoot = [];
  const referencedAssets = new Set([
    ...rows.library_projects.map((row) => row.cover_asset_id).filter(Boolean),
    ...rows.library_entry_assets.map((row) => row.asset_id).filter(Boolean),
  ]);
  const unreferencedAssets = [];
  const assets = rows.assets.map((asset) => {
    const location = normalizedAssetLocation(libraryRoot, asset.storage_key);
    const filePath = location.filePath;
    if (!filePath || !isInsideOrSame(libraryRoot, filePath)) {
      outsideLibraryRoot.push({ id: asset.id, storageKey: asset.storage_key });
      return asset;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      missingFiles.push({ id: asset.id, storageKey: asset.storage_key });
      return asset;
    }
    if (!referencedAssets.has(asset.id)) unreferencedAssets.push({ id: asset.id, storageKey: asset.storage_key });
    return { ...asset, storage_key: location.storageKey, size_bytes: statSync(filePath).size };
  });
  return { assets, missingFiles, outsideLibraryRoot, unreferencedAssets };
}

function strictIssues(report) {
  const issues = [];
  if (report.integrityCheck !== "ok") issues.push(`SQLite integrity_check returned: ${report.integrityCheck}`);
  if (report.countDifferences.length) issues.push(`Legacy rows were lost during normalization: ${report.countDifferences.join("; ")}`);
  if (report.missingFiles.length) issues.push(`${report.missingFiles.length} asset files are missing`);
  if (report.outsideLibraryRoot.length) issues.push(`${report.outsideLibraryRoot.length} asset paths are outside the library root`);
  if (report.unreferencedAssets.length) issues.push(`${report.unreferencedAssets.length} assets are unreferenced and would be cleaned on server start`);
  return issues;
}

async function createSourceSnapshot(sourcePath) {
  const resolvedSource = path.resolve(sourcePath);
  if (!existsSync(resolvedSource) || !statSync(resolvedSource).isFile()) {
    throw new Error(`SQLite source file does not exist: ${resolvedSource}`);
  }
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "forart-legacy-import-"));
  const snapshotPath = path.join(temporaryDirectory, "forart-library.sqlite");
  const sourceDatabase = new Database(resolvedSource, { readonly: true, fileMustExist: true });
  try {
    const integrityCheck = String(sourceDatabase.pragma("integrity_check", { simple: true }));
    const sourceSchema = requireSourceSchema(sourceDatabase);
    const expectedCounts = sourceSchema === "legacy" ? legacyCounts(sourceDatabase) : null;
    await sourceDatabase.backup(snapshotPath);
    const legacyPreparations = sourceSchema === "legacy" ? prepareLegacySnapshot(snapshotPath) : [];
    return { temporaryDirectory, snapshotPath, sourceSchema, integrityCheck, expectedCounts, legacyPreparations };
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    sourceDatabase.close();
  }
}

async function countTargetRows(db) {
  const tableNames = [...LIBRARY_IMPORT_TABLES, "asset_cleanup_jobs"];
  const entries = await Promise.all(tableNames.map(async (tableName) => {
    const row = await db.selectFrom(tableName).select(sql`count(*)`.as("count")).executeTakeFirst();
    return [tableName, Number(row?.count || 0)];
  }));
  return Object.fromEntries(entries);
}

async function isBootstrapOnlyTarget(db, counts) {
  if (!Object.entries(counts).every(([tableName, count]) => tableName === "library_projects" || count === 0)) return false;
  if (counts.library_projects === 0) return true;
  const bootstrapNames = new Set([
    "model\0默认项目",
    "model\0Default Project",
    "outfit\0默认穿搭项目",
    "outfit\0Default Outfit Project",
    "action\0默认动作项目",
    "action\0Default Action Project",
  ]);
  const projects = await db.selectFrom("library_projects").select(["kind", "name"]).execute();
  return projects.length <= 3 && projects.every((project) => bootstrapNames.has(`${project.kind}\0${project.name}`));
}

async function insertBatches(db, tableName, rows, batchSize = 250) {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    await db.insertInto(tableName).values(rows.slice(offset, offset + batchSize)).execute();
  }
}

async function replaceTargetLibrary(db, rows, { replaceLibrary = false } = {}) {
  const before = await countTargetRows(db);
  if (!replaceLibrary && !await isBootstrapOnlyTarget(db, before)) {
    throw new Error(
      "PostgreSQL already contains library data. Refusing to replace it without --replace-library. "
      + `Current counts: ${JSON.stringify(before)}`,
    );
  }

  await db.transaction().execute(async (trx) => {
    for (const tableName of TARGET_CLEAR_ORDER) await trx.deleteFrom(tableName).execute();
    for (const tableName of LIBRARY_IMPORT_TABLES) await insertBatches(trx, tableName, rows[tableName]);
    const after = await countTargetRows(trx);
    const expected = normalizedCounts(rows);
    const differences = countDifferences(expected, after);
    if (differences.length) throw new Error(`PostgreSQL import count verification failed: ${differences.join("; ")}`);
  });

  return { before, after: await countTargetRows(db) };
}

export async function inspectLegacyLibrary({ sourcePath, libraryRoot, strict = true } = {}) {
  if (!String(sourcePath || "").trim()) throw new Error("SQLite source path is required");
  if (!String(libraryRoot || "").trim()) throw new Error("Library root is required");
  const resolvedLibraryRoot = path.resolve(libraryRoot);
  if (!existsSync(resolvedLibraryRoot) || !statSync(resolvedLibraryRoot).isDirectory()) {
    throw new Error(`Library root does not exist: ${resolvedLibraryRoot}`);
  }

  const snapshot = await createSourceSnapshot(sourcePath);
  let sourceRuntime;
  try {
    sourceRuntime = await createDatabaseRuntime({ driver: "sqlite", databasePath: snapshot.snapshotPath });
    const rows = await readNormalizedRows(sourceRuntime.db);
    const fileValidation = validateAssetFiles(rows, resolvedLibraryRoot);
    rows.assets = fileValidation.assets;
    const counts = normalizedCounts(rows);
    const report = {
      sourcePath: path.resolve(sourcePath),
      sourceSchema: snapshot.sourceSchema,
      legacyPreparations: snapshot.legacyPreparations,
      libraryRoot: resolvedLibraryRoot,
      integrityCheck: snapshot.integrityCheck,
      counts,
      countDifferences: snapshot.expectedCounts ? countDifferences(snapshot.expectedCounts, counts) : [],
      missingFiles: fileValidation.missingFiles,
      outsideLibraryRoot: fileValidation.outsideLibraryRoot,
      unreferencedAssets: fileValidation.unreferencedAssets,
    };
    const issues = strictIssues(report);
    if (strict && issues.length) throw new Error(`Strict source validation failed: ${issues.join("; ")}`);
    return { report, rows, cleanup: async () => {
      await sourceRuntime?.close().catch(() => {});
      sourceRuntime = null;
      rmSync(snapshot.temporaryDirectory, { recursive: true, force: true });
    } };
  } catch (error) {
    await sourceRuntime?.close().catch(() => {});
    rmSync(snapshot.temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function migrateLegacyLibraryToPostgres({
  sourcePath,
  libraryRoot,
  databaseUrl = "",
  dryRun = false,
  strict = true,
  replaceLibrary = false,
} = {}) {
  const source = await inspectLegacyLibrary({ sourcePath, libraryRoot, strict });
  let targetRuntime;
  try {
    if (dryRun) return { dryRun: true, source: source.report, target: null };
    targetRuntime = await createDatabaseRuntime({ driver: "postgres", databaseUrl });
    const target = await replaceTargetLibrary(targetRuntime.db, source.rows, { replaceLibrary });
    return { dryRun: false, source: source.report, target };
  } finally {
    await targetRuntime?.close().catch(() => {});
    await source.cleanup();
  }
}
