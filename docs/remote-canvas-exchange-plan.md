# Remote Canvas Exchange Plan

## Background

Forart has local mode and remote server mode. The current infinite canvas is still mainly local: canvas documents and canvas image assets are stored through Electron IPC and local `CanvasAssests`.

The previous shared-canvas idea introduced remote editing, edit locks, heartbeats, revisions, and conflict handling. That is heavier than needed.

This revised plan treats the server as a remote canvas exchange shelf:

- A local canvas can be uploaded to the server.
- A remote canvas can be opened for browsing in read-only mode.
- A remote canvas can be copied back into the local workspace for editing.
- Users do not directly edit the remote copy.
- There is no shared live editing.
- There is no edit lock.
- There is no heartbeat.
- There is no remote conflict resolution.

## Goals

- Let users publish/upload a local canvas to the remote server.
- Let users browse remote uploaded canvases.
- Let users open remote uploaded canvases in read-only browse mode.
- Let users copy a remote canvas into the local canvas workspace.
- Keep the current local editing model unchanged.
- Avoid SQLite involvement for the canvas exchange feature if possible.
- Avoid live shared editing, locks, permissions, and revision conflict handling.
- Show remote-only canvas exchange actions only in remote server mode.
- Let the left sidebar switch between locally saved canvases and server canvas snapshots in remote server mode.

## Non-Goals

- No remote in-place canvas editing.
- No simultaneous collaborative editing.
- No live auto-sync viewing.
- No edit lock or heartbeat.
- No per-user permissions.
- No revision conflict detection.
- No automatic sync between local and remote copies.
- No remote canvas direct editing.

## Product Model

The remote server stores unpacked canvas snapshots, not actively edited canvases.

There are two separate copies:

- Local canvas: editable in the desktop app.
- Remote uploaded canvas: a snapshot stored on the server.

After upload, editing the local canvas does not change the remote copy. Uploading again always creates a new remote snapshot.

After copying remote to local, editing the local copy does not change the remote copy.

Remote snapshots can be opened from the server canvas list for browsing. This browse view should reuse the normal canvas viewing experience where practical, but all editing, generation, import, upload, paste, drag-drop, and mutation controls must be disabled.

## User Flows

### Upload Local Canvas To Remote

1. User is running in remote server mode.
2. User opens or selects a local canvas.
3. User clicks `Upload to remote`.
4. The app gathers:
   - Canvas JSON document.
   - Referenced local canvas assets.
   - Basic metadata such as title, node count, and updated time.
5. The app uploads the canvas and all referenced canvas resources to the server using the existing `.forartcanvas` package as a transfer container.
6. If some referenced local resources are missing, the upload continues with warnings and omits those missing resources.
7. The server unpacks the uploaded package into server-side `canvas.json` and resource files.
8. The server deletes the temporary uploaded `.forartcanvas` file after successful unpacking.
9. The remote canvas appears in the server canvas list.

### Browse Server Canvas

1. User is running in remote server mode.
2. User switches the left sidebar to `Server canvases`.
3. User opens a server canvas snapshot.
4. The app loads the server-side `canvas.json` and resource URLs.
5. The canvas opens in read-only browse mode.
6. The user can pan, zoom, select nodes, inspect prompts, open images, and copy text.
7. The user cannot edit the server canvas directly.
8. The top-left area displays `Read-only mode`.

### Copy Remote Canvas To Local

1. User is running in remote server mode.
2. User opens the server canvas list from the left sidebar.
3. User chooses a remote canvas.
4. User clicks `Copy to local`.
5. The user chooses a target local project through a picker similar to local move-canvas behavior.
6. The app downloads the remote canvas package, including both canvas JSON and resources.
7. The app imports it into local `CanvasAssests`.
8. The imported canvas always appears as a new local canvas in the selected local project.
9. The imported canvas keeps the original title. If the title conflicts with an existing local canvas title, local creation/import logic should de-duplicate or append a suffix.

