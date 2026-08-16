import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { createDatabaseRuntime } from "../src/db/database-runtime.mjs";
import { migrateLegacyLibraryToPostgres } from "../src/db/legacy-postgres-import.mjs";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function seedLegacyDatabase(databasePath, libraryRoot) {
  const database = new Database(databasePath);
  database.pragma("foreign_keys = off");
  database.exec(`
    create table model_projects (id text primary key, name text not null unique, cover_asset_id text, created_at text not null, updated_at text not null);
    create table model_entries (id text primary key, project_id text not null, name text not null, code text not null, gender text not null default 'unknown', cover_image_id text, created_at text not null, updated_at text not null, unique(project_id, name));
    create table model_images (id text primary key, model_id text not null, asset_id text not null, caption text not null default '', sort_order integer not null default 0, created_at text not null, mime_type text, filename text);
    create table outfit_projects (id text primary key, name text not null unique, cover_asset_id text, created_at text not null, updated_at text not null);
    create table outfit_entries (id text primary key, project_id text not null, name text not null, asset_id text not null, created_at text not null, updated_at text not null, unique(project_id, name));
    create table action_projects (id text primary key, name text not null unique, cover_asset_id text, created_at text not null, updated_at text not null);
    create table action_entries (id text primary key, project_id text not null, name text not null, asset_id text not null, prompt text not null default '', created_at text not null, updated_at text not null, unique(project_id, name));
    create table library_tags (id text primary key, kind text not null, project_id text not null, name text not null, sort_order integer not null default 0, created_at text not null, updated_at text not null, unique(kind, project_id, name));
    create table library_entry_tags (id text primary key, kind text not null, entry_id text not null, tag_id text not null, created_at text not null, unique(kind, entry_id, tag_id));
    create table assets (id text primary key, filename text not null, path text not null, mime_type text not null, width integer not null default 0, height integer not null default 0, source text not null, created_at text not null);
  `);
  const timestamp = "2026-08-14T00:00:00.000Z";
  const relativePaths = {
    model: path.join("模特库", "旧模特项目", "模特一", "模特一_001.png"),
    outfit: path.join("穿搭库", "旧穿搭项目", "穿搭一.png"),
    action: path.join("动作库", "旧动作项目", "动作一.png"),
  };
  const insertAsset = database.prepare("insert into assets values (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const [kind, assetId] of [["model", "asset_model"], ["outfit", "asset_outfit"], ["action", "asset_action"]]) {
    const filePath = path.join(libraryRoot, relativePaths[kind]);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, ONE_PIXEL_PNG);
    insertAsset.run(assetId, path.basename(filePath), relativePaths[kind], "image/png", 1, 1, `${kind}-library`, timestamp);
  }
  database.prepare("insert into model_projects values (?, ?, ?, ?, ?)").run("project_model", "旧模特项目", "asset_model", timestamp, timestamp);
  database.prepare("insert into outfit_projects values (?, ?, ?, ?, ?)").run("project_outfit", "旧穿搭项目", "asset_outfit", timestamp, timestamp);
  database.prepare("insert into action_projects values (?, ?, ?, ?, ?)").run("project_action", "旧动作项目", "asset_action", timestamp, timestamp);
  database.prepare("insert into model_entries values (?, ?, ?, ?, ?, ?, ?, ?)").run("entry_model", "project_model", "模特一", "MODEL-001", "female", "image_model", timestamp, timestamp);
  database.prepare("insert into model_images values (?, ?, ?, ?, ?, ?, ?, ?)").run("image_model", "entry_model", "asset_model", "正面", 0, timestamp, "image/png", "模特一_001.png");
  database.prepare("insert into outfit_entries values (?, ?, ?, ?, ?, ?)").run("entry_outfit", "project_outfit", "穿搭一", "asset_outfit", timestamp, timestamp);
  database.prepare("insert into action_entries values (?, ?, ?, ?, ?, ?, ?)").run("entry_action", "project_action", "动作一", "asset_action", "旧提示词", timestamp, timestamp);
  database.prepare("insert into library_tags values (?, ?, ?, ?, ?, ?, ?)").run("tag_action", "action", "project_action", "旧标签", 0, timestamp, timestamp);
  database.prepare("insert into library_entry_tags values (?, ?, ?, ?, ?)").run("binding_action", "action", "entry_action", "tag_action", timestamp);
  database.close();
  return relativePaths;
}

