# Active Task Registry Refactor Plan

## Purpose

This document proposes a refactor for Forart's infinite canvas generation task state.

The direction is:

- Move active generation task state out of canvas nodes and action-fission rows.
- Make the persisted local generation task registry the source of truth for active tasks.
- Keep canvas nodes focused on durable canvas data: user configuration, input/result fields, and optional recovery hints.
- Derive UI running/progress/stop state from the registry instead of persisted node flags.

No data migration is required for this plan because the project is still in development.

## Confirmed Decisions

- Copied nodes preserve final generated result images.
- Copied nodes clear all task logs, task ids, upstream task ids, and recovery hints.
- Task recovery relies on the persisted registry first. Do not add node-level recovery hints in the first version.
- Deleting a running task target, or deleting an entire canvas, immediately interrupts active tasks and clears their registry records.
- When clearing the last action-fission row, regenerate the row id.
- Manual stop returns the UI to normal idle state and does not show an error prompt.
- Batch action-fission UI remains derived from each row's registry task state.
- Task view refresh starts with polling.
- Old development canvas JSON can be ignored; no compatibility migration is required.

## Current Problem

The current implementation already has a persisted local generation task registry in Electron:

- `electron/main/modules/generation-task-store.cjs`
- `renderer/src/features/infinite-canvas/generation/generationTaskRegistry.ts`
- `renderer/src/features/infinite-canvas/generation/generationTaskWriteback.ts`

However, renderer code still writes active task state back into canvas nodes and action-fission rows:

- Image generator nodes use fields such as `running`, `generationStatus`, and `generationTask`.
- Action-fission rows use fields such as `running`, `status`, and `generationTask`.
- UI active checks read those node/row fields directly.

That creates stale-state bugs. The copied action-fission node issue is one example:

1. A row is running.
2. Copy/paste clones the node and row data.
3. The copied row inherits `generationTask.status = "running"` or `running = true`.
4. The UI shows the copied row as generating even though no real task was started for the copied target.

The deeper issue is not just copy/paste. The same stale state can appear after save/load, canvas duplication, target deletion, task supersede, or failed write-back.

## Design Goal

The task lifecycle should have one authority:

```text
Active task truth: generation-task-registry.json
Canvas truth: nodes, connections, groups, final generation results
UI truth: derived view from registry + canvas data
```

The registry answers:

- Is this target currently queued, submitting, running, or waiting for write-back?
- Which task is latest for `canvasId + target`?
- Can this task be stopped, resumed, written back, superseded, or marked orphaned?

The canvas node answers:

- What kind of node is this?
- What user configuration does it contain?
- What final result should be rendered?
- What terminal error/result summary should be shown, if any?

The node should not answer:

- Is this target actively generating right now?
- What progress text should the running UI show?
- Which AbortController or polling loop owns this target?

## Proposed Ownership Model

### Registry-Owned State

The local task registry owns the full active task record:

```ts
interface CanvasGenerationTask {
  id: string;
  canvasId: string;
  target: CanvasGenerationTarget;
  kind: "image";
  providerId: string;
  model: string;
  upstreamTaskId?: string;
  status:
    | "queued"
    | "submitting"
    | "running"
    | "succeeded"
    | "failed"
    | "interrupted"
    | "superseded"
    | "writeback_pending"
    | "writeback_failed"
    | "acked"
    | "orphaned";
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  durationMs?: number;
  prompt?: string;
  referenceImages?: string[];
  resolution?: "1k" | "2k" | "4k";
  aspectRatio?: string;
  message?: string;
  error?: string;
  interruptReason?: "user_stop" | "app_restart" | "provider_lost" | "superseded";
  result?: {
    url?: string;
    localUrl?: string;
    fileName?: string;
    width?: number;
    height?: number;
  };
  writeback?: {
    terminalStatus?: CanvasGenerationTask["status"];
    [key: string]: unknown;
  };
}
```

For active tasks, registry state is authoritative.

Active statuses:

- `queued`
- `submitting`
- `running`
- `writeback_pending`

Terminal statuses:

- `succeeded`
- `failed`
- `interrupted`
- `superseded`
- `writeback_failed`
- `orphaned`
- `acked`

`acked` means the terminal result has been written back to canvas data and the registry no longer needs to retain the live record.

### Canvas-Owned State

Image generator node should keep:

- prompt/config fields
- provider/model/resolution/aspect ratio defaults
- final image fields: `url`, `fileName`, image dimensions, download state
- optional terminal summary for the most recent generation

Action-fission row should keep:

- action selection fields
- row image/result fields
- optional terminal summary for the most recent generation

Recommended terminal summary shape:

```ts
interface GenerationTerminalSummary {
  taskId: string;
  status: "succeeded" | "failed" | "interrupted" | "superseded" | "orphaned";
  completedAt?: number;
  durationMs?: number;
  error?: string;
}
```

This is intentionally not enough to drive active UI. It is only for final state display and diagnostics.

### Optional Recovery Hint