### Left Sidebar

In remote server mode, the left sidebar should let the user switch between:

- `Local canvases`: existing locally saved editable canvases.
- `Server canvases`: uploaded remote canvas snapshots that can be browsed read-only or copied to local.

Remote-only actions should not appear in local mode.

### Server Canvas List

The server canvas list should show remote snapshots like normal local canvas records, without thumbnail preview in the first version.

The server canvas list should show:

- Title.
- Uploaded time.
- Node count.
- File/package size.
- Project/folder.
- Actions:
  - `Copy to local`
  - `Delete remote copy`

The server canvas list should support:

- Project/folder grouping.
- Search by title.
- Sorting by upload time and title.

## Storage Strategy

To avoid adding SQLite for canvas exchange, store unpacked remote canvas snapshots on disk under the same server library root used by model, outfit, and action libraries.

Create a server-side `CanvasAssests` folder under that root. Its internal structure should stay close to local mode's `CanvasAssests` structure so the mental model and import/export code stay aligned.

Suggested layout:

```text
<server-library-root>/
  CanvasAssests/
    canvas-index.json
    json/
      remote_canvas_abc123.json
    input/
      ...
    output/
      ...
    projects/
      project_default.json
    manifests/
      remote_canvas_abc123.json
```

`canvas-index.json` is a lightweight catalog for listing uploaded canvases and server-side canvas projects/folders. The naming intentionally mirrors local mode's canvas index file.

The exact subfolder names can be adjusted during implementation if reusing local canvas import/export helpers requires it, but the server structure should remain recognizably close to local `CanvasAssests`.

Remote `input/` and `output/` resource folders should be shared folders, like local mode. They do not need to be nested per canvas.

Server canvas projects/folders must support:

- Create.
- Rename.
- Delete, including non-empty project/folder deletion.

Server canvas project/folder naming should follow the same validation rules as local canvas projects.

Deleting a non-empty project/folder immediately deletes all contained remote snapshots and their referenced server-side resource files.

`manifest.json` stores package metadata:

```ts
interface RemoteCanvasManifest {
  id: string;
  projectId: string;
  title: string;
  uploadedAt: string;
  updatedAt: string;
  nodeCount: number;
  assetCount: number;
  packageBytes: number;
  source?: "forart";
  warnings?: Array<{ source?: string; url?: string; message: string }>;
  schemaVersion: number;
}
```

This keeps the feature file-based and separate from the existing SQLite-backed library data.

## Package Format

Use the existing canvas import/export package shape for upload transport. The current `.forartcanvas` file is a zip archive generated with `adm-zip`; it contains `manifest.json`, `canvas.json`, and packaged asset files.

The server should not keep `.forartcanvas` as the long-term storage format. After upload, the server unpacks the package into the server-side `CanvasAssests` layout:

Long-term server snapshot contents:

```text
CanvasAssests/
  json/: canvas documents
  input/: shared input resources
  output/: shared output resources
  manifests/: per-canvas metadata and resource references
```

The uploaded `.forartcanvas` package is only an intermediate transfer container. After unpacking succeeds, the temporary package can be deleted.

`canvas.json` should be rewritten on the server so packaged asset URLs become server-readable resource URLs or stable server resource references.

When copying to local, server resource URLs should be rewritten back into local `forart-asset://canvas/...` URLs after files are stored in local `CanvasAssests`.

If upload omitted missing resources, those warnings should be preserved in the remote manifest so the user can understand why some images may be absent.

## Server API

### List Server Canvas Projects

```text
GET /api/canvas-exchange/projects
```

Response:

```ts
interface ListRemoteCanvasProjectsResponse {
  projects: RemoteCanvasProject[];
}
```

### Create Server Canvas Project

```text
POST /api/canvas-exchange/projects
```

### Rename/Delete Server Canvas Project

```text
PATCH  /api/canvas-exchange/projects/:projectId
DELETE /api/canvas-exchange/projects/:projectId
```

