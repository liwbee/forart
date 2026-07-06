# Resource Library Bulk Manager Plan

## Background

The resource library currently has three entry types:

- Model cards in model projects.
- Outfit cards in outfit projects.
- Action cards in action projects.

Each type has its own page, store, route set, and backend service. Tags are shared through `library_tags` and `library_entry_tags`, but scoped by `kind` and `project_id`.

Current card operations are single-entry operations:

- Models: `PATCH /api/models/:modelId`, `DELETE /api/models/:modelId`
- Outfits: `PATCH /api/outfits/:outfitId`, `DELETE /api/outfits/:outfitId`
- Actions: `PATCH /api/actions/:actionId`, `DELETE /api/actions/:actionId`

The renderer can technically loop over these endpoints, but that would make bulk deletion and bulk tag changes vulnerable to partial completion. The better design is a backend bulk operation that validates the whole request and applies the change in one service-level transaction where possible.

## Goals

- Add a bulk manager mode for resource library cards.
- Support selecting multiple cards in the current resource library view.
- Support bulk delete.
- Support bulk add tags.
- Support bulk remove tags.
- Keep local desktop IPC mode and remote HTTP mode behavior consistent.
- Keep model, outfit, and action library behavior aligned without merging their domain-specific services into one large generic service.
- Reuse existing tag normalization rules where appropriate: unique tags, trimmed whitespace, and 24-character tag names.
- Remove the current 12-tags-per-card cap as part of this work so bulk and single-card tag behavior stay consistent.
- Preserve existing delete side effects, including asset cleanup, cover cleanup, and folder cleanup rules.

## Non-Goals

- Do not add cross-kind bulk operations in the first version.
- Do not add cross-project bulk operations in the first version.
- Do not introduce a new database schema in the first version.
- Do not add undo/restore in the first version.
- Do not add bulk rename in the first version.
- Do not add tag rules or smart classification in the first version.
- Do not change the existing single-card edit flows.

## Recommended First-Version Scope

Bulk operations should apply to the active resource kind and active project only.

Examples:

- In the model tab, select cards from the current model project only.
- In the outfit tab, select cards from the current outfit project only.
- In the action tab, select cards from the current action project only.

This matches the current tag model because tag records are scoped by `kind + project_id`. It also avoids ambiguous behavior when the user has the same tag name in different projects.

## UX Proposal

### Entry Point

Add a selection mode button to the content toolbar on each library page:

- Models page
- Outfits page
- Actions page

When selection mode is off, cards behave as they do today.

When selection mode is on:

- Each card shows a checkbox.
- Clicking the checkbox toggles selection.
- Clicking the card body should not accidentally open the editor/viewer unless the card has a dedicated preview button.
- The toolbar shows the selected count.
- The toolbar provides:
  - Select matching
  - Clear selection
  - Add tags
  - Remove tags
  - Delete
  - Exit selection mode
- The bulk action toolbar should be a sticky bottom bar.

### Selection Semantics

The first version should support selecting all cards that match the current filtered result.

Recommended behavior:

- `Select matching` selects all cards matching the current project, tag filter, gender filter, and search query.
- If a future implementation adds pagination or virtualization, selection should still fetch/select the full matched result set instead of only the rendered viewport.
- Changing project clears selection.
- Changing resource tab clears selection.
- Changing search or tag filters should keep only selected ids that still belong to the current project and kind.
- Deleting selected cards clears selection after success.

### Bulk Tag Dialog

Use one dialog for both add and remove tags.

For add tags:

- Show existing project tags as selectable chips.
- Do not allow typing new tag names in the first version.
- Users can only add tags that already exist in the current project.
- Show selected count.
- Submit applies the tags to every selected card.

For remove tags:

- Show all existing project tags as selectable chips.
- Submit removes the selected tags from every selected card.
- If a selected card does not have one of the tags, it is skipped for that tag.

### Bulk Delete Confirmation

