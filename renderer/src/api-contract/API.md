# Forart Remote API Contract

Forart uses this contract through `RemoteDataSource` when running in server mode.

The canonical server implementation lives in:

```text
server/forart-server.mjs
```

No shared package is used. Generated or hand-written client types should stay inside Forart.

## Base

```text
GET /api/health
GET /api/settings/storage
```

`GET /api/health` returns `{ ok: true }`.

`GET /api/settings/storage` returns `{ configured: boolean }`.

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
/api/libraries/model/tags?project_id=:projectId

/api/outfit-projects
/api/outfits
/api/libraries/outfit/tags?project_id=:projectId

/api/action-projects
/api/actions
/api/libraries/action/tags?project_id=:projectId
```

Library tag records include `id`, `kind`, `project_id`, `name`, `sort_order`, `usage_count`, `created_at`, and `updated_at`.
`POST /api/libraries/:kind/tags` accepts `name`.
`PATCH /api/libraries/:kind/tags/:tagId` accepts `name` and `sort_order`.
Library entry list endpoints accept repeated `tag_id` query params and return entries that contain every selected tag.

Use `server/forart-server.mjs` as the full route source of truth.
