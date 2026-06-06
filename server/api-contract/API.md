# Forart Server API Contract

This contract records the remote API consumed by Forart in server mode.

This server is a pure API service. It does not serve the Electron renderer, Vite assets, or any frontend HTML.

## Base

```text
GET /api/health
GET /api/settings/storage
PATCH /api/settings/storage
POST /api/model-library/import-legacy
```

## Assets

```text
GET  /api/assets/:assetId/file
HEAD /api/assets/:assetId/file
GET  /api/assets/:assetId/download
HEAD /api/assets/:assetId/download
```

## Model Library

```text
GET    /api/model-projects
POST   /api/model-projects
PATCH  /api/model-projects/:projectId
DELETE /api/model-projects/:projectId
POST   /api/model-projects/:projectId/cover/upload
GET    /api/model-projects/:projectId/models
POST   /api/model-projects/:projectId/models

PATCH  /api/models/:modelId
DELETE /api/models/:modelId
GET    /api/models/:modelId/images
POST   /api/models/:modelId/images
POST   /api/models/:modelId/images/upload
DELETE /api/model-images/:imageId

GET    /api/libraries/model/tags
POST   /api/libraries/model/tags
PATCH  /api/libraries/model/tags/:tagId
DELETE /api/libraries/model/tags/:tagId
```

## Outfit Library

```text
GET    /api/outfit-projects
POST   /api/outfit-projects
PATCH  /api/outfit-projects/:projectId
DELETE /api/outfit-projects/:projectId
POST   /api/outfit-projects/:projectId/cover/upload
GET    /api/outfit-projects/:projectId/outfits
POST   /api/outfit-projects/:projectId/outfits

PATCH  /api/outfits/:outfitId
DELETE /api/outfits/:outfitId
POST   /api/outfits/:outfitId/image/upload

GET    /api/libraries/outfit/tags
POST   /api/libraries/outfit/tags
PATCH  /api/libraries/outfit/tags/:tagId
DELETE /api/libraries/outfit/tags/:tagId
```

## Action Library

```text
GET    /api/action-projects
POST   /api/action-projects
PATCH  /api/action-projects/:projectId
DELETE /api/action-projects/:projectId
POST   /api/action-projects/:projectId/cover/upload
GET    /api/action-projects/:projectId/actions
POST   /api/action-projects/:projectId/actions

PATCH  /api/actions/:actionId
DELETE /api/actions/:actionId
POST   /api/actions/:actionId/image/upload

GET    /api/libraries/action/tags
POST   /api/libraries/action/tags
PATCH  /api/libraries/action/tags/:tagId
DELETE /api/libraries/action/tags/:tagId
```

## Image Review

```text
GET  /api/review/status
GET  /api/review/roots
GET  /api/review/directories
GET  /api/review/products
GET  /api/review/products/:productId/images
GET  /api/review/images
HEAD /api/review/images
GET  /api/review/issues
POST /api/review/issues
```

## Unknown Routes

Unknown routes return JSON:

```json
{
  "detail": "API route not found"
}
```