Bulk delete should require explicit confirmation.

Recommended copy:

```text
Delete 18 selected cards?
This cannot be undone.
```

The confirm button should be destructive and include the count.

## API Proposal

Add one bulk endpoint per resource kind shape:

```http
POST /api/libraries/:kind/entries/bulk
```

Supported `kind` values:

- `model`
- `outfit`
- `action`

Request body:

```json
{
  "project_id": "project-id",
  "entry_ids": ["entry-id-1", "entry-id-2"],
  "operation": "add_tags",
  "tags": ["featured", "needs-review"]
}
```

Supported operations:

- `delete`
- `add_tags`
- `remove_tags`

Optional later operation:

- `set_tags`

Response body:

```json
{
  "ok": true,
  "operation": "add_tags",
  "kind": "model",
  "project_id": "project-id",
  "requested": 12,
  "updated": 12,
  "deleted": 0,
  "skipped": [],
  "tags": [
    {
      "id": "tag-id",
      "name": "featured",
      "usage_count": 8
    }
  ]
}
```

For the first implementation, invalid ids should fail the whole request instead of being silently skipped. That keeps the result predictable and avoids partial user confusion.

## Backend Design

Add bulk methods to each service:

- `createModelLibraryService(...).bulkEntries(payload)`
- `createOutfitLibraryService(...).bulkEntries(payload)`
- `createActionLibraryService(...).bulkEntries(payload)`

Each service should own its own implementation because deletion side effects differ:

- Model deletion removes model images and the model folder.
- Outfit deletion removes the outfit asset and clears project cover references.
- Action deletion removes the action asset and clears project cover references.

Shared helper logic can be extracted only after the three service methods are clear and tested.

### Validation Rules

Before mutation:

- `project_id` is required.
- `entry_ids` must be a non-empty array.
- Limit `entry_ids` to a reasonable maximum.
- Every entry id must exist.
- Every entry must belong to the given project.
- `operation` must be one of the supported operations.
- Tag operations require at least one valid tag name.
- Tags should use the existing normalization rules.

Recommended first-version maximum:

```text
500 entries per bulk request
```

### Transaction Rules

Bulk tag operations should run in one database transaction.

Bulk delete should also be coordinated by the service. Existing delete methods already contain transaction logic, but nesting transactions may conflict. Prefer extracting internal delete helpers that can run inside a parent transaction:

- `deleteModelInsideTransaction(modelId)`
- `deleteOutfitInsideTransaction(outfitId)`
- `deleteActionInsideTransaction(actionId)`

Filesystem deletion is not fully rollbackable. The service should delete database rows and remove assets with the same safety checks already used by existing single-delete flows.

### Tag Add

For every selected entry:

1. Read current tag names.
2. Merge current tags with normalized requested tags.
3. Ensure project tags exist.
4. Replace entry tag links.
5. Update entry `updated_at`.

### Tag Remove

For every selected entry:

1. Resolve requested tag names.
2. Read current tag names.
3. Remove requested names from current tags.
4. Replace entry tag links.
5. Update entry `updated_at`.

The tag record itself should remain in `library_tags` even if usage becomes zero. Existing tag manager behavior already allows explicit tag deletion.

## Routing

Remote HTTP mode:

- Add handling in `server/forart-server.mjs`.

Local desktop IPC mode:

- Add dispatch handling in `electron/main/ipc/local-api-ipc.cjs`.

Renderer API wrappers:

- `renderer/src/features/model-library/api.ts`
- `renderer/src/features/outfit-library/api.ts`
- `renderer/src/features/action-library/api.ts`

Each wrapper can expose a typed function:

```ts
bulkModelEntries(payload)
bulkOutfitEntries(payload)
bulkActionEntries(payload)
```

## Code Architecture

The implementation should avoid both extremes:

- Do not build one giant bulk-manager component or one giant shared backend service that knows every resource type.
- Do not split every button, checkbox, and helper into separate files.