If extra recovery resilience is needed, nodes/rows may store a small recovery hint:

```ts
interface GenerationRecoveryHint {
  taskId: string;
  upstreamTaskId?: string;
  providerId: string;
  model: string;
  startedAt: number;
}
```

Rules for this hint:

- It is a recovery hint, not the active state source.
- UI must not show "running" just because the hint exists.
- On load, the task runtime may use the hint to rehydrate the registry if the registry record is missing.
- Copy/paste and canvas duplication must strip this hint.
- The hint should be removed or replaced after terminal write-back.

For the first version, do not store this hint on nodes/rows. The persisted registry is the recovery source.

## Target Key

Every task is keyed by `canvasId + target`.

```ts
type CanvasGenerationTarget =
  | { type: "imageGenerator"; nodeId: string }
  | { type: "actionFissionRow"; nodeId: string; rowId: string };
```

Canonical target key:

```text
imageGenerator:<canvasId>:<nodeId>
actionFissionRow:<canvasId>:<nodeId>:<rowId>
```

The registry already has target-key logic in `generation-task-store.cjs`; the renderer should use the same canonical shape when deriving UI state.

## Renderer Architecture

### Add A Generation Task View Store

Introduce a renderer-side module/hook that subscribes to or polls the registry and exposes a target-indexed view:

```ts
interface GenerationTaskView {
  taskByTargetKey: Map<string, CanvasGenerationTask>;
  getTaskForTarget(canvasId: string, target: CanvasGenerationTarget): CanvasGenerationTask | null;
  isTargetActive(canvasId: string, target: CanvasGenerationTarget): boolean;
  getTargetMessage(canvasId: string, target: CanvasGenerationTarget): string;
  refreshTasks(canvasId?: string): Promise<void>;
}
```

The first implementation can poll `listGenerationTasks({ canvasId })` every second while a canvas is open or while any active task exists.

Later, this can become IPC push/events from Electron.

### UI Uses Task View, Not Node Flags

Image generator active state becomes:

```ts
const task = generationTaskView.getTaskForTarget(canvasId, {
  type: "imageGenerator",
  nodeId,
});
const isRunning = task ? isGenerationTaskActive(task) : false;
```

Action-fission row active state becomes:

```ts
const task = generationTaskView.getTaskForTarget(canvasId, {
  type: "actionFissionRow",
  nodeId,
  rowId,
});
const isRunning = task ? isGenerationTaskActive(task) : false;
```

This means `isActionFissionRowActive(row)` should eventually be replaced with a target-aware check. A row alone is not enough context because active state belongs to `canvasId + nodeId + rowId`.

### Task Start Flow

1. User starts an image node or action-fission row.
2. Renderer builds immutable input snapshot:
   - prompt
   - references
   - provider/model/rule
   - resolution/aspect ratio
   - target
3. Renderer calls `createGenerationTask`.
4. Electron registry creates a persisted task and supersedes any existing active task for the same target.
5. Renderer refreshes the task view.
6. UI shows running state because registry now has an active task.
7. Renderer does not write `running`, `status`, `generationStatus`, or active `generationTask` into the node.

### Task Progress Flow

1. Electron runner updates registry task `message`, `upstreamTaskId`, `status`, and result.
2. Renderer task view refreshes.
3. UI derives progress text from the task view.
4. Canvas data remains unchanged until terminal write-back.

### Terminal Write-Back Flow

1. Task reaches terminal status in registry.
2. Write-back manager patches the target canvas.
3. For success:
   - image generator gets final image fields
   - action-fission row gets final result fields
4. For failure/interruption:
   - target gets optional terminal summary/error
5. Canvas save succeeds.
6. Renderer calls `ackGenerationTaskWriteback`.
7. Registry removes or closes the task.
8. UI no longer sees an active task for that target.

### Stop Flow

1. User clicks stop.
2. UI resolves the current task from `canvasId + target`.
3. Renderer calls `stopGenerationTask(task.id)`.
4. Registry marks task `interrupted`.
5. Local polling/waiting stops.
6. Write-back applies terminal summary if product wants one.
7. UI stops showing running state because the registry task is no longer active.

The node/row should not be patched to clear `running` because `running` no longer exists as source-of-truth state.

## Data Shape Changes

No migration is required. New canvases can use the new shape directly.

### Remove From CanvasNode As Active State

These should no longer be active-state source fields:

- `running`
- `generationStatus`
- active `generationTask`

`generationError` should be reviewed. It can be kept only as a terminal summary or replaced by `lastGeneration.error`.

### Remove From ActionFissionRow As Active State

These should no longer be active-state source fields:

- `running`
- `status`
- active `generationTask`

`error` should be reviewed. It can stay for configuration/validation errors, but generation task errors should come from either the active task view or terminal summary.

### Keep Result Fields

Keep these on the node/row because they are durable canvas output:

- image/result URL
- file name
- dimensions
- download state
- provider/model/resolution/aspect ratio that produced the result, if useful

## Copy/Paste And Duplication Rules

