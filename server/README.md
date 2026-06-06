# Forart Server

Lightweight server for Forart.

Responsibilities:

- Provides database APIs.
- Stores server-side resource files.
- Handles authentication and access tokens.
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

## API Contract

The server API contract starts at:

```text
api-contract/API.md
```

Keep it synchronized with `renderer/src/api-contract/API.md` when changing remote APIs.
