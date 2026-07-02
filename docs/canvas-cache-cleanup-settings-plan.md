# Canvas cache cleanup settings plan

## Background

Forart currently stores infinite canvas image assets under `CanvasAssests`:

- `CanvasAssests/input`: imported, pasted, dragged, or library-saved input images.
- `CanvasAssests/output`: generated or derived output images.
- `CanvasAssests/json`: persisted canvas documents.
- `CanvasAssests/tasks`: local generation task persistence, if present.

Canvas nodes reference local assets with `forart-asset://canvas/...` URLs and sometimes also keep `filePath`, generation task result URLs, or LibTV latest-run URLs. Deleting an asset that is still referenced by a canvas can leave visible broken images, so cleanup should be audit-first and conservative by default.

## Goal

Add a new Settings navigation item named `清理缓存` that lets users inspect input and output images used by the infinite canvas, understand which files are still referenced, and safely remove unnecessary local cache files.

## Confirmed product decisions

- First version only allows deleting unreferenced images.
- Images that are still referenced by canvas data are fully protected and cannot be deleted from this page.
- Add a `清理 14 天前未引用缓存` action.
- Show canvas references whose local image files are missing.
- Add an `打开缓存目录` action.
- Do not add a destructive "delete referenced image and rewrite canvas" flow in the first version.
- Scan all persisted canvases, not only the currently active project.
- Do not give extra protection to `outputDownloadState: "pending"` outputs; cleanup is based on actual references.
- Only process local files in `CanvasAssests/input` and `CanvasAssests/output`.

## Non-goals for the first version

- Do not delete canvas nodes.
- Do not rewrite canvas documents.
- Do not clean model library, outfit library, action library, image review, browser cache, or API response cache.
- Do not deduplicate identical image content.
- Do not clean remote-only image URLs because there is no local file to remove.

## Recommended first version

The first version should support:

1. Add a third Settings tab: `清理缓存`.
2. Scan `CanvasAssests/input` and `CanvasAssests/output`.
3. Read all persisted canvas JSON documents and collect local asset references.
4. Show image thumbnails, metadata, and reference status.
5. Filter by asset kind, reference status, canvas, and search text.
6. Delete selected unreferenced assets.
7. One-click cleanup for all unreferenced assets.
8. One-click cleanup for unreferenced assets older than 14 days.
9. Show missing local files that are still referenced by canvas documents.
10. Open the cache root directory from the page.
11. Refresh scan results after deletion.

The default destructive action should only delete unreferenced local files. Referenced files should be viewable but never deletable in version one.

## UX design

### Navigation

Settings currently has `general` and `api` tabs. Add:

- `general`: 常规
- `api`: 接口
- `cache`: 清理缓存

Use an icon such as `HardDrive` or `Database` from `lucide-react` for the tab. Reserve `Trash2` for destructive action buttons.

### Page layout

Use the existing settings visual language:

- Header summary band.
- Compact tool row.
- Scrollable asset list/grid.
- Sticky bottom action bar only when items are selected.

Avoid large marketing-style cards. This is an operational settings view.

### Summary metrics

Show four compact metrics:

- 输入图片: count and size.
- 输出图片: count and size.
- 使用中: count and size.
- 可清理: count and size.

`可清理` means local files found in `input` or `output` that are not referenced by any persisted canvas document or protected task record.

### Filters

Recommended filters:

- Type segmented control: `全部`, `输入`, `输出`.
- Status segmented control: `全部`, `使用中`, `可清理`, `文件缺失`.
- Search input: file name, canvas title, node title.
- Canvas select: all canvases or one canvas.

Optional later filters:

- Created before / after.
- File size range.
- Only downloaded outputs.

### Asset list item

Each row/card should show:

- Thumbnail.
- File name.
- Kind: `输入` or `输出`.
- File size.
- Modified time.
- Reference status:
  - `使用中`: referenced by at least one canvas or protected task record.
  - `可清理`: local file exists and no reference was found.
  - `文件缺失`: referenced by a canvas but the local file does not exist.