Copying nodes must create new canvas targets, not clone task identity.

Copy/paste should:

- assign new node ids
- assign new action-fission row ids
- preserve user configuration
- preserve final result fields if product wants duplicated results
- strip recovery hints
- strip terminal summary if product wants the copy to be a clean reusable template
- never copy active task ids, upstream task ids, running messages, or task statuses

Recommended first behavior:

- Preserve final result images.
- Preserve action selection/configuration.
- Strip all task/recovery/terminal state.
- Regenerate action-fission row ids so copied rows cannot collide with old task targets.

Canvas project duplication should follow the same rules unless the intended product behavior is "snapshot everything including completed result history". It still must not duplicate active registry tasks.

## Edge Cases

### Copy A Running Target

Expected behavior:

- Original target keeps running.
- Copied target is idle.
- Copied target may keep config and existing final results.
- Copied target has no active task in registry.

Important rule:

- UI active state must require a registry task keyed to the copied node/row ids.

### Delete A Running Target

Expected behavior:

- Task may continue in the provider.
- Local registry should either stop it or mark it orphaned, depending on product choice.

Confirmed first behavior:

- Deleting a target calls `stopGenerationTask` for active tasks under that target.
- The registry record is cleared after the local stop is recorded.
- If a provider result still arrives later, the runner must ignore it because the local task is no longer active.

### Delete An Action-Fission Row While Running

Expected behavior:

- Stop the row's active task before deleting the row.
- If the last row is cleared instead of removed, stop the task and reset the row id or strip all task identity.

Confirmed behavior:

- Clearing the last row generates a new row id.
- This avoids old target identity accidentally matching future task records.

### Delete A Canvas With Active Tasks

Expected behavior:

- Stop or orphan all tasks for that `canvasId`.

Confirmed first behavior:

- On canvas delete, registry interrupts and clears all non-terminal tasks for that canvas.
- The task runner must ignore later provider results for those tasks.

### Retry Same Target While Old Task Runs

Expected behavior:

- Registry creates a new task.
- Registry marks the older active task for the same target as `superseded`.
- UI shows only the new task.
- If the older provider task later succeeds, its result must not write back.

Existing store already supersedes active tasks by target. The write-back manager should continue to validate latest task ownership before applying results.

With active state moved out of nodes, latest ownership should be validated against registry target state, not `row.generationTask.id`.

### Provider Returns Direct Image

Expected behavior:

- Registry task goes from `submitting/running` to `succeeded`.
- Write-back applies result immediately.
- Ack removes task from registry.
- UI may only briefly show active state.

### App Exits Before Upstream Task ID Exists

Expected behavior:

- If the local task exists but no `upstreamTaskId` was persisted, the app cannot safely recover the provider job.
- Mark task `interrupted` after a short grace window.
- Do not auto-resubmit because that can cause duplicate generation and duplicate billing.

Existing `interruptUnrecoverableGenerationTasks` already follows this direction.

### App Exits After Upstream Task ID Exists

Expected behavior:

- On restart, registry still has task and `upstreamTaskId`.
- Renderer resumes via `resumeGenerationTask`.
- UI shows active state from registry after task view loads.

If optional recovery hints are not stored on nodes, recovery depends on the registry file surviving. That is acceptable if we treat the registry as durable and write it atomically.

### Registry File Corruption

Expected behavior:

- App should not show stale running state from nodes.
- Active tasks may be unrecoverable if no optional recovery hints exist.
- User should see idle targets with existing final results.

Mitigation options:

- Keep optional recovery hints on nodes and use them only to rehydrate registry.
- Write registry atomically with temp-file rename, which already exists.
- Add a backup registry file if needed later.

### Registry Has Active Task But Target Is Missing

Expected behavior:

- Do not create a new node or row.
- Mark task `orphaned`.
- Keep diagnostic record for TTL, then prune.

Existing store already has diagnostic TTL for orphaned/writeback-failed tasks.

### Registry Has Active Task But Target Was Copied

Expected behavior:

- Only the original target can show active state because target key includes original node/row ids.
- Copied target is idle because it has new ids and no registry task.

This is the core fix for the current copied action-fission node bug.

### Offscreen Canvas Write-Back

Expected behavior:

- Task result writes back by `canvasId`.
- If the canvas is not active, load the canvas project from disk, patch it, save it, then ack.
- If save fails, task remains `writeback_failed` or `writeback_pending`.

Important rule:

- Ack only after canvas save succeeds.

### Active Canvas Race

Possible race:

1. User starts a task.
2. User edits the target before task completes.
3. Task finishes and write-back applies an older snapshot.

Mitigation:

- Write-back should patch only result/terminal fields, not overwrite full node/row state.
- Task input should be immutable once created.
- Optionally store target `startedAt` and compare with newer target generation ids.

### Multiple Windows Or Renderers

If Forart later supports multiple windows:

- Registry remains the authority.
- Renderer task views must refresh on registry changes.
- Electron should eventually emit task-change IPC events instead of relying on polling.