### List Remote Canvas Snapshots

```text
GET /api/canvas-exchange/canvases?project_id=:projectId
```

Response:

```ts
interface ListRemoteCanvasesResponse {
  canvases: RemoteCanvasManifest[];
}
```

### Upload Canvas Snapshot

```text
POST /api/canvas-exchange/canvases
```

Request options:

- Multipart or binary upload of the existing `.forartcanvas` package.

The upload must include both the canvas document and all referenced canvas resources. No explicit upload size limit is planned for the first version.

The existing `.forartcanvas` package is already a zip archive. The server should unpack the uploaded package into the file-based exchange storage layout and delete the temporary uploaded package after success.

If the source package contains warnings about missing resources, the server should preserve those warnings in the remote manifest instead of rejecting the upload.

After upload completes, the client should immediately show the user any missing-resource warnings once.

Response:

```ts
interface UploadRemoteCanvasResponse {
  ok: true;
  canvas: RemoteCanvasManifest;
}
```

### Download Canvas Snapshot

```text
GET /api/canvas-exchange/canvases/:remoteCanvasId/package
```

Generates and returns a `.forartcanvas` package from the stored server-side `canvas.json` and resource files. This is used internally by `Copy to local`. Do not expose a separate direct package download action in the first version.

### Load Canvas Snapshot For Browsing

```text
GET /api/canvas-exchange/canvases/:remoteCanvasId
```

Returns a read-only canvas document with server-accessible resource URLs.

### Read Canvas Resource

```text
GET /api/canvas-exchange/canvases/:remoteCanvasId/assets/:assetPath
```

Returns a stored image resource for remote read-only browsing.

### Delete Remote Snapshot

```text
DELETE /api/canvas-exchange/canvases/:remoteCanvasId
```

Required in the first version.

Deleting a remote snapshot immediately deletes its stored `canvas.json`, `manifest.json`, and referenced resource files.

Because remote `input/` and `output/` are shared folders, deletion should use the snapshot manifest to remove only resources referenced by that snapshot. If the same physical resource is referenced by another snapshot in the future, deletion must not remove the still-referenced file.

## Renderer Changes

### Keep Local Canvas Editing As-Is

Do not change the core canvas editing behavior. The current local canvas storage and editing flow can remain based on Electron IPC.

### Add Remote Canvas Exchange UI

Add an entry point from the canvas home/sidebar:

- `Upload to remote` only in the canvas more/settings menu.
- Left sidebar switch between `Local canvases` and `Server canvases` in remote server mode.
- `Copy to local` on remote canvas records.
- `Delete remote copy` on remote canvas records.
- Server project/folder create, rename, and delete controls.
- Search and sort controls for server canvas snapshots.
- Read-only server canvas browse view.

The remote canvas view is a read-only canvas browser, not an editor.

All remote-only buttons and options should appear only when the app is running in remote server mode.

Server canvas browse mode can reuse the infinite canvas stage, but must force a read-only capability flag through the canvas UI. Mutation controls should be hidden or disabled, including node edits, canvas save, generation actions, paste/drop, imports, and delete/rename actions.

In read-only server canvas browse mode, the only remote snapshot action should be `Copy to local`. Do not expose a separate export package action in the first version.

### Add API Client

Add a small remote canvas exchange client:

```ts
interface RemoteCanvasExchangeClient {
  listRemoteCanvasProjects(): Promise<RemoteCanvasProject[]>;
  listRemoteCanvases(): Promise<RemoteCanvasManifest[]>;
  loadRemoteCanvas(remoteCanvasId: string): Promise<CanvasDocument>;
  uploadLocalCanvas(canvasId: string, projectId: string): Promise<RemoteCanvasManifest>;
  copyRemoteCanvasToLocal(remoteCanvasId: string): Promise<CanvasDocumentRecord>;
  deleteRemoteCanvas(remoteCanvasId: string): Promise<void>;
}
```

The implementation can combine:

- Existing local `window.easyTool.loadCanvas`.
- Existing local canvas package export/import logic.
- New server `/api/canvas-exchange/*` endpoints.

The upload UI should follow the existing local canvas move interaction pattern: the user chooses a target server project/folder in a similar picker instead of using a completely separate flow.

The upload action should be available only from the canvas more/settings menu, not as a primary toolbar action and not on every local canvas list item in the first version.

The server canvas sidebar does not need to remember the last selected server project/folder between app launches.

## Remote Mode Behavior

This plan should not make remote mode edit a shared remote canvas directly.

Recommended behavior:

- Local mode and remote mode can both use local editable canvases.
- Remote mode additionally exposes remote libraries and remote canvas exchange.
- Remote uploaded canvases can be browsed read-only.
- Server canvas browse reuses the current main canvas stage and shows `Read-only mode` in the top-left area.
- Remote uploaded canvases are copied to local before editing.
- Remote-only upload/copy/delete actions are hidden outside remote server mode.

This avoids the question of whether the active editable canvas is local or remote.

## Upload/Copy Semantics

### Upload

Upload always creates a new remote snapshot.

Reasons:

- No conflict handling needed.
- No remote lock needed.
- Upload is append-only and easy to reason about.
- User can delete old snapshots manually.
- This matches the decision that remote snapshots are exchange artifacts, not live editable documents.

### Copy To Local

Copying a remote snapshot to local always creates a new local canvas.

Reasons:

- Avoids accidental local data loss.
- Reuses existing import behavior.
- No merge or overwrite prompt needed.

The copied local canvas keeps the original title. If a same-title local canvas already exists, existing local canvas creation/import behavior should de-duplicate or append a suffix.

Copying to local must include both the canvas JSON and all referenced server-side resources.

The user should choose the target local project through a picker before the local copy is created.

## Resource Cost

There is no heartbeat and no always-on connection.

Resource usage only happens when users perform explicit actions:

- Listing remote canvases reads `CanvasAssests/canvas-index.json`.
- Upload receives a `.forartcanvas` package, unpacks it, writes `canvas.json` and resource files, deletes the temporary package, and updates `CanvasAssests/canvas-index.json`.
- Browsing reads `canvas.json` and serves resource files.
- Copy/download generates a `.forartcanvas` package from stored `canvas.json` and resource files.
- Delete removes the snapshot JSON, manifest, referenced resource files, and updates `CanvasAssests/canvas-index.json`.

Server memory usage can stay low if uploads/downloads stream data instead of buffering entire large packages in memory.

No explicit package size limit is planned. Because of that, upload and download handlers should avoid buffering full packages in memory where practical.

## Risks

- Large canvas packages can be heavy if many images are embedded.
- File-based `CanvasAssests/canvas-index.json` needs careful atomic writes to avoid corruption.
- Concurrent uploads/deletes need simple serialization around index updates.
- Remote snapshots can accumulate storage because there is no automatic cleanup.
- No explicit upload size limit means very large packages can occupy disk and network bandwidth unexpectedly.
- Remote browsing requires a reliable URL rewrite layer so packaged assets render from server-side resource files.

## Code Architecture

The implementation should avoid adding more logic to existing large files. In particular:

- Do not put canvas exchange business logic directly into `server/forart-server.mjs`.
- Do not put remote canvas exchange rules directly into `CanvasPage.tsx`.
- Keep `CanvasPage.tsx` as orchestration and wiring only.
- Keep server route handlers thin and push file, index, package, and resource logic into focused modules.

### Server Modules

Add a dedicated server feature folder:

```text
server/src/canvas-exchange/
  canvas-exchange-context.mjs
  canvas-exchange-types.mjs
  canvas-exchange-paths.mjs
  canvas-exchange-index.mjs
  canvas-exchange-projects.mjs
  canvas-exchange-packages.mjs
  canvas-exchange-assets.mjs
  canvas-exchange-store.mjs
  canvas-exchange-api.mjs
```

