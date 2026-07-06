# Electron-Only Product Definition Plan

## Purpose

Forart should be defined as an Electron desktop product first. The remote HTTP server and Docker deployment remain fully supported, but the React renderer is no longer treated as a complete standalone browser web app.

This plan is about product boundary and architecture cleanup. It does not require removing the remote server. It also does not require rewriting every renderer feature immediately.

## Current Shape

The current app is a hybrid:

- Electron shell loads the React renderer.
- During development, Electron loads `http://127.0.0.1:6981`.
- `npm run dev:web` can start the renderer alone.
- Vite proxies `/api` to `http://127.0.0.1:6980`.
- Renderer checks for Electron bridges such as `window.forartWindow`, `window.forartConfig`, `window.forartLocalApi`, `window.easyTool`, `window.forartReview`, and `window.libtv`.
- Some paths tolerate missing bridges and degrade into partial browser behavior.
- Local library mode uses Electron IPC through `window.forartLocalApi`.
- Remote server mode uses HTTP APIs against an independently deployed `server`.

This means `http://127.0.0.1:6981/` can open in Chrome or another browser in development, but that environment is not equivalent to the desktop product.

## Target Definition

The supported client is the Electron desktop app.

Remote server mode remains supported:

- The Docker server remains an official deployment target.
- The server continues to expose HTTP APIs.
- Electron can talk to a remote server over HTTP.
- Local filesystem reads, imports, exports, canvas package operations, settings, updates, and desktop integrations are owned by Electron IPC.

The ordinary browser renderer is no longer a supported product surface:

- It may still run for development diagnostics.
- It does not need full feature parity.
- New desktop features do not need browser fallback unless there is a clear reason.

## Non-Goals

- Do not remove `server/forart-server.mjs`.
- Do not remove Docker support.
- Do not remove remote mode.
- Do not rewrite all renderer bridge calls at once.
- Do not force every existing optional bridge call to become required immediately.
- Do not remove Vite dev server usage inside Electron development.

## Recommended Product Boundary

Use this rule:

```text
Electron is the only supported front-end runtime.
Remote HTTP server is a supported backend runtime.
Browser-opened renderer is a development convenience only.
```

This keeps the server architecture intact while allowing the desktop client to use native capabilities confidently.

## Cleanup And Refactor Phases

### Phase 1: Documentation And Naming

Goal: make the product boundary explicit without breaking workflows.

Actions:

- Update `README.md` to say the supported client is Electron.
- Move `npm run dev:web` documentation under a "renderer diagnostics" or "development only" note.
- Clarify that opening `http://127.0.0.1:6981/` in a browser is unsupported for full product use.
- Clarify that Docker is the remote backend, not a browser frontend product.
- Update feature plans to avoid designing new local-file workflows around browser compatibility.

Expected risk: low.

### Phase 2: Runtime Guard

Goal: make missing Electron bridges fail clearly instead of silently becoming a half-working web app.

Actions:

- Add a small renderer runtime helper, for example `renderer/src/app/electronRuntime.ts`.
- Centralize checks such as:

```ts
export function isElectronRuntime() {
  return Boolean(window.forartWindow && window.forartConfig);
}

export function requireElectronBridge<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`${name} bridge is unavailable. Use the Forart desktop app.`);
  return value;
}
```

- Show a dedicated unsupported-runtime screen when the required base bridges are missing.
- Keep this guard narrow at first: require only `forartWindow` and `forartConfig` for the app shell.
- Do not require optional domain bridges globally. Require them at feature boundaries.

Expected risk: medium. It changes behavior for people opening the renderer in a normal browser.

### Phase 3: Replace Browser Fallbacks With Electron-Owned Flows

Goal: make desktop-only capabilities first-class.

Candidates:

- Folder picking and re-scan.
- Batch action import.
- Canvas package import/export/upload/download.
- Image review folder scanning.
- Cache reveal/open operations.
- App update checks and updater.
- Local library configuration.

For each feature:

- Put filesystem access in Electron main.
- Expose a narrowly named preload bridge.
- Keep renderer responsible for UI state.
- Keep backend writes going through the current local IPC or remote HTTP APIs.

For batch action import specifically:

```text
Electron main:
- chooseActionImportFolder()
- scanActionImportFolder(folderPath)
- readActionImportEntry(folderPath, rowId or relativePath)

Renderer:
- shows one stable import UI
- calls Electron main for scan/re-scan/read
- calls remote or local import-entries API for actual library writes
```

Expected risk: medium. Each feature needs a small API contract.

### Phase 4: Simplify API Client Assumptions

Goal: keep local and remote backend behavior clear without browser fallback ambiguity.

Current desired split:

- Local mode: renderer calls Electron IPC via `window.forartLocalApi`.
- Remote mode: renderer calls `serverUrl` HTTP APIs.

Actions:

- Keep `apiRequest` routing by mode.
- In local mode, require `window.forartLocalApi`.
- In remote mode, require a configured `serverUrl`.
- Stop treating a missing IPC bridge as a reason to silently fall back to HTTP local APIs.
- Keep HTTP for remote server mode only.

Expected risk: low to medium, depending on current browser use.

### Phase 5: Remove Or Demote Web-Only Development Scripts

Goal: reduce confusion without harming developer diagnostics.

Options:

- Keep `dev:web`, but rename docs to "renderer diagnostics only".
- Rename script later, for example `dev:renderer`.
- Keep Vite `preview` only as a build smoke-test tool.
- Do not advertise browser access as an app mode.

Recommended first step: documentation only. Do not delete scripts yet.

Expected risk: low.

## What Not To Clean Up Yet

Do not immediately remove:

- Vite dev server.
- `dev:web` script.
- Optional chaining everywhere.
- Remote HTTP API code.
- Docker build path.
- `server/forart-server.mjs`.

These removals are not necessary to make the product Electron-only. Removing them too early creates churn and makes debugging harder.

## Impact On Batch Action Import

Electron-only product definition supports a better importer:

- True re-scan of the same folder becomes possible.
- Folder path can be stored in Electron main during the dialog session.
- Hidden/system file filtering can be done consistently in Node.
- Text decoding can use Node buffers and `TextDecoder`.
- Renderer no longer needs to hold all selected `File` objects as the source of truth.
- Remote mode still works because Electron reads local files and uploads selected entries to the remote server.

Recommended import architecture after this product decision:

```text
Renderer UI
  -> Electron main folder scan/read bridge
  -> apiRequest(import-entries)
      local mode: Electron local IPC service
      remote mode: HTTP server
```

This preserves backend import behavior while improving desktop file handling.

## Open Questions

1. Should normal browser access show a hard unsupported-runtime page, or a reduced diagnostic page?
2. Should `dev:web` be renamed to `dev:renderer` to avoid implying a web product?
3. Should the README remove browser instructions entirely or keep them under diagnostics?
4. Should future feature work be allowed to use browser APIs like `webkitdirectory`, or should all local file features go through Electron IPC?
5. Should local mode always require `forartLocalApi`, even in development?

## Recommended First Implementation Slice

1. Update README wording to define Electron as the only supported client.
2. Add `electronRuntime.ts` helper with `isElectronRuntime` and `requireElectronBridge`.
3. Add an unsupported-runtime screen for normal browser access.
4. Leave `dev:web` available but document it as diagnostics only.
5. Convert the next feature, action batch import re-scan, to Electron IPC.

This slice changes the product definition without forcing a large immediate rewrite.
