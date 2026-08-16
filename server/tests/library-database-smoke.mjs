import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createLibraryRuntime } from "../src/library/library-runtime.mjs";
import { createModelLibraryService } from "../src/library/model-library-service.mjs";
import { createOutfitLibraryService } from "../src/library/outfit-library-service.mjs";
import { createActionLibraryService } from "../src/library/action-library-service.mjs";
import { resolvePostgresConnection } from "../src/db/database-runtime.mjs";
import { libraryAssetThumbnailPath } from "../src/library/library-asset-thumbnails.mjs";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function seedLegacyLibraryDatabase(databasePath, storageRoot) {
  const db = new Database(databasePath);
  db.pragma("foreign_keys = OFF");
  db.exec(`
    create table model_projects (id text primary key, name text not null unique, cover_asset_id text, sort_order integer not null default 0, created_at text not null, updated_at text not null);
    create table model_entries (id text primary key, project_id text not null, name text not null, code text not null, gender text not null default 'unknown', cover_image_id text, created_at text not null, updated_at text not null, unique(project_id, name), foreign key(project_id) references model_projects(id) on delete cascade, foreign key(cover_image_id) references model_images(id) on delete set null);
    create table model_images (id text primary key, model_id text not null, asset_id text not null, caption text not null default '', sort_order integer not null default 0, created_at text not null, mime_type text, filename text, foreign key(model_id) references model_entries(id) on delete cascade);
    create table outfit_projects (id text primary key, name text not null unique, cover_asset_id text, sort_order integer not null default 0, created_at text not null, updated_at text not null);
    create table outfit_entries (id text primary key, project_id text not null, name text not null, asset_id text not null, created_at text not null, updated_at text not null, unique(project_id, name), foreign key(project_id) references outfit_projects(id) on delete cascade, foreign key(asset_id) references assets(id) on delete cascade);
    create table action_projects (id text primary key, name text not null unique, cover_asset_id text, sort_order integer not null default 0, created_at text not null, updated_at text not null);
    create table action_entries (id text primary key, project_id text not null, name text not null, asset_id text not null, prompt text not null default '', created_at text not null, updated_at text not null, unique(project_id, name), foreign key(project_id) references action_projects(id) on delete cascade, foreign key(asset_id) references assets(id) on delete cascade);
    create table library_tags (id text primary key, kind text not null, project_id text not null, name text not null, color text not null default 'default', sort_order integer not null default 0, created_at text not null, updated_at text not null, unique(kind, project_id, name));
    create table library_entry_tags (id text primary key, kind text not null, entry_id text not null, tag_id text not null, created_at text not null, unique(kind, entry_id, tag_id), foreign key(tag_id) references library_tags(id) on delete cascade);
    create table assets (id text primary key, filename text not null, path text not null, mime_type text not null, width integer not null default 0, height integer not null default 0, source text not null, created_at text not null);
    create unique index idx_model_projects_name_unique on model_projects(name);
    create unique index idx_model_entries_project_name_unique on model_entries(project_id, name);
    create unique index idx_outfit_projects_name_unique on outfit_projects(name);
    create unique index idx_outfit_entries_project_name_unique on outfit_entries(project_id, name);
    create unique index idx_action_projects_name_unique on action_projects(name);
    create unique index idx_action_entries_project_name_unique on action_entries(project_id, name);
    create index idx_model_entries_project_updated on model_entries(project_id, updated_at desc, created_at desc);
    create index idx_model_images_model_sort on model_images(model_id, sort_order asc, created_at asc);
    create index idx_outfit_entries_project_updated on outfit_entries(project_id, updated_at desc, created_at desc);
    create index idx_action_entries_project_updated on action_entries(project_id, updated_at desc, created_at desc);
    create index idx_library_tags_kind_project_sort on library_tags(kind, project_id, sort_order asc, name asc);
    create index idx_library_entry_tags_kind_entry on library_entry_tags(kind, entry_id);
    create index idx_library_entry_tags_tag on library_entry_tags(tag_id);
    create index idx_model_projects_sort on model_projects(sort_order asc, created_at desc);
    create index idx_outfit_projects_sort on outfit_projects(sort_order asc, created_at desc);
    create index idx_action_projects_sort on action_projects(sort_order asc, created_at desc);
  `);
  const timestamp = new Date().toISOString();
  const insertAsset = db.prepare("insert into assets (id, filename, path, mime_type, width, height, source, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
  const assets = [
    ["asset_legacy_model_1", "模特一_001.png", path.join("Model Library", "旧模特项目", "模特一", "模特一_001.png"), "image/png", "model-library"],
    ["asset_legacy_model_2", "模特一_002.png", path.join("Model Library", "旧模特项目", "模特一", "模特一_002.png"), "image/png", "model-library"],
    ["asset_legacy_outfit", "穿搭一.png", path.join("Outfit Library", "旧穿搭项目", "穿搭一.png"), "image/png", "outfit-library"],
    ["asset_legacy_action", "动作一.png", path.join("Action Library", "旧动作项目", "动作一.png"), "image/png", "action-library"],
  ];
  for (const [id, filename, relativePath, mimeType, source] of assets) {
    const fullPath = path.join(storageRoot, relativePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, ONE_PIXEL_PNG);
    insertAsset.run(id, filename, relativePath, mimeType, 1, 1, source, timestamp);
  }
  db.prepare("insert into model_projects values (?, ?, ?, ?, ?, ?)").run("model_project_legacy", "旧模特项目", "asset_legacy_model_1", 0, timestamp, timestamp);
  db.prepare("insert into outfit_projects values (?, ?, ?, ?, ?, ?)").run("outfit_project_legacy", "旧穿搭项目", "asset_legacy_outfit", 0, timestamp, timestamp);
  db.prepare("insert into action_projects values (?, ?, ?, ?, ?, ?)").run("action_project_legacy", "旧动作项目", "asset_legacy_action", 0, timestamp, timestamp);
  db.prepare("insert into model_entries values (?, ?, ?, ?, ?, ?, ?, ?)").run("model_legacy", "model_project_legacy", "模特一", "MODEL-001", "female", "model_image_2", timestamp, timestamp);
  db.prepare("insert into model_images values (?, ?, ?, ?, ?, ?, ?, ?)").run("model_image_1", "model_legacy", "asset_legacy_model_1", "正面", 0, timestamp, "image/png", "模特一_001.png");
  db.prepare("insert into model_images values (?, ?, ?, ?, ?, ?, ?, ?)").run("model_image_2", "model_legacy", "asset_legacy_model_2", "侧面", 1, timestamp, "image/png", "模特一_002.png");
  db.prepare("insert into outfit_entries values (?, ?, ?, ?, ?, ?)").run("outfit_legacy", "outfit_project_legacy", "穿搭一", "asset_legacy_outfit", timestamp, timestamp);
  db.prepare("insert into action_entries values (?, ?, ?, ?, ?, ?, ?)").run("action_legacy", "action_project_legacy", "动作一", "asset_legacy_action", "旧提示词", timestamp, timestamp);
  db.prepare("insert into library_tags values (?, ?, ?, ?, ?, ?, ?, ?)").run("tag_legacy", "action", "action_project_legacy", "旧标签", "red", 0, timestamp, timestamp);
  db.prepare("insert into library_entry_tags values (?, ?, ?, ?, ?)").run("entry_tag_legacy", "action", "action_legacy", "tag_legacy", timestamp);
  db.close();
  const legacyThumbnail = path.join(path.dirname(databasePath), "thumb", "library-assets", "asset_legacy_action.webp");
  mkdirSync(path.dirname(legacyThumbnail), { recursive: true });
  writeFileSync(legacyThumbnail, "legacy-thumbnail");
}

test("PostgreSQL connection configuration uses standard environment variables", () => {
  assert.deepEqual(resolvePostgresConnection({
    environment: { PGHOST: "database", PGDATABASE: "forart", PGUSER: "forart" },
  }), {
    connectionString: "",
    missingEnvironmentVariables: [],
  });
  assert.deepEqual(resolvePostgresConnection({ environment: { PGDATABASE: "forart", PGUSER: "forart" } }), {
    connectionString: "",
    missingEnvironmentVariables: ["PGHOST"],
  });
});

async function runDatabaseSmoke(driver, databaseUrl = "") {
  const root = mkdtempSync(path.join(os.tmpdir(), `forart-${driver}-`));
  const runtimeDataDir = path.join(root, "forart_data");
  let runtime = await createLibraryRuntime({
    dataDir: root,
    runtimeDataDir,
    databaseDir: path.join(root, "database"),
    canvasStorageRoot: root,
    driver,
    databaseUrl,
  });
  const cleanup = [];

  async function cleanupCreated() {
    for (const operation of cleanup.splice(0).reverse()) {
      try { await operation(); } catch {}
    }
  }

  try {
    assert.equal(runtime.driver, driver);
    assert.ok((await runtime.repository.countTable("library_projects")) >= 3);
    const initialMigration = driver === "postgres"
      ? "001_initial_library_schema"
      : "001_legacy_library_to_current";
    assert.ok(runtime.databaseRuntime.migration.applied.length === 0 || runtime.databaseRuntime.migration.applied.includes(initialMigration));
    const initialEntryCount = await runtime.repository.countTable("library_entries");

    const model = createModelLibraryService(runtime);
    const firstProject = (await model.listProjects()).projects[0];
    const secondProject = (await model.createProject({ name: `Second ${Date.now()}` }));
    cleanup.push(() => model.deleteProject(secondProject.id));
    const emptyModelImport = await model.importEntries(firstProject.id, { entries: [{ gender: "female" }] });
    assert.equal(emptyModelImport.imported_count, 1);
    assert.equal(emptyModelImport.failed_count, 0);
    assert.equal(emptyModelImport.imported[0].gender, "female");
    await model.deleteModel(emptyModelImport.imported[0].id);
    const tagName = `front-${Date.now()}`;
    const firstTag = await model.createTag(firstProject.id, { name: tagName, color: "red" });
    cleanup.push(() => model.deleteTag(firstProject.id, firstTag.id));
    const duplicateTag = await model.createTag(firstProject.id, { name: tagName, color: "blue" });
    assert.equal(firstTag.id, duplicateTag.id);
    const secondTag = await model.createTag(secondProject.id, { name: tagName });
    assert.notEqual(firstTag.id, secondTag.id);

    const entry = await model.createModel(firstProject.id, { name: `Model ${Date.now()}`, gender: "female", tags: [tagName] });
    cleanup.push(() => model.deleteModel(entry.id));
    assert.deepEqual(entry.tags, [tagName]);
    const renamedEntry = await model.updateModel(entry.id, { name: `${entry.name} Renamed`, tags: [tagName] });
    assert.equal(renamedEntry.gender, "female");
    assert.deepEqual(renamedEntry.tags, [tagName]);
    const firstModelImage = await model.uploadImage(entry.id, { filename: "model-1.png", mime_type: "image/png", data: ONE_PIXEL_PNG.toString("base64") });
    const secondModelImage = await model.uploadImage(entry.id, { filename: "model-2.png", mime_type: "image/png", data: ONE_PIXEL_PNG.toString("base64") });
    const firstModelAsset = await runtime.repository.getAsset(firstModelImage.asset.id);
    const secondModelAsset = await runtime.repository.getAsset(secondModelImage.asset.id);
    const modelDirectory = path.join(runtime.storageRoot, runtime.labels.modelLibrary, firstProject.name, renamedEntry.name);
    assert.equal(firstModelAsset.storage_key, path.relative(runtime.storageRoot, path.join(modelDirectory, `${renamedEntry.name}_001.png`)));
    assert.equal(secondModelAsset.storage_key, path.relative(runtime.storageRoot, path.join(modelDirectory, `${renamedEntry.name}_002.png`)));
    assert.equal(firstModelAsset.filename, `${renamedEntry.name}_001.png`);
    assert.equal(libraryAssetThumbnailPath(runtime, firstModelAsset), path.join(runtimeDataDir, "thumb", "library-assets", `${firstModelAsset.id}.webp`));
    assert.equal(libraryAssetThumbnailPath(runtime, secondModelAsset), path.join(runtimeDataDir, "thumb", "library-assets", `${secondModelAsset.id}.webp`));
    assert.equal(Number(firstModelImage.image.is_cover), 1);
    assert.equal(Number(secondModelImage.image.is_cover), 0);
    await assert.rejects(() => runtime.repository.updateEntryAsset(secondModelImage.image.id, { is_cover: 1 }));
    assert.ok((await model.listModels(firstProject.id)).models.some((item) => item.id === entry.id));
    await assert.rejects(() => model.bulkEntries({ project_id: firstProject.id, entry_ids: [entry.id], operation: "add_tags", tags: ["missing"] }));

    const sharedSourceProject = await model.createProject({ name: `Shared source ${Date.now()}` });
    const sharedSource = await model.createModel(sharedSourceProject.id, { name: `Shared source model ${Date.now()}` });
    const sharedUpload = await model.uploadImage(sharedSource.id, { filename: "shared.png", mime_type: "image/png", data: ONE_PIXEL_PNG.toString("base64") });
    const sharedTarget = await model.createModel(secondProject.id, { name: `Shared target model ${Date.now()}` });
    const sharedLink = await model.addImage(sharedTarget.id, { asset_id: sharedUpload.asset.id });
    const sharedAsset = await runtime.repository.getAsset(sharedUpload.asset.id);
    const sharedAssetPath = path.join(runtime.storageRoot, sharedAsset.storage_key);
    await model.deleteProject(sharedSourceProject.id);
    assert.equal(existsSync(sharedAssetPath), true);
    assert.equal((await model.listImages(sharedTarget.id)).images.some((image) => image.id === sharedLink.id), true);
    await model.deleteModel(sharedTarget.id);
    assert.equal(await runtime.repository.getAsset(sharedUpload.asset.id), null);
    assert.equal(existsSync(sharedAssetPath), false);

    const outfit = createOutfitLibraryService(runtime);
    const outfitProject = (await outfit.listProjects()).projects[0];
    const renameOutfitProject = await outfit.createProject({ name: `Outfit before rename ${Date.now()}` });
    cleanup.push(() => outfit.deleteProject(renameOutfitProject.id));
    const renameOutfit = await outfit.createOutfitFromFile(renameOutfitProject.id, {
      name: "Custom outfit name",
      buffer: ONE_PIXEL_PNG,
      filename: "outfit.png",
      mime_type: "image/png",
    });
    const originalOutfitAsset = await runtime.repository.getAsset(renameOutfit.asset_id);
    const originalOutfitPath = path.join(runtime.storageRoot, originalOutfitAsset.storage_key);
    const renamedOutfitProject = await outfit.updateProject(renameOutfitProject.id, { name: `Outfit after rename ${Date.now()}` });
    const expectedOutfitName = `${renamedOutfitProject.name}_001`;
    const renamedOutfit = await runtime.repository.getEntry("outfit", renameOutfit.id);
    const renamedOutfitAsset = await runtime.repository.getAsset(renameOutfit.asset_id);
    const renamedOutfitPath = path.join(runtime.storageRoot, runtime.labels.outfitLibrary, renamedOutfitProject.name, `${expectedOutfitName}.png`);
    assert.equal(renamedOutfit.name, expectedOutfitName);
    assert.equal(path.join(runtime.storageRoot, renamedOutfitAsset.storage_key), renamedOutfitPath);
    assert.equal(renamedOutfitAsset.filename, `${expectedOutfitName}.png`);
    assert.equal(existsSync(renamedOutfitPath), true);
    assert.equal(existsSync(originalOutfitPath), false);
    assert.equal(libraryAssetThumbnailPath(runtime, renamedOutfitAsset), path.join(runtimeDataDir, "thumb", "library-assets", `${renamedOutfitAsset.id}.webp`));
    const action = createActionLibraryService(runtime);
    const actionProject = (await action.listProjects()).projects[0];
    const assetAction = await action.createActionFromFile(actionProject.id, {
      name: `Action ${Date.now()}`,
      buffer: ONE_PIXEL_PNG,
      filename: "action.png",
      mime_type: "image/png",
      prompt: "test",
    });
    cleanup.push(() => action.deleteAction(assetAction.id));
    assert.ok(assetAction.asset_id);
    const actionAsset = await runtime.repository.getAsset(assetAction.asset_id);
    const actionAssetPath = path.join(runtime.storageRoot, actionAsset.storage_key);
    assert.equal(existsSync(actionAssetPath), true);
    assert.equal(actionAssetPath, path.join(runtime.storageRoot, runtime.labels.actionLibrary, actionProject.name, `${assetAction.name}.png`));
    assert.equal(actionAsset.filename, `${assetAction.name}.png`);
    assert.equal(existsSync(path.join(runtime.storageRoot, runtime.labels.actionLibrary, actionProject.name, assetAction.id)), false);
    const actionThumbnailPath = path.join(runtimeDataDir, "thumb", "library-assets", `${actionAsset.id}.webp`);
    assert.equal(libraryAssetThumbnailPath(runtime, actionAsset), actionThumbnailPath);
    mkdirSync(path.dirname(actionThumbnailPath), { recursive: true });
    writeFileSync(actionThumbnailPath, "thumbnail");
    assert.equal(existsSync(actionThumbnailPath), true);
    assert.ok((await action.listActions(actionProject.id)).actions.some((item) => item.id === assetAction.id));

    const renamedAction = await action.updateAction(assetAction.id, { name: `${assetAction.name} Renamed` });
    const actionAfterEntryRename = await runtime.repository.getAsset(assetAction.asset_id);
    const entryRenamedPath = path.join(runtime.storageRoot, runtime.labels.actionLibrary, actionProject.name, `${renamedAction.name}.png`);
    assert.equal(path.join(runtime.storageRoot, actionAfterEntryRename.storage_key), entryRenamedPath);
    assert.equal(existsSync(actionAssetPath), false);
    const renamedActionProject = await action.updateProject(actionProject.id, { name: `${actionProject.name} Renamed` });
    const actionAfterProjectRename = await runtime.repository.getAsset(assetAction.asset_id);
    const projectRenamedPath = path.join(runtime.storageRoot, runtime.labels.actionLibrary, renamedActionProject.name, `${renamedAction.name}.png`);
    assert.equal(path.join(runtime.storageRoot, actionAfterProjectRename.storage_key), projectRenamedPath);
    assert.equal(existsSync(entryRenamedPath), false);
    assert.equal(libraryAssetThumbnailPath(runtime, actionAfterProjectRename), actionThumbnailPath);
    assert.equal(existsSync(actionThumbnailPath), true);

    const outfitTag = await outfit.createTag(outfitProject.id, { name: tagName });
    cleanup.push(() => outfit.deleteTag(outfitProject.id, outfitTag.id));
    assert.notEqual(firstTag.id, outfitTag.id);
    await action.updateProject(actionProject.id, { cover_asset_id: null });
    await action.deleteAction(assetAction.id);
    await model.deleteModel(entry.id);
    await outfit.deleteProject(renameOutfitProject.id);
    assert.equal(await runtime.repository.getAsset(assetAction.asset_id), null);
    assert.equal(await runtime.repository.countTable("asset_cleanup_jobs"), 0);
    assert.equal(existsSync(actionAssetPath), false);
    assert.equal(existsSync(actionThumbnailPath), false);
    assert.equal(await runtime.repository.countTable("library_entries"), initialEntryCount);
    await cleanupCreated();

    if (driver === "sqlite") {
      await runtime.close();
      runtime = null;
      const reopened = await createLibraryRuntime({ dataDir: root, runtimeDataDir, databaseDir: path.join(root, "database"), canvasStorageRoot: root, driver });
      try {
        assert.deepEqual(reopened.databaseRuntime.migration.applied, []);
        assert.equal(await reopened.repository.countTable("library_projects"), 3);
      } finally {
        await reopened.close();
      }
    }
  } finally {
    await cleanupCreated();
    try { await runtime?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
}

test("SQLite library database supports CRUD, migration and project-scoped tags", async () => {
  await runDatabaseSmoke("sqlite");
});

test("library startup reconciles legacy ID paths into localized title paths", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forart-library-layout-"));
  const databaseDir = path.join(root, "database");
  const runtimeDataDir = path.join(root, "forart_data");
  let runtime = await createLibraryRuntime({ dataDir: root, runtimeDataDir, databaseDir, canvasStorageRoot: root, driver: "sqlite" });
  try {
    const action = createActionLibraryService(runtime);
    const project = await action.createProject({ name: "迁移项目" });
    const entry = await action.createActionFromFile(project.id, {
      name: "迁移动作",
      buffer: ONE_PIXEL_PNG,
      filename: "legacy.png",
      mime_type: "image/png",
    });
    const asset = await runtime.repository.getAsset(entry.asset_id);
    const canonicalPath = path.join(root, asset.storage_key);
    const canonicalThumbnail = libraryAssetThumbnailPath(runtime, asset);
    const legacyDirectory = path.join(root, "Action Library", project.id, entry.id);
    const legacyPath = path.join(legacyDirectory, `${entry.id}_legacy.png`);
    mkdirSync(legacyDirectory, { recursive: true });
    mkdirSync(path.dirname(canonicalThumbnail), { recursive: true });
    writeFileSync(canonicalThumbnail, "thumbnail");
    renameSync(canonicalPath, legacyPath);
    assert.equal(existsSync(canonicalThumbnail), true);
    await runtime.repository.updateAsset(asset.id, {
      storage_key: path.relative(root, legacyPath),
      filename: path.basename(legacyPath),
    });
    await runtime.close();
    runtime = null;

    const reopened = await createLibraryRuntime({ dataDir: root, runtimeDataDir, databaseDir, canvasStorageRoot: root, driver: "sqlite" });
    try {
      const reconciled = await reopened.repository.getAsset(asset.id);
      const expectedPath = path.join(root, reopened.labels.actionLibrary, project.name, `${entry.name}.png`);
      assert.equal(path.join(root, reconciled.storage_key), expectedPath);
      assert.equal(reconciled.filename, `${entry.name}.png`);
      assert.equal(existsSync(expectedPath), true);
      assert.equal(existsSync(canonicalThumbnail), true);
      assert.equal(existsSync(legacyPath), false);
    } finally {
      await reopened.close();
    }
  } finally {
    try { await runtime?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("English library mode uses localized English root names", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forart-library-english-"));
  const runtime = await createLibraryRuntime({ dataDir: root, runtimeDataDir: path.join(root, "forart_data"), databaseDir: path.join(root, "database"), canvasStorageRoot: root, driver: "sqlite", language: "en-US" });
  try {
    const outfit = createOutfitLibraryService(runtime);
    const project = (await outfit.listProjects()).projects[0];
    const entry = await outfit.createOutfitFromFile(project.id, { name: "Front Outfit", buffer: ONE_PIXEL_PNG, filename: "source.png", mime_type: "image/png" });
    const asset = await runtime.repository.getAsset(entry.asset_id);
    assert.equal(path.join(root, asset.storage_key), path.join(root, "Outfit Library", project.name, "Front Outfit.png"));
  } finally {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("SQLite migrates the released legacy library database to the current schema", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forart-sqlite-upgrade-"));
  const databaseDir = path.join(root, "database");
  const runtimeDataDir = path.join(root, "forart_data");
  const databasePath = path.join(databaseDir, "forart-library.sqlite");
  mkdirSync(databaseDir, { recursive: true });
  seedLegacyLibraryDatabase(databasePath, root);

  try {
    const runtime = await createLibraryRuntime({ dataDir: root, runtimeDataDir, databaseDir, canvasStorageRoot: root, driver: "sqlite" });
    try {
      assert.deepEqual(runtime.databaseRuntime.migration.applied, ["001_legacy_library_to_current"]);
      assert.equal(existsSync(runtime.databaseRuntime.migration.backupPath), true);
      assert.equal(await runtime.repository.countTable("library_projects"), 3);
      assert.equal(await runtime.repository.countTable("library_entries"), 3);
      assert.equal((await runtime.repository.getEntry("action", "action_legacy")).prompt, "旧提示词");
      assert.deepEqual((await runtime.repository.tagsForEntry("action_legacy")).map((tag) => tag.name), ["旧标签"]);
      const modelImages = await runtime.repository.listEntryAssets("model", "model_legacy");
      assert.equal(modelImages.length, 2);
      assert.equal(Number(modelImages[1].is_cover), 1);
      assert.equal(path.join(root, modelImages[0].storage_key), path.join(root, runtime.labels.modelLibrary, "旧模特项目", "模特一", "模特一_001.png"));
      assert.equal(existsSync(path.join(databaseDir, "thumb", "library-assets", "asset_legacy_action.webp")), true);
      assert.equal(existsSync(path.join(runtimeDataDir, "thumb", "library-assets", "asset_legacy_action.webp")), false);
    } finally {
      await runtime.close();
    }
    const reopened = await createLibraryRuntime({ dataDir: root, runtimeDataDir, databaseDir, canvasStorageRoot: root, driver: "sqlite" });
    try {
      assert.deepEqual(reopened.databaseRuntime.migration.applied, []);
      assert.equal(await reopened.repository.countTable("library_entries"), 3);
    } finally {
      await reopened.close();
    }
    const migratedDb = new Database(databasePath, { readonly: true });
    try {
      const tables = migratedDb.prepare("select name from sqlite_master where type = 'table'").all().map((row) => row.name);
      assert.equal(tables.includes("model_projects"), false);
      assert.equal(tables.includes("legacy_model_projects"), false);
      assert.deepEqual(migratedDb.pragma("foreign_key_check"), []);
      assert.equal(migratedDb.pragma("integrity_check", { simple: true }), "ok");
    } finally {
      migratedDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SQLite resumes pending asset cleanup on the next runtime start", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forart-asset-cleanup-"));
  const databaseDir = path.join(root, "database");
  const runtimeDataDir = path.join(root, "forart_data");
  const assetId = "asset_pending_cleanup_test";
  const orphanAssetId = "asset_unreferenced_cleanup_test";
  const storageKey = path.join("Model Library", "pending-cleanup.png");
  const orphanStorageKey = path.join("Model Library", "unreferenced-cleanup.png");
  const assetPath = path.join(root, storageKey);
  const orphanAssetPath = path.join(root, orphanStorageKey);
  mkdirSync(path.dirname(assetPath), { recursive: true });
  writeFileSync(assetPath, ONE_PIXEL_PNG);
  writeFileSync(orphanAssetPath, ONE_PIXEL_PNG);
  const pendingThumbnailKey = path.join("thumb", "library-assets", `${assetId}.webp`);
  const pendingThumbnailPath = path.join(runtimeDataDir, pendingThumbnailKey);
  mkdirSync(path.dirname(pendingThumbnailPath), { recursive: true });
  writeFileSync(pendingThumbnailPath, "thumbnail");

  let runtime = await createLibraryRuntime({ dataDir: root, runtimeDataDir, databaseDir, canvasStorageRoot: root, driver: "sqlite" });
  try {
    await runtime.repository.insertAsset({
      id: assetId,
      storage_key: storageKey,
      filename: "pending-cleanup.png",
      mime_type: "image/png",
      width: 1,
      height: 1,
      size_bytes: ONE_PIXEL_PNG.length,
      sha256: null,
      source: "test",
      created_at: new Date().toISOString(),
    });
    await runtime.repository.takeAssetForCleanup(assetId, new Date().toISOString(), pendingThumbnailKey);
    await runtime.repository.insertAsset({
      id: orphanAssetId,
      storage_key: orphanStorageKey,
      filename: "unreferenced-cleanup.png",
      mime_type: "image/png",
      width: 1,
      height: 1,
      size_bytes: ONE_PIXEL_PNG.length,
      sha256: null,
      source: "test",
      created_at: new Date().toISOString(),
    });
    assert.equal(await runtime.repository.countTable("asset_cleanup_jobs"), 1);
    assert.equal(existsSync(assetPath), true);
    assert.equal(existsSync(pendingThumbnailPath), true);
    assert.equal(existsSync(orphanAssetPath), true);
    await runtime.close();
    runtime = null;

    const reopened = await createLibraryRuntime({ dataDir: root, runtimeDataDir, databaseDir, canvasStorageRoot: root, driver: "sqlite" });
    try {
      assert.equal(await reopened.repository.countTable("asset_cleanup_jobs"), 0);
      assert.equal(await reopened.repository.getAsset(orphanAssetId), null);
      assert.equal(existsSync(assetPath), false);
      assert.equal(existsSync(pendingThumbnailPath), false);
      assert.equal(existsSync(orphanAssetPath), false);
    } finally {
      await reopened.close();
    }
  } finally {
    try { await runtime?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

if (process.env.PGHOST && process.env.FORART_DATABASE_TESTS === "1") {
  test("PostgreSQL library database supports CRUD and project-scoped tags", async () => {
    await runDatabaseSmoke("postgres");
  });
}
