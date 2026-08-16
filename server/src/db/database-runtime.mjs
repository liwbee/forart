import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Kysely, PostgresDialect, SqliteDialect, sql } from "kysely";
import { Migrator } from "kysely/migration";
import pg from "pg";
import { postgresLibraryMigrationProvider, sqliteLibraryMigrationProvider } from "./migrations/migration-provider.mjs";

export const LIBRARY_DATABASE_FILENAME = "forart-library.sqlite";
const SQLITE_BACKUP_LIMIT = 3;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT_DIR = path.resolve(MODULE_DIR, "..", "..", "..");

function loadSqliteConstructor() {
  if (process.versions?.electron) {
    return createRequire(path.join(APP_ROOT_DIR, "package.json"))("better-sqlite3");
  }
  return createRequire(import.meta.url)("better-sqlite3");
}

function migrationError(result) {
  const failed = result.results?.find((item) => item.status === "Error");
  const suffix = failed ? ` (${failed.migrationName})` : "";
  const cause = result.error instanceof Error ? result.error : new Error(String(result.error || "Unknown migration error"));
  const error = new Error(`Library database migration failed${suffix}: ${cause.message}`);
  error.cause = cause;
  return error;
}

function sqliteBackupPath(databasePath, targetMigration) {
  const safeMigration = String(targetMigration || "pending").replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `${databasePath}.pre-${safeMigration}-${Date.now()}.bak`;
}

function pruneSqliteBackups(databasePath) {
  const directory = path.dirname(databasePath);
  const prefix = `${path.basename(databasePath)}.pre-`;
  const backups = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".bak"))
    .map((entry) => ({ path: path.join(directory, entry.name), modifiedAt: statSync(path.join(directory, entry.name)).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const backup of backups.slice(SQLITE_BACKUP_LIMIT)) {
    try {
      unlinkSync(backup.path);
    } catch {}
  }
}

export function resolvePostgresConnection({ databaseUrl = "", environment = process.env } = {}) {
  const connectionString = String(databaseUrl || "").trim();
  const missingEnvironmentVariables = connectionString
    ? []
    : ["PGHOST", "PGDATABASE", "PGUSER"]
      .filter((name) => !String(environment[name] || "").trim());
  return { connectionString, missingEnvironmentVariables };
}

async function runMigrations({ db, driver, databasePath, nativeDatabase }) {
  const provider = driver === "sqlite" ? sqliteLibraryMigrationProvider : postgresLibraryMigrationProvider;
  const migrator = new Migrator({ db, provider });
  const migrations = await migrator.getMigrations();
  const pending = migrations.filter((migration) => !migration.executedAt);
  let backupPath = "";

  if (driver === "sqlite" && databasePath && existsSync(databasePath) && statSync(databasePath).size > 0 && pending.length) {
    backupPath = sqliteBackupPath(databasePath, pending.at(-1)?.name);
    if (typeof nativeDatabase?.backup === "function") await nativeDatabase.backup(backupPath);
    else copyFileSync(databasePath, backupPath);
  }

  const result = await migrator.migrateToLatest();
  if (result.error) throw migrationError(result);
  if (driver === "sqlite" && databasePath) pruneSqliteBackups(databasePath);
  return {
    backupPath,
    applied: (result.results || []).filter((item) => item.status === "Success").map((item) => item.migrationName),
  };
}

export async function createDatabaseRuntime({ driver = "sqlite", databasePath = "", databaseUrl = "" } = {}) {
  const normalizedDriver = String(driver || "sqlite").trim().toLowerCase();
  let nativeDatabase = null;
  let pool = null;
  let db;

  if (normalizedDriver === "sqlite") {
    if (!databasePath) throw new Error("SQLite database path is required");
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const SqliteDatabase = loadSqliteConstructor();
    nativeDatabase = new SqliteDatabase(databasePath);
    nativeDatabase.pragma("journal_mode = WAL");
    nativeDatabase.pragma("busy_timeout = 5000");
    nativeDatabase.pragma("foreign_keys = ON");
    db = new Kysely({ dialect: new SqliteDialect({ database: nativeDatabase }) });
  } else if (normalizedDriver === "postgres") {
    const connection = resolvePostgresConnection({ databaseUrl });
    if (!connection.connectionString && connection.missingEnvironmentVariables.length) {
      throw new Error(
        "PostgreSQL connection is not configured. "
        + "Set PGHOST and PGPASSWORD. PGPORT, PGDATABASE and PGUSER use Docker defaults unless overridden. "
        + `Missing: ${connection.missingEnvironmentVariables.join(", ")}`,
      );
    }
    const configuredPoolSize = Number(process.env.FORART_DB_POOL_SIZE || 10);
    const max = Number.isInteger(configuredPoolSize) && configuredPoolSize > 0 ? configuredPoolSize : 10;
    pool = new pg.Pool({ ...(connection.connectionString ? { connectionString: connection.connectionString } : {}), max });
    // A database restart invalidates idle clients. Keep the process alive so pg can discard
    // those clients and establish fresh connections for subsequent queries.
    pool.on("error", (error) => {
      console.warn(`[database] PostgreSQL pool connection error: ${error instanceof Error ? error.message : String(error)}`);
    });
    db = new Kysely({ dialect: new PostgresDialect({ pool }) });
  } else {
    throw new Error(`Unsupported database driver: ${normalizedDriver}`);
  }

  try {
    const migration = await runMigrations({ db, driver: normalizedDriver, databasePath, nativeDatabase });
    await sql`select 1`.execute(db);
    return {
      db,
      driver: normalizedDriver,
      databasePath: normalizedDriver === "sqlite" ? databasePath : "",
      migration,
      async check() {
        await sql`select 1`.execute(db);
      },
      async close() {
        await db.destroy();
      },
    };
  } catch (error) {
    await db.destroy().catch(() => {});
    throw error;
  }
}
