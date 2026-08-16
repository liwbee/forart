# Forart Server

Lightweight server for Forart.

Responsibilities:

- Provides database APIs.
- Stores server-side resource files.
- Runs in Docker.
- Does not run Electron code or bundled desktop UI.
- Uses PostgreSQL in the server deployment; SQLite is reserved for the desktop local mode.

## Development

Run the server with PostgreSQL. The server defaults to PostgreSQL, so no driver
or connection-string variable is required:

```powershell
$env:PGHOST="127.0.0.1"
$env:PGPORT="5432"
$env:PGDATABASE="forart"
$env:PGUSER="forart"
$env:PGPASSWORD="<password>"
npm run dev
```

The administrative React bundle is generated into `server/admin` and is not
source-controlled. Build it once before running the server locally:

```powershell
npm run build:admin
```

Docker builds the administrative bundle automatically from `admin-app`.

SQLite is used by the desktop local mode.

Default address:

```text
http://127.0.0.1:6980
```

Set `FORART_ADMIN_PASSWORD` when deploying the server to create or synchronize
the administrator account during startup. The username defaults to `admin` and
can be changed with `FORART_ADMIN_USERNAME`. The administrator and later
members sign in with a username and password; email is not part of the Forart
account UI. Public registration is disabled.

On every startup, the configured password is verified against the stored
password hash. A matching password is left unchanged, including existing login
sessions. A different password replaces the stored password and revokes that
administrator's existing sessions. If `FORART_ADMIN_PASSWORD` is not set, the
server leaves existing accounts untouched and a new installation can still be
initialized from the browser. To synchronize an administrator that was created
with a username other than `admin`, set `FORART_ADMIN_USERNAME` to that existing
username; the server refuses to overwrite a non-administrator account.

The server creates a random authentication secret in the mounted `/forart_data`
volume on first start. `FORART_AUTH_SECRET` or `BETTER_AUTH_SECRET` can be
supplied to manage that secret externally. Keep the value stable across
restarts, otherwise existing sessions will be invalidated.

## Docker

From this directory:

New Compose deployments use PostgreSQL 18. PostgreSQL 18 stores its
version-specific data directory below `/var/lib/postgresql`, so the bundled
Compose file mounts the persistent database volume at that parent path.

```powershell
$env:FORART_DB_PASSWORD="<database-password>"
$env:FORART_ADMIN_PASSWORD="<administrator-password>"
docker compose -f docker-compose.postgres.yml up --build
```

Build:

```powershell
docker build -t liwbee/forart-server:<version> -t liwbee/forart-server:latest .
```

Run the Docker Hub image against an existing PostgreSQL database:

```bash
docker run --rm -p 6980:6980 \
  -e PGHOST="<database-host>" \
  -e PGPASSWORD="<password>" \
  -e FORART_ADMIN_PASSWORD="<administrator-password>" \
  -v forart-library:/library \
  -v forart-data:/forart_data \
  liwbee/forart-server:latest
```

For NAS container managers, the normal deployment requires these environment
variables:

```text
PGHOST=<database-host>
PGPASSWORD=<password>
FORART_ADMIN_PASSWORD=<administrator-password-at-least-8-characters>
```

Map a host port to container port `6980`, then mount the NAS/shared resource
directory at container path `/library` and a persistent runtime-data directory
at `/forart_data`. Port and volume mappings are container settings, not
environment variables. The runtime-data volume stores thumbnails and the
Better Auth signing secret; it does not store the PostgreSQL database.

When PostgreSQL is another container, `<database-host>` must be that container's
name and both containers must use the same user-defined Docker network. Do not
use `127.0.0.1` or `localhost` for another container.

The image defaults to PostgreSQL port `5432`, database `forart`, and user
`forart`. Only add the corresponding optional override when the PostgreSQL
installation uses a different value:

```text
PGPORT=<database-port>
PGDATABASE=<database-name>
PGUSER=<database-user>
FORART_ADMIN_USERNAME=<administrator-username-defaults-to-admin>
FORART_LANGUAGE=en-US
FORART_DB_POOL_SIZE=<positive-integer>
FORART_AUTH_SECRET=<random-value-at-least-32-characters>
```

