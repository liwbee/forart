# Server admin console plan

## Background

Forart has a lightweight Node HTTP server under `server/forart-server.mjs`.
After the port update, the default server port is `6980`.

Today the server mostly exposes JSON APIs under `/api/*`, such as:

- `GET /api/health`
- Library project and entry APIs.
- Asset upload and serving APIs.

Before the admin console implementation, opening the server root, for example `http://192.168.1.20:6980`, fell through to the API 404 response because there was no browser-facing admin UI.

The requested product direction is to make the server port itself open a management page:

```text
http://192.168.1.20:6980
```

This should be a maintainable server-side admin console, not another large single-file block inside `forart-server.mjs`.

## Goals

1. Serve a browser-based admin page from the same server port as the API.
2. Keep existing `/api/*` business APIs compatible.
3. Keep admin UI, admin APIs, static file serving, and server bootstrapping in separate modules.
4. Start with a low-risk read-only dashboard.
5. Make later additions such as authentication, storage tools, and write operations straightforward.
6. Avoid coupling this page to Electron renderer or Electron preload APIs.

## Confirmed decisions

- `/` should directly display the admin console.
- No `/admin` route is needed.
- The first version is read-only.
- The first version does not need token authentication.
- The first version should use plain HTML, CSS, and browser JavaScript modules.
- The admin page should show full storage paths.
- The first version should not show a separate access URL panel.
- The first version should not show Docker deployment hints on the page.
- The first version has no permission model. Anyone who can access the admin page can view the information shown there.

## Non-goals for the first version

- Do not move the current Electron UI into the server.
- Do not add destructive operations such as deleting library records or files.
- Do not add server restart or runtime port-change controls.
- Do not require a frontend build pipeline for the first version.
- Do not expose API keys or sensitive provider configuration.
- Do not add login, token entry, roles, or permission checks.
- Do not redesign the existing library APIs.

## Recommended approach

Build a small server-owned admin console:

- `GET /` serves the admin shell.
- `GET /_admin/*` serves static admin assets used by the root admin page.
- `GET /api/admin/*` serves admin-only JSON endpoints.
- Existing `/api/*` routes continue to be handled by the current library API router.

The first version should use static HTML, CSS, and browser ES modules. This avoids introducing a second Vite build inside the Docker server image. If the admin console becomes more complex later, `server/admin` can be upgraded to a standalone Vite app.

## Proposed file layout

```text
server/
  forart-server.mjs
  src/
    http/
      responses.mjs
      static-files.mjs
      admin-router.mjs
    admin/
      admin-api.mjs
      admin-context.mjs
  admin/
    index.html
    styles/
      admin.css
    src/
      main.js
      api.js
      state.js
      views/
        dashboard.js
        storage.js
        system.js
      components/
        status-card.js
        metric-grid.js
```

Future versions that add write operations can add `server/src/admin/auth.mjs`. The first version should not create auth or permission modules.

## Module responsibilities

### `server/forart-server.mjs`

Keep this as the server composition entrypoint.

Responsibilities:

- Read environment variables.
- Create shared server context.
- Create the HTTP server.
- Try admin routing first for `/`, `/_admin/*`, and `/api/admin/*`.
- Fall back to existing business API routing.
- Start listening on `SERVER_HOST` and `SERVER_PORT`.

It should not contain HTML strings, CSS, or dashboard-specific data shaping.

### `server/src/http/responses.mjs`

Shared HTTP response helpers.

Responsibilities:

- `sendJson(res, status, payload, headers?)`
- `sendText(res, status, text, headers?)`
- `withCorsHeaders(headers?)`
- Consistent content type handling.

The current helpers in `forart-server.mjs` can be moved here later. The first implementation can either move them as a preparatory step or add admin-specific wrappers and consolidate afterward.

### `server/src/http/static-files.mjs`

Static file serving for the admin console.

Responsibilities:

- Resolve admin asset paths safely.
- Prevent path traversal.
- Map MIME types.
- Support `GET` and `HEAD`.
- Return `index.html` for `/`.

### `server/src/http/admin-router.mjs`

Admin route dispatch.

Responsibilities:

- Route `/` to `admin/index.html`.
- Route `/_admin/*` to static files under `server/admin`.
- Route `/api/admin/*` to admin API handlers.
- Return `false` when the request is not an admin request so the main server can fall back to existing APIs.

### `server/src/admin/admin-context.mjs`

Build read-only runtime context for the admin API.

Responsibilities:

- Server host and port.
- Server start time.
- Data directory paths.
- Database path.
- Node version.
- App/server version if available.
- Local network URLs.

### `server/src/admin/admin-api.mjs`

Admin JSON endpoints.

Responsibilities:

- `GET /api/admin/status`
- `GET /api/admin/storage`
- `GET /api/admin/library-summary`
- `GET /api/admin/environment`

The admin UI should consume these admin endpoints instead of directly calling many business APIs for dashboard metrics.

### Future `server/src/admin/auth.mjs`

Authentication module for later write operations.

The first version should not create this module because the confirmed scope has no login, token, roles, or permission checks.

Future behavior:

- Read `FORART_ADMIN_TOKEN`.
- Validate `Authorization: Bearer <token>`.
- Allow read-only routes without auth only if explicitly accepted.

## Route plan

### Browser routes

```text
GET  /              -> admin/index.html
GET  /_admin/styles/admin.css
GET  /_admin/src/main.js
```

