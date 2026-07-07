# Zod Validation Integration Plan

## Background

Forart currently has two request paths for resource-library behavior:

- Local mode: renderer calls `apiRequest("/api/...")`, which routes to Electron main through `window.forartLocalApi.request`.
- Remote mode: renderer calls the same `apiRequest("/api/...")`, which routes to the HTTP server.

The local IPC adapter and the remote HTTP routes both eventually call the same model, outfit, and action library service modules. However, request validation is still spread across route handlers and service implementations:

- Route adapters manually parse paths, query strings, and JSON bodies.
- Service modules repeatedly normalize values with `String(...)`, `Number(...)`, `Array.isArray(...)`, and fallback defaults.
- Local IPC and remote HTTP can diverge in how they reject malformed payloads.
- Tests must exercise large route flows to verify small input-shape rules.

Zod should be introduced as a request-contract layer. It should describe the current contract and normalize incoming data before it reaches the library services.

## Goals

- Add runtime validation for resource-library request bodies and query params.
- Keep local IPC and remote HTTP behavior consistent for the same invalid input.
- Preserve the existing SQLite schema and existing user data.
- Preserve the existing renderer API functions and route-shaped `apiRequest` facade.
- Move repeated input coercion out of service modules over time.
- Make route behavior easier to test without launching the full Electron or HTTP runtime.
- Keep this migration incremental and reversible.

## Non-Goals

- Do not change the database schema.
- Do not change stored library data, asset files, or canvas files.
- Do not change the user-visible UI as part of the first Zod pass.
- Do not replace the whole HTTP server with Hono in the same change.
- Do not convert route-shaped local IPC to typed IPC methods.
- Do not rewrite model, outfit, and action service internals all at once.
- Do not validate response payloads in the first phase unless a route has a known response-shape bug.

## Current Touch Points

Renderer request callers:

```text
renderer/src/features/model-library/api.ts
renderer/src/features/outfit-library/api.ts
renderer/src/features/action-library/api.ts
renderer/src/features/action-library/actionFolderImportApi.ts
renderer/src/features/infinite-canvas/remote-canvas/remoteCanvasApi.ts
renderer/src/lib/apiClient.ts
```

Local IPC adapter:

```text
electron/main/ipc/local-api-ipc.cjs
```

Remote HTTP adapter and legacy routes:

```text
server/forart-server.mjs
server/src/canvas-exchange/canvas-exchange-api.mjs
server/src/http/responses.mjs
```

Shared library services:

```text
server/src/library/model-library-service.mjs
server/src/library/outfit-library-service.mjs
server/src/library/action-library-service.mjs
server/src/library/action-folder-import-service.mjs
```

## Target Architecture

```text
Renderer API module
  -> apiRequest(path, body/query)
  -> local IPC adapter or remote HTTP adapter
  -> route schema parses params/query/body
  -> service method receives validated input
  -> SQLite and filesystem behavior remains unchanged
```

The Zod layer should sit at the adapter-to-service seam. It should not become a second business implementation. Business checks that require database state, filesystem state, or uniqueness rules should stay in the service modules.

Examples:

- Zod should validate that `entry_ids` is a non-empty array of strings.
- Zod should validate that `operation` is one of `delete`, `add_tags`, or `remove_tags`.
- Zod should normalize `sort_order` to a number.
- The service should still check whether a project exists.
- The service should still check uniqueness of names.
- The service should still decide whether a referenced asset exists.

## Proposed Module Shape

Add:

```text
server/src/shared/validation.mjs
server/src/library/library-route-schemas.mjs
```

Optional later additions:

```text
server/src/canvas-exchange/canvas-exchange-route-schemas.mjs
server/src/http/route-adapter.mjs
```

### `server/src/shared/validation.mjs`

Responsibilities:

- Wrap `schema.safeParse`.
- Convert Zod errors into the existing `{ detail: string }` error shape.
- Optionally include a stable `code`, such as `VALIDATION_ERROR`.
- Optionally include `fields` for future field-level UI.
- Keep HTTP and IPC error conversion consistent.

Suggested result shape:

```js
export function parseRequest(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    status: 400,
    body: {
      detail: formatZodError(result.error),
      code: "VALIDATION_ERROR",
      fields: flattenZodFields(result.error),
    },
  };
}
```