function sourceTables(databasePath) {
  const database = new Database(databasePath, { readonly: true });
  try {
    return database.prepare("select name from sqlite_master where type = 'table'").all().map((row) => row.name);
  } finally {
    database.close();
  }
}

test("legacy PostgreSQL importer dry-run validates without modifying its SQLite source", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forart-import-dry-run-"));
  const databasePath = path.join(root, "forart-library.sqlite");
  const relativePaths = seedLegacyDatabase(databasePath, root);
  try {
    const result = await migrateLegacyLibraryToPostgres({ sourcePath: databasePath, libraryRoot: root, dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.source.sourceSchema, "legacy");
    assert.deepEqual(result.source.legacyPreparations, [
      "model_projects.sort_order",
      "outfit_projects.sort_order",
      "action_projects.sort_order",
      "library_tags.color",
    ]);
    assert.deepEqual(result.source.counts, {
      assets: 3,
      library_projects: 3,
      library_entries: 3,
      model_profiles: 1,
      action_profiles: 1,
      library_entry_assets: 3,
      library_tags: 1,
      library_entry_tags: 1,
    });
    assert.deepEqual(result.source.countDifferences, []);
    assert.deepEqual(result.source.missingFiles, []);
    assert.equal(sourceTables(databasePath).includes("model_projects"), true);
    assert.equal(sourceTables(databasePath).includes("library_projects"), false);

    unlinkSync(path.join(root, relativePaths.action));
    await assert.rejects(
      migrateLegacyLibraryToPostgres({ sourcePath: databasePath, libraryRoot: root, dryRun: true }),
      /1 asset files are missing/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

if (process.env.FORART_MIGRATION_TEST_DATABASE_URL) {
  test("legacy PostgreSQL importer replaces only library tables and verifies counts", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "forart-import-postgres-"));
    const databasePath = path.join(root, "forart-library.sqlite");
    seedLegacyDatabase(databasePath, root);
    const databaseUrl = process.env.FORART_MIGRATION_TEST_DATABASE_URL;
    let target;
    try {
      target = await createDatabaseRuntime({ driver: "postgres", databaseUrl });
      await sql`create table migration_auth_sentinel (id integer primary key)`.execute(target.db);
      await sql`insert into migration_auth_sentinel (id) values (1)`.execute(target.db);
      await target.db.insertInto("library_projects").values([
        { id: "bootstrap_model", kind: "model", name: "默认项目", cover_asset_id: null, sort_order: 0, created_at: "2026-08-14T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z" },
        { id: "bootstrap_outfit", kind: "outfit", name: "默认穿搭项目", cover_asset_id: null, sort_order: 0, created_at: "2026-08-14T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z" },
        { id: "bootstrap_action", kind: "action", name: "默认动作项目", cover_asset_id: null, sort_order: 0, created_at: "2026-08-14T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z" },
      ]).execute();
      await target.close();
      target = null;

      const result = await migrateLegacyLibraryToPostgres({ sourcePath: databasePath, libraryRoot: root, databaseUrl });
      assert.deepEqual(result.target.after, {
        assets: 3,
        library_projects: 3,
        library_entries: 3,
        model_profiles: 1,
        action_profiles: 1,
        library_entry_assets: 3,
        library_tags: 1,
        library_entry_tags: 1,
        asset_cleanup_jobs: 0,
      });

      target = await createDatabaseRuntime({ driver: "postgres", databaseUrl });
      assert.equal((await sql`select count(*)::int as count from migration_auth_sentinel`.execute(target.db)).rows[0].count, 1);
      assert.equal((await target.db.selectFrom("action_profiles").select("prompt").executeTakeFirst()).prompt, "旧提示词");
      assert.equal((await target.db.selectFrom("assets").select("storage_key").where("id", "=", "asset_action").executeTakeFirst()).storage_key.includes("\\"), false);
      await target.close();
      target = null;

      await assert.rejects(
        migrateLegacyLibraryToPostgres({ sourcePath: databasePath, libraryRoot: root, databaseUrl }),
        /Refusing to replace it without --replace-library/,
      );
      const replacement = await migrateLegacyLibraryToPostgres({ sourcePath: databasePath, libraryRoot: root, databaseUrl, replaceLibrary: true });
      assert.equal(replacement.target.after.library_entries, 3);
      assert.equal(sourceTables(databasePath).includes("model_projects"), true);
    } finally {
      await target?.close().catch(() => {});
      rmSync(root, { recursive: true, force: true });
    }
  });
}
