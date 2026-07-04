# Forart Server

Lightweight server for Forart.

Responsibilities:

- Provides database APIs.
- Stores server-side resource files.
- Runs in Docker.
- Does not run Electron code or bundled desktop UI.

## Development

Run the server:

```powershell
npm run dev
```

Default address:

```text
http://127.0.0.1:6980
```

## Docker

From this directory:

Build:

```powershell
docker build -t forart-server .
```

Run:

```powershell
docker run --rm -p 6980:6980 -v forart-library:/library -v forart-database:/database forart-server
```

The container uses these paths by default:

```text
FORART_DATABASE_DIR=/database
FORART_LIBRARY_DIR=/library
FORART_LANGUAGE=zh-CN
```

Mount `/library` to a NAS/shared volume to share the resource library. The server creates library folders and `CanvasAssests` directly under `/library`.

Mount `/database` to persistent storage to keep the SQLite database:

```text
/database/forart-library.sqlite
/database/forart-library.sqlite-wal
/database/forart-library.sqlite-shm
```

Set `FORART_LANGUAGE=en-US` if you want newly-created library folders and default records to use English names:

```powershell
docker run --rm -p 6980:6980 -v forart-library:/library -v forart-database:/database -e FORART_LANGUAGE=en-US forart-server
```

## API Contract

The API contract is tracked in the renderer project:

```text
../renderer/src/api-contract/API.md
```