For the current single-window app, polling is enough.

### Batch Action-Fission Run

No separate batch id is required for first version.

Footer state can be derived from registry:

- running rows = active tasks with target type `actionFissionRow` under this node
- completed count = rows with terminal summary or result
- stop all = stop all active registry tasks under this node

If later UX needs "this exact click started these N rows", introduce a batch id in the registry only. Do not store batch running state on the node.

## Virtual Flow Simulation After Confirmed Decisions

### Scenario 1: Copy A Running Action-Fission Node

Flow:

1. Original row has an active registry task keyed by `actionFissionRow:<canvasId>:<oldNodeId>:<oldRowId>`.
2. User copies the node.
3. Paste creates `<newNodeId>` and new row ids.
4. Paste preserves action selection and final result images.
5. Paste strips task logs, task ids, upstream task ids, and recovery hints.
6. Task view looks for `actionFissionRow:<canvasId>:<newNodeId>:<newRowId>`.
7. No registry task exists for the copied target.

Expected result:

- Original row remains running.
- Copied row is idle.
- Copied row can be run as a new task later.

New issue to guard:

- The clone helper must deep-clone and rewrite nested action-fission rows. A shallow copy that only changes the node id still risks duplicate row ids and shared nested object references.

### Scenario 2: Copy A Completed Action-Fission Node

Flow:

1. Row has `resultUrl`, `resultFileName`, dimensions, and no active registry task.
2. Copy/paste preserves result fields and action selection.
3. Copy/paste clears terminal task summary/log fields.
4. New row ids are generated.

Expected result:

- Copied node shows the generated image result.
- Copied node has no task history and no active state.

New issue to guard:

- If result images are local canvas assets, copying a canvas within the same project can reuse the same URL. If later cross-project export/import is added, asset copying rules must be revisited.

### Scenario 3: Manual Stop A Running Row

Flow:

1. UI resolves active task from registry by `canvasId + nodeId + rowId`.
2. User clicks stop.
3. Renderer calls `stopGenerationTask(task.id)`.
4. Registry interrupts the task and clears the active record.
5. Task view refreshes.
6. UI sees no active task and returns to idle.
7. No node/row error is written for manual stop.

Expected result:

- Stop button changes back to run.
- No error message is shown.
- Existing result image, if any, remains.

New issue to guard:

- If `ack` removes the registry record immediately, any in-flight `waitForLocalGenerationTask` loop must treat task-not-found after manual stop as a normal stop, not as an error write-back.

### Scenario 4: Delete A Running Row

Flow:

1. UI finds active registry task for the row.
2. Delete action calls `stopGenerationTask`.
3. Registry interrupts and clears the active record.
4. Row is removed, or if it is the last row, the row is cleared and assigned a new id.
5. Task view refreshes.

Expected result:

- The deleted/cleared row cannot receive the old task result.
- The new last-row id has no matching active task.

New issue to guard:

- Stop and delete should be ordered. If row deletion happens before stop lookup, the UI may lose the row target needed to stop the task. Resolve active task ids before mutating rows.

### Scenario 5: Delete A Canvas With Active Tasks

Flow:

1. Delete canvas action lists registry tasks for the canvas id.
2. All active tasks are interrupted and cleared.
3. Canvas JSON is deleted.
4. Any later runner completion for those tasks is ignored.

Expected result:

- No orphan write-back attempts for the deleted canvas.
- No stale registry records for deleted canvas tasks.

New issue to guard:

- The Electron task runner may still hold async work for a cleared task. Before writing success/failure, runner must re-read registry and skip update when the task no longer exists or is no longer active.

### Scenario 6: Retry Same Target While Old Provider Task Still Runs

Flow:

1. Existing task A is active for target.
2. User starts task B for the same target.
3. Registry marks task A as superseded or clears it, then creates task B.
4. UI shows task B only.
5. If task A returns later, runner checks registry latest ownership and does not write back A.

Expected result:

- Older provider result cannot overwrite newer result.
- UI remains tied to task B.

New issue to guard:

- If confirmed deletion behavior clears records immediately, retry should still keep enough in-memory knowledge to ignore old async completions. A per-run `cancelled/superseded` check in the runner is required.

### Scenario 7: App Restart With Active Registry Task

Flow:

1. Registry contains a task with `upstreamTaskId`.
2. App restarts.
3. Renderer loads registry tasks through polling/task view.
4. Resume logic restarts provider polling by `upstreamTaskId`.
5. UI shows active state from registry after task view loads.

Expected result:

- No node fields are needed for active UI.
- Recovery works as long as registry is intact.

New issue to guard:

- There may be a short idle-looking gap before task view loads. The canvas should either load task view before first render or show a neutral loading state for task status.

### Scenario 8: Registry Lost Or Corrupt During Development

Flow:

1. Old active task record is missing.
2. Node has no recovery hint by design.
3. Canvas opens.
4. UI shows idle state.

Expected result:

- No stale "generating" UI.
- In-flight provider result may be unrecoverable.