Responsibilities:

- `canvas-exchange-context.mjs`
  - Exposes `getStorageRoot()`, `getCanvasAssetsRoot()`, `getNowIso()`, and `newId(prefix)`.
  - Mirrors the existing admin context pattern and avoids hidden global dependencies.

- `canvas-exchange-types.mjs`
  - Shared constants such as package format, schema version, default project id, route-safe id prefixes, and allowed sort fields.

- `canvas-exchange-paths.mjs`
  - Resolves server `CanvasAssests` root under the same library root as model, outfit, and action libraries.
  - Resolves `json/`, `input/`, `output/`, `projects/`, `manifests/`, and temp paths.
  - Enforces path traversal protection.

- `canvas-exchange-index.mjs`
  - Reads and writes `CanvasAssests/canvas-index.json`.
  - Uses atomic writes through temp file + rename.
  - Owns search and sort helpers.
  - Keeps index records normalized.

- `canvas-exchange-projects.mjs`
  - Creates, renames, and deletes server canvas projects/folders.
  - Applies the same naming rules as local canvas projects.
  - Deletes non-empty projects by deleting contained snapshots and referenced resources.

- `canvas-exchange-packages.mjs`
  - Reads uploaded `.forartcanvas` zip packages.
  - Validates `manifest.json` and `canvas.json`.
  - Unpacks package assets into shared `input/` and `output/` folders.
  - Rewrites package asset URLs into server resource URLs.
  - Generates a `.forartcanvas` package for `Copy to local`.

- `canvas-exchange-assets.mjs`
  - Serves stored resource files.
  - Maps server resource URLs back to file paths safely.
  - Deletes resources referenced by a snapshot manifest without crossing out of `CanvasAssests`.

- `canvas-exchange-store.mjs`
  - Main file-backed domain API used by HTTP handlers.
  - Methods such as `listProjects`, `createProject`, `renameProject`, `deleteProject`, `listCanvases`, `uploadCanvasPackage`, `loadCanvas`, `createPackageForCanvas`, and `deleteCanvas`.

- `canvas-exchange-api.mjs`
  - HTTP handler for `/api/canvas-exchange/*`.
  - Parses requests, calls `canvas-exchange-store`, and sends responses.
  - Does not contain direct filesystem business logic beyond request upload/download handling.

Add a thin HTTP router:

```text
server/src/http/canvas-exchange-router.mjs
```

Wire it in `server/forart-server.mjs` alongside existing routes:

```js
if (handleAdminRoute(req, res, url)) return;
if (handleCanvasExchangeRoute(req, res, url)) return;
if (handleModelLibraryApi(req, res, url)) return;
```

This keeps `forart-server.mjs` from becoming an even larger monolith.

### Renderer Modules

Add a renderer feature folder:

```text
renderer/src/features/infinite-canvas/remote-canvas/
  remoteCanvasTypes.ts
  remoteCanvasApi.ts
  remoteCanvasStore.ts
  remoteCanvasPackageActions.ts
  remoteCanvasReadOnly.ts
  useRemoteCanvasExchange.ts
  ServerCanvasPanel.tsx
  ServerCanvasProjectPicker.tsx
  ServerCanvasActions.tsx
```

Responsibilities:

- `remoteCanvasTypes.ts`
  - Types for remote projects, remote canvas manifests, warnings, list options, and copy/upload results.

- `remoteCanvasApi.ts`
  - Calls `/api/canvas-exchange/*` with the existing `apiRequest` style.
  - Does not touch local Electron IPC.

- `remoteCanvasStore.ts`
  - UI state for selected server project, search text, sort mode, loading/error state, and selected server canvas.
  - Does not store local canvas state.

- `remoteCanvasPackageActions.ts`
  - Bridges local IPC package export/import and remote API upload/download.
  - Owns `uploadLocalCanvasToRemote` and `copyRemoteCanvasToLocal`.

