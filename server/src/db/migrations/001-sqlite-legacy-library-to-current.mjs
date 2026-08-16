import { sql } from "kysely";
import { initialLibrarySchemaMigration } from "./001-initial-library-schema.mjs";

const LEGACY_TABLES = [
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
];

const LEGACY_INDEXES = [
  "idx_model_projects_name_unique",
  "idx_model_entries_project_name_unique",
  "idx_outfit_projects_name_unique",
  "idx_outfit_entries_project_name_unique",
  "idx_action_projects_name_unique",
  "idx_action_entries_project_name_unique",
  "idx_model_entries_project_updated",
  "idx_model_images_model_sort",
  "idx_outfit_entries_project_updated",
  "idx_action_entries_project_updated",
  "idx_library_tags_kind_project_sort",
  "idx_library_entry_tags_kind_entry",
  "idx_library_entry_tags_tag",
  "idx_model_projects_sort",
  "idx_outfit_projects_sort",
  "idx_action_projects_sort",
];

async function tableNames(db) {
  return new Set((await db.introspection.getTables()).map((table) => table.name));
}

async function createCurrentSchema(db) {
  await initialLibrarySchemaMigration.up(db);
}

async function renameLegacyTables(db) {
  for (const tableName of LEGACY_TABLES) {
    await db.schema.alterTable(tableName).renameTo(`legacy_${tableName}`).execute();
  }
  for (const indexName of LEGACY_INDEXES) {
    await sql.raw(`drop index if exists "${indexName}"`).execute(db);
  }
}

async function copyLegacyData(db) {
  await sql`
    insert into assets (
      id, storage_key, filename, mime_type, width, height,
      size_bytes, sha256, source, created_at
    )
    select
      id, path, filename, mime_type, width, height,
      0, null, source, created_at
    from legacy_assets
  `.execute(db);

  for (const [kind, legacyTable] of [
    ["model", "legacy_model_projects"],
    ["outfit", "legacy_outfit_projects"],
    ["action", "legacy_action_projects"],
  ]) {
    await sql.raw(`
      insert into library_projects (
        id, kind, name, cover_asset_id, sort_order, created_at, updated_at
      )
      select
        project.id,
        '${kind}',
        project.name,
        case when asset.id is not null then project.cover_asset_id else null end,
        project.sort_order,
        project.created_at,
        project.updated_at
      from ${legacyTable} project
      left join assets asset on asset.id = project.cover_asset_id
    `).execute(db);
  }

  await sql`
    insert into library_entries (id, project_id, kind, name, created_at, updated_at)
    select id, project_id, 'model', name, created_at, updated_at from legacy_model_entries
  `.execute(db);
  await sql`
    insert into library_entries (id, project_id, kind, name, created_at, updated_at)
    select id, project_id, 'outfit', name, created_at, updated_at from legacy_outfit_entries
  `.execute(db);
  await sql`
    insert into library_entries (id, project_id, kind, name, created_at, updated_at)
    select id, project_id, 'action', name, created_at, updated_at from legacy_action_entries
  `.execute(db);

  await sql`
    insert into model_profiles (entry_id, code, gender)
    select id, code, gender from legacy_model_entries
  `.execute(db);
  await sql`
    insert into action_profiles (entry_id, prompt)
    select id, prompt from legacy_action_entries
  `.execute(db);

  await sql`
    insert into library_entry_assets (
      id, entry_id, project_id, kind, asset_id, role,
      is_cover, caption, sort_order, created_at
    )
    select
      image.id,
      image.model_id,
      model.project_id,
      'model',
      image.asset_id,
      'gallery',
      case when image.id = coalesce(
        case when selected_cover.id is not null then model.cover_image_id end,
        (
          select fallback.id
          from legacy_model_images fallback
          where fallback.model_id = image.model_id
          order by fallback.sort_order asc, fallback.created_at asc, fallback.id asc
          limit 1
        )
      ) then 1 else 0 end,
      image.caption,
      image.sort_order,
      image.created_at
    from legacy_model_images image
    inner join legacy_model_entries model on model.id = image.model_id
    inner join assets asset on asset.id = image.asset_id
    left join legacy_model_images selected_cover
      on selected_cover.id = model.cover_image_id
      and selected_cover.model_id = model.id
  `.execute(db);

  await sql`
    insert into library_entry_assets (
      id, entry_id, project_id, kind, asset_id, role,
      is_cover, caption, sort_order, created_at
    )
    select
      entry.id, entry.id, entry.project_id, 'outfit', entry.asset_id,
      'primary', 1, '', 0, entry.created_at
    from legacy_outfit_entries entry
    inner join assets asset on asset.id = entry.asset_id
  `.execute(db);
  await sql`
    insert into library_entry_assets (
      id, entry_id, project_id, kind, asset_id, role,
      is_cover, caption, sort_order, created_at
    )
    select
      entry.id, entry.id, entry.project_id, 'action', entry.asset_id,
      'primary', 1, '', 0, entry.created_at
    from legacy_action_entries entry
    inner join assets asset on asset.id = entry.asset_id
  `.execute(db);

  await sql`
    insert into library_tags (
      id, project_id, kind, name, color, sort_order, created_at, updated_at
    )
    select id, project_id, kind, name, color, sort_order, created_at, updated_at
    from legacy_library_tags
  `.execute(db);
  await sql`
    insert into library_entry_tags (entry_id, tag_id, project_id, kind, created_at)
    select binding.entry_id, binding.tag_id, tag.project_id, tag.kind, binding.created_at
    from legacy_library_entry_tags binding
    inner join library_tags tag on tag.id = binding.tag_id and tag.kind = binding.kind
    inner join library_entries entry
      on entry.id = binding.entry_id
      and entry.project_id = tag.project_id
      and entry.kind = tag.kind
  `.execute(db);
}

async function removeLegacyTables(db) {
  await sql`update legacy_model_entries set cover_image_id = null`.execute(db);
  for (const tableName of [
    "legacy_library_entry_tags",
    "legacy_model_images",
    "legacy_model_entries",
    "legacy_outfit_entries",
    "legacy_action_entries",
    "legacy_library_tags",
    "legacy_model_projects",
    "legacy_outfit_projects",
    "legacy_action_projects",
    "legacy_assets",
  ]) {
    await sql.raw(`drop table "${tableName}"`).execute(db);
  }
}

export const sqliteLegacyLibraryToCurrentMigration = {
  async up(db) {
    const tables = await tableNames(db);
    if (tables.has("library_projects")) return;
    const hasLegacySchema = LEGACY_TABLES.every((tableName) => tables.has(tableName));
    if (!hasLegacySchema && LEGACY_TABLES.some((tableName) => tables.has(tableName))) {
      throw new Error("Legacy library database is incomplete and cannot be migrated safely");
    }
    if (!hasLegacySchema) {
      await createCurrentSchema(db);
      return;
    }

    await renameLegacyTables(db);
    await createCurrentSchema(db);
    await copyLegacyData(db);
    await removeLegacyTables(db);
  },

  async down(db) {
    await initialLibrarySchemaMigration.down(db);
  },
};
