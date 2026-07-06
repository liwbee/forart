# Action Library Bulk Import Plan

## Background

The action library now writes both single-entry and multi-entry imports through `POST /api/action-projects/:projectId/actions/import-entries`. The backend creates `action_entries` rows, auto-generates names when an entry name is blank, and accepts only existing tag ids/names when tags are supplied.

The target import source can be a local folder such as a downloaded action-prompt folder. One current real example is the user's `Downloads` folder named for the natural-standing action set.

```text
C:\Users\Rocco\Downloads\<action-folder>
```

That folder currently contains paired files:

```text
full-body-natural-standing-front-hands-on-waist-001.png
full-body-natural-standing-front-hands-on-waist-001.txt
```

For the first implementation, each image should be paired with a same-stem `.txt` file. The image becomes the action reference image, and the text file becomes the action prompt.

## Goals

- Add a batch import flow for action library entries.
- Support importing from a local folder in both local desktop mode and remote mode.
- Pair images with same-stem `.txt` files.
- Use the image filename stem as the action card name.
- Use the paired text file content as `action_entries.prompt`.
- Show an import preview before writing to the library.
- Report imported and failed files clearly after import.
- Keep the implementation compatible with the existing action library storage model.

## Non-Goals

- Do not auto-create tags during import; import entries may only reference existing tags.
- Do not send local folder paths to the remote server. Remote mode must upload selected entries from the renderer.
- Do not add CSV, JSON, or manifest-based import in the first version.
- Do not overwrite existing action cards automatically.
- Do not auto-rename duplicate action names unless confirmed later.
- Do not recursively scan subfolders in the first version.
- Do not migrate existing action library data.

## Confirmed First-Version Rules

- The first version ignores tags completely.
- The import target is the currently selected action project by default.
- Action name comes from the image filename without extension.
- Prompt comes from the same-stem `.txt` file.
- Missing images and missing `.txt` files must both be visible in the batch import screen.
- Missing images and missing `.txt` files are blocking errors and cannot be imported.
- Import is allowed only after every selected row is valid.
- Prompt files over 4000 characters are truncated and shown with a warning.
- Duplicate action names are shown as row-level blocking errors.
- The first version does not recursively scan subfolders.
- The batch import preview must show a thumbnail for each row that has an image.
- The batch import interface allows manually unchecking rows before import.
- Unchecked rows are ignored by the import process and do not block import.
- Every selected row must be valid before import can start.
- Valid rows are selected by default. Rows with blocking errors are not selected by default.
- All errors and warnings are shown on their related rows.
- After a successful import, show a result summary screen with imported and failed counts plus a full row list.
- Text reading should support UTF-8 and include GBK/GB18030 fallback.
- Supported image extensions should be at least `.png`, `.jpg`, `.jpeg`, and `.webp`.
- The first version supports only `.png`, `.jpg`, `.jpeg`, and `.webp`.
- The importer only recognizes supported image files and `.txt` files. Other files, including hidden/system files, are ignored.
- Preview thumbnails should be generated from the original selected file path. Files are copied into managed storage only after import confirmation.
- Imported images preserve the original extension. The importer does not convert image formats.
- Import should copy files into the managed action library storage instead of referencing the source folder directly.
- Source files should remain untouched.

## Proposed UX

### Entry Point

Add a "Batch Import" action in the action library page, near the existing image upload/drop area.

Clicking it opens a dedicated batch import interface in both local desktop mode and remote mode. The interface uses an Electron folder picker, and Electron main scans the selected local folder through IPC. The renderer receives preview rows and thumbnail URLs, then uploads only selected valid import entries.

The remote server never reads a local Windows path like `C:\Users\Rocco\Downloads\<action-folder>`. Electron main reads the local files and returns explicit entry data to the renderer; the server receives action name, prompt text, original filename, mime type, and image bytes.

### Preview Dialog

The preview dialog should show:

- Source folder path.
- Target action project.
- Total image files found.
- Number of valid image/text pairs.
- Images missing `.txt`.
- `.txt` files without matching images.
- Duplicate action names in the target project.
- Invalid action names.
- Estimated import count.
- Selected row count.
- Whether the current selection is importable.
- A re-scan action for checking the same folder again after source files are fixed.

Each preview row should show:

- Thumbnail when an image exists.
- Filename or text filename.
- Proposed action name.
- Prompt status: found, missing, unreadable.
- Image status: found, missing, unreadable.
- Import status: ready, not selected, invalid, duplicate, warning.
- Warnings such as duplicate action name or prompt truncation.
- Checkbox state for whether the row is selected for import.

Rows with blocking errors can be shown but cannot be selected for import. If any selected row has a blocking error, the import confirmation button stays disabled.

Unchecked rows are ignored throughout import execution. They should not be treated as failures, and they do not need special handling beyond remaining visible in the interface.

Valid rows are checked by default. Rows with blocking errors are unchecked by default.

### Confirmation

The user confirms the import from the preview dialog. The import should only process selected rows marked as ready.

After import, keep the same row list visible and update each row as it progresses:

- Pending before the row is processed.
- Importing while the row is being uploaded.
- Imported in green after success.
- Failed with the row-level error.
- Not selected for unchecked rows.

The summary counters above the list should show imported, warning, failed, and not-selected counts after completion.

## Import Matching Rules

Given an image file:

```text
full-body-natural-standing-front-hands-on-waist-001.png
```

The importer looks for:

```text
full-body-natural-standing-front-hands-on-waist-001.txt
```

Matching is based on the full filename stem. Extension comparison should be case-insensitive.

If multiple supported image files share the same stem, treat that stem as ambiguous and skip it unless a conflict rule is added later.

If a `.txt` file has no matching image, include it in the preview as a missing-image row. This row cannot be imported.

If an image has no matching `.txt` file, include it in the preview as a missing-text row. This row cannot be imported.

### Recursive Import Meaning

Recursive import means scanning files inside subfolders under the selected folder.

For example, if the selected folder is:

```text
C:\Users\Rocco\Downloads\<action-folder>
```

A non-recursive import scans only files directly inside that folder.

A recursive import also scans files such as:

```text
C:\Users\Rocco\Downloads\<action-folder>\front\pose-001.png
C:\Users\Rocco\Downloads\<action-folder>\side\pose-002.png
```

The first version uses non-recursive import only. Subfolders are ignored.

## Action Name Rules

The proposed action name is the image filename stem.

The backend should reuse existing filename validation rules:

- No Windows-invalid filename characters.
- Not empty.
- Not `.` or `..`.
- No trailing spaces or periods.
- Maximum length should match existing action name validation.
- Must be unique within the target action project.

First-version duplicate handling should be conservative:

- If the action name already exists in the target project, show a duplicate error for that row.
- Duplicate rows cannot be imported while selected in the first version.
- A duplicate row can be unchecked so the remaining selected valid rows can still be imported.
- Do not overwrite existing entries.

## Prompt Text Rules

The paired `.txt` content should be written to `action_entries.prompt`.

Implementation notes:

- Trim only trailing null bytes or obvious file-read artifacts; do not aggressively rewrite user prompt text.
- Preserve line breaks.
- Apply the existing prompt length limit, currently 4000 characters.
- If text is longer than the limit, truncate to 4000 characters and show a preview warning.
- Prompt truncation is a warning, not a blocking error.
- Text encoding needs care. Prefer UTF-8, with GBK/GB18030 fallback.

## Backend Design

Add an import-specific service at `server/src/library/action-folder-import-service.mjs`. Keep reusable action storage in `server/src/library/action-library-service.mjs`.

The primary UI path uses explicit entry import for both local and remote modes:

```ts
importActionEntries(projectId, payload)
```

Suggested payload:

```ts
interface ActionFolderImportEntriesPayload {
  entries: ActionFolderImportUploadEntry[];
}

interface ActionFolderImportUploadEntry {
  id: string;
  stem: string;
  name: string;
  filename: string;
  relative_path: string;
  mime_type: string;
  data: string; // base64 image bytes
  prompt: string;
  warnings: ActionFolderImportIssue[];
}
```

Electron main owns the preview scan in the product UI path. The renderer owns the TypeScript contract for the preview response:

```ts
interface ActionFolderImportPreview {
  source_path: string;
  project_id: string;
  total_images: number;
  total_text_files: number;
  ready_count: number;
  blocking_error_count: number;
  warning_count: number;
  rows: ActionFolderImportPreviewRow[];
}

interface ActionFolderImportPreviewRow {
  image_path: string | null;
  text_path: string | null;
  filename: string;
  proposed_name: string;
  thumbnail_url?: string;
  selectable: boolean;
  selected: boolean;
  status: "ready" | "missing_image" | "missing_text" | "duplicate_name" | "invalid_name" | "ambiguous_image" | "unreadable" | "warning";
  errors?: string[];
  warnings?: string[];
  reason?: string;
}
```