Accepted tradeoff:

- This is acceptable for the first version because recovery relies on the persisted registry and old development JSON is ignored.

### Scenario 9: Batch Run Rows

Flow:

1. User runs all eligible rows.
2. Each row creates its own registry task.
3. Footer derives progress from registry tasks under `canvasId + nodeId`.
4. Stop all resolves active row tasks from registry and stops them.

Expected result:

- No `runningAll` field is needed.
- Progress survives UI remount as long as registry tasks exist.

New issue to guard:

- If completed tasks are acked and removed immediately, footer cannot count "completed in this batch" from registry alone. For the current decision, footer should show active count from registry and completed/result count from row result fields, not depend on removed task records.

## Implementation Phases

### Phase 0: Immediate Safety Net

Goal:

- Stop creating new stale active state while the larger refactor is underway.

Changes:

- Add `cloneCanvasNodeForPaste` or equivalent clone sanitizer.
- Use it for node copy/paste.
- Use the same sanitizer for canvas duplication.
- Regenerate action-fission row ids when cloning.
- Preserve final result images.
- Strip task logs, task ids, upstream task ids, recovery hints, `running`, `status`, and `generationStatus`.

Files likely involved:

- `renderer/src/features/infinite-canvas/CanvasPage.tsx`
- `renderer/src/features/infinite-canvas/useCanvasProjects.ts`
- new helper under `renderer/src/features/infinite-canvas/`

Acceptance:

- Copy a running action-fission node: copied node is idle.
- Copy a completed action-fission node: copied node keeps result image but has no task state.
- Duplicate a canvas that contains running-looking development nodes: duplicated canvas does not show copied active state.

Why first:

- This fixes the visible bug immediately and reduces noise while the deeper task-state refactor happens.

### Phase 1: Registry Stop/Clear API

Goal:

- Make deletion flows able to clean active tasks before canvas data is mutated.

Changes:

- Add Electron-side bulk stop/clear APIs:
  - `stopGenerationTasksForTarget(canvasId, target)`
  - `stopGenerationTasksForNode(canvasId, nodeId)`
  - `stopGenerationTasksForCanvas(canvasId)`
- Implement two-step stop/clear:
  1. mark matching active tasks `interrupted`
  2. move them into the short-lived closed cache instead of keeping them in the active registry
- Expose these APIs through preload and renderer config.
- Add runner guards so async completion skips stopped/cleared tasks.

Files likely involved:

- `electron/main/modules/generation-task-store.cjs`
- `electron/main/modules/image-generation-runner.cjs`
- `electron/main/ipc/canvas-ipc.cjs`
- `electron/preload/preload.cjs`
- `renderer/src/app/appConfig.ts`
- `renderer/src/features/infinite-canvas/generation/generationTaskRegistry.ts`

Acceptance:

- Stop/clear by node removes active registry tasks for that node.
- Stop/clear by canvas removes active registry tasks for that canvas.
- In-flight runner completion after clear does not recreate or update the task.
- Renderer polling does not show an error for task-not-found after user stop/delete.

Why before task view:

- The task view will rely on registry correctness. Deletion cleanup should be solid first.

### Phase 2: Delete Flow Integration

Goal:

- Existing delete actions satisfy the confirmed behavior: deleting a target or canvas immediately stops and clears its active tasks.

Changes:

- Before `deleteNode`, call stop/clear for that node.
- Before `deleteSelectedNodes` and `deleteSelectedGroup`, stop/clear for every removed node.
- Before action-fission row removal, stop/clear for that row target.
- Before canvas delete, stop/clear for that canvas.
- Before folder delete, stop/clear for all canvases in the folder.
- Refresh task view after delete if task view already exists; otherwise no-op.

Files likely involved:

- `renderer/src/features/infinite-canvas/CanvasPage.tsx`
- `renderer/src/features/infinite-canvas/action-fission/useActionFissionNodeState.ts`
- `renderer/src/features/infinite-canvas/useCanvasProjects.ts`
- `electron/main/modules/canvas-store.cjs` if canvas/folder delete cleanup is centralized in main

Acceptance:

- Delete a running image generator node: no active registry task remains for that node.
- Delete a running action-fission node: no active registry row tasks remain under that node.
- Delete a running action-fission row: no active task remains for that row.
- Delete a canvas with active tasks: no active registry tasks remain for that canvas.
- Deleting does not display task errors.

Why before removing node active fields:

- It fixes a real gap in the current implementation while keeping the rest of the generation flow unchanged.

### Phase 3: Define Active-State Boundary

Goal:

Create a clear split:

- Registry task record: active and terminal-unacked lifecycle.
- Canvas node/row: durable config and result.
- Renderer task view: derived UI state.

Update docs/types before code changes so new code has a stable target.

Changes:

- Decide final TypeScript shapes for:
  - terminal summary, if kept
  - active task view model
  - target key helpers
- Add helpers for canonical target key generation in renderer.
- Keep old fields temporarily, but mark them as transitional and stop adding new dependencies on them.

