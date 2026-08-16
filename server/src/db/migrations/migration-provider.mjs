import { initialLibrarySchemaMigration } from "./001-initial-library-schema.mjs";
import { sqliteLegacyLibraryToCurrentMigration } from "./001-sqlite-legacy-library-to-current.mjs";

const MIGRATIONS = Object.freeze({
  "001_initial_library_schema": initialLibrarySchemaMigration,
});

export const postgresLibraryMigrationProvider = {
  async getMigrations() {
    return MIGRATIONS;
  },
};

export const sqliteLibraryMigrationProvider = {
  async getMigrations() {
    return {
      "001_legacy_library_to_current": sqliteLegacyLibraryToCurrentMigration,
    };
  },
};
