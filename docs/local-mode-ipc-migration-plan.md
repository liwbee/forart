# Local Mode IPC Migration Plan

## Background

Forart currently has two runtime modes:

- Local mode: the desktop app starts a bundled local HTTP server on `127.0.0.1:6980`.
- Remote mode: the renderer talks to a configured remote server URL, including Docker deployments.

The renderer's local library APIs currently go through the same HTTP client used by remote mode. This makes local mode depend on a localhost port. On Windows, Hyper-V/HNS/WinNAT can reserve low development ports through TCP excluded port ranges, causing startup failures such as `EACCES: permission denied 127.0.0.1:6980`.

The goal is to remove the localhost HTTP dependency from desktop local mode while preserving the existing HTTP API and Docker server behavior for remote mode.

## Goals

- Make local desktop mode work without binding `127.0.0.1:6980`.
- Fully remove normal local-mode dependency on port `6980` by the end of the migration.
- Keep Docker and remote server deployments on the existing `/api/*` HTTP contract.
- Reuse business logic between local IPC and remote HTTP wherever practical.
- Keep image/file rendering on Electron custom protocols where that fits the browser resource model.
- Migrate incrementally without changing old user data.
- Avoid a big-bang rewrite of resource libraries.

## Non-Goals

- Do not remove remote HTTP mode.
- Do not change Docker server routes as part of the local IPC migration.
- Do not convert all remote canvas exchange APIs to IPC.
- Do not replace custom asset protocols such as `forart-asset://` where they are a better fit.
- Do not introduce a second independent copy of library business rules.

## Current Architecture

Main window loading:

- Development: Electron loads `http://127.0.0.1:6981`.
- Production: Electron loads `dist/index.html` from disk.

Local library data:

- Renderer calls `apiRequest("/api/...")`.
- `apiRequest` resolves the base URL through `getApiBaseUrl()`.
- Local mode resolves to `http://127.0.0.1:6980`.
- Remote mode resolves to `config.serverUrl`.

Canvas data:

- Most local canvas storage already uses Electron IPC through `window.easyTool`.
- This is a good precedent for the local-mode migration.

Server implementation:

- `server/forart-server.mjs` owns the bundled HTTP server startup and much of the resource-library logic.
- Remote Docker deployments use this server.
- The server logic is not yet fully separated into service modules that Electron main can call directly.

## Target Architecture

```text
Renderer local mode
  -> window.forartLocalApi.request(...)
  -> Electron main IPC
  -> local service modules
  -> SQLite / filesystem / asset store

Renderer remote mode
  -> fetch(config.serverUrl + /api/...)
  -> remote HTTP server / Docker

Local asset display
  -> forart-asset://...
  -> Electron protocol handler

Remote asset display
  -> HTTP asset URLs from remote server
```

## Design Principles

- Local IPC should be a business RPC boundary, not a fake web server.
- Remote HTTP should remain the server contract.
- Shared business behavior should live below both IPC and HTTP adapters.
- Renderer feature code should not care whether local mode is IPC or remote mode is HTTP.
- Keep the migration behind the existing `apiRequest` facade as much as possible.

## Proposed Phases

### Phase 1: Add The IPC Transport Skeleton

Add a local API bridge:

- `window.forartLocalApi.request(payload)` in preload.
- `ipcMain.handle("local-api:request", ...)` in Electron main.
- Request payload shape:
  - `path`
  - `method`
  - `body`
  - optional `headers` if needed later
- Response shape:
  - `ok`
  - `status`
  - `body`

Update `apiRequest`:

- Remote mode keeps using `fetch`.
- Local mode calls `window.forartLocalApi.request`.
- Preserve `ApiError` behavior so feature code does not change.

Implement only low-risk routes first:

- `/api/health`
- `/api/settings/storage`

Expected outcome:

- The renderer can prove local IPC routing works.
- Existing feature APIs do not need to be rewritten yet.
- The bundled local HTTP server can still be retained as fallback.

