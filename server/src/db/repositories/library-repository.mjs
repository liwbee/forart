import { sql } from "kysely";

function countValue(row) {
  return Number(row?.count || 0);
}

function compactUpdate(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

export function createLibraryRepository(db, { driver = "sqlite" } = {}) {
  const repository = {
    db,

    async transaction(work) {
      return db.transaction().execute((transaction) => work(createLibraryRepository(transaction, { driver })));
    },

    async getProject(kind, projectId) {
      return await db.selectFrom("library_projects").selectAll().where("kind", "=", kind).where("id", "=", projectId).executeTakeFirst() || null;
    },

    async listProjects(kind) {
      return db.selectFrom("library_projects").selectAll().where("kind", "=", kind).orderBy("sort_order", "asc").orderBy("created_at", "desc").execute();
    },

    async projectNameExists(kind, name, exceptProjectId = "") {
      let query = db.selectFrom("library_projects").select("id").where("kind", "=", kind).where("name", "=", name);
      if (exceptProjectId) query = query.where("id", "!=", exceptProjectId);
      return Boolean(await query.executeTakeFirst());
    },

    async nextProjectSortOrder(kind) {
      const row = await db.selectFrom("library_projects").select(sql`coalesce(min(sort_order), 0) - 1`.as("next")).where("kind", "=", kind).executeTakeFirst();
      return Number(row?.next || 0);
    },

    async insertProject(project) {
      await db.insertInto("library_projects").values(project).execute();
      return repository.getProject(project.kind, project.id);
    },

    async insertProjectIfAbsent(project) {
      await db.insertInto("library_projects").values(project)
        .onConflict((conflict) => conflict.columns(["kind", "name"]).doNothing())
        .execute();
      return await db.selectFrom("library_projects").selectAll().where("kind", "=", project.kind).where("name", "=", project.name).executeTakeFirst() || null;
    },

    async updateProject(kind, projectId, values) {
      const update = compactUpdate(values);
      if (Object.keys(update).length) {
        await db.updateTable("library_projects").set(update).where("kind", "=", kind).where("id", "=", projectId).execute();
      }
      return repository.getProject(kind, projectId);
    },

    async deleteProject(kind, projectId) {
      const result = await db.deleteFrom("library_projects").where("kind", "=", kind).where("id", "=", projectId).executeTakeFirst();
      return Number(result.numDeletedRows || 0);
    },

    async countProjects(kind) {
      return countValue(await db.selectFrom("library_projects").select(sql`count(*)`.as("count")).where("kind", "=", kind).executeTakeFirst());
    },

    async getEntry(kind, entryId) {
      let query = db.selectFrom("library_entries as entry").selectAll("entry").where("entry.kind", "=", kind).where("entry.id", "=", entryId);
      if (kind === "model") {
        query = query.leftJoin("model_profiles as profile", "profile.entry_id", "entry.id").select(["profile.code", "profile.gender"]);
      } else if (kind === "action") {
        query = query.leftJoin("action_profiles as profile", "profile.entry_id", "entry.id").select("profile.prompt");
      }
      return await query.executeTakeFirst() || null;
    },

    async listEntries(kind, projectId) {
      let query = db.selectFrom("library_entries as entry").selectAll("entry").where("entry.kind", "=", kind).where("entry.project_id", "=", projectId);
      if (kind === "model") {
        query = query.leftJoin("model_profiles as profile", "profile.entry_id", "entry.id").select(["profile.code", "profile.gender"]);
      } else if (kind === "action") {
        query = query.leftJoin("action_profiles as profile", "profile.entry_id", "entry.id").select("profile.prompt");
      }
      return query.orderBy("entry.updated_at", "desc").orderBy("entry.created_at", "desc").execute();
    },

    async listEntriesOldestFirst(kind, projectId) {
      return db.selectFrom("library_entries")
        .selectAll()
        .where("kind", "=", kind)
        .where("project_id", "=", projectId)
        .orderBy("created_at", "asc")
        .orderBy("id", "asc")
        .execute();
    },

    async listEntriesByIds(kind, entryIds) {
      if (!entryIds.length) return [];
      let query = db.selectFrom("library_entries as entry").selectAll("entry").where("entry.kind", "=", kind).where("entry.id", "in", entryIds);
      if (kind === "model") {
        query = query.leftJoin("model_profiles as profile", "profile.entry_id", "entry.id").select(["profile.code", "profile.gender"]);
      } else if (kind === "action") {
        query = query.leftJoin("action_profiles as profile", "profile.entry_id", "entry.id").select("profile.prompt");
      }
      return query.execute();
    },

    async entryNameExists(projectId, name, exceptEntryId = "") {
      let query = db.selectFrom("library_entries").select("id").where("project_id", "=", projectId).where("name", "=", name);
      if (exceptEntryId) query = query.where("id", "!=", exceptEntryId);
      return Boolean(await query.executeTakeFirst());
    },

    async insertEntry(entry, profile = null) {
      await db.insertInto("library_entries").values(entry).execute();
      if (entry.kind === "model") {
        await db.insertInto("model_profiles").values({ entry_id: entry.id, code: profile?.code || "", gender: profile?.gender || "unknown" }).execute();
      } else if (entry.kind === "action") {
        await db.insertInto("action_profiles").values({ entry_id: entry.id, prompt: profile?.prompt || "" }).execute();
      }
      return repository.getEntry(entry.kind, entry.id);
    },

    async updateEntry(kind, entryId, values, profile = null) {
      const update = compactUpdate(values);
      if (Object.keys(update).length) {
        await db.updateTable("library_entries").set(update).where("kind", "=", kind).where("id", "=", entryId).execute();
      }
      if (kind === "model" && profile) {
        const profileUpdate = compactUpdate(profile);
        if (Object.keys(profileUpdate).length) {
          await db.updateTable("model_profiles").set(profileUpdate).where("entry_id", "=", entryId).execute();
        }
      } else if (kind === "action" && profile) {
        const profileUpdate = compactUpdate(profile);
        if (Object.keys(profileUpdate).length) {
          await db.updateTable("action_profiles").set(profileUpdate).where("entry_id", "=", entryId).execute();
        }
      }
      return repository.getEntry(kind, entryId);
    },

    async deleteEntry(kind, entryId) {
      const result = await db.deleteFrom("library_entries").where("kind", "=", kind).where("id", "=", entryId).executeTakeFirst();
      return Number(result.numDeletedRows || 0);
    },

    async getAsset(assetId) {
      return await db.selectFrom("assets").selectAll().where("id", "=", assetId).executeTakeFirst() || null;
    },

    async assetStorageKeyExistsWithPrefix(storageKeyPrefix) {
      const startsWithPrefix = driver === "postgres"
        ? sql`strpos(storage_key, ${storageKeyPrefix}) = 1`
        : sql`instr(storage_key, ${storageKeyPrefix}) = 1`;
      return Boolean(await db.selectFrom("assets")
        .select("id")
        .where(startsWithPrefix)
        .executeTakeFirst());
    },

    async insertAsset(asset) {
      await db.insertInto("assets").values(asset).execute();
      return repository.getAsset(asset.id);
    },

    async updateAsset(assetId, values) {
      const update = compactUpdate(values);
      if (Object.keys(update).length) await db.updateTable("assets").set(update).where("id", "=", assetId).execute();
      return repository.getAsset(assetId);
    },

    async deleteAsset(assetId) {
      const result = await db.deleteFrom("assets").where("id", "=", assetId).executeTakeFirst();
      return Number(result.numDeletedRows || 0);
    },

    async assetReferenceCount(assetId) {
      const project = countValue(await db.selectFrom("library_projects").select(sql`count(*)`.as("count")).where("cover_asset_id", "=", assetId).executeTakeFirst());
      const entry = countValue(await db.selectFrom("library_entry_assets").select(sql`count(*)`.as("count")).where("asset_id", "=", assetId).executeTakeFirst());
      return project + entry;
    },

    async entryAssetReferenceCount(assetId) {
      return countValue(await db.selectFrom("library_entry_assets")
        .select(sql`count(*)`.as("count"))
        .where("asset_id", "=", assetId)
        .executeTakeFirst());
    },

    async getAssetOwnerEntryLink(assetId) {
      return db.selectFrom("library_entry_assets")
        .select(["id", "entry_id", "project_id", "kind"])
        .where("asset_id", "=", assetId)
        .orderBy("created_at", "asc")
        .orderBy("id", "asc")
        .executeTakeFirst();
    },

    async takeAssetForCleanup(assetId, requestedAt, thumbnailStorageKey = "") {
      return repository.transaction(async (tx) => {
        let query = tx.db.selectFrom("assets").selectAll().where("id", "=", assetId);
        if (driver === "postgres") query = query.forUpdate();
        const asset = await query.executeTakeFirst();
        if (!asset || await tx.assetReferenceCount(assetId)) return null;
        const job = {
          asset_id: asset.id,
          storage_key: asset.storage_key,
          thumbnail_storage_key: String(thumbnailStorageKey || "") || null,
          requested_at: requestedAt,
          attempts: 0,
          last_error: "",
        };
        await tx.db.insertInto("asset_cleanup_jobs").values(job).execute();
        await tx.deleteAsset(assetId);
        return { asset, job };
      });
    },

    async listAssetCleanupJobs() {
      return db.selectFrom("asset_cleanup_jobs").selectAll().orderBy("requested_at", "asc").execute();
    },

    async listUnreferencedAssetIds() {
      const rows = await db.selectFrom("assets as asset")
        .leftJoin("library_entry_assets as entry_asset", "entry_asset.asset_id", "asset.id")
        .leftJoin("library_projects as project", "project.cover_asset_id", "asset.id")
        .select("asset.id")
        .where("entry_asset.asset_id", "is", null)
        .where("project.cover_asset_id", "is", null)
        .execute();
      return rows.map((row) => row.id);
    },

    async completeAssetCleanup(assetId) {
      await db.deleteFrom("asset_cleanup_jobs").where("asset_id", "=", assetId).execute();
    },

    async failAssetCleanup(assetId, error) {
      await db.updateTable("asset_cleanup_jobs")
        .set({ attempts: sql`attempts + 1`, last_error: String(error || "").slice(0, 2000) })
        .where("asset_id", "=", assetId)
        .execute();
    },

    async listProjectAssetIds(kind, projectId) {
      const project = await repository.getProject(kind, projectId);
      const rows = await db.selectFrom("library_entry_assets").select("asset_id").where("kind", "=", kind).where("project_id", "=", projectId).execute();
      return Array.from(new Set([project?.cover_asset_id, ...rows.map((row) => row.asset_id)].filter(Boolean)));
    },

    async listEntryAssets(kind, entryId) {
      return db.selectFrom("library_entry_assets as link")
        .innerJoin("assets as asset", "asset.id", "link.asset_id")
        .select([
          "link.id", "link.entry_id", "link.project_id", "link.kind", "link.asset_id", "link.role", "link.is_cover",
          "link.caption", "link.sort_order", "link.created_at", "asset.storage_key", "asset.filename", "asset.mime_type",
          "asset.width", "asset.height", "asset.size_bytes", "asset.sha256", "asset.source",
        ])
        .where("link.kind", "=", kind)
        .where("link.entry_id", "=", entryId)
        .orderBy("link.sort_order", "asc")
        .orderBy("link.created_at", "asc")
        .execute();
    },

    async listEntryAssetsForEntries(kind, entryIds) {
      if (!entryIds.length) return [];
      return db.selectFrom("library_entry_assets as link")
        .innerJoin("assets as asset", "asset.id", "link.asset_id")
        .select([
          "link.id", "link.entry_id", "link.project_id", "link.kind", "link.asset_id", "link.role", "link.is_cover",
          "link.caption", "link.sort_order", "link.created_at", "asset.storage_key", "asset.filename", "asset.mime_type",
          "asset.width", "asset.height", "asset.size_bytes", "asset.sha256", "asset.source",
        ])
        .where("link.kind", "=", kind)
        .where("link.entry_id", "in", entryIds)
        .orderBy("link.entry_id", "asc")
        .orderBy("link.sort_order", "asc")
        .orderBy("link.created_at", "asc")
        .execute();
    },

    async listEntryAssetLinksForAssets(assetIds) {
      const uniqueAssetIds = Array.from(new Set(assetIds.map((assetId) => String(assetId || "")).filter(Boolean)));
      if (!uniqueAssetIds.length) return [];
      const rows = [];
      // Stay below conservative SQLite parameter limits while keeping startup
      // reconciliation to a handful of bulk queries for PostgreSQL.
      for (let offset = 0; offset < uniqueAssetIds.length; offset += 500) {
        const batch = uniqueAssetIds.slice(offset, offset + 500);
        rows.push(...await db.selectFrom("library_entry_assets")
          .select(["id", "entry_id", "project_id", "kind", "asset_id", "created_at"])
          .where("asset_id", "in", batch)
          .orderBy("asset_id", "asc")
          .orderBy("created_at", "asc")
          .orderBy("id", "asc")
          .execute());
      }
      return rows;
    },

    async getEntryAsset(linkId) {
      return await db.selectFrom("library_entry_assets as link")
        .innerJoin("assets as asset", "asset.id", "link.asset_id")
        .select([
          "link.id", "link.entry_id", "link.project_id", "link.kind", "link.asset_id", "link.role", "link.is_cover",
          "link.caption", "link.sort_order", "link.created_at", "asset.storage_key", "asset.filename", "asset.mime_type",
          "asset.width", "asset.height", "asset.size_bytes", "asset.sha256", "asset.source",
        ])
        .where("link.id", "=", linkId)
        .executeTakeFirst() || null;
    },

    async insertEntryAsset(link) {
      await db.insertInto("library_entry_assets").values(link).execute();
      return repository.getEntryAsset(link.id);
    },

    async updateEntryAsset(linkId, values) {
      await db.updateTable("library_entry_assets").set(compactUpdate(values)).where("id", "=", linkId).execute();
      return repository.getEntryAsset(linkId);
    },

    async clearEntryCover(entryId) {
      await db.updateTable("library_entry_assets").set({ is_cover: 0 }).where("entry_id", "=", entryId).execute();
    },

    async deleteEntryAsset(linkId) {
      const link = await repository.getEntryAsset(linkId);
      if (!link) return null;
      await db.deleteFrom("library_entry_assets").where("id", "=", linkId).execute();
      return link;
    },

    async deleteEntryAssets(entryId) {
      await db.deleteFrom("library_entry_assets").where("entry_id", "=", entryId).execute();
    },

    async listTags(projectId) {
      const rows = await db.selectFrom("library_tags as tag")
        .leftJoin("library_entry_tags as binding", "binding.tag_id", "tag.id")
        .selectAll("tag")
        .select(sql`count(binding.entry_id)`.as("usage_count"))
        .where("tag.project_id", "=", projectId)
        .groupBy(["tag.id", "tag.project_id", "tag.kind", "tag.name", "tag.color", "tag.sort_order", "tag.created_at", "tag.updated_at"])
        .orderBy("tag.sort_order", "asc")
        .orderBy("tag.name", "asc")
        .execute();
      return rows.map((row) => ({ ...row, usage_count: Number(row.usage_count || 0) }));
    },

    async getTag(projectId, tagId) {
      return await db.selectFrom("library_tags").selectAll().where("project_id", "=", projectId).where("id", "=", tagId).executeTakeFirst() || null;
    },

    async getTagByName(projectId, name) {
      return await db.selectFrom("library_tags").selectAll().where("project_id", "=", projectId).where("name", "=", name).executeTakeFirst() || null;
    },

    async listTagsByIds(projectId, tagIds) {
      if (!tagIds.length) return [];
      return db.selectFrom("library_tags").selectAll().where("project_id", "=", projectId).where("id", "in", tagIds).execute();
    },

    async listTagsByNames(projectId, names) {
      if (!names.length) return [];
      return db.selectFrom("library_tags").selectAll().where("project_id", "=", projectId).where("name", "in", names).execute();
    },

    async insertTag(tag) {
      await db.insertInto("library_tags").values(tag).execute();
      return repository.getTag(tag.project_id, tag.id);
    },

    async insertTagIfAbsent(tag) {
      await db.insertInto("library_tags").values(tag)
        .onConflict((conflict) => conflict.columns(["project_id", "name"]).doNothing())
        .execute();
      return repository.getTagByName(tag.project_id, tag.name);
    },

    async updateTag(projectId, tagId, values) {
      await db.updateTable("library_tags").set(compactUpdate(values)).where("project_id", "=", projectId).where("id", "=", tagId).execute();
      return repository.getTag(projectId, tagId);
    },

    async deleteTag(projectId, tagId) {
      const result = await db.deleteFrom("library_tags").where("project_id", "=", projectId).where("id", "=", tagId).executeTakeFirst();
      return Number(result.numDeletedRows || 0);
    },

    async nextTagSortOrder(projectId) {
      const row = await db.selectFrom("library_tags").select(sql`coalesce(max(sort_order), 0) + 1`.as("next")).where("project_id", "=", projectId).executeTakeFirst();
      return Number(row?.next || 1);
    },

    async tagsForEntry(entryId) {
      return db.selectFrom("library_entry_tags as binding")
        .innerJoin("library_tags as tag", "tag.id", "binding.tag_id")
        .select(["tag.id", "tag.name", "tag.color", "tag.sort_order"])
        .where("binding.entry_id", "=", entryId)
        .orderBy("tag.sort_order", "asc")
        .orderBy("tag.name", "asc")
        .execute();
    },

    async tagsForEntries(entryIds) {
      if (!entryIds.length) return [];
      return db.selectFrom("library_entry_tags as binding")
        .innerJoin("library_tags as tag", "tag.id", "binding.tag_id")
        .select(["binding.entry_id", "tag.id", "tag.name", "tag.color", "tag.sort_order"])
        .where("binding.entry_id", "in", entryIds)
        .orderBy("binding.entry_id", "asc")
        .orderBy("tag.sort_order", "asc")
        .orderBy("tag.name", "asc")
        .execute();
    },

    async replaceEntryTags({ entryId, projectId, kind, tags }) {
      await db.deleteFrom("library_entry_tags").where("entry_id", "=", entryId).execute();
      if (!tags.length) return;
      await db.insertInto("library_entry_tags").values(tags.map((tag) => ({
        entry_id: entryId,
        tag_id: tag.id,
        project_id: projectId,
        kind,
        created_at: new Date().toISOString(),
      }))).execute();
    },

    async replaceEntriesTags({ entries, projectId, kind, updatedAt }) {
      const entryIds = entries.map((entry) => entry.entryId);
      if (!entryIds.length) return;
      await db.deleteFrom("library_entry_tags").where("entry_id", "in", entryIds).execute();
      const bindings = entries.flatMap((entry) => entry.tags.map((tag) => ({
        entry_id: entry.entryId,
        tag_id: tag.id,
        project_id: projectId,
        kind,
        created_at: updatedAt,
      })));
      if (bindings.length) await db.insertInto("library_entry_tags").values(bindings).execute();
      await db.updateTable("library_entries").set({ updated_at: updatedAt }).where("kind", "=", kind).where("id", "in", entryIds).execute();
    },

    async countTable(tableName) {
      const allowed = new Set(["assets", "asset_cleanup_jobs", "library_projects", "library_entries", "library_tags", "library_entry_tags", "library_entry_assets"]);
      if (!allowed.has(tableName)) throw new Error(`Unsupported count table: ${tableName}`);
      return countValue(await db.selectFrom(tableName).select(sql`count(*)`.as("count")).executeTakeFirst());
    },

    async countKind(tableName, kind) {
      const allowed = new Set(["library_projects", "library_entries"]);
      if (!allowed.has(tableName)) throw new Error(`Unsupported kind count table: ${tableName}`);
      return countValue(await db.selectFrom(tableName).select(sql`count(*)`.as("count")).where("kind", "=", kind).executeTakeFirst());
    },
  };

  return repository;
}
