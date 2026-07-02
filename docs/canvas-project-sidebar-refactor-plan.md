# Infinite Canvas Project Sidebar Refactor Plan

## Background

The infinite canvas currently uses a folder-like organization model. The UI exposes folder cards inside the canvas home panel, and the codebase uses names such as `CanvasFolderRecord`, `folderId`, `canvasFolders`, `createCanvasFolder`, and `deleteCanvasFolder`.

The target product model is different:

- A project is the top-level workspace container.
- A canvas is an individual infinite canvas document inside a project.
- Projects should be shown in a dedicated sidebar instead of mixed into the canvas card grid.
- The codebase should stop using folder terminology for this area.

The project is still in development, so no old-data migration or compatibility layer is required. Existing local canvas index data can be discarded or regenerated.

## Goals

1. Replace the folder concept with a project concept across Electron storage, IPC, preload, renderer types, state, UI, CSS, and i18n.
2. Separate project navigation into a sidebar.
3. Keep canvas documents as the editable infinite canvas surface.
4. Make future maintenance easier by using consistent domain names.
5. Remove old folder APIs instead of keeping aliases.

## Non-Goals

- No migration for existing `CanvasAssests/canvas-index.json`.
- No compatibility with `canvas:create-folder`, `canvas:update-folder`, or other folder IPC channels.
- No nested projects in this refactor.
- No remote/server synchronization changes unless the local Electron API later becomes backed by the server.
- No changes to node data, generation task data, or canvas drawing behavior except where project ownership is referenced.

## Domain Model

Use these names consistently:

| Product concept | Current name | New name |
| --- | --- | --- |
| Top-level container | folder | project |
| Individual infinite canvas file | canvas project | canvas / canvas document |
| Container id on a canvas | `folderId` | `projectId` |
| Container record | `CanvasFolderRecord` | `CanvasProjectRecord` |
| Canvas record | `CanvasProjectRecord` | `CanvasDocumentRecord` |
| Full canvas payload | `CanvasProject` | `CanvasDocument` |

Recommended TypeScript names:

```ts
export interface CanvasProjectRecord {
  id: string;
  title: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasDocument extends CanvasSnapshot {
  id: string;
  title: string;
  icon?: string;
  canvasType?: "forart";
  source?: "forart";
  projectId?: string;
  color?: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasDocumentRecord {
  id: string;
  title: string;
  icon?: string;
  canvasType?: "forart";
  source?: "forart";
  projectId?: string;
  color?: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
}
```

Use `CanvasDocument` if the code needs to distinguish the saved canvas file from the visual canvas surface. If that feels too verbose in local code, `CanvasRecord` and `CanvasFile` are acceptable, but avoid using `CanvasProject` for the individual canvas after this refactor.

## Storage Shape

Current index shape:

```json
{
  "version": 2,
  "records": [],
  "folders": []
}
```

New index shape:

```json
{
  "version": 3,
  "updatedAt": 0,
  "canvases": [],
  "projects": []
}
```

Canvas JSON should use `projectId` instead of `folderId`.

Because no migration is required, `canvas-store.cjs` can treat missing or older index shapes as empty:

```js
if (payload?.version !== 3) {
  return { canvases: [], projects: [] };
}
```

This keeps the code simple and avoids carrying old folder semantics forward.

## Electron Storage Changes

Target file:

- `electron/main/modules/canvas-store.cjs`

Rename storage helpers:

| Current | New |
| --- | --- |
| `newFolderId` | `newProjectId` |
| `normalizeFolderId` | `normalizeProjectId` |
| `normalizeFolderRecord` | `normalizeProjectRecord` |
| `sortFolderRecords` | `sortProjectRecords` |
| `listFolders` | `listProjects` for containers, or `listCanvasProjects` if needed to avoid collision |
| `createFolder` | `createProject` for containers |
| `updateFolder` | `updateProject` |
| `deleteFolder` | `deleteProject` for containers |
| `moveProject` | `moveCanvasToProject` |