### Phase 2: Extract Shared Library Services

Move resource-library business logic out of `server/forart-server.mjs` into service modules.

Suggested module shape:

```text
server/src/library/library-context.mjs
server/src/library/library-service.mjs
server/src/library/library-http-router.mjs
```

The service should expose methods such as:

- list/create/update/delete projects
- list/create/update/delete entries
- upload/replace image assets
- list/create/update/delete tags
- get storage settings

HTTP routes and IPC handlers should both call the same service methods.

Expected outcome:

- No duplicated business rules between local desktop and Docker server.
- Remote server remains functionally equivalent.

### Phase 3: Migrate Model Library Local Mode

Move model-library local-mode routes to IPC:

- `/api/model-projects`
- `/api/models`
- `/api/model-images`
- `/api/libraries/model/tags`

Keep remote mode unchanged.

Use this as the first real feature migration because model library has a broad but contained API surface.

Expected outcome:

- Model library works in local mode without `6980`.
- Remote model library still works over HTTP.

### Phase 4: Migrate Outfit And Action Libraries

Migrate the remaining local resource-library routes:

- Outfit library:
  - `/api/outfit-projects`
  - `/api/outfits`
  - `/api/libraries/outfit/tags`
- Action library:
  - `/api/action-projects`
  - `/api/actions`
  - `/api/libraries/action/tags`

Expected outcome:

- Local resource libraries no longer require a localhost HTTP server.

### Phase 5: Migrate Local Asset URLs

Audit local-mode asset URL responses.

Preferred local-mode direction:

- Keep asset IDs in stored data models.
- Return or resolve `forart-asset://...` display URLs for desktop local assets.

Remote mode remains:

- Return HTTP URLs from the remote server.

Touch points:

- `libraryImageActions.ts`
- resource library cards/previews
- upload/replace image flows
- canvas references that import library images

Expected outcome:

- Local asset rendering no longer depends on `http://127.0.0.1:6980/api/assets/...`.

### Phase 6: Stop Starting The Local HTTP Server In Local Mode

After the local library and asset paths no longer use HTTP:

- Stop calling `localServer.ensure(config)` for normal local desktop mode.
- Keep the server module for remote/Docker builds.
- Remove the normal production local-mode dependency on `6980`.
- Optional developer-only fallback can exist during implementation, but it should not remain part of normal local-mode behavior.

Expected outcome:

- Production local mode does not bind `6980`.
- Remote Docker mode remains unchanged.

## Rollback Strategy

Use a temporary fallback switch during migration only:

```text
FORART_LOCAL_API=http
```

Possible behaviors:

- `ipc`: local mode uses IPC.
- `http`: local mode uses the current bundled local server.

This allows each phase to ship safely and makes debugging easier if a local IPC route behaves differently from the HTTP route.

The final intended product behavior is:

- Local desktop mode does not start or depend on the bundled HTTP server.
- Remote mode and Docker deployments continue to use the HTTP server.

## Testing Strategy

For each migrated route group:

- Verify local mode with IPC.
- Verify remote mode against the HTTP server.
- Verify Docker server still serves the same routes.
- Verify image upload and image display.
- Verify tag filters and project filters.
- Verify storage-not-configured behavior.
- Verify Chinese and English UI error messages where user-visible.

Recommended checks:

```bash
npm run build
npm run validate:i18n
```

Remote server checks should continue to use the existing HTTP contract documented in:

```text
renderer/src/api-contract/API.md
```

## Risks

- `server/forart-server.mjs` currently mixes startup, HTTP helpers, storage setup, and business logic. Extracting services is the main complexity.
- Upload payloads currently use JSON/base64. IPC can carry this, but large image payloads should be watched for memory pressure.
- Local and remote asset URLs will differ. Callers must not assume all asset URLs are HTTP.
- Some code uses `getApiBaseUrl()` directly for URL rewriting. These call sites need explicit local-mode handling.
- It is easy to accidentally fork business rules if HTTP handlers and IPC handlers are implemented separately.