### `server/src/library/library-route-schemas.mjs`

Responsibilities:

- Define shared schemas used by model, outfit, and action library route adapters.
- Export generic schemas where the three library kinds share request shapes.
- Export kind-specific schemas where the behavior differs.

Suggested schema groups:

```text
ids
library kind
tag color
name strings
asset upload payload
project create/update payload
entry update payload
tag create/update payload
list query payload
bulk entries payload
import entries payload
action folder import preview payload
```

## Request Envelope

Validate a normalized route input instead of validating body, params, and query in unrelated places.

Recommended adapter input:

```js
{
  method: "POST",
  params: { projectId: "..." },
  query: { tag_id: ["..."], untagged: "1" },
  body: { ... }
}
```

Benefits:

- Local IPC and remote HTTP can call the same parser after their transport-specific parsing is done.
- Route params, query params, and request bodies can be validated together when they depend on each other.
- The service method receives only the validated values it needs.

Implementation notes:

- HTTP adapters should build `params` from route matches and `query` from `URLSearchParams`.
- Local IPC should build the same shape from its parsed URL and route matches.
- Do not pass a mutable `URL` object into shared schema helpers.
- Keep route matching separate from payload validation until a later router cleanup.

## Unknown Keys Policy

Zod object schemas strip unknown keys by default. That can accidentally change behavior for import flows or future-compatible payloads.

Recommended policy:

- For small command payloads such as bulk operations, tag updates, and project updates, use strict schemas or explicitly strip unknown keys.
- For import row payloads, use `.passthrough()` at the row level until the import service has been audited.
- For upload payloads, allow only known top-level keys.
- Never rely on unknown-key stripping to implement security-sensitive behavior.

This should be documented per schema group so future maintainers know whether extra keys are rejected, stripped, or preserved.

## First Phase Scope

Start with small JSON requests that have the most duplication and the lowest migration risk.

### Phase 1A: Bulk Entry Operations

Routes:

```text
POST /api/libraries/model/entries/bulk
POST /api/libraries/outfit/entries/bulk
POST /api/libraries/action/entries/bulk
```

Current fields:

```text
project_id: string
entry_ids: string[]
operation: "delete" | "add_tags" | "remove_tags"
tags?: string[]
```

Validation rules:

- `project_id` is required after trimming.
- `entry_ids` must be non-empty.
- `entry_ids` should be deduplicated.
- `entry_ids` should stay capped at the current service limit of 500.
- `operation` must be a supported operation.
- `tags` should be normalized to trimmed unique strings with the current max length behavior.
- For `add_tags` and `remove_tags`, `tags` must be non-empty.

Why first:

- Payload is small.
- The same shape exists across model, outfit, and action.
- The current service modules already contain repeated validation.
- Failure modes are easy to test.

### Phase 1B: Tag Create/Update

Routes:

```text
GET    /api/libraries/:kind/tags?project_id=:projectId
POST   /api/libraries/:kind/tags?project_id=:projectId
PATCH  /api/libraries/:kind/tags/:tagId?project_id=:projectId
DELETE /api/libraries/:kind/tags/:tagId?project_id=:projectId
```

Validation rules:

- `project_id` is required for all tag routes.
- `tagId` is required for tag-specific routes.
- `name` should be trimmed, whitespace-collapsed, and capped at 24 characters.
- `color` should be one of the existing library tag colors.
- `sort_order` should normalize to a number when present.

Important behavior to preserve:

- Existing service behavior truncates long tag names to 24 characters.
- Do not accidentally turn truncation into rejection unless that product behavior is explicitly changed.
- Existing unknown colors normalize to `default`; keep this behavior in the first pass unless a stricter contract is desired.

### Phase 1C: Project Create/Update

Routes:

```text
POST   /api/model-projects
PATCH  /api/model-projects/:projectId
POST   /api/outfit-projects
PATCH  /api/outfit-projects/:projectId
POST   /api/action-projects
PATCH  /api/action-projects/:projectId
```

Validation rules:

- `name` is optional for create only if the service keeps using the default localized name.
- `name` should remain validated by `validateFileNamePart` inside the service because that function knows filesystem constraints and localized error labels.
- `cover_asset_id` should normalize empty strings to `null`.
- `sort_order` should normalize to a number when present.

Important behavior to preserve:

- Filesystem-safe names are not just a Zod concern. The current `validateFileNamePart` checks reserved Windows names, trailing spaces/periods, and illegal path characters. Keep that check in the service.

## Second Phase Scope

### Asset Upload JSON Payloads

Routes:

```text
POST /api/model-projects/:projectId/cover/upload
POST /api/models/:modelId/images/upload
POST /api/outfit-projects/:projectId/cover/upload
POST /api/outfits/:outfitId/image/upload
POST /api/action-projects/:projectId/cover/upload
POST /api/actions/:actionId/image/upload
```

Validation rules:

- `filename` is required or defaults to `"image"`.
- `mime_type` defaults to `"image/png"` when omitted.
- `data` must be a non-empty base64 string.
- Avoid decoding large base64 payloads inside Zod refinements. Let the service decode and handle image validation.

Important behavior to preserve:

- Zod should not parse or buffer image data beyond checking presence and string shape.
- Sharp metadata reads and thumbnail generation should remain in service/shared image modules.
- Avoid increasing memory use for large image uploads.

### Model-Specific Entry Requests

Routes:

```text
GET  /api/model-projects/:projectId/models
POST /api/model-projects/:projectId/models
PATCH /api/models/:modelId
POST /api/models/:modelId/images
```

Validation rules:

- `gender` should be one of `female`, `male`, or `unknown`, preserving current fallback behavior where appropriate.
- `tags` should normalize through the shared tag normalization rules.
- `cover_image_id` should normalize empty strings to `null`.
- `asset_id` should be required for adding an existing asset as a model image.
- `caption` should normalize to a string.
- `sort_order` should normalize to a number.

### Outfit And Action Entry Requests

Routes:

```text
PATCH /api/outfits/:outfitId
PATCH /api/actions/:actionId
```

Validation rules:

- `name` remains filesystem-validated in the service.
- `tags` normalize through shared tag rules.
- `prompt` should normalize to a string and preserve the current 4000-character cap in the action service.

## Third Phase Scope

### Import Flows

Routes:

```text
POST /api/model-projects/:projectId/models/import-entries
POST /api/outfit-projects/:projectId/outfits/import-entries
POST /api/action-projects/:projectId/actions/import-folder/preview
POST /api/action-projects/:projectId/actions/import-entries
```

These payloads are larger and closer to file ingestion workflows. They should be validated after the smaller request shapes are stable.

Rules:

- Validate the top-level request shape first.
- Keep row-level warnings/errors in the import service because they are domain outcomes, not request parse failures.
- Preserve partial import behavior where some rows can import and others can fail.
- Do not make Zod reject a whole import batch for row-level issues that are currently reported per row.

## Hono Position

Hono should not be part of the first Zod implementation.

Reasoning:

- Zod solves a current cross-adapter validation problem.
- Hono solves HTTP routing ergonomics, but local IPC is not HTTP.
- Several current routes stream files or packages using Node streams.
- Replacing the server router at the same time would mix validation changes with transport changes.

Hono can be revisited after the JSON route adapters are thin.

Good later candidates:

```text
/api/admin/*
/api/canvas-exchange/projects
/api/canvas-exchange/canvases JSON list/load/delete routes
future /api/model-projects and related JSON resource-library routes
```

Poor first candidates:

```text
/api/assets/:assetId/file
/api/assets/:assetId/download
/api/assets/:assetId/thumb
/api/canvas-exchange/canvases package upload/download
static admin file serving
local IPC routes
```

## Error Handling Contract

Current renderer error handling expects a body with `detail` when a request fails. Preserve that shape.

Recommended validation error body:

```json
{
  "detail": "Invalid request payload.",
  "code": "VALIDATION_ERROR",
  "fields": [
    {
      "path": "entry_ids",
      "message": "Select at least one entry."
    }
  ]
}
```

Compatibility rule:

- `detail` is required.
- `code` and `fields` are optional additions.
- Existing callers that only display `detail` must continue to work.

Do not expose raw Zod internals directly to the renderer. Format them through a small adapter so messages can remain stable if Zod is upgraded.

## Things To Handle Carefully

### Preserve Current Lenient Behavior

Several current services normalize rather than reject:

- Unknown library tag colors become `default`.
- Missing image mime types become `image/png`.
- Tag names are trimmed and sliced to 24 characters.
- Action prompts are sliced to 4000 characters.
- Empty cover IDs are treated as clearing the cover.

