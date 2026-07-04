# Resource Library Card Rename Plan

## Background

The action library card name editor already sends `name` in `PATCH /api/actions/:actionId`, but both remote HTTP mode and local IPC mode ignore that field. The request can succeed while `action_entries.name` remains unchanged.

The model library already has the expected rename behavior for model cards:

- Validate that the name is a safe file/folder name.
- Enforce name uniqueness within the project.
- Rename the related folder or image files.
- Update the database record.

The outfit library does not currently expose card-name editing in the UI. Its backend should still gain the same rename capability so the UI can enable it later without another server/API migration.

## Goals

- Fix action library card rename in both server mode and local mode.
- Add backend-only outfit card rename support for future use.
- Fix remote server cleanup so deleting projects and model cards removes leftover library folders like local mode already does.
- Keep model library behavior unchanged, but improve duplicate-name UI feedback.
- Show duplicate-name errors near the active input instead of only relying on the generic page error.
- Rename image files when action or outfit card names change.

## Non-Goals

- Do not add outfit card-name editing UI yet.
- Do not migrate old data.
- Do not preserve the original uploaded filename as separate metadata.

## Confirmed Decisions

- Renaming an action or outfit project must not renumber child entries. Child card names should survive project rename.
- Renaming an action project must not renumber child entries. Child action card names should survive project rename.
- Renaming an outfit project should keep the current behavior for now: child outfit entries are renumbered as `<project>_001`, `<project>_002`, etc.
- Duplicate-name checks should run before submitting the rename request.
- Original uploaded filenames do not need to be preserved after normalized library filenames are created.

## Existing Behavior

### Model Library

Model card rename already supports `payload.name`.

Expected backend behavior exists in:

- `server/src/library/model-library-service.mjs`
- `server/forart-server.mjs`

It validates the new name, checks uniqueness in the same model project, renames the model folder/images, then updates `model_entries.name`.

### Action Library

The renderer sends name updates from the card editor:

- `renderer/src/features/action-library/ActionLibraryPage.tsx`
- `renderer/src/features/action-library/api.ts`

But the backend update handlers only apply `tags` and `prompt`.

Affected backend paths:

- Remote server: `PATCH /api/actions/:actionId` in `server/forart-server.mjs`
- Local IPC service: `updateAction(...)` in `server/src/library/action-library-service.mjs`

### Outfit Library

The backend update handlers only apply `tags`. There is no active card-name editing UI to wire up yet.

Affected backend paths:

- Remote server: `PATCH /api/outfits/:outfitId` in `server/forart-server.mjs`
- Local IPC service: `updateOutfit(...)` in `server/src/library/outfit-library-service.mjs`

### Remote Server Folder Cleanup

Local IPC mode already removes library folders through the service modules:

- Model project delete removes the model project folder.
- Model card delete removes the model folder.
- Action project delete removes the action project folder.
- Outfit project delete removes the outfit project folder.

Remote server mode still uses inline handlers in `server/forart-server.mjs`. Those handlers delete database records and asset files, but do not recursively remove the now-empty project/model folders. This causes leftover folders under the server library directory after deleting projects or model cards.

## Backend Rename Rules

### Project Rename Behavior

Action project rename should change from the current batch-renumber behavior.

New behavior:

1. Rename the project directory. This is a filesystem directory move/rename operation, not a per-file copy.
2. Keep existing child image files inside that renamed directory.
3. Keep each child entry's `name` unchanged.
4. Keep each child asset's basename unchanged.
5. Update each affected asset `path`.
6. Update project `name` and `updated_at`.

This preserves manual card names and avoids surprising renumbering after a project/folder rename.

Outfit project rename should keep the current batch-renumber behavior for now. That means renaming an outfit project still renames child outfit entries and image basenames to match the new project prefix.

## Remote Folder Cleanup Rules

Add the same safe recursive directory cleanup used by local service modules to `server/forart-server.mjs`.

Required helper:

```js
function removeDirectoryInsideLibrary(directory, libraryRoot) {
  // Resolve paths, refuse to delete outside the expected library root,
  // then rmSync(target, { recursive: true, force: true }).
}
```

Use separate root checks for each library type:

- Model project/model folders must stay inside the model library root.
- Action project folders must stay inside the action library root.
- Outfit project folders must stay inside the outfit library root.

Remote server delete behavior to add:

- `DELETE /api/model-projects/:projectId`
  - Capture `projectDirForName(project.name)` before DB deletion.
  - After successful DB transaction and asset cleanup, recursively delete the project folder.
- `DELETE /api/models/:modelId`
  - Capture `modelDirForNames(project.name, model.name)` before DB deletion.
  - After successful DB transaction and asset cleanup, recursively delete the model folder.
- `DELETE /api/action-projects/:projectId`
  - Capture `actionProjectDirForName(project.name)` before DB deletion.
  - After successful DB transaction and asset cleanup, recursively delete the action project folder.
- `DELETE /api/outfit-projects/:projectId`
  - Capture `outfitProjectDirForName(project.name)` before DB deletion.
  - After successful DB transaction and asset cleanup, recursively delete the outfit project folder.

Do not add folder deletion for single action/outfit card delete. Those entries are single images inside a project folder, so deleting the image asset is sufficient.

### Shared Rule Shape

For action and outfit entries:

1. Load the entry by id.
2. Load its parent project.
3. Normalize and validate `payload.name` with the same filename-safe rules used elsewhere.
4. Enforce uniqueness within the same project.
5. If the normalized name differs from the current name:
   - Resolve the current asset path.
   - Preserve the existing file extension.
   - Build the target path under the current project directory.
   - Refuse to overwrite an existing file.
   - Rename the file.
   - Update `assets.filename`.
   - Update `assets.path`.
   - Update entry `name`.
   - Update entry `updated_at`.
6. Return the updated entry with asset URL and tags.

### Action Rename

Add or reuse:

- `actionNameExists(projectId, name, exceptActionId)`
- `renameActionImage(action, nextName)`

Remote server logic should be added to `PATCH /api/actions/:actionId`.

Local IPC service logic should be added to `updateAction(actionId, payload)`.

Validation:

- Use `validateFileNamePart(payload.name || defaultActionName, "action name")`.
- Reject duplicate names in the same action project.
- Reject unsafe filesystem names.

File rename:

- Current directory: `actionProjectDirForName(project.name)`
- Target filename: `${nextName}${existingExtension}`
- Preserve the current asset extension from `asset.path`, `asset.filename`, or MIME type fallback.

### Outfit Rename

Add or reuse:

- `outfitNameExists(projectId, name, exceptOutfitId)`
- `renameOutfitImage(outfit, nextName)`

Remote server logic should be added to `PATCH /api/outfits/:outfitId`.

Local IPC service logic should be added to `updateOutfit(outfitId, payload)`.

Validation:

- Use `validateFileNamePart(payload.name || defaultOutfitName, "outfit name")`.
- Reject duplicate names in the same outfit project.
- Reject unsafe filesystem names.

File rename:

- Current directory: `outfitProjectDirForName(project.name)` or equivalent service helper.
- Target filename: `${nextName}${existingExtension}`
- Preserve the current asset extension from `asset.path`, `asset.filename`, or MIME type fallback.

## UI Error Feedback

### Required Behavior

For model card rename and action card rename:

- If the server rejects a duplicate name, the active input border should turn red.
- A floating error notification should appear above the input.
- The notification should be anchored to the edited input, not only shown as a page-level error.
- The user should be able to continue editing without the input being forcibly closed.
- The error should clear when:
  - The user changes the input value.
  - The rename succeeds.
  - The editor is closed/canceled.

### Error Copy

Use concise text:

- Chinese: `名称已存在`
- English: `Name already exists`

For non-duplicate validation errors, display the server message in the same floating notice.

### Visual Style

Input error state:

- Red border using existing danger token.
- Keep focus ring visible.
- Do not shift layout.

Floating error notice:

- Position above the input.
- Small, compact, single line when possible.
- Red/danger tone.
- Should not block typing or clicking inside the input.
- Should not overlap unrelated controls in narrow card layouts.

Suggested class names:

- `library-rename-input--error`
- `library-rename-error-popover`

The existing `model-project-rename-input` styles should not be overloaded for card-level errors if that creates confusing project/card coupling.

## Frontend Wiring

### Action Library

Action card name editing already exists. Adjust mutation handling so failed rename errors remain attached to the specific action id and field.

Before submitting a rename:

- Check the current action list for another action in the same project with the same normalized name.
- If a duplicate exists, show the input-level error immediately and do not call the API.
- Still keep backend validation as the source of truth in case data is stale or another client changed the library.

Suggested state shape:

```ts
const [renameErrors, setRenameErrors] = useState<Record<string, string>>({});
```

On `updateActionDetailsMutation` error:

- If the patch included `name`, store the message under `actionId`.
- Keep the editor open.

On input change:

- Clear `renameErrors[actionId]`.

On success:

- Clear `renameErrors[actionId]`.
- Invalidate the active actions query.

### Model Library

Model card rename already works at the backend level. Add the same per-card rename error state and visual treatment.

Before submitting a rename:

- Check the current model list for another model in the same project with the same normalized name.
- If a duplicate exists, show the input-level error immediately and do not call the API.
- Still keep backend validation as the source of truth in case data is stale or another client changed the library.

### Outfit Library

Do not expose card rename UI yet.

Only update API/type support if useful for future integration:

- `updateOutfit(outfitId, { name })`
- `OutfitEntry` type already has `name`, so the mutation payload can be widened when the UI is added later.

## Implementation Checklist

### Backend

- Add action entry `name` handling in `server/src/library/action-library-service.mjs`.
- Add action entry `name` handling in `server/forart-server.mjs`.
- Add outfit entry `name` handling in `server/src/library/outfit-library-service.mjs`.
- Add outfit entry `name` handling in `server/forart-server.mjs`.
- Ensure file rename updates `assets.filename` and `assets.path`.
- Ensure duplicate names are rejected per project.
- Update action project rename so child action names are preserved and only asset paths are updated after the project directory rename.
- Keep outfit project rename's existing child-renumber behavior.
- Add safe recursive folder cleanup to remote `server/forart-server.mjs`.
- Remote model project delete removes the project folder.
- Remote model card delete removes the model folder.
- Remote action project delete removes the action project folder.
- Remote outfit project delete removes the outfit project folder.
- Ensure existing `prompt`, `tags`, image replacement, and delete behavior still works.

### Frontend

- Keep action card name editor submitting `name`.
- Add per-action rename error state.
- Add client-side duplicate-name precheck before action rename submit.
- Add red input border for action rename errors.
- Add floating error notice above the action name input.
- Add equivalent model card rename error UI.
- Add client-side duplicate-name precheck before model rename submit.
- Leave outfit card rename UI disabled/unimplemented.

### Validation

- `npm run validate:i18n`
- `npm run build`
- Manual remote-mode test:
  - Rename action card to a unique name.
  - Confirm DB/list result updates.
  - Confirm image file is renamed on disk.
  - Rename another action card to an existing name.
  - Confirm red input border and floating error.
- Manual local-mode test:
  - Repeat the same checks through Electron IPC/local mode.
- Regression checks:
  - Rename action project and confirm child action names remain unchanged while asset paths update.
  - Rename outfit project and confirm existing child-renumber behavior remains unchanged.
  - Delete remote model project and confirm the folder is removed.
  - Delete remote model card and confirm the model folder is removed.
  - Delete remote action project and confirm the folder is removed.
  - Delete remote outfit project and confirm the folder is removed.
  - Rename model card and confirm existing behavior still works.
  - Update action prompt and tags.
  - Upload/replace/delete action images.