## Confirmed Decisions

1. Local mode should eventually remove normal `6980` usage completely.
2. Remote mode and Docker deployments must remain unchanged.
3. Remote canvas exchange stays HTTP-only.
4. The migration should be split into executable implementation steps.
5. Local durable data should store asset IDs; local display should resolve those IDs to `forart-asset://...`.
6. The first implementation should keep `/api/...` route-shaped calls hidden behind `apiRequest`.
7. Migration order is model library, then outfit library, then action library.
8. `/api/admin/*` is out of scope for local IPC.
9. A temporary `FORART_LOCAL_API=http` fallback is allowed during migration.
10. Local canvas storage remains on the existing `window.easyTool` IPC APIs and is not folded into `forartLocalApi`.
11. Image-review remains on `window.forartReview` and is not folded into `forartLocalApi`.
12. Resource-library image download/save-as continues to use existing `easyTool.saveResult`.

## IPC API Boundaries

The app already exposes several IPC bridges:

- `window.easyTool`: canvas workspace operations, canvas package import/export, canvas image assets, generation tasks, downloads, and canvas cache tools.
- `window.forartConfig`: app configuration, setup paths, update checks, server tests, and local server status.
- `window.forartReview`: image-review domain operations.
- `window.libtv`: LibTV CLI/account/workspace/model/generation operations.

The new `window.forartLocalApi` should not replace all of these.

Its intended boundary is narrower:

- It is the local-mode replacement for renderer calls that currently go through `apiRequest("/api/...")`.
- It should cover resource-library business APIs: model, outfit, action, tags, storage settings, and asset file/display resolution needed by those APIs.
- It should preserve remote/local parity behind the existing API facade.

`window.easyTool` should remain responsible for local canvas and generation task operations because those are already typed desktop IPC APIs and are not part of the remote resource-library HTTP contract.

## Clarifications

### Local Asset URL Strategy

There are two options for local image resources.

Option A: APIs return `forart-asset://...` display URLs.

- Pros:
  - Renderer can use URLs directly in `<img>` and existing preview components.
  - Matches the current canvas asset protocol direction.
  - Removes localhost URLs from local desktop mode.
- Cons:
  - Local and remote display URLs use different schemes.
  - Code that rewrites `/api/assets/.../file` to `/download` needs local-mode branching.

Option B: APIs return asset IDs only, and renderer resolves display URLs through a helper.

- Pros:
  - Data model stays transport-neutral.
  - Local and remote URL construction is centralized.
- Cons:
  - Larger renderer refactor.
  - More call sites need to be audited before images render correctly.

Recommendation:

- Keep asset IDs in stored data models.
- Use `forart-asset://...` as the local display URL returned by IPC or resolved at the data-source boundary.
- Do not store `forart-asset://...` as the only durable identity when an asset ID exists.

### What "Migration" Means

This is not an old-user-data migration.

It means migrating runtime access paths:

- From local renderer `fetch("http://127.0.0.1:6980/api/...")`
- To local renderer `window.forartLocalApi.request(...)`

Existing SQLite data, library folders, asset files, canvas files, and remote server data should remain in place.

If schemas need changes later, those should be handled as separate database migrations. This plan does not require one by default.

### Route-Shaped IPC Versus Typed IPC

Option A: Route-shaped IPC behind `apiRequest`.

Example:

```ts
window.forartLocalApi.request({
  method: "GET",
  path: "/api/model-projects"
})
```

Pros:

- Lowest renderer churn.
- Existing `model-library/api.ts`, `outfit-library/api.ts`, and `action-library/api.ts` can keep calling `apiRequest`.
- Easier to migrate one route group at a time.
- Keeps remote HTTP and local IPC behind the same facade.