- `remoteCanvasReadOnly.ts`
  - Defines read-only capability flags.
  - Helpers such as `remoteCanvasCapabilities` and `assertCanvasEditable`.

- `useRemoteCanvasExchange.ts`
  - Composes API calls, local project picker, upload warnings, and list refresh.
  - Exposes a small interface to `CanvasPage` and `CanvasHomePanel`.

- `ServerCanvasPanel.tsx`
  - Server canvas list UI, grouped by project/folder.
  - Search and sort UI.
  - Copy/delete/open actions.

- `ServerCanvasProjectPicker.tsx`
  - Reusable picker for upload target and copy-to-local target.

- `ServerCanvasActions.tsx`
  - Small action menu components, keeping the list panel focused on rendering.

### Canvas Page Integration

`CanvasPage.tsx` should only receive and wire:

- Current canvas source: `local` or `server`.
- Read-only flag.
- `onUploadToRemote`.
- `onCopyRemoteToLocal`.
- `onOpenServerCanvas`.
- `onDeleteRemoteCanvas`.

Avoid embedding remote exchange logic directly in `CanvasPage.tsx`.

Recommended integration shape:

```ts
type ActiveCanvasSource =
  | { type: "local"; canvasId: string }
  | { type: "server"; remoteCanvasId: string; readonly: true };
```

When `ActiveCanvasSource.type === "server"`:

- Load canvas through `remoteCanvasApi.loadRemoteCanvas`.
- Render it in the same main stage.
- Display `Read-only mode` in the top-left area.
- Disable all mutation actions through capability flags.
- Hide save, generate, import, paste, drop, and edit controls.
- Expose only `Copy to local` as the remote snapshot action.

### Read-Only Capability Boundary

Do not rely only on hiding buttons. Add a capability flag that action handlers must check before mutating canvas state.

Recommended shape:

```ts
interface CanvasCapabilities {
  canEdit: boolean;
  canSave: boolean;
  canGenerate: boolean;
  canImport: boolean;
  canPasteOrDrop: boolean;
  canDelete: boolean;
}
```

Local canvases use full capabilities. Server canvases use read-only capabilities.

Mutation hooks and handlers should check capabilities before doing work:

- `useCanvasProjects`
- `useCanvasMediaActions`
- `useCanvasGenerationActions`
- node, group, connection, and keyboard shortcut handlers in `CanvasPage`

This prevents accidental edits through keyboard shortcuts, paste/drop, or less-visible code paths.

### IPC Boundary

The existing `canvas-package-store.cjs` exports packages through a save dialog. Remote upload needs a non-dialog package creation path.

Add focused IPC methods instead of overloading the UI export command:

```text
canvas:create-package-for-upload
canvas:import-package-from-path
```

Recommended Electron module additions:

- Add reusable package creation/import helpers inside `electron/main/modules/canvas-package-store.cjs`.
- Keep dialog-based `exportPackage` and `importCanvas` as UI commands.
- Add non-dialog methods for remote exchange workflows.

This avoids automating save/open dialogs for remote upload/copy.

### File Size And Streaming

No upload size limit is planned, so avoid buffering more than necessary:

- Client creates a temporary `.forartcanvas` package and uploads it.
- Server writes upload to a temp file, then unzips from disk.
- Server generates copy packages as temp files and cleans them up after response completion.

### Testing Boundaries

Add targeted verification around module boundaries:

- Server path traversal rejection for asset reads and package paths.
- Atomic `CanvasAssests/canvas-index.json` update behavior.
- Upload package with complete resources.
- Upload package with missing resources and warning preservation.
- Delete snapshot removes JSON, manifest, and referenced resources.
- Delete non-empty project removes contained snapshots.
- Open server canvas renders read-only.
- Read-only mode blocks keyboard shortcuts, paste/drop, generation, and node mutation.
- Copy remote to local imports JSON and resources into the selected local project.

## Implementation Phases

### Phase 1: Server File-Based Exchange Store

