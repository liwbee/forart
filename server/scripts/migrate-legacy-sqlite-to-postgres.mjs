#!/usr/bin/env node
import { migrateLegacyLibraryToPostgres } from "../src/db/legacy-postgres-import.mjs";

function usage() {
  return `Usage:
  node scripts/migrate-legacy-sqlite-to-postgres.mjs \\
    --source /migration/forart-library.sqlite \\
    --library-root /library [--dry-run] [--replace-library] [--allow-incomplete]

PostgreSQL connection uses DATABASE_URL or PGHOST, PGPORT, PGDATABASE, PGUSER and PGPASSWORD.

Options:
  --source PATH          Legacy or current Forart SQLite database
  --library-root PATH    Directory mounted as FORART_LIBRARY_DIR
  --database-url URL     Optional PostgreSQL connection string
  --dry-run              Validate the source without connecting to PostgreSQL
  --replace-library      Replace non-bootstrap library data in PostgreSQL
  --allow-incomplete     Import despite missing/unreferenced files or normalized count loss
  --help                 Show this help
`;
}

function parseArgs(argv) {
  const options = { dryRun: false, replaceLibrary: false, strict: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--replace-library") options.replaceLibrary = true;
    else if (argument === "--allow-incomplete") options.strict = false;
    else if (["--source", "--library-root", "--database-url"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--source") options.sourcePath = value;
      else if (argument === "--library-root") options.libraryRoot = value;
      else options.databaseUrl = value;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
  } else {
    const result = await migrateLegacyLibraryToPostgres(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(result.dryRun ? "Forart migration dry-run passed.\n" : "Forart PostgreSQL import completed successfully.\n");
  }
} catch (error) {
  process.stderr.write(`Forart PostgreSQL import failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