Cons:

- The IPC API initially looks like a local HTTP router.
- Less type-safe than domain methods.

Option B: Typed IPC methods per domain.

Example:

```ts
window.forartLocalApi.modelProjects.list()
```

Pros:

- Cleaner final desktop API.
- Better type boundaries.

Cons:

- Larger front-end refactor.
- More chance of touching unrelated UI logic.
- Harder to preserve remote/local parity during incremental migration.

Recommendation:

- Start with route-shaped IPC behind `apiRequest`.
- Keep service-layer methods typed internally.
- Consider typed renderer methods later only after local HTTP has been removed.

## Execution Checklist

### Step 1: Add Local IPC Request Skeleton

- Add `forartLocalApi.request` to preload.
- Add `local-api:request` IPC handler in Electron main.
- Add local route dispatcher with `/api/health`.
- Update `appConfig.ts` window typings.
- Update `apiClient.ts` to choose IPC in local mode and fetch in remote mode.
- Preserve `ApiError` semantics.
- Verify local `/api/health` through IPC.
- Verify remote `/api/health` still uses HTTP.

### Step 2: Add Storage Settings IPC Route

- Implement `/api/settings/storage` for local IPC.
- Make it read the same local library configuration used by the desktop app.
- Verify setup/settings pages still report storage state correctly.
- Keep HTTP fallback only during migration.

### Step 3: Extract Shared Library Context

- Move database path/data directory setup out of `server/forart-server.mjs`.
- Create a reusable library context module.
- Make the HTTP server use the new context without behavior changes.
- Verify Docker/server startup still works.

### Step 4: Extract Shared Library Service

- Move model/outfit/action library business operations into service functions.
- Keep HTTP routers as adapters over the service.
- Add local IPC adapter over the same service.
- Avoid duplicating validation, asset writing, tag handling, and sorting rules.

### Step 5: Migrate Model Library Local Routes

- Implement local IPC handling for model projects.
- Implement local IPC handling for model entries.
- Implement local IPC handling for model images.
- Implement local IPC handling for model tags.
- Verify model create/update/delete/list/upload flows in local mode.
- Verify the same model flows in remote mode.

### Step 6: Migrate Outfit Library Local Routes

- Implement local IPC handling for outfit projects.
- Implement local IPC handling for outfits.
- Implement local IPC handling for outfit tags.
- Verify outfit create/update/delete/list/upload flows in local mode.
- Verify the same outfit flows in remote mode.

### Step 7: Migrate Action Library Local Routes

- Implement local IPC handling for action projects.
- Implement local IPC handling for actions.
- Implement local IPC handling for action tags.
- Verify action create/update/delete/list/upload flows in local mode.
- Verify the same action flows in remote mode.

### Step 8: Replace Local Asset HTTP URLs

- Audit every local use of `/api/assets/:assetId/file`.
- Audit every local use of `/api/assets/:assetId/download`.
- Add a local asset URL resolver if needed.
- Use `forart-asset://...` for local display URLs.
- Keep remote asset URLs HTTP.
- Update `libraryImageActions.ts` to handle local protocol URLs without HTTP URL rewriting.

### Step 9: Stop Normal Local Server Startup

- Remove normal local-mode calls to `localServer.ensure(config)`.
- Keep remote server testing unchanged.
- Keep remote/Docker server code unchanged.
- Remove `6980` from renderer local data-source behavior.
- Keep any fallback flag developer-only and disabled by default.

### Step 10: Final Cleanup

- Remove obsolete `getApiBaseUrl()` local `6980` behavior.
- Update settings copy that says port `6980` if it applies to local mode.
- Update docs and API notes.
- Run build and i18n validation.
- Test packaged local mode without any process listening on `6980`.

## Open Questions

No product-direction questions remain open.

Implementation may still surface route-level details while extracting the shared library service, especially around asset URL payload shape and database context initialization.