Acceptance:

- There is one target-key helper used by task view, action-fission rows, image nodes, and delete cleanup.
- New code does not call row-only active helpers for task state.

### Phase 4: Add Renderer Task View

Add a small target-indexed task view module:

- loads tasks from `listGenerationTasks`
- filters by canvas id
- computes canonical target keys
- exposes `getTaskForTarget`
- exposes active/progress helpers
- refreshes on interval while active tasks exist

This gives UI code a single seam for active task state.

Files likely involved:

- new `renderer/src/features/infinite-canvas/generation/useGenerationTaskView.ts`
- `renderer/src/features/infinite-canvas/generation/generationTaskRuntime.ts`
- `renderer/src/features/infinite-canvas/useCanvasGenerationActions.ts`
- `renderer/src/features/infinite-canvas/CanvasPage.tsx`

Acceptance:

- Task view can show active tasks for current canvas.
- Polling stops or slows when no active tasks exist.
- Task view does not write to canvas nodes.
- UI can query `getTaskForTarget(canvasId, target)`.

### Phase 5: Switch UI Active Checks

Replace node/row active checks:

- `isImageGeneratorNodeActive(node)` becomes target-aware.
- `isActionFissionRowActive(row)` becomes target-aware or is replaced by task-view calls.
- Running labels and duration read from registry task view.

At the end of this phase, UI should no longer require `node.running`, `row.running`, `row.status`, or active `generationTask`.

Files likely involved:

- `renderer/src/features/infinite-canvas/generation/imageGeneratorNodeRuntime.ts`
- `renderer/src/features/infinite-canvas/action-fission/actionFissionRowRuntime.ts`
- `renderer/src/features/infinite-canvas/nodes/ImageNodeBody.tsx`
- `renderer/src/features/infinite-canvas/nodes/action-fission/ActionFissionRowItem.tsx`
- `renderer/src/features/infinite-canvas/nodes/ActionFissionNodeBody.tsx`
- `renderer/src/features/infinite-canvas/nodes/action-fission/ActionFissionFooter.tsx`
- `renderer/src/features/infinite-canvas/layers/NodeLayer.tsx`

Acceptance:

- Running badge/style comes from task view.
- Action-fission row disabled state comes from task view.
- Footer running/progress state comes from registry-derived active row tasks and durable result fields.
- Old node/row active fields can be wrong without affecting visible active UI.

### Phase 6: Stop Writing Active State Into Nodes

Update generation actions:

- On start, create registry task and refresh task view.
- During progress, do not patch canvas nodes with task progress.
- On stop, update registry task.
- On terminal, call write-back.

Node writes should happen only for durable outputs or terminal summaries.

Files likely involved:

- `renderer/src/features/infinite-canvas/generation/useImageGenerationActions.ts`
- `renderer/src/features/infinite-canvas/generation/useActionFissionGenerationActions.ts`
- `renderer/src/features/infinite-canvas/generation/generationTaskRegistry.ts`

Acceptance:

- During generation progress, canvas JSON is not updated with `running/status/generationStatus/generationTask`.
- Active UI still updates through task view polling.
- Manual stop returns UI to idle without writing an error to the node/row.

### Phase 7: Rewrite Write-Back Ownership Checks

Today write-back checks fields such as `row.generationTask?.id`.

After this refactor, ownership should be checked against registry rules:

- terminal task must still be latest for its `canvasId + target`, or be explicitly allowed to write terminal failure/interruption
- superseded tasks must not write result fields
- orphaned targets are marked in registry

This keeps stale results from overwriting newer ones without relying on node-embedded task ids.

Files likely involved:

- `renderer/src/features/infinite-canvas/generation/generationTaskWriteback.ts`
- `electron/main/modules/generation-task-store.cjs`
- `renderer/src/features/infinite-canvas/generation/generationTaskRegistry.ts`

Acceptance:

- Superseded task results cannot overwrite newer task results.
- Deleted targets do not receive result writes.
- Write-back still retries when canvas save fails.
- Ack only happens after canvas save succeeds.

### Phase 8: Remove Obsolete Fields

After UI and generation flows no longer depend on them:

- remove or stop using `CanvasNode.running`
- remove or stop using `CanvasNode.generationStatus`
- remove or stop using active `CanvasNode.generationTask`
- remove or stop using `ActionFissionRow.running`
- remove or stop using `ActionFissionRow.status`
- remove or stop using active `ActionFissionRow.generationTask`

Because no migration is required, old development canvases can be discarded or normalized.

Files likely involved:

- `renderer/src/features/infinite-canvas/types.ts`
- `renderer/src/features/infinite-canvas/action-fission/actionFissionTypes.ts`
- `renderer/src/features/infinite-canvas/canvasSerialization.ts`
- any remaining callers found by `rg "running|generationStatus|generationTask|row.status"`

Acceptance:

- TypeScript no longer requires active task fields on canvas node/row data.
- Canvas save sanitizer no longer needs to protect against most active fields.
- Old development JSON can be ignored or normalized in memory.

