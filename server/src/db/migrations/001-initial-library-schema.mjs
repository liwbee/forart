import { sql } from "kysely";

const LIBRARY_KINDS = sql`kind in ('model', 'outfit', 'action')`;

export const initialLibrarySchemaMigration = {
  async up(db) {
    await db.schema
      .createTable("assets")
      .addColumn("id", "varchar(96)", (column) => column.primaryKey())
      .addColumn("storage_key", "varchar(1024)", (column) => column.notNull().unique())
      .addColumn("filename", "varchar(512)", (column) => column.notNull())
      .addColumn("mime_type", "varchar(255)", (column) => column.notNull())
      .addColumn("width", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("height", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("size_bytes", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("sha256", "varchar(64)")
      .addColumn("source", "varchar(128)", (column) => column.notNull())
      .addColumn("created_at", "varchar(32)", (column) => column.notNull())
      .execute();

    await db.schema
      .createTable("library_projects")
      .addColumn("id", "varchar(96)", (column) => column.primaryKey())
      .addColumn("kind", "varchar(16)", (column) => column.notNull())
      .addColumn("name", "varchar(255)", (column) => column.notNull())
      .addColumn("cover_asset_id", "varchar(96)", (column) => column.references("assets.id").onDelete("set null"))
      .addColumn("sort_order", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("created_at", "varchar(32)", (column) => column.notNull())
      .addColumn("updated_at", "varchar(32)", (column) => column.notNull())
      .addCheckConstraint("library_projects_kind_check", LIBRARY_KINDS)
      .addUniqueConstraint("library_projects_kind_name_unique", ["kind", "name"])
      .addUniqueConstraint("library_projects_id_kind_unique", ["id", "kind"])
      .execute();

    await db.schema
      .createTable("library_entries")
      .addColumn("id", "varchar(96)", (column) => column.primaryKey())
      .addColumn("project_id", "varchar(96)", (column) => column.notNull())
      .addColumn("kind", "varchar(16)", (column) => column.notNull())
      .addColumn("name", "varchar(255)", (column) => column.notNull())
      .addColumn("created_at", "varchar(32)", (column) => column.notNull())
      .addColumn("updated_at", "varchar(32)", (column) => column.notNull())
      .addCheckConstraint("library_entries_kind_check", LIBRARY_KINDS)
      .addUniqueConstraint("library_entries_project_name_unique", ["project_id", "name"])
      .addUniqueConstraint("library_entries_id_project_kind_unique", ["id", "project_id", "kind"])
      .addForeignKeyConstraint(
        "library_entries_project_kind_fk",
        ["project_id", "kind"],
        "library_projects",
        ["id", "kind"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .execute();

    await db.schema
      .createTable("model_profiles")
      .addColumn("entry_id", "varchar(96)", (column) => column.primaryKey().references("library_entries.id").onDelete("cascade"))
      .addColumn("code", "varchar(255)", (column) => column.notNull())
      .addColumn("gender", "varchar(32)", (column) => column.notNull().defaultTo("unknown"))
      .execute();

    await db.schema
      .createTable("action_profiles")
      .addColumn("entry_id", "varchar(96)", (column) => column.primaryKey().references("library_entries.id").onDelete("cascade"))
      .addColumn("prompt", "text", (column) => column.notNull().defaultTo(""))
      .execute();

    await db.schema
      .createTable("library_entry_assets")
      .addColumn("id", "varchar(96)", (column) => column.primaryKey())
      .addColumn("entry_id", "varchar(96)", (column) => column.notNull())
      .addColumn("project_id", "varchar(96)", (column) => column.notNull())
      .addColumn("kind", "varchar(16)", (column) => column.notNull())
      .addColumn("asset_id", "varchar(96)", (column) => column.notNull().references("assets.id").onDelete("cascade"))
      .addColumn("role", "varchar(32)", (column) => column.notNull())
      .addColumn("is_cover", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("caption", "text", (column) => column.notNull().defaultTo(""))
      .addColumn("sort_order", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("created_at", "varchar(32)", (column) => column.notNull())
      .addCheckConstraint("library_entry_assets_kind_check", LIBRARY_KINDS)
      .addCheckConstraint("library_entry_assets_role_check", sql`role in ('primary', 'reference', 'gallery')`)
      .addCheckConstraint("library_entry_assets_cover_check", sql`is_cover in (0, 1)`)
      .addUniqueConstraint("library_entry_assets_entry_asset_role_unique", ["entry_id", "asset_id", "role"])
      .addForeignKeyConstraint(
        "library_entry_assets_entry_project_kind_fk",
        ["entry_id", "project_id", "kind"],
        "library_entries",
        ["id", "project_id", "kind"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .execute();

    await db.schema
      .createTable("library_tags")
      .addColumn("id", "varchar(96)", (column) => column.primaryKey())
      .addColumn("project_id", "varchar(96)", (column) => column.notNull())
      .addColumn("kind", "varchar(16)", (column) => column.notNull())
      .addColumn("name", "varchar(96)", (column) => column.notNull())
      .addColumn("color", "varchar(32)", (column) => column.notNull().defaultTo("default"))
      .addColumn("sort_order", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("created_at", "varchar(32)", (column) => column.notNull())
      .addColumn("updated_at", "varchar(32)", (column) => column.notNull())
      .addCheckConstraint("library_tags_kind_check", LIBRARY_KINDS)
      .addUniqueConstraint("library_tags_project_name_unique", ["project_id", "name"])
      .addUniqueConstraint("library_tags_id_project_kind_unique", ["id", "project_id", "kind"])
      .addForeignKeyConstraint(
        "library_tags_project_kind_fk",
        ["project_id", "kind"],
        "library_projects",
        ["id", "kind"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .execute();

    await db.schema
      .createTable("library_entry_tags")
      .addColumn("entry_id", "varchar(96)", (column) => column.notNull())
      .addColumn("tag_id", "varchar(96)", (column) => column.notNull())
      .addColumn("project_id", "varchar(96)", (column) => column.notNull())
      .addColumn("kind", "varchar(16)", (column) => column.notNull())
      .addColumn("created_at", "varchar(32)", (column) => column.notNull())
      .addPrimaryKeyConstraint("library_entry_tags_pk", ["entry_id", "tag_id"])
      .addForeignKeyConstraint(
        "library_entry_tags_entry_project_kind_fk",
        ["entry_id", "project_id", "kind"],
        "library_entries",
        ["id", "project_id", "kind"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .addForeignKeyConstraint(
        "library_entry_tags_tag_project_kind_fk",
        ["tag_id", "project_id", "kind"],
        "library_tags",
        ["id", "project_id", "kind"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .execute();

    await db.schema
      .createTable("asset_cleanup_jobs")
      .addColumn("asset_id", "varchar(96)", (column) => column.primaryKey())
      .addColumn("storage_key", "varchar(1024)", (column) => column.notNull().unique())
      .addColumn("thumbnail_storage_key", "varchar(1024)")
      .addColumn("requested_at", "varchar(32)", (column) => column.notNull())
      .addColumn("attempts", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("last_error", "text", (column) => column.notNull().defaultTo(""))
      .execute();

    await db.schema.createIndex("library_projects_kind_sort_idx").on("library_projects").columns(["kind", "sort_order", "created_at"]).execute();
    await db.schema.createIndex("library_entries_project_updated_idx").on("library_entries").columns(["project_id", "updated_at", "created_at"]).execute();
    await db.schema.createIndex("library_entry_assets_entry_sort_idx").on("library_entry_assets").columns(["entry_id", "sort_order", "created_at"]).execute();
    await db.schema.createIndex("library_entry_assets_asset_idx").on("library_entry_assets").column("asset_id").execute();
    await db.schema.createIndex("library_tags_project_sort_idx").on("library_tags").columns(["project_id", "sort_order", "name"]).execute();
    await db.schema.createIndex("library_entry_tags_tag_idx").on("library_entry_tags").column("tag_id").execute();
    await sql`create unique index library_entry_assets_one_cover_idx on library_entry_assets(entry_id) where is_cover = 1`.execute(db);
    await sql`create unique index library_entry_assets_one_primary_idx on library_entry_assets(entry_id) where role = 'primary'`.execute(db);
  },

  async down(db) {
    await db.schema.dropTable("asset_cleanup_jobs").ifExists().execute();
    await db.schema.dropTable("library_entry_tags").ifExists().execute();
    await db.schema.dropTable("library_tags").ifExists().execute();
    await db.schema.dropTable("library_entry_assets").ifExists().execute();
    await db.schema.dropTable("action_profiles").ifExists().execute();
    await db.schema.dropTable("model_profiles").ifExists().execute();
    await db.schema.dropTable("library_entries").ifExists().execute();
    await db.schema.dropTable("library_projects").ifExists().execute();
    await db.schema.dropTable("assets").ifExists().execute();
  },
};
