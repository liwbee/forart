# Forart Main

Desktop client for Forart.

Responsibilities:

- Runs the Electron shell and React UI.
- Lets the user choose local mode or server mode.
- Owns local file access and local resource library operations.
- Starts the bundled `server` in local mode.
- Talks to a remote server only when running in server mode.

## Development

Install dependencies:

```powershell
npm install
```

Run the Electron app:

```powershell
npm run dev
```

Run only the web renderer:

```powershell
npm run dev:web
```

## Remote Server Mode

Remote mode talks to an independently deployed `server` through `RemoteDataSource`.

The renderer API contract summary lives at:

```text
renderer/src/api-contract/API.md
```

## Bundled Server

The reusable API server lives in:

```text
server/
```

It can run locally for desktop mode, or be built independently as a Docker image.
