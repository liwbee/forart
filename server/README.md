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
http://127.0.0.1:5175
```

## Docker

From this directory:

Build:

```powershell
docker build -t forart-server .
```

Run:

```powershell
docker run --rm -p 5175:5175 -v forart-data:/data forart-server
```

The container uses these paths by default:

```text
FORART_DATABASE_DIR=/data/.forart/database
FORART_DATA_DIR=/data
FORART_LANGUAGE=zh-CN
```

Mount `/data` to a NAS/shared volume to share the resource library. The server creates library folders directly under `/data`.

Set `FORART_LANGUAGE=en-US` if you want newly-created library folders and default records to use English names:

```powershell
docker run --rm -p 5175:5175 -v forart-data:/data -e FORART_LANGUAGE=en-US forart-server
```

## API Contract

The API contract is tracked in the renderer project:

```text
../renderer/src/api-contract/API.md
```