The first Zod pass should preserve these behaviors. A stricter contract can come later, but it should be a product decision.

### Do Not Duplicate Business Rules

Zod should validate request shape. Services should keep database and filesystem rules:

- Project exists.
- Entry exists.
- Asset exists.
- Name is unique.
- Filename is valid on Windows.
- Path stays inside the library root.
- Image data can be decoded and inspected by Sharp.

If a rule requires SQLite, filesystem access, or localized service labels, it belongs in the service.

### Watch JavaScript Versus TypeScript Boundaries

The server and Electron main code are currently JavaScript/CommonJS/ESM mixed:

- Server modules are ESM `.mjs`.
- Electron IPC module is CommonJS `.cjs`.
- `local-api-ipc.cjs` already dynamically imports ESM service modules.

Zod schema modules should be ESM `.mjs` and loaded from CJS with dynamic `import()` where needed.

Avoid introducing TypeScript-only schema files unless there is a separate server TypeScript build plan.

### Keep Renderer Types In Sync

Renderer TypeScript types live separately from server JavaScript schemas.

For the first pass, do not try to generate renderer types from Zod. That would make the change larger.

Instead:

- Keep renderer types unchanged.
- Name schemas after existing route payloads.
- Add manual notes when a renderer type and a schema must stay aligned.

Future option:

- Move shared contracts to TypeScript or generate docs/types after the server has a TypeScript strategy.

### Avoid Large Payload Overhead

Image upload payloads include base64 image strings.

Rules:

- Do not use expensive Zod refinements that decode the base64 string in the schema.
- Do not clone or transform huge strings more than necessary.
- Keep image decoding in the existing service path.

### Preserve Local/Remote Parity

Every schema introduced for a route should be used by both local IPC and remote HTTP when both paths support that route.

Avoid validating only the local path or only the remote path for shared resource-library behavior.

### Avoid Changing Import Semantics

Import routes intentionally return row-level errors and warnings. Zod should validate that the request is a batch import request, not reject every row that might have a domain-level issue.

For example:

- Empty `entries` should be a validation error.
- A duplicate model name inside one row can remain a row-level failed import result if that is the current behavior.

### Package Dependency Placement

The root Electron app and the standalone server each have their own package metadata:

```text
package.json
server/package.json
```

If server modules imported by Electron main use Zod, the root app must have `zod` installed. If the standalone server uses the same modules, `server/package.json` must also include `zod`.

Both lockfiles need to be updated when implementation happens:

```text
package-lock.json
server/package-lock.json
```

### Version Alignment

Use the same `zod` version in the root app and standalone server. This avoids subtle differences in error formatting, coercion behavior, or package resolution between local IPC and remote server mode.

### Error Message Stability

Do not expose raw Zod messages as the only stable contract.

Recommended approach:

- Keep a generic `detail`, such as `"Invalid request payload."`, for broad UI compatibility.
- Add stable field records with `path`, `code`, and `message`.
- Prefer project-owned message strings for common cases such as missing project ID, empty selection, and unsupported operation.
- Treat raw Zod issue text as diagnostic detail, not product copy.

This keeps future Zod upgrades from unexpectedly changing user-facing errors.

### Coercion Limits

Zod coercion is useful, but it can hide bad callers if used too broadly.

Recommended approach:

- Use explicit transforms for known legacy-compatible fields such as `sort_order`.
- Avoid broad `z.coerce.string()` on payloads where `null`, arrays, or objects should be treated as invalid.
- Preserve current service defaults intentionally, not accidentally.
- Add tests for string and number forms of `sort_order`.

### Empty String And Null Semantics

Several current routes treat empty strings as meaningful:

- Empty cover IDs clear covers.
- Missing names may use localized defaults on create.
- Empty optional strings often become `""`.

Recommended approach:

- Add small reusable helpers such as `emptyStringToNull`, `trimmedOptionalString`, and `defaultedMimeType`.
- Define the behavior in schemas instead of repeating transforms inline.
- Keep service-level checks for filesystem-valid names.

### Method Handling

Some existing local IPC and HTTP routes accept `HEAD` as equivalent to `GET`.

Recommended approach:

- Keep method normalization outside Zod.
- Include method in the request envelope only when a shared route parser needs it.
- Do not accidentally reject existing `HEAD` routes while adding schema validation.