Use a small number of cohesive files grouped by layer.

### Backend Shape

Keep bulk behavior inside the existing library services:

```text
server/src/library/model-library-service.mjs
server/src/library/outfit-library-service.mjs
server/src/library/action-library-service.mjs
```

Each service gets one public method:

```js
bulkEntries(payload)
```

Each service may have a few private helpers in the same file:

```js
validateBulkPayload(payload)
bulkAddTags(projectId, entryIds, tagNames)
bulkRemoveTags(projectId, entryIds, tagNames)
bulkDeleteEntries(projectId, entryIds)
```

This keeps deletion side effects close to the existing single-entry delete logic. It also avoids a premature generic abstraction because model deletion, outfit deletion, and action deletion are not identical.

If repeated code becomes meaningful after all three services are implemented, extract only pure tag helpers into one shared module:

```text
server/src/library/library-bulk-tags.mjs
```

Do not extract filesystem deletion or entry loading into a shared bulk service in the first version.

### Routing Shape

Route handlers should stay thin:

- Parse `kind`.
- Pick the matching service.
- Call `service.bulkEntries(body)`.
- Return the result.

Avoid duplicating bulk validation in both `server/forart-server.mjs` and `electron/main/ipc/local-api-ipc.cjs`. Validation belongs in the service method.

### Renderer Shape

Use one shared UI module group under:

```text
renderer/src/features/resource-library/
```

Recommended files:

```text
LibraryBulkActions.tsx
useLibraryBulkSelection.ts
libraryBulkTypes.ts
```

`LibraryBulkActions.tsx` should contain the bottom toolbar, add-tags dialog, remove-tags dialog, and delete confirmation. These pieces are tightly related and should stay together until the file becomes hard to navigate.

`useLibraryBulkSelection.ts` should contain selection state only:

- selection mode
- selected ids
- select matching
- clear selection
- toggle one id
- prune selected ids on project/kind changes

`libraryBulkTypes.ts` should hold shared renderer types only if the types are used by more than one file. If the types stay small, colocate them in `LibraryBulkActions.tsx` instead.

Keep model/outfit/action-specific mutation wiring inside the existing pages:

```text
renderer/src/features/model-library/ModelLibraryPage.tsx
renderer/src/features/outfit-library/OutfitLibraryPage.tsx
renderer/src/features/action-library/ActionLibraryPage.tsx
```

The shared bulk UI should receive callbacks and data:

```ts
selectedCount
tags
isBusy
onSelectMatching
onClearSelection
onAddTags
onRemoveTags
onDeleteSelected
```

It should not import model/outfit/action API functions or query keys.

### API Wrapper Shape

Add one function to each existing API file:

```text
renderer/src/features/model-library/api.ts
renderer/src/features/outfit-library/api.ts
renderer/src/features/action-library/api.ts
```

Do not create a new renderer-wide library API abstraction for the first version. The existing code already keeps API wrappers next to each feature, and the bulk manager should follow that pattern.

### Styling Shape

Use the existing resource/model library stylesheet structure. Prefer adding one compact style section for bulk controls to:

```text
renderer/src/styles/model-library.css
```

Only create a new stylesheet if the bulk UI grows beyond a focused section. Avoid spreading related styles across all three library CSS files.

## Frontend Design

Create shared resource-library bulk UI pieces under:

```text
renderer/src/features/resource-library/
```

Suggested files:

- `LibraryBulkActions.tsx`
- `useLibraryBulkSelection.ts`
- `libraryBulkTypes.ts`, only if shared types would otherwise be duplicated

The hook should own:

- selected id set
- selection mode
- select matching
- clear selection
- toggle one id
- pruning selection when visible project/kind changes

Each library page still owns its data and mutations. The shared UI should not know model/outfit/action-specific query keys.

## Cache Invalidation

After any bulk operation, invalidate:

- Current entries query root:
  - `["models", activeProjectId]`
  - `["outfits", activeProjectId]`
  - `["actions", activeProjectId]`
- Current project tags query:
  - `modelLibraryKeys.tags(activeProjectId)`
  - `outfitLibraryKeys.tags(activeProjectId)`
  - `actionLibraryKeys.tags(activeProjectId)`
- Project list query for outfit/action delete if cover or updated counts may change.
- Model images query only if the open model is deleted or affected.

## Internationalization

Add labels to shared/common namespaces where possible:

- Selection mode
- Select matching
- Clear selection
- Selected count
- Add tags to selected
- Remove tags from selected
- Delete selected
- Bulk delete confirmation
- Bulk operation failed
- Bulk operation completed

## Implementation Phases

### Phase 1: Backend Contract

- Add service-level bulk methods for model, outfit, and action libraries.
- Add remote HTTP route.
- Add local IPC dispatch route.
- Add renderer API wrappers.
- Verify manually with local IPC and remote HTTP calls.

### Phase 2: Shared Frontend Selection

- Add shared selection hook.
- Add shared bulk toolbar.
- Add checkbox affordance to model, outfit, and action cards.
- Clear selection on project or tab change.

### Phase 3: Bulk Tag Operations

- Add bulk add-tags dialog.
- Add bulk remove-tags dialog.
- Wire mutations and query invalidation.
- Verify usage counts update correctly.

### Phase 4: Bulk Delete

- Add destructive confirmation.
- Wire bulk delete mutation.
- Verify asset cleanup and folder cleanup for all three kinds.
- Verify open editor/viewer state closes when its card is deleted.

### Phase 5: Polish And Regression Testing

- Add loading/disabled states.
- Add row/card visual selected state.
- Add empty selection handling.
- Verify narrow layout does not overlap existing controls.
- Run typecheck/build.

## Risks

- Filesystem deletion cannot be rolled back like database writes.
- Existing single-delete methods may need internal refactoring to avoid nested transactions.
- Model card deletion has more side effects than outfit/action because models own multiple images and a folder.
- Selection behavior can become confusing if filters change while many cards are selected.
- Removing the current tag-count cap touches both frontend normalization and backend normalization; all three library services plus the remote server fallback need to stay consistent.

## Confirmed Decisions

These product rules are confirmed:

- First version works only inside the current resource kind and current project.
- `Select matching` means the full current filtered/searched result set.
- Selection should represent the full matched result set, not only the rendered viewport.
- Changing project or resource tab clears selection.
- Entering selection mode automatically closes any open action/model card editor.
- Bulk add-tags can only use existing project tags in the first version.
- Bulk remove-tags shows all project tags.
- Invalid entry ids fail the whole bulk request.
- There should be no tag-count limit per card.
- Tags with zero usage remain in the tag manager.
- Bulk delete uses a second confirm button; typed `DELETE` confirmation is not required.
- The bulk toolbar should be a sticky bottom action bar.
- Completed bulk operations should show a toast only, not a result dialog.
- Bulk delete is permanent and has no undo in the first version.
- Maximum bulk request size is 500 cards.

## Existing Tag Cap To Remove

The current code does have a 12-tags-per-card cap. It appears in at least:

- `renderer/src/features/model-library/tagUtils.ts`
- `server/forart-server.mjs`
- `server/src/library/model-library-service.mjs`
- `server/src/library/outfit-library-service.mjs`
- `server/src/library/action-library-service.mjs`

The bulk manager implementation should remove that cap from shared tag normalization paths instead of only bypassing it for bulk operations. Otherwise single-card edits and bulk edits would disagree.

## Needs User Confirmation

No open product decisions remain for the first version.

## Future Extensions

- Cross-project resource manager view.
- Cross-kind manager view.
- Bulk move to another project.
- Bulk set tags, replacing all tags.
- Bulk rename by pattern.
- Bulk export selected cards.
- Undo window for non-filesystem operations.
