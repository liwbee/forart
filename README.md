# Forart Main

Electron desktop client for Forart.

Responsibilities:

- Runs the Electron shell and React UI.
- Lets the user choose local mode or server mode.
- Owns local file access and local resource library operations.
- Uses Electron IPC for local mode.
- Talks to a remote server only when running in server mode.

## Product Runtime

Forart's supported front-end runtime is the Electron desktop app. The reusable HTTP server and Docker image remain supported backend deployment targets for remote server mode.

Opening the renderer directly in a browser, such as `http://127.0.0.1:6981/`, is a development diagnostic convenience only. It is not a supported product entry point and does not provide full desktop features such as local folder access, configuration storage, updates, image review file scanning, canvas package operations, or local IPC resource-library access.

## Development

Install dependencies:

```powershell
npm install
```

Run the Electron app:

```powershell
npm run dev
```

Run only the renderer for diagnostics:

```powershell
npm run dev:web
```

This starts the Vite renderer at `http://127.0.0.1:6981/`, but the full app should still be tested through Electron with `npm run dev`.

The renderer shows an unsupported-runtime page when opened directly in a browser. For narrowly scoped renderer diagnostics during development, open:

```text
http://127.0.0.1:6981/?diagnostic=1
```

This diagnostic bypass is development-only and does not make the browser renderer a supported product runtime.

## Remote Server Mode

Remote mode talks to an independently deployed `server` through `RemoteDataSource`.

The remote server is a backend for the Electron client. It is not intended to make the browser-opened renderer a complete web app.

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