## Suggested Implementation Phases

### Phase 1: Add Zod Dependency And Shared Helpers

- Add `zod` to root dependencies.
- Add `zod` to `server/package.json`.
- Add `server/src/shared/validation.mjs`.
- Add `server/src/library/library-route-schemas.mjs`.
- Add a lightweight schema verification script because the project does not currently define a test script.

Suggested script:

```text
scripts/validate-zod-schemas.mjs
```

Suggested package script:

```json
"validate:schemas": "node scripts/validate-zod-schemas.mjs"
```

This script should import the schema modules and run focused valid/invalid cases. It can later be replaced by a full test runner if the project adopts one.

Status: implemented.

### Phase 2: Validate Bulk Entry Routes

- Add schema parsing to local IPC bulk routes.
- Add the same parsing to remote HTTP bulk routes or the extracted library HTTP router if that extraction happens first.
- Preserve existing service behavior.
- Verify model, outfit, and action bulk delete/add-tags/remove-tags in local mode and remote mode.

Important sequencing:

- Local IPC currently uses extracted service modules.
- Remote HTTP still has legacy route logic in `server/forart-server.mjs`.
- The same schema can be shared immediately, but the call sites are different.
- Do not clean up service coercion until both call sites use the schema.

Status: implemented for local IPC and remote HTTP.

### Phase 3: Validate Tag Routes

- Validate `project_id` query.
- Validate tag body payloads.
- Preserve unknown-color-to-default behavior unless explicitly changed.
- Verify create, rename, recolor, reorder, and delete tags.

Status: implemented for local IPC and remote HTTP.

Compatibility note:

- Unknown tag colors still normalize to `default`.
- Long tag names are still trimmed, whitespace-collapsed, and truncated to 24 characters.
- `sort_order` still uses the legacy `Number(value || 0)` coercion semantics, including preserving non-finite results instead of rejecting them. Tightening this should be treated as a later contract change.

### Phase 4: Validate Project Routes

- Validate create/update project payloads.
- Keep filesystem name validation in services.
- Verify create, rename, reorder, cover update, and delete projects.

Status: implemented for local IPC and remote HTTP.

Compatibility note:

- Project `name` is intentionally passed through without trimming in the route schema.
- Filesystem-safe project names, empty-name handling, localized defaults, reserved Windows names, uniqueness checks, and folder rename behavior remain in the service layer.
- Empty `cover_asset_id` values normalize to `null`.
- `sort_order` still uses the legacy `Number(value || 0)` coercion semantics.

### Phase 5: Validate Asset Upload Routes

- Validate top-level upload payloads.
- Keep decoding, Sharp dimension reads, thumbnail generation, and file writes in services.
- Verify model cover upload, model image upload, outfit image replacement, action image replacement, and project cover uploads.

Status: implemented for local IPC and remote HTTP.

Compatibility note:

- Upload schemas only validate the top-level JSON shape.
- `filename` still defaults to `"image"`.
- `mime_type` still defaults to `"image/png"`.
- `data` must be a non-empty string, but the schema does not decode or validate base64 content.
- Data URL parsing, image decoding, Sharp metadata reads, thumbnail generation, and file writes remain in the service/server upload path.

### Phase 6: Validate Entry And Import Routes

- Validate create/update entry payloads.
- Validate import request envelopes.
- Preserve row-level import warnings and failures.
- Verify action folder preview and import flows.

Status: implemented for existing local IPC and remote HTTP routes.

Compatibility note:

- Model create/update, model add-image, outfit update, and action update use route schemas for small JSON payloads.
- Entry names are intentionally passed through to service-level filename validation.
- Tags normalize through the shared tag normalization helper before reaching services.
- Action `prompt` still truncates to 4000 characters.
- Import routes validate only the top-level `{ entries }` envelope.
- Import row values are not shape-validated so row-level warnings/failures stay inside the import services.
- Action folder import preview validates `source_path` on the local IPC route where that route currently exists; no new HTTP preview route was added.

### Phase 7: Cleanup Service Defensive Code

- After schemas are used by both adapters, remove redundant coercion from service code where safe.
- Keep service-level validation that protects direct internal callers.
- Do not remove service guards if the method may still be called outside validated routes.

Status: conservatively implemented.