Suggested import response:

```ts
interface ActionFolderImportResult {
  imported_count: number;
  failed_count: number;
  imported: ActionEntry[];
  not_selected: ActionFolderImportResultRow[];
  failed: ActionFolderImportResultRow[];
  rows: ActionFolderImportResultRow[];
}
```

### Local IPC Route

Extend `electron/main/ipc/local-api-ipc.cjs` action library dispatch:

```text
POST /api/action-projects/:projectId/actions/import-entries
POST /api/action-projects/:projectId/actions/import-folder/preview
```

The UI calls `import-entries` for both single-entry and multi-entry imports so local and remote imports share the same payload shape and backend import service. The local `import-folder/preview` route is only for Electron folder preview scanning; the old one-shot `import-folder` write route has been removed.

### Electron Folder Scan And Preview

The visible UI path uses a narrow Electron bridge:

```ts
window.forartActionImport.chooseFolder()
window.forartActionImport.scan({ projectId, sourcePath, existingActionNames })
window.forartActionImport.readEntry({ previewId, rowId })
window.forartActionImport.clearPreview()
```

Electron main is responsible for:

- Non-recursive folder scanning.
- Pairing same-stem image and `.txt` files.
- UTF-8 text decoding with GB18030 fallback.
- Prompt truncation warnings.
- Row validation for missing files, duplicate names, ambiguous image matches, and invalid names.
- Serving row thumbnails through `forart-asset://action-folder-import-preview/{previewId}/{rowId}`.
- Reading a selected row's image bytes and prompt text during import.

This matches the image-review architecture: the renderer keeps UI state, while Electron main owns filesystem access and repeatable rescans.

### Remote HTTP Route

Remote mode uses the same explicit action-entry import payload as local mode:

```text
POST /api/action-projects/:projectId/actions/import-entries
```

Electron main reads local files, the renderer builds the upload entry from IPC data, and the renderer uploads only selected valid entries. This keeps remote import from depending on server-side access to a local folder path.

The current implementation uploads selected rows one at a time and merges the returned row results in the renderer. This avoids constructing one very large JSON/base64 request for folders with many images.

## Storage Behavior

Each imported image should go through the same asset-writing path as normal action creation:

- Copy the image into the action project folder under managed library storage.
- Insert an `assets` row.
- Insert an `action_entries` row with `name`, `asset_id`, `prompt`, `created_at`, and `updated_at`.
- If the project has no cover image, set the first imported image as project cover.

The importer should avoid the existing single-action auto-name behavior because imported names come from filenames.

## Code Architecture

The implementation should avoid both extremes: do not put the whole feature into `ActionLibraryPage.tsx` or `action-library-service.mjs`, and do not split every helper into a separate file.

Recommended shape:

```text
server/src/library/action-folder-import-service.mjs
server/src/library/action-library-service.mjs
server/forart-server.mjs
electron/main/ipc/local-api-ipc.cjs
electron/main/modules/action-folder-import-store.cjs
renderer/src/features/action-library/actionFolderImportTypes.ts
renderer/src/features/action-library/actionFolderImportApi.ts
renderer/src/features/action-library/ActionFolderImportDialog.tsx
renderer/src/features/action-library/ActionLibraryPage.tsx
```

### Server Module

Create `server/src/library/action-folder-import-service.mjs` for the import-specific backend logic:

- Import explicit selected entries with `name`, `prompt`, and image bytes.
- Validate proposed action names again server-side.
- Detect duplicate names in the target project again server-side.
- Return per-row imported, failed, and warning statuses.
- Keep local-only folder scan helpers available if the local IPC path-based route is needed later.

Keep reusable low-level action storage operations in `action-library-service.mjs`. The action library service can expose a small internal helper for "create action from already-read file content with explicit name and prompt" so the folder importer does not duplicate asset-writing rules.

Both `electron/main/ipc/local-api-ipc.cjs` and `server/forart-server.mjs` should call this service for `import-entries`. That keeps local and remote backend behavior aligned.

### IPC Routing

Keep route dispatch in `electron/main/ipc/local-api-ipc.cjs`, but limit it to routing:

- Parse project id.
- Call `importActionEntries`.
- Keep only the local `import-folder/preview` route for folder preview scanning.

Do not put scan, validation, or import logic directly in the IPC router.

Keep filesystem preview scanning in `electron/main/modules/action-folder-import-store.cjs` instead of the local API router. This module should expose the import bridge methods and preview URL resolver used by the `forart-asset` protocol.

### Renderer Module

Create `ActionFolderImportDialog.tsx` as the UI boundary for the feature:

- Folder picker button.
- Re-scan button.
- Summary counters.
- Row list with thumbnail, proposed name, prompt status, image status, row errors, and warnings.
- Row checkbox controls.
- Import button disabled until every selected row is valid.
- Result view with full row list and final statuses.
- Calling the Electron action-import bridge for folder selection, scan, preview thumbnails, and per-row file reads.
- Sequential one-row-at-a-time upload through `import-entries`, with live row status updates.

Keep `ActionLibraryPage.tsx` responsible only for opening the dialog and refreshing queries after successful import.

Create a small `actionFolderImportApi.ts` instead of adding all import-specific calls to the existing `api.ts`. This keeps the main action library API readable while avoiding a broad folder tree.

### Type Sharing

Use one renderer type file, `actionFolderImportTypes.ts`, for preview/result row shapes. The backend remains JavaScript, so keep the runtime validation on the backend and keep TypeScript types as renderer contracts.

## Transaction And Failure Strategy

Use per-row transactions for the first version.

Reasoning:

- A large folder import should not fail entirely because one file is invalid.
- Each row can be cleanly rolled back if its image copy or database insert fails.
- The final report can tell the user exactly what imported and what failed.

Preview validation should catch common issues before import, but import must still revalidate because the source folder or database may change after preview.

## Frontend Changes

Expected files:

- `renderer/src/features/action-library/actionFolderImportApi.ts`
- `renderer/src/features/action-library/actionFolderImportTypes.ts`
- `renderer/src/features/action-library/ActionFolderImportDialog.tsx`
- `renderer/src/features/action-library/ActionLibraryPage.tsx`
- `renderer/src/i18n/namespaces/actionLibrary.ts`
- Potentially `renderer/src/styles/model-library.css` or a shared library stylesheet

Frontend responsibilities:

- Open folder picker through the existing Electron config/dialog bridge or a new narrowly named bridge if needed.
- Request Electron IPC preview.
- Render a dedicated batch import interface with row thumbnails and per-row statuses.
- Allow users to uncheck valid rows before import.
- Allow users to uncheck invalid rows so those rows no longer block import.
- Disable import until every selected row is valid.
- Provide a re-scan button for the currently selected folder.
- Submit import.
- Keep the same row list visible during import and turn successful rows green.
- Invalidate action, project, and tag queries after import.

Even though tags are ignored in the first version, invalidating tag queries is harmless and keeps the page consistent if later versions add tag import.

## Open Questions

1. Should the action name use the raw filename stem exactly, or normalize whitespace and trim unsafe trailing characters before validation?
2. If a folder contains both `pose.png` and `pose.jpg`, should both be treated as ambiguous and blocked, or should each extension import as a separate row with a duplicate-name error?
3. Should row check/uncheck state survive re-scan when the filename stem still exists?
4. Should the import result include a "reveal in library" or "filter to imported rows" shortcut after completion?
5. Should large remote imports later be optimized with configurable concurrency, chunked requests, or archive upload instead of the current sequential per-row upload?

## Recommended Defaults

- Missing `.txt` or image: blocking row error.
- Long prompt: truncate to 4000 characters and show a warning.
- Duplicate names: blocking row error.
- Recursion: off.
- Project handling: import into current selected project.
- Preview: show thumbnails for rows with images.
- Manual selection: allow unchecking any row.
- Selection default: valid rows checked, invalid rows unchecked.
- Validation: import only when every selected row is valid.
- Unchecked rows: ignore for import, keep visible in the interface.
- Result: show full row list with imported, not selected, failed, and warning statuses.
- Re-scan: available in the batch import interface.
- Encoding: include UTF-8 first and GB18030 fallback.
- Files: recognize only supported image extensions and `.txt`; ignore everything else.
- Image extensions: preserve original extension and do not convert formats.
- Supported images: `.png`, `.jpg`, `.jpeg`, `.webp`.