- Reference count.
- Canvas titles and node titles, truncated.
- Per-item actions:
  - Preview.
  - Show in folder.
  - Delete, enabled only for unreferenced files.

Referenced files should show disabled delete controls with a tooltip or inline reason: `该图片仍被画布引用，不能删除`.

### Delete flow

For unreferenced cleanup:

1. User clicks `清理可清理项` or deletes selected unreferenced assets.
2. Confirm dialog says:
   - Number of files.
   - Total size.
   - Asset kinds included.
   - `这些文件未被任何画布引用，删除后不会影响当前画布内容。`
3. Main process re-validates that each file is still unreferenced.
4. Main process deletes files.
5. UI refreshes scan.
6. Show result status: deleted count, skipped count, freed size.

For 14-day cleanup:

1. User clicks `清理 14 天前未引用缓存`.
2. UI filters cleanable local files to `modifiedAt < now - 14 days`.
3. Confirm dialog says:
   - Number of files.
   - Total size.
   - Oldest and newest modified time in the deletion set.
   - `仅删除超过 14 天且未被任何画布引用的缓存图片。`
4. Main process re-validates both conditions before deletion:
   - File is still unreferenced.
   - File modified time is still older than 14 days.
5. UI refreshes scan and shows result status.

For referenced files:

- First version: disable delete action and show tooltip `该图片仍被画布引用，不能删除`.
- Later version can add an advanced destructive action, but this is intentionally out of scope now.

## Data model

Renderer-facing asset record:

```ts
interface CanvasCacheAsset {
  id: string;
  kind: "input" | "output" | "missing";
  url: string;
  filePath: string;
  fileName: string;
  sizeBytes: number;
  modifiedAt: number;
  exists: boolean;
  referenced: boolean;
  references: CanvasCacheReference[];
}

interface CanvasCacheReference {
  canvasId: string;
  canvasTitle: string;
  nodeId?: string;
  nodeTitle?: string;
  source:
    | "node.url"
    | "node.filePath"
    | "node.generationTask.result.localUrl"
    | "node.libtvImageGeneration.latestRun.localUrl"
    | "actionFission.row.resultUrl"
    | "actionFission.row.generationTask.result.localUrl"
    | "task.result.localUrl"
    | "task.referenceImages";
}

interface CanvasCacheScanResult {
  rootPath: string;
  scannedAt: number;
  assets: CanvasCacheAsset[];
  missingReferences: CanvasCacheAsset[];
  totals: {
    inputCount: number;
    inputBytes: number;
    outputCount: number;
    outputBytes: number;
    referencedCount: number;
    referencedBytes: number;
    cleanableCount: number;
    cleanableBytes: number;
    missingReferenceCount: number;
  };
}
```

`modifiedAt` should use the filesystem modified time. It is the basis for the `清理 14 天前未引用缓存` action.

## Main process API

Add IPC handlers:

```ts
ipcMain.handle("canvas-cache:scan", async () => canvasCacheStore.scan());
ipcMain.handle("canvas-cache:delete", async (_event, payload) => canvasCacheStore.deleteAssets(payload));
ipcMain.handle("canvas-cache:reveal", async (_event, payload) => canvasCacheStore.revealAsset(payload));
ipcMain.handle("canvas-cache:open-root", async () => canvasCacheStore.openRoot());
```

Expose through preload:

```ts
scanCanvasCache: () => ipcRenderer.invoke("canvas-cache:scan"),
deleteCanvasCacheAssets: (payload) => ipcRenderer.invoke("canvas-cache:delete", payload),
revealCanvasCacheAsset: (payload) => ipcRenderer.invoke("canvas-cache:reveal", payload),
openCanvasCacheRoot: () => ipcRenderer.invoke("canvas-cache:open-root"),
```

Renderer type additions belong in `renderer/src/app/appConfig.ts`.

## Main process scanning algorithm

