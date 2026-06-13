# Forart Remote API Contract

Forart uses this contract through `RemoteDataSource` when running in server mode.

The canonical server implementation lives in:

```text
server/forart-server.mjs
```

Keep this file synchronized with:

```text
server/api-contract/API.md
```

No shared package is used. Generated or hand-written client types should stay inside Forart.

## Base

```text
GET /api/health
GET /api/settings/storage
PATCH /api/settings/storage
```

## Assets

```text
GET  /api/assets/:assetId/file
HEAD /api/assets/:assetId/file
GET  /api/assets/:assetId/download
HEAD /api/assets/:assetId/download
```

## Libraries

The current remote API supports model, outfit, and action libraries:

```text
/api/model-projects
/api/models
/api/model-images
/api/libraries/model/tags

/api/outfit-projects
/api/outfits
/api/libraries/outfit/tags

/api/action-projects
/api/actions
/api/libraries/action/tags
```

See the server contract for the full route list.