Important naming conflict:

`canvas-store.cjs` already uses `createProject`, `saveProject`, and `readProject` for individual canvases. These should be renamed first:

| Current canvas-file function | New |
| --- | --- |
| `createProject` | `createCanvas` or `createCanvasDocument` |
| `saveProject` | `saveCanvas` or `saveCanvasDocument` |
| `readProject` | `readCanvas` or `readCanvasDocument` |
| `deleteProject` | `deleteCanvas` or `deleteCanvasDocument` |
| `listProjects` | `listCanvases` |
| `projectPath` | `canvasPath` |

Suggested store public API:

```js
return {
  createCanvas,
  createProject,
  deleteCanvas,
  deleteProject,
  listCanvases,
  listProjects,
  moveCanvasToProject,
  readCanvas,
  saveCanvas,
  updateCanvasMeta,
  updateProject,
  writeCanvas,
};
```

Deletion behavior needs one product decision. For this refactor, use the current behavior equivalent:

- Deleting a project deletes all canvases assigned to that project.

If later the product wants a safer flow, change project deletion to move canvases to an unassigned state.

## IPC and Preload Changes

Target files:

- `electron/main/ipc/canvas-ipc.cjs`
- `electron/preload/preload.cjs`
- `renderer/src/app/appConfig.ts`

Replace folder IPC channels:

| Remove | Add |
| --- | --- |
| `canvas:create-folder` | `canvas:create-project` |
| `canvas:update-folder` | `canvas:update-project` |
| `canvas:delete-folder` | `canvas:delete-project` |
| `canvas:move-project` | `canvas:move-to-project` |

Rename existing canvas document channels if practical:

| Current | Preferred |
| --- | --- |
| `canvas:load-project` | `canvas:load` |
| `canvas:save-project` | `canvas:save` |
| `canvas:delete-project` | `canvas:delete` |

If renaming all IPC channels creates too much churn in one slice, prioritize removing folder channels first and keep existing canvas document channels temporarily. Do not keep folder aliases.

Preload API should expose project-oriented names:

```js
listCanvases: () => ipcRenderer.invoke('canvas:list'),
createCanvas: (payload) => ipcRenderer.invoke('canvas:create', payload),
createCanvasProject: (payload) => ipcRenderer.invoke('canvas:create-project', payload),
updateCanvasProject: (projectId, patch) => ipcRenderer.invoke('canvas:update-project', projectId, patch),
deleteCanvasProject: (projectId) => ipcRenderer.invoke('canvas:delete-project', projectId),
moveCanvasToProject: (canvasId, projectId) => ipcRenderer.invoke('canvas:move-to-project', canvasId, projectId),
```

`canvas:list` should return:

```ts
{
  canvases: CanvasDocumentRecord[];
  projects: CanvasProjectRecord[];
}
```

## Renderer Type Changes

Target file:

- `renderer/src/features/infinite-canvas/types.ts`

Rename:

| Current | New |
| --- | --- |
| `CanvasProject` | `CanvasDocument` |
| `CanvasProjectRecord` | `CanvasDocumentRecord` |
| `CanvasFolderRecord` | `CanvasProjectRecord` |
| `folderId` | `projectId` |
| `parentFolderId` | remove |

Then update imports across:

- `renderer/src/features/infinite-canvas/CanvasHomePanel.tsx`
- `renderer/src/features/infinite-canvas/CanvasPage.tsx`
- `renderer/src/features/infinite-canvas/useCanvasProjects.ts`
- `renderer/src/features/infinite-canvas/generation/generationTaskWriteback.ts`
- `renderer/src/app/appConfig.ts`

## Renderer State Changes

Target file:

- `renderer/src/features/infinite-canvas/useCanvasProjects.ts`

This hook currently mixes canvas document management and folder navigation. Rename or split it.

Preferred split:

- `useCanvasWorkspace.ts`: open tabs, active canvas, save/load, refresh.
- `useCanvasProjectSidebar.ts`: project list, active project, create/rename/delete project.
- `useCanvasDocuments.ts`: canvas list, create/rename/delete/duplicate/move canvas.