1. Resolve `CanvasAssests` through the existing asset store root.
2. Enumerate files from `input` and `output`.
3. Convert each path to a canonical `forart-asset://canvas/...` URL using `assetStore.assetUrl(filePath)`.
4. Read all canvas documents from `canvasStore`, across every canvas project.
5. Traverse each node and collect local asset references.
6. Read generation task registry if it exists and collect result and reference image URLs.
7. Map references by normalized local file path or normalized asset URL.
8. Mark files as referenced if any reference points to them.
9. Include missing local references separately.

Reference collection should handle at least:

- `node.url`
- `node.filePath`
- `node.generationTask.result.localUrl`
- `node.generationTask.referenceImages[]`
- `node.libtvImageGeneration.latestRun.localUrl`
- `node.libtvImageGeneration.latestRun.resultUrl` if it resolves to local asset URL
- `node.actionFission.rows[].resultUrl`
- `node.actionFission.rows[].generationTask.result.localUrl`
- `node.actionFission.rows[].generationTask.referenceImages[]`

Use structured traversal for known fields. A generic recursive scan for strings beginning with `forart-asset://canvas/` can be added as a safety net, but known fields should remain the primary source so references can show meaningful labels.

## Generation task registry clarification

The app already has code paths for local generation tasks and a documented registry at `CanvasAssests/tasks/generation-task-registry.json`. This is not a visible user-facing management page. It is task persistence used by generation runtime/recovery.

For cleanup, task references should be treated as protected in the first version if the registry file exists. If the file does not exist, scanning simply skips it.

This means:

- A file referenced by saved canvas JSON is protected.
- A file referenced only by task registry is also protected for version one.
- `outputDownloadState: "pending"` does not add protection by itself. If no saved canvas or task reference points to the file, it is cleanable.
- If we later decide task registry records are disposable after completion, that can become a separate cleanup rule.

## Deletion rules

Deletion should be guarded in the main process:

- Only delete files inside `CanvasAssests/input` or `CanvasAssests/output`.
- Refuse paths outside the asset root.
- Refuse referenced files.
- Do not expose or implement forced deletion from the version-one UI.
- For the 14-day cleanup action, refuse files whose current filesystem modified time is newer than the requested cutoff.
- Ignore already-missing files and report them as skipped.
- Return deleted count, skipped count, failed count, and freed bytes.

This validation must happen in Electron main process, not only in the renderer.

## Scope decisions

- Scan all persisted canvases.
- Treat references as the only protection signal, aside from optional task-registry references.
- Exclude library URLs and any images outside `CanvasAssests/input` and `CanvasAssests/output`.
- Remote-only URLs are shown only if they appear as context in references; they are not cache cleanup targets.

## Implementation slices

### Slice 1: scan API

- Add a `canvas-cache-store.cjs` main module.
- Add IPC handlers and preload methods.
- Return scan result for input/output files and canvas references.
- Add renderer TypeScript declarations.

### Slice 2: settings UI

- Add `cache` to `SettingsTab`.
- Add nav button and i18n strings.
- Build `CanvasCacheSettingsPane`.
- Load scan on tab open and show summary metrics.

### Slice 3: filtering and preview

- Add type/status filters, search, and canvas select.
- Add thumbnail grid/list.
- Add preview modal using existing image viewer conventions if practical.

### Slice 4: safe cleanup

- Add selection state.
- Add delete selected unreferenced assets.
- Add clean all unreferenced assets.
- Add clean unreferenced assets older than 14 days.
- Add open cache directory action.
- Refresh scan and show status.

### Slice 5: polish and tests

- Unit-test scan reference extraction if test setup exists.
- Manually verify:
  - Referenced input is protected.
  - Referenced output is protected.
  - Orphan input is deleted.
  - Orphan output is deleted.
  - 14-day cleanup only deletes old unreferenced files.
  - Missing referenced file is reported without crashing.
  - UI remains usable with hundreds of files.

## Recommended decision

Ship the first version as a conservative cleanup tool:

- Inspect everything.
- Delete only unreferenced local `input` and `output` files.
- Offer a second cleanup path for unreferenced files older than 14 days.
- Show referenced and missing assets for transparency.
- Allow opening the cache root directory.
- Defer destructive canvas-rewrite cleanup until there is explicit product confirmation.