`FORART_DATA_DIR`, `FORART_LIBRARY_DIR`, `FORART_CANVAS_STORAGE_ROOT`, `HOST`,
and `PORT` already have container defaults and should not be added in a normal
deployment.

The Docker image does not bundle PostgreSQL and does not silently fall back to
SQLite when database configuration is missing. The internal PostgreSQL connection
pool defaults to 10 connections; `FORART_DB_POOL_SIZE` normally does not need to
be configured.

Mount `/library` to a NAS/shared volume to share the resource library. The
server creates library folders and `CanvasAssests` directly under `/library`.

The PostgreSQL data directory is persisted by the PostgreSQL container volume.
Library thumbnails are cached under `/forart_data/thumb/library-assets` using
the asset ID as the filename. The Better Auth signing secret is also stored in
`/forart_data`.

Set `FORART_LANGUAGE=en-US` if you want newly-created library folders and default records to use English names:

```powershell
docker run --rm -p 6980:6980 -v forart-library:/library -v forart-data:/forart_data -e FORART_LANGUAGE=en-US liwbee/forart-server:latest
```

## One-time legacy SQLite import

`scripts/migrate-legacy-sqlite-to-postgres.mjs` imports the released SQLite
server database into the current PostgreSQL library schema. It creates a
consistent temporary SQLite snapshot, upgrades only that snapshot, verifies
the resource files, and imports all library rows in one PostgreSQL transaction.
The source SQLite file and the mounted library directory are never modified by
the importer.

Stop every Forart server that can write the source SQLite database or the
shared library. Back up the SQLite database, including any `-wal` and `-shm`
files, and take a snapshot of the shared library before continuing.

For Synology Container Manager, start only the new PostgreSQL service first.
Do not start the new Forart server yet. Add a temporary service to the same
Container Manager project and Docker network:

```yaml
  forart-migration:
    image: liwbee/forart-server:latest
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      PGHOST: postgres
      PGPORT: 5432
      PGDATABASE: forart
      PGUSER: forart
      PGPASSWORD: ${FORART_DB_PASSWORD}
    volumes:
      - /volume1/docker/forart/library:/library:ro
      - /volume1/docker/forart/legacy-database:/migration:ro
    command:
      - node
      - scripts/migrate-legacy-sqlite-to-postgres.mjs
      - --source
      - /migration/forart-library.sqlite
      - --library-root
      - /library
      - --dry-run
```

Replace the two `/volume1/...` paths with the real Synology shared-folder
paths. `PGHOST` is the PostgreSQL Compose service name, not `localhost`.

Run the temporary service once with `--dry-run`. Its JSON report must show:

- `integrityCheck` is `ok`;
- `countDifferences`, `missingFiles`, `outsideLibraryRoot`, and
  `unreferencedAssets` are empty;
- the project, entry, asset, profile, tag, and relation counts match the old
  installation.

After the dry-run succeeds, remove only the `--dry-run` command item and run
the temporary service once more. The importer automatically initializes the
PostgreSQL library schema, accepts a genuinely empty target or the three empty
bootstrap projects, and refuses to overwrite other library data. Use
`--replace-library` only when intentionally repeating the import into a target
whose existing library data may be discarded.

Do not use `--allow-incomplete` for the production migration. It permits
missing files, unreferenced assets, or normalized count loss and is intended
only for manual data recovery.

When the command prints `Forart PostgreSQL import completed successfully`,
remove the temporary migration service and start the normal Forart server. The
normal server startup creates Better Auth tables and the configured
administrator; the importer never copies or clears authentication and
permission tables. `CanvasAssests` and the desktop `generation-tasks.sqlite`
remain filesystem data and are not imported into PostgreSQL.

## Docker Hub Release

The published Docker Hub image name is fixed as:

```text
liwbee/forart-server
```

From the repository root, publish the current `VERSION` as both the version tag and `latest`:

```powershell
.\scripts\publish-dockerhub.ps1
```

To publish a specific version manually:

```powershell
.\scripts\publish-dockerhub.ps1 -Version 0.1.24
```

## API Contract

The API contract is tracked in the renderer project:

```text
../renderer/src/api-contract/API.md
```