If splitting is too large for the first pass, rename the existing state clearly inside the current hook:

| Current | New |
| --- | --- |
| `canvasProjects` for canvases | `canvasDocuments` |
| `canvasFolders` | `canvasProjects` |
| `visibleCanvasFolders` | remove |
| `currentFolderId` | `activeProjectId` |
| `folderBreadcrumbs` | remove |
| `createCanvasFolder` | `createCanvasProject` |
| `openCanvasFolder` | `selectCanvasProject` |
| `submitRenameCanvasFolder` | `submitRenameCanvasProject` |
| `deleteCanvasFolder` | `deleteCanvasProject` |
| `moveCanvasProjectToFolder` | `moveCanvasToProject` |

Filtering becomes:

```ts
const visibleCanvasDocuments = canvasDocuments.filter((canvas) => {
  if (!activeProjectId) return !canvas.projectId;
  return canvas.projectId === activeProjectId;
});
```

If the product wants "All" instead of "Unassigned" as the default sidebar item, use a separate `activeProjectId` state:

```ts
type ActiveProjectFilter = "all" | "unassigned" | string;
```

## UI Refactor

Current file:

- `renderer/src/features/infinite-canvas/CanvasHomePanel.tsx`

Recommended new components:

```text
renderer/src/features/infinite-canvas/
  CanvasWorkspaceHome.tsx
  CanvasProjectSidebar.tsx
  CanvasDocumentGrid.tsx
```

Responsibilities:

- `CanvasWorkspaceHome`: layout shell for sidebar + canvas list.
- `CanvasProjectSidebar`: project navigation, create project, rename project, delete project.
- `CanvasDocumentGrid`: canvas document cards, create canvas, rename canvas, duplicate, delete, move to project.

Layout:

```text
+----------------------------------------------------------+
| Canvas tabs / current canvas toolbar                      |
+----------------------+-----------------------------------+
| Project sidebar      | Canvas documents for selection     |
| - All / Unassigned   | - Sort controls                    |
| - Project A          | - New canvas button                |
| - Project B          | - Canvas cards                     |
| + New project        |                                   |
+----------------------+-----------------------------------+
```

UI behavior:

- Selecting a project filters the canvas document list.
- Double-clicking a canvas opens it.
- Creating a canvas places it under the selected project unless the selected filter is "All".
- Creating a project adds it to the sidebar and starts inline rename.
- Deleting a project asks for confirmation and deletes canvases inside it.
- Moving a canvas uses a project picker menu.
- Breadcrumbs are removed because project navigation is now a sidebar.

## CSS Changes

Target file:

- `renderer/src/styles/infinite-canvas.css`

Rename folder-specific classes:

| Current | New |
| --- | --- |
| `ic-folder-card` | remove or replace with `ic-project-sidebar__item` |
| `ic-folder-card__shape` | remove |
| `ic-folder-breadcrumbs` | remove |

Clarify existing project/card classes:

| Current | New |
| --- | --- |
| `ic-project-home` | `ic-canvas-home` or `ic-workspace-home` |
| `ic-project-card` | `ic-canvas-card` |
| `ic-project-card-grid` | `ic-canvas-grid` |
| `ic-project-card-menu` | `ic-canvas-card-menu` |
| `ic-project-move-menu` | `ic-canvas-move-menu` |

Add sidebar classes:

```css
.ic-project-sidebar {}
.ic-project-sidebar__header {}
.ic-project-sidebar__list {}
.ic-project-sidebar__item {}
.ic-project-sidebar__item.active {}
.ic-project-sidebar__actions {}
```

Keep the visual design restrained and utilitarian. The infinite canvas home is an operational workspace, not a landing page.

## i18n Changes

Target file:

- `renderer/src/i18n.ts`

Rename keys:

| Current | New |
| --- | --- |
| `folderBaseName` | `projectBaseName` |
| `newFolder` | `newProject` |
| `untitledFolder` | `untitledProject` |
| `folderActions` | `projectActions` |
| `deleteThisFolder` | `deleteThisProject` |
| `moveToFolder` | `moveToProject` |
| `folderPath` | remove |
| `rootFolder` | `unassignedCanvases` or `allCanvases` |

Chinese product copy should use:

- 项目
- 新建项目
- 未归属画布 or 全部画布, depending on the selected default behavior
- 移动到项目

English copy should use:

- Project
- New project
- Unassigned canvases or All canvases
- Move to project

## Implementation Order

1. Rename canvas document types.
   - `CanvasProject` -> `CanvasDocument`
   - `CanvasProjectRecord` -> `CanvasDocumentRecord`
   - `CanvasFolderRecord` -> `CanvasProjectRecord`

2. Rewrite Electron storage shape.
   - Use index `version: 3`.
   - Use `canvases` and `projects`.
   - Treat older index files as empty.
   - Replace `folderId` with `projectId`.

3. Replace IPC/preload APIs.
   - Remove folder channels.
   - Add project channels.
   - Update `appConfig.ts`.

4. Update renderer state.
   - Rename folder state to project state.
   - Remove breadcrumbs.
   - Filter canvases by `projectId`.

5. Split home UI.
   - Extract project sidebar.
   - Extract canvas grid.
   - Remove folder cards.

6. Update styling.
   - Remove folder card visuals.
   - Add sidebar layout.
   - Rename misleading `project-card` classes that actually refer to canvas cards.

7. Update i18n.
   - Replace folder copy with project copy.
   - Remove obsolete breadcrumb/root folder copy.

8. Verify and clean up.
   - Run `npm run build`.
   - Search for forbidden names.
   - Manually test create/open/rename/delete/duplicate/move flows.

## Search Cleanup Checklist

After implementation, these searches should return no product-organization usage:

```powershell
rg -n "folder|Folder|folders|Folders|parentFolderId|folderId|CanvasFolder|createCanvasFolder|deleteCanvasFolder|updateCanvasFolder|moveCanvasProjectToFolder" renderer electron
```

Some unrelated matches may remain if they refer to actual filesystem folders. Those should be reviewed case by case.

Expected allowed terms:

- Filesystem folder references outside canvas project organization.
- Documentation that explicitly describes the old system.

## Verification Checklist

Build:

```powershell
npm run build
```

Manual verification:

1. Launch the app.
2. Existing old local canvas index is ignored or reset without crashing.
3. Project sidebar appears on the canvas home screen.
4. New project can be created and renamed.
5. New canvas can be created inside the selected project.
6. Canvas list filters correctly when selecting projects.
7. Canvas can be opened from the list.
8. Canvas can be renamed, duplicated, deleted, and moved to another project.
9. Deleting a project deletes canvases in that project and closes affected tabs.
10. Active generation task cleanup still runs when deleting canvases or projects.
11. `rg` cleanup does not show stale folder API/type/state names.

## Risks

- The biggest risk is partial renaming where container projects and canvas documents both keep `project` in their names. Fix this early by renaming the individual canvas payload away from `CanvasProject`.
- Generation task writeback uses canvas ids and save APIs. Make sure function renames do not break task result persistence.
- Deleting a project currently maps to destructive folder behavior. The confirmation copy must make it clear that canvases inside the project will also be deleted.
- CSS class renames can create visual regressions. Do a quick visual pass on desktop and a narrow viewport after the split.

## Recommended First Slice

The first implementation slice should be purely structural:

1. Rename types and storage fields.
2. Replace Electron/preload APIs.
3. Update renderer state to use `projectId`.
4. Keep the existing home panel layout temporarily, but rename folder cards to project cards.

The second slice should change the visual layout:

1. Extract `CanvasProjectSidebar`.
2. Extract `CanvasDocumentGrid`.
3. Remove breadcrumbs and folder-card visuals.

This sequence reduces risk because the data model can be verified before the UI layout changes.