## Testing Checklist

Minimum manual or automated checks:

- Start image generation node and verify UI running state comes from registry.
- Start action-fission row and verify UI running state comes from registry.
- Copy a running action-fission node; copied node must be idle.
- Copy a running image generator node; copied node must be idle.
- Retry the same target; older task must not write result.
- Stop a row; UI stops because registry task is interrupted.
- Stop all rows; only active registry tasks under that node are stopped.
- Switch canvas while task runs; result writes to original canvas.
- Delete target while task runs; task becomes stopped or orphaned.
- Restart app after `upstreamTaskId` exists; task resumes.
- Restart app before `upstreamTaskId` exists; task is interrupted, not resubmitted.
- Force write-back failure; registry retains terminal task for retry.
- Duplicate canvas with active tasks; duplicated canvas must not inherit active tasks.

## Recommended Execution Order

Do the work in three delivery slices rather than one large refactor.

## Implementation Progress

Current status:

- Slice 1 is implemented: copy/paste and canvas duplication sanitize active task fields, action-fission row ids are regenerated on clone, delete flows call registry stop/clear APIs for nodes, rows, folders, and canvases, and manual stop clears UI error state.
- Slice 2 read path is implemented: the renderer has a polling task view keyed by `canvasId + target`, image generator UI, action-fission rows, action-fission footer counts, and node running outlines now prefer registry task state.
- Task view refresh is triggered after task creation, progress, stop/clear, write-back pending, ack, orphan, and write-back failure paths, so key UI state no longer waits only for the polling interval.
- Slice 3 write-path cleanup has started: image generation and action-fission generation no longer write active progress tasks into node/row data, and write-back ownership now checks the registry latest target task instead of node/row `generationTask.id`.
- Acked tasks are retained as hidden short-term registry markers so an older retry/write-back cannot overwrite a newer result after the newer task has already been acknowledged. Normal task listing still hides acked records from the UI.
- Image generation and action-fission active fallback helpers have been removed. Action-fission rows no longer type active task fields, and image nodes no longer type `generationTask`.
- `running` and `generationStatus` remain on `CanvasNode` for LLM node runtime only. Image/action-fission UI no longer uses them for active state.

### Slice 1: Safety And Delete Cleanup

Includes:

- Phase 0: Immediate Safety Net
- Phase 1: Registry Stop/Clear API
- Phase 2: Delete Flow Integration

Why:

- Fixes the visible copy/paste bug.
- Fixes the confirmed current gap where delete flows leave active tasks behind.
- Does not require changing all UI active-state reads yet.

Recommended stopping point:

- Ship or test this slice before moving on. It reduces stale-state bugs while preserving the current generation flow.

### Slice 2: Task View Read Path

Includes:

- Phase 3: Define Active-State Boundary
- Phase 4: Add Renderer Task View
- Phase 5: Switch UI Active Checks

Why:

- Moves UI reads to the registry.
- Keeps write paths mostly unchanged until task view is proven stable.

Recommended stopping point:

- Verify UI can ignore stale node active fields before removing writes.

### Slice 3: Task Write Path And Cleanup

Includes:

- Phase 6: Stop Writing Active State Into Nodes
- Phase 7: Rewrite Write-Back Ownership Checks
- Phase 8: Remove Obsolete Fields

Why:

- Completes the architecture shift.
- Removes the old source of stale state after the new read path is already working.

Recommended stopping point:

- After Phase 7, run the full generation/retry/delete/restart checklist. Remove obsolete fields only after the behavior is stable.

## Risks

### Registry Loss Becomes More Important

If active state is no longer duplicated into nodes, losing the registry means losing active-task recovery.

Mitigation:

- Keep atomic writes.
- Consider optional node recovery hints.
- Consider registry backup later.

### UI Needs Async Task View

Canvas can render before registry tasks are loaded.

Mitigation:

- Load task view before showing active canvas, or allow a short neutral loading state.
- Do not temporarily show stale running state from nodes.

### Write-Back Must Be More Precise

Without node-embedded task ids, write-back must use registry latest-task ownership.

Mitigation:

- Centralize latest-task checks in the registry module.
- Add helper such as `isLatestTaskForTarget(taskId, canvasId, target)`.

### More Calls Depend On Target Context

Helpers that currently accept only `row` or `node` need `canvasId + nodeId + rowId`.

Mitigation:

- Accept the interface change intentionally.
- Do not keep row-only helpers that pretend active state is local to the row.

### Product Semantics Need Explicit Decisions

Several cases have valid alternatives: stop on delete vs orphan, preserve results on copy vs clear results, store recovery hints vs registry-only.

These should be decided before implementation.

## Remaining Questions

The main product decisions are confirmed. Remaining questions are implementation-level:

1. Should registry clearing on manual stop/delete physically remove the task immediately, or mark it `acked`/closed for a short in-memory TTL so in-flight polling can resolve cleanly?
2. Should Electron expose a bulk API such as `stopGenerationTasksForTarget` and `stopGenerationTasksForCanvas` to avoid renderer-side list/filter races?
3. Should old active tasks be ignored only at UI level, or should canvas load normalize them in memory by dropping obsolete active fields?