Cleanup completed:

- Removed unused standalone HTTP `sanitizeGender` helper after model-create gender normalization moved to the route schema.
- Removed unused standalone HTTP import for the local-only action import preview schema.
- Removed the unused bulk-schema parse wrapper and use the shared IPC schema parser consistently.
- Made schema normalization helpers private to the schema module instead of exporting them as public API.

Kept intentionally:

- Service-level filename, uniqueness, project/entry/asset existence, asset ownership, and filesystem checks.
- Service-level import row processing and row-level failure/warning generation.
- Defensive normalization in shared library services where methods may still be called outside a validated route path.

## Testing Strategy

Recommended checks:

```bash
npm run validate:schemas
npm run build
npm run validate:i18n
```

Add focused validation checks for:

- Empty project ID.
- Empty entry IDs.
- More than 500 entry IDs.
- Unsupported bulk operation.
- Empty tag name.
- Unsupported tag color.
- Sort order supplied as a string.
- Empty or missing image data.
- Missing `entries` in import payload.
- Invalid `gender`.

Manual behavior checks:

- Local mode model library: create project, rename project, create tag, bulk tag edit, upload image.
- Local mode outfit library: create project, create tag, replace image, bulk delete.
- Local mode action library: preview action folder import, import selected actions, edit prompt, replace image.
- Remote mode against HTTP server: repeat the same library flows.
- Docker/server mode: verify startup and the same HTTP routes.

Remote/local parity checks:

- For each newly validated route, send the same invalid payload through local IPC and remote HTTP.
- Confirm both paths return status `400`.
- Confirm both paths include `detail`.
- Confirm both paths use the same `code` when `code` is present.
- Confirm valid payload behavior is unchanged.

## Rollback Strategy

Rollback should be simple if the migration is staged:

- Remove schema parsing calls from route adapters.
- Keep service methods unchanged.
- Remove Zod dependency only after no module imports it.

Do not delete old service validation until a route group has been verified in both local and remote mode.

## Open Questions

1. Should validation errors expose `fields` to the renderer now, or only keep `{ detail }` for the first pass?
2. Should unknown tag colors continue normalizing to `default`, or become validation errors later?
3. Should long tag names continue truncating to 24 characters, or become validation errors later?
4. Should renderer request builders eventually import generated/shared request types, or stay manually typed until the server has a TypeScript plan?
5. Should Hono be evaluated only after resource-library HTTP routes have been extracted out of `server/forart-server.mjs`?

## Recommended Answers To Open Questions

1. Expose `fields` now, but do not require the renderer to use it yet.
   - Keep `{ detail }` as the compatibility surface.
   - Add `code: "VALIDATION_ERROR"` and `fields` for diagnostics and future field-level UI.
   - Do not wire field-level UI in the first pass.

2. Keep unknown tag colors normalizing to `default` in the first pass.
   - This preserves current behavior and avoids surprising old clients.
   - Add a TODO or follow-up issue if stricter color validation is desired later.
   - If stricter behavior is adopted later, treat it as a contract change.

3. Keep long tag names truncating to 24 characters in the first pass.
   - This preserves current service behavior.
   - Record the behavior explicitly in the tag schema helper name or comments.
   - Revisit later if product wants visible validation errors for long tag names.

4. Keep renderer request builders manually typed for now.
   - The server route schemas will be JavaScript `.mjs`, so there is no clean type-export path yet.
   - Generated/shared TypeScript contracts should wait for a server TypeScript strategy.
   - The immediate goal is runtime parity, not shared compile-time types.

5. Yes, evaluate Hono only after resource-library HTTP routes are extracted out of `server/forart-server.mjs`.
   - Zod should land first at the validation seam.
   - Hono should only replace thin JSON route adapters.
   - Do not include stream/file routes in the first Hono evaluation.

## Recommended First Slice

Start with bulk entry validation.

Why:

- It touches all three resource libraries.
- It has a small, shared payload shape.
- It has obvious invalid states.
- It does not involve file uploads.
- It does not require database schema changes.
- It proves local IPC and remote HTTP can share the same validation module.

Success criteria:

- Invalid bulk payloads return a consistent validation error in local mode and remote mode.
- Valid bulk payloads behave exactly as before.
- No SQLite schema changes are introduced.
- No renderer API call sites need to change.