### Admin API routes

```text
GET  /api/admin/status
GET  /api/admin/storage
GET  /api/admin/library-summary
GET  /api/admin/environment
```

### Existing routes

Existing business routes stay under `/api/*` and should keep their current behavior.

```text
GET  /api/health
GET  /api/model-projects
GET  /api/outfit-projects
GET  /api/action-projects
...
```

## First version UI

The first version should be operational and compact.

Recommended sections:

1. Server status
   - Online state.
   - Host.
   - Port.
   - Uptime.
   - Node version.

2. Storage
   - `FORART_DATA_DIR`.
   - `FORART_DATABASE_DIR`.
   - SQLite database filename.
   - Database file size.
   - Database modified time.

3. Library summary
   - Model project count.
   - Model entry count.
   - Outfit project count.
   - Outfit entry count.
   - Action project count.
   - Action entry count.
   - Asset count.

## First version API response shapes

### `GET /api/admin/status`

```json
{
  "ok": true,
  "server": {
    "host": "0.0.0.0",
    "port": 6980,
    "startedAt": "2026-07-02T00:00:00.000Z",
    "uptimeSeconds": 123,
    "nodeVersion": "v24.x.x"
  },
  "urls": {
    "local": "http://127.0.0.1:6980",
    "lan": ["http://192.168.1.20:6980"],
    "health": "http://127.0.0.1:6980/api/health"
  }
}
```

### `GET /api/admin/storage`

```json
{
  "ok": true,
  "storage": {
    "dataDir": "/data",
    "databaseDir": "/data/.forart/database",
    "databasePath": "/data/.forart/database/forart-library.sqlite",
    "databaseExists": true,
    "databaseSizeBytes": 123456,
    "databaseModifiedAt": "2026-07-02T00:00:00.000Z"
  }
}
```

### `GET /api/admin/library-summary`

```json
{
  "ok": true,
  "summary": {
    "modelProjects": 0,
    "models": 0,
    "outfitProjects": 0,
    "outfits": 0,
    "actionProjects": 0,
    "actions": 0,
    "assets": 0
  }
}
```

## Security model

First version recommendation:

- Read-only admin dashboard.
- No delete, edit, restart, shell, file browsing outside configured storage roots, or config mutation.
- No API keys shown.
- No token, login, roles, or permission checks.
- Anyone who can reach `http://<server>:6980` can view the admin information.

Before adding write operations in a future version, add token-based admin auth:

```text
FORART_ADMIN_TOKEN=<secret>
```

Protected requests should use:

```text
Authorization: Bearer <secret>
```

The first version should not implement this token flow. Keep it as a future security boundary for mutating operations.

## Implementation phases

### Phase 1: Read-only admin shell

1. Add static admin file serving.
2. Add the `/` route.
3. Add `GET /api/admin/status`.
4. Build the first dashboard view with status and copyable URLs.
5. Verify `/api/health` and existing APIs are unchanged.

### Phase 2: Storage and library summary

1. Add `GET /api/admin/storage`.
2. Add `GET /api/admin/library-summary`.
3. Add storage and summary panels.
4. Handle missing database or unconfigured storage gracefully.

### Phase 3: Security foundation

1. Add `server/src/admin/auth.mjs` only when write operations are being planned.
2. Support optional `FORART_ADMIN_TOKEN`.
3. Protect mutating admin APIs.
4. Add UI token prompt only if protected operations exist.

### Phase 4: Future management tools

Possible future additions:

- Storage health checks.
- Database backup download.
- Library folder browser limited to `FORART_DATA_DIR`.
- Server logs summary.
- Version/update information.
- Authenticated write operations.

These should be explicitly reviewed before implementation because they increase security risk.

## Testing plan

Manual checks:

1. `npm run build` still passes.
2. Start server on port `6980`.
3. Open `http://127.0.0.1:6980`.
4. Confirm admin assets under `/_admin/*` load without 404s.
5. Confirm `GET /api/health` still returns `{ "ok": true }`.
6. Confirm existing Electron local mode can still connect to `http://127.0.0.1:6980`.
7. Confirm unknown API routes still return the existing API 404 shape.

Automated checks to add if the server gains a test harness:

- Static route returns HTML for `/`.
- Path traversal attempts under `/_admin/*` are rejected.
- Admin status route returns current port.
- Existing health route behavior remains unchanged.

## Decisions that need confirmation

1. Should `/` serve the admin console?

   Decision: serve the admin console directly from `/`. Do not add `/admin`.

2. Should the first version be read-only?

   Decision: yes. Add no destructive or mutating operations in version one.

3. Should read-only admin pages require a token?

   Decision: no. The first version has no token or permission checks.

4. Should the admin console use plain HTML/CSS/JS first, or should it use Vite/React from the start?

   Decision: plain HTML, CSS, and browser JavaScript modules first. Upgrade later only if the UI becomes complex.

5. Should the page show LAN IP addresses discovered from network interfaces?

   Decision: no separate access URL panel in the first version.

6. Should storage paths be shown in full?

   Decision: yes for local/LAN administration, but do not expose API keys or provider secrets.

7. Should Docker deployment examples be shown on the admin page?

   Decision: no. Keep deployment hints out of the first version page.

8. Should the admin console be included in the server Docker image by copying `server/admin` and `server/src`?

   Recommendation: yes. Keep it self-contained inside the server image.