## Recommended Implementation Adjustments From Simulation

- Add a deep `cloneCanvasNodeForPaste` helper. It must rewrite node ids, action-fission row ids, and strip every task/recovery/log field.
- Add registry APIs for bulk stop/clear by target and canvas. This avoids losing target information after row or canvas deletion.
- In the Electron runner, before every registry update and before final result write, re-read the task. If the task was stopped, cleared, or superseded, skip the update.
- Treat "task not found" after a user stop/delete as a normal terminal condition in renderer polling loops.
- Keep task-view polling independent from canvas node writes. Progress should refresh the task view only.
- Let action-fission footer combine registry active counts with durable row result fields. Do not depend on acked tasks remaining in the registry for completed counts.
- Load the task view before or alongside canvas render to avoid a visible false-idle flash.

## Current Implementation Gap Check

The current code already has the pieces for individual task stop, but deletion flows do not yet use them.

Existing behavior:

- `deleteNode` removes the node, its connections, and group membership from canvas state.
- `deleteSelectedNodes` and `deleteSelectedGroup` remove selected nodes from canvas state.
- `deleteCanvasProject` calls the canvas delete API and removes local tab state.
- `canvasStore.deleteProject` deletes the canvas JSON file and index record.
- `stopImageComposer`, `stopActionFissionRow`, and `stopAllActionFissionRows` call `stopGenerationTask`, but only when the user explicitly presses stop.

Missing behavior:

- Deleting an image generator node does not stop or clear active tasks for that node.
- Deleting an action-fission node does not stop or clear active row tasks under that node.
- Deleting selected nodes or a selected group does not stop or clear tasks for the removed nodes.
- Removing an action-fission row does not stop or clear an active task for that row.
- Deleting a canvas does not stop or clear registry tasks for that canvas.
- Deleting a folder does not stop or clear registry tasks for canvases inside that folder.
- Canvas duplication currently clones nodes as payload data and should be routed through the same clone sanitizer as copy/paste.

Conclusion:

- The current implementation does not yet satisfy the confirmed delete behavior.
- It can leave active registry tasks behind after node/row/canvas deletion.
- Those tasks may later become orphaned or attempt write-back unless the runner/write-back path catches the missing target.

## Refined Implementation Decisions

Based on the simulation, use these implementation defaults:

### Stop/Clear Semantics

Use a two-step clear:

1. Mark the task `interrupted` with `interruptReason = "user_stop"` or `interruptReason = "superseded"`.
2. Move the task into a short-lived closed cache, equivalent to acked/closed state, instead of leaving it in the persisted active registry.

This matches the product decision that deleted targets should clear visible task records, while still letting in-flight polling calls resolve cleanly for a short time.

### Bulk Registry APIs

Add Electron-side APIs instead of doing renderer-side list/filter/stop loops:

```ts
stopGenerationTasksForTarget(canvasId, target)
stopGenerationTasksForNode(canvasId, nodeId)
stopGenerationTasksForCanvas(canvasId)
```

Expected behavior:

- Abort active controllers when present.
- Mark matching active tasks interrupted.
- Move matching tasks into the closed cache.
- Return the stopped task ids for diagnostics.

This is safer than making the renderer list tasks, mutate canvas state, and then try to stop tasks after target identity may have changed.

### Delete Ordering

Deletion must stop tasks before mutating canvas state:

1. Resolve target ids from current canvas data.
2. Stop/clear tasks for those targets through bulk registry APIs.
3. Mutate canvas nodes/rows/canvas records.
4. Refresh task view.

### Runner Guard

Every async runner completion must re-read registry state:

```ts
const current = generationTaskStore.getTask(task.id);
if (!current || current.status === "acked" || current.status === "interrupted" || current.status === "superseded") {
  return;
}
```

If `getTask` returns a closed-cache task, the runner should still treat it as not writable.

### Renderer Polling Guard

Renderer wait loops should distinguish:

- task not found after user stop/delete: normal end
- task not found during ordinary running: unexpected failure

The clean way is to let the closed-cache response return an `acked` or `interrupted` task briefly after clear, so renderer does not need to guess.

### Canvas Load Policy

Old development canvas JSON is ignored for compatibility. For user experience during development, the loader may still normalize in memory by dropping obsolete active fields, but it does not need to save a migration.

### Canvas Duplication Policy

Canvas duplication must use the same sanitization rules as node copy/paste:

- preserve result images
- preserve configuration
- regenerate node ids only if duplication means a new independent canvas identity is required
- regenerate action-fission row ids if tasks are target-keyed by row id
- clear task ids, upstream task ids, logs, active fields, and recovery hints

If canvas duplication preserves node ids inside a new canvas id, task target keys are still different because `canvasId` changes. However, clearing task fields is still required so the duplicated canvas cannot show stale task UI.