- Add server-side `CanvasAssests` root under the same server library root as the model, outfit, and action libraries.
- Add server canvas project/folder catalog.
- Add manifest normalization.
- Add atomic `CanvasAssests/canvas-index.json` read/write helpers.
- Add project, list, upload, download, and delete APIs.
- Add search and sort support for server canvas listing.
- Add read-only canvas load and asset file APIs.

### Phase 2: Package Reuse

- Reuse existing `.forartcanvas` zip-based package format.
- Add helper to upload an exported package to the server.
- Server unpacks uploaded package into `canvas.json` and resources.
- Server can regenerate a `.forartcanvas` package for copy/download.
- Add helper to import a downloaded package into local canvas storage.

### Phase 3: UI

- Add `Upload to remote` action in the canvas more/settings menu.
- Add left sidebar switch between local canvases and server canvases in remote server mode.
- Add server canvas list grouped by project/folder.
- Add server canvas project/folder create, rename, and delete controls.
- Add server canvas search and sort controls.
- Add read-only server canvas browse mode.
- Add `Copy to local` action.
- Add `Delete remote copy` action.
- Add basic status and error handling.
- Reuse the current main canvas stage for server canvas browsing and display `Read-only mode` in the top-left area.

### Phase 4: Storage Hygiene

- Show package size and upload time.
- Add delete remote snapshot.
- Optionally add admin cleanup for orphaned or old snapshots.

## Decisions

- No remote canvas direct editing.
- No shared edit lock.
- No heartbeat.
- No SQLite required for canvas exchange.
- Remote canvas exchange uses server-side files and a `CanvasAssests/canvas-index.json` catalog.
- Remote canvas files live under server library root `CanvasAssests`, alongside model/outfit/action library storage.
- Server-side `CanvasAssests` should remain close to the local `CanvasAssests` structure.
- Remote `input/` and `output/` resource folders are shared folders like local mode, not nested per canvas.
- Uploading local to remote always creates a new remote snapshot.
- Uploading includes both canvas document and referenced canvas resources.
- The uploaded `.forartcanvas` package is only a transfer container.
- The server unpacks uploaded packages and stores `canvas.json` plus resource files.
- Server canvas snapshots can be opened for read-only browsing.
- Server canvas browsing reuses the current main canvas stage and displays `Read-only mode` in the top-left area.
- Copying remote to local always creates a new local editable canvas.
- Copying remote to local includes canvas JSON and resources.
- Local and remote copies do not automatically sync.
- Remote snapshots support delete in the first version.
- Deleting a remote snapshot immediately deletes its stored JSON and referenced resource files.
- No explicit upload size limit.
- Server canvas snapshots are grouped by project/folder.
- Server canvas projects/folders support create, rename, and delete.
- Server canvas project/folder names follow local canvas project naming rules.
- Deleting a non-empty server project/folder deletes all contained snapshots and their referenced resource files.
- Upload uses the existing `.forartcanvas` zip-based package format.
- Upload target selection should feel like the existing local move-canvas flow.
- Server canvas list supports title search and sorting by upload time and title.
- Remote snapshots do not need thumbnail display in the first version.
- Remote-only buttons and options appear only in remote server mode.
- In remote server mode, the left sidebar can switch between locally saved canvases and server canvas snapshots.
- Copying remote to local preserves the original title, with local de-duplication/suffix behavior if needed.
- `Upload to remote` appears only in the canvas more/settings menu.
- Read-only server canvas browse mode exposes `Copy to local` but not a separate export package action.
- Delete actions use the same second-confirmation pattern as ordinary canvas deletion.
- Uploading to remote does not need to preserve the original local project name.
- The server canvas sidebar does not remember the last selected project/folder between launches.
- `Copy to local` asks the user to choose a target local project.
- Upload with missing local resources continues with warnings and omits missing resources.
- Missing-resource warnings are shown once immediately after upload and stored in the remote manifest.

## Remaining Questions

No remaining product decisions are currently open. The next step is implementation planning.
