# Unified Generation Task System Design

## Scope

This document covers a unified task system for local Forart image generation workflows:

- Image generation canvas nodes.
- Action fission row generation.

LibTV generation and sync are intentionally out of scope because they use a separate remote project/node model and should not be coupled to this local task system.

## Confirmed Decisions

- Action fission row tasks should automatically resume polling when the app or canvas is reopened.
- The first implementation should introduce a local backend task interface, following the `D:\coding\Infinite-Canvas-main` pattern.
- Do not build a visible task center in the first implementation.
- Do not persist a separate action-fission batch ID for now. Batch/footer state should be derived from each row task.
- Keep only the latest task state on each node/row for the first implementation; do not build full task history yet.
- "Stop" means stopping local waiting/polling unless a provider-specific cancellation endpoint is explicitly supported.
- Keep the visible stop button text as "Stop".
- If a user retries after failure, replace the latest task record for that row/node.
- Keep only latest-task metadata on each row/node.
- If the app restarts before a task receives `upstreamTaskId`, mark it `interrupted`; do not resubmit automatically.
- Completed, failed, or interrupted local registry tasks should be cleaned only after the result/error has been acknowledged as written back to the canvas JSON.
- Store the persisted local task registry at `D:\coding\Forart\CanvasAssests\tasks\generation-task-registry.json`.
- Show `interrupted` task messages in the target node/row bottom status area.
- When a task succeeds, save the output image to `CanvasAssests/output` as soon as possible. Use the cloud result URL first, and fall back to the saved local image URL if needed.
- If the user retries the same target, mark the old task as `interrupted/superseded`; the new task replaces the latest task metadata on that node/row.

## Problem

The current canvas has two different generation paths:

- Image generation nodes already persist `generationTask.upstreamTaskId` and can recover unfinished cloud tasks after reopening a canvas.
- Action fission rows call the same image generation API but do not persist task IDs, so unfinished row tasks cannot be recovered after closing the app or switching away.

This creates inconsistent behavior:

- A regular image node can resume polling a cloud task.
- An action fission row loses the cloud task handle once the local runtime is gone.
- UI runtime flags such as `runningAll`, `running`, and `status` can become stale if persisted with canvas data.

## Goals

1. Use one task model for all local image generation workflows.
2. Persist cloud task IDs as soon as the provider returns them.
3. Resume unfinished tasks after app restart or canvas reopen.
4. Keep recoverable task state separate from transient UI state.
5. Allow task results to write back to different targets:
   - Image generation node image fields.
   - Action fission row result fields.
6. Avoid coupling this system to LibTV.
7. Avoid stale UI states by deriving UI running/progress from task state.

## Non-Goals

- Do not redesign LibTV sync or LibTV generation.
- Do not change the image provider API contract unless required.
- Do not persist temporary UI text such as "Generating..." as source-of-truth task state.
- Do not build a global task center in the first implementation.
- Do not keep full per-target task history in the first implementation.

## Reference Project Findings

The project at `D:\coding\Infinite-Canvas-main` has a more complete task handling pattern worth adopting conceptually.

Relevant implementation points:

- Backend creates a local canvas image task via `POST /api/canvas-image-tasks`.
- The client receives a local `task_id` immediately, stores it in `pendingTasks`, and polls `GET /api/canvas-image-tasks/{task_id}`.
- The backend runs the provider request in the background and stores status in `CANVAS_TASKS`.
- On success, the backend returns local output image URLs.
- If the local backend task fails but can extract an upstream provider task ID, it returns `upstream_task_id`.
- The frontend can then query the provider task directly through `POST /api/image-task-query`.
- Frontend pending task state is persisted on the node as `pendingTasks`.
- Pending node recovery is automatic through `resumeSmartPendingTasks`.
- The "stop" behavior is cooperative: it requests stop for the local run loop and usually waits for the current task boundary. It does not prove that every upstream provider task is canceled.
- `history.json` stores successful generation records such as prompt, images, timestamp, type, model, provider, task ID, request ID, params, and usage. It is generation history, not the source of truth for recovering active tasks.

Important limitation in that project:

- `CANVAS_TASKS` is in-memory. If the backend process restarts, local task IDs can disappear, so the implementation keeps or extracts upstream task IDs as a recovery fallback.
- There is no separate persisted task-registry file for `CANVAS_TASKS` in the observed implementation.
- Persistence mainly happens through node-level `pendingTasks` in saved canvas JSON and successful generation entries in `history.json`.

Design implication for Forart:

- Use a dual-ID model: a durable local task ID plus an upstream provider task ID.
- The local backend task interface is part of the first implementation, not a later optional enhancement.
- `upstreamTaskId` is still required for recovery after app/backend restart.

## Current Flow

### Image Generation Node

1. User runs an image generation node.
2. The app creates a local `CanvasGenerationTask`.
3. The app submits `POST /images/generations`.
4. If the provider returns a direct image URL, the result is applied immediately.
5. If the provider returns a task ID, it is stored as `generationTask.upstreamTaskId`.
6. The app polls `GET /tasks/{taskId}` or `GET /images/tasks/{taskId}`.
7. On success, the result image is saved as a local canvas asset and applied to the node.
8. On reopen, `resumeImageGenerationTasks` scans image generation nodes and resumes recoverable tasks.

### Action Fission Row

1. User runs one row or all rows.
2. The row sets `running/status/error` UI state.
3. The app submits the same image generation request.
4. The app currently does not persist `upstreamTaskId`.
5. The app polls only in the current runtime.
6. On success, the result image is saved and applied to the row.
7. On close/reopen, unfinished tasks cannot be recovered.

## Proposed Data Model

Create a generalized generation task target:

```ts
export type CanvasGenerationTarget =
  | {
      type: "imageGenerator";
      nodeId: string;
    }
  | {
      type: "actionFissionRow";
      nodeId: string;
      rowId: string;
    };
```

Extend `CanvasGenerationTask`:

```ts
export interface CanvasGenerationTask {
  id: string;
  canvasId: string;
  target: CanvasGenerationTarget;
  kind: "image";
  providerId: string;
  model: string;
  upstreamTaskId?: string;
  status: "submitting" | "running" | "succeeded" | "failed" | "interrupted" | "superseded";
  startedAt: number;
  updatedAt: number;
  prompt?: string;
  referenceImages?: string[];
  resolution?: "1k" | "2k" | "4k";
  aspectRatio?: string;
  error?: string;
  result?: {
    url?: string;
    localUrl?: string;
    fileName?: string;
    width?: number;
    height?: number;
  };
}
```

Compatibility note:

- Existing image node tasks currently store `nodeId` directly on the task.
- Migration can derive `target: { type: "imageGenerator", nodeId: task.nodeId }` for old tasks.

## Storage Strategy

First implementation:

- Add a local backend task registry exposed to renderer through Electron APIs.
- Renderer creates a local generation task through the local backend before provider submission.
- The local backend returns a local task ID immediately.
- Renderer stores a lightweight `generationTask` reference on the image node or action fission row.
- The local backend submits to the provider, records `upstreamTaskId` as soon as it is available, polls provider status, and stores result/error.
- When the provider succeeds, the local backend should save the output image into `CanvasAssests/output` as soon as possible.
- The task result should keep the cloud URL when available and also keep the saved local image URL as fallback.
- Renderer polls the local task ID and applies completed results/errors to the correct target.
- Renderer acknowledges successful canvas write-back to the local backend.
- The local backend removes terminal registry records only after receiving that write-back acknowledgement.
- Keep only the latest task per target in canvas node/row state.

Recommended later implementation:

- Move tasks into a canvas-level `generationTasks` collection keyed by task ID.
- UI targets then reference task IDs instead of embedding full task objects.
- This makes task lifecycle management cleaner, especially for batch operations.

Local backend task interface:

- `createGenerationTask(payload) -> { taskId, status }`
- `getGenerationTask(taskId) -> task`
- `stopGenerationTask(taskId) -> task`
- `ackGenerationTaskWriteback(taskId, target, canvasVersion?) -> task`
- `resumeGenerationTasks() -> void` or automatic startup recovery.

Storage requirement:

- Unlike `Infinite-Canvas-main`, the Forart local task registry should be persisted to disk, not only kept in memory.
- Store it at `D:\coding\Forart\CanvasAssests\tasks\generation-task-registry.json`.
- This avoids losing local task IDs when the app restarts.
- If a local task record still disappears but `upstreamTaskId` exists in the node/row task reference, renderer can fall back to provider task recovery.

## Local Task Registry Lifecycle

The local task registry is the source of truth while a generation task is active. It allows tasks to continue while the app is running even if the user switches canvas tabs, leaves the canvas page, or the target node is not mounted in the current UI.

The registry does not make tasks continue after the entire app/local backend process exits. After restart, recovery depends on persisted local registry records and/or `upstreamTaskId`.

Lifecycle:

1. Create a persisted local registry record before provider submission.
2. Store the local task ID on the target node/row immediately.
3. Submit to the provider from the local backend.
4. Persist `upstreamTaskId` immediately when the provider returns it.
5. Poll provider status from the local backend while the app/backend is running.
6. When the provider reaches a terminal state, mark the local registry task as `succeeded`, `failed`, or `interrupted`.
7. Renderer/task manager writes the terminal task state and result/error back to the target canvas JSON.
8. Renderer sends `ackGenerationTaskWriteback` after the canvas JSON save succeeds.
9. Local backend removes the terminal registry record only after the write-back ack.

Ack rule:

- A registry record may be cleaned only when the target canvas JSON contains the latest terminal task metadata and result/error.
- If write-back fails, keep the terminal registry record so the renderer can retry write-back later.
- If the target canvas is not currently active, write-back must patch the offscreen canvas JSON by `canvasId`.
- If the target node/row no longer exists, mark the registry record `orphaned` or keep it for a short diagnostic TTL instead of deleting it silently.

Recommended registry states:

```ts
type LocalGenerationTaskStatus =
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
```

`acked` is an internal cleanup state. Node/row `generationTask.status` should remain user-facing (`succeeded`, `failed`, `interrupted`, or `superseded`) rather than `acked`.

`superseded` means a newer task replaced this task for the same `canvasId + target`. It is treated as an interrupted terminal state and must not write its result back to the node/row if it later finishes upstream.

## Runtime State vs Persisted State

Persist:

- `generationTask`
- local task ID
- `upstreamTaskId`
- provider/model/prompt/reference/resolution/aspect ratio metadata
- succeeded/failed/interrupted terminal status
- superseded terminal status for tasks replaced by a retry
- final result fields (`url`, `resultUrl`, dimensions, file names)

Do not persist as source-of-truth UI state:

- `running`
- `runningAll`
- `status`
- `generationStatus`
- progress text such as "Generating: queued"

On load:

- Derive running UI from recoverable task status.
- If a task has `status: submitting | running` and `upstreamTaskId`, resume polling.
- If a task is `submitting` but has no `upstreamTaskId`, mark it interrupted or failed because the app cannot recover a provider task without an external ID.
- If a task has terminal status, do not show it as running.
- If a row/node has a result URL and a terminal succeeded task, render the result normally.

## Unified Runtime API

Add a task manager hook/module around the local backend task interface:

```ts
interface StartGenerationTaskInput {
  canvasId: string;
  target: CanvasGenerationTarget;
  providerId: string;
  model: string;
  prompt: string;
  referenceImages: string[];
  resolution: "1k" | "2k" | "4k";
  aspectRatio: string;
}

interface GenerationTaskRuntime {
  startTask(input: StartGenerationTaskInput): Promise<void>;
  stopTask(target: CanvasGenerationTarget): void;
  resumeTasks(nodes: CanvasNode[]): void;
  getTargetTask(target: CanvasGenerationTarget): CanvasGenerationTask | null;
}
```

The task manager owns:

- Local task creation.
- Local task polling.
- Abort controllers.
- Recovery dedupe.
- Result dispatch.
- Canvas JSON write-back acknowledgement.

The local backend owns:

- Provider submission.
- `upstreamTaskId` persistence.
- Provider polling.
- Output image download/save into `CanvasAssests/output`.
- Result/error persistence.
- Stop-local-waiting state.
- Terminal task retention until renderer write-back ack.
- Registry cleanup after ack.

Security note:

- The local registry should not persist API keys.
- Renderer passes a provider snapshot to the local backend when starting or resuming a task.
- On app restart, recovery still needs the current provider settings to query the upstream task by `upstreamTaskId`.

Feature components own:

- Building prompt/reference/model input.
- Rendering task state.
- Row/node selection and user interactions.

## Result Dispatch

Use target-specific applicators:

```ts
function applyGenerationResultToTarget(
  target: CanvasGenerationTarget,
  result: ImageGenerationResult,
  task: CanvasGenerationTask,
): Promise<void>;
```

For `imageGenerator`:

- Prefer the cloud result URL when it is still valid.
- Fall back to the saved local image URL from `CanvasAssests/output`.
- Update node `url`, `fileName`, dimensions, provider/model metadata.
- Mark task succeeded.
- Save the target canvas JSON.
- Ack the local registry task only after the canvas JSON save succeeds.

For `actionFissionRow`:

- Prefer the cloud result URL when it is still valid.
- Fall back to the saved local image URL from `CanvasAssests/output`.
- Update row `resultUrl`, `resultFileName`, dimensions.
- Mark row task succeeded.
- Clear transient row UI state.
- Save the target canvas JSON.
- Ack the local registry task only after the canvas JSON save succeeds.

## Recovery Flow

On app/canvas open:

1. Normalize legacy task shape.
2. Scan all canvas nodes:
   - `imageGenerator.generationTask`
   - `actionFission.rows[].generationTask`
3. Filter recoverable tasks:
   - status is `submitting` or `running`
   - has `canvasId`
   - has target
   - has `upstreamTaskId`
4. Dedupe by `canvasId + target + upstreamTaskId`.
5. Query local backend task state by local task ID.
6. If the local task is still active, start local task polling.
7. If the local task is missing but `upstreamTaskId` exists, recover directly by provider task ID and recreate/update local task state.
8. If provider polling succeeds, apply success/failure to the correct target.
9. If a local registry task is already terminal but not acked, retry canvas JSON write-back and then ack.

Recovery should be automatic for action fission rows. The UI should not ask for confirmation before polling.

If an unfinished task has no `upstreamTaskId`:

- Mark it `interrupted`.
- Show an `interrupted` message in the target node/row bottom status area.
- Do not show permanent running UI.

## Virtual Flow Check

### Normal success while staying on the same canvas

1. User starts an image node or action fission row task.
2. Backend creates a persisted registry record in `CanvasAssests\tasks\generation-task-registry.json`.
3. Renderer writes the local task ID to the target node/row.
4. Backend submits to provider and persists `upstreamTaskId` when available.
5. Backend polls until success.
6. Backend saves the output image into `CanvasAssests/output`.
7. Renderer receives terminal task state, writes result and latest task metadata to the active canvas JSON. It prefers the cloud URL and can fall back to the saved local URL.
8. Renderer sends write-back ack.
9. Backend cleans the registry record.

Expected result:

- No duplicate submit.
- Canvas JSON contains final result and latest task metadata.
- Registry does not retain completed work after successful ack.

### User switches canvas tabs while a task is running

1. Current canvas is saved and the global canvas document is replaced by another canvas.
2. Backend continues the task because it is independent from the active renderer canvas document.
3. When the task finishes, the task manager writes back by `canvasId`.
4. If the target canvas is not active, write-back patches the offscreen canvas JSON.
5. After save succeeds, renderer/backend ack clears the registry record.

Expected result:

- Task continues while Forart stays open.
- Result is written to the original canvas, not the currently visible canvas.
- Existing image-node `patchGenerationNode` behavior should be generalized for action fission rows.

### App exits after upstream task ID is known

1. Registry and target node/row both contain local task ID and `upstreamTaskId`.
2. App/backend stops, so no local polling continues while the app is closed.
3. On next startup, task recovery scans registry and/or node/row task metadata.
4. Provider polling resumes by `upstreamTaskId`.
5. Terminal result/error is written back and acked.

Expected result:

- No resubmit.
- Recovery depends on provider task query support and the persisted `upstreamTaskId`.

### App exits before upstream task ID is known

1. Registry has a local task in `queued` or `submitting`.
2. No `upstreamTaskId` exists.
3. On next startup, the task cannot be reliably recovered.
4. Mark target task `interrupted`, write the bottom status message, save canvas JSON, then ack/clean the registry record.

Expected result:

- No duplicate billing from automatic resubmit.
- User sees a clear interrupted state instead of a permanent running state.

### User clicks Stop

1. Backend stops local waiting/polling and marks task `interrupted`.
2. If provider cancellation is unavailable, the upstream cloud task may still continue outside Forart.
3. Renderer writes `interrupted` to the target node/row bottom status area.
4. Canvas JSON save succeeds, then ack clears the registry record.

Expected result:

- UI stops waiting immediately.
- The app does not claim the provider task was canceled unless a provider cancellation API is implemented.

### User retries the same target

1. User starts a new task for the same image node or action fission row.
2. Existing active task for the same `canvasId + target` is marked `interrupted/superseded`.
3. The new task is created and stored as the latest task metadata on that node/row.
4. If the older upstream task later succeeds, the task manager must ignore its result for node/row write-back.
5. The superseded old task can be acked/cleaned after the canvas JSON records that it is no longer the latest task for that target.

Expected result:

- Retrying does not allow an older result to overwrite a newer result.
- The UI shows the new task as the current task for the target.

### Provider returns direct image without upstream task ID

1. Backend receives final image immediately.
2. Backend saves the output image into `CanvasAssests/output`.
3. Task goes directly to `succeeded`.
4. Renderer writes result to node/row and saves canvas JSON.
5. Ack clears registry.

Expected result:

- No recovery issue because there is no unfinished upstream task.

### Provider fails

1. Backend marks task `failed` with error.
2. Renderer writes failed task metadata and bottom error/status message to the target.
3. Canvas JSON save succeeds, then ack clears registry.

Expected result:

- Retry replaces the latest task metadata for that target.
- No batch ID is needed; row states derive the aggregate footer state.

### Canvas write-back fails after terminal provider result

1. Backend has terminal result/error.
2. Renderer cannot save the target canvas JSON.
3. Registry keeps the task as `writeback_pending` or `writeback_failed`.
4. On renderer restart, canvas open, or task manager resume, write-back is retried.
5. Only after save succeeds does ack clear the registry record.

Expected result:

- Completed results are not lost just because disk write-back failed once.
- Registry can accumulate stuck terminal records if write-back keeps failing, so a diagnostic TTL or orphan handling is needed.

### Target node or row was deleted before task finishes

1. Backend reaches terminal state.
2. Write-back cannot find `canvasId + nodeId` or `rowId`.
3. Mark registry task `orphaned`.
4. Keep it for a short diagnostic TTL, then clean it.

Expected result:

- No silent write to the wrong target.
- User should not see stale running UI because the target no longer exists.

## Remaining Risks and Implementation Notes

- The task manager needs a generic offscreen canvas patcher, not only the current image-node `patchGenerationNode` path.
- Active-canvas writes and offscreen writes must both go through the same save/ack rule.
- Registry file writes should be atomic enough for crash safety: write temp file, then rename over `generation-task-registry.json`.
- Task dedupe should use `canvasId + target + upstreamTaskId` when available, otherwise local task ID.
- If a user retries while an older task for the same row/node is still running, the implementation must stop or supersede the older local task before starting the replacement.
- Superseded tasks must be prevented from writing stale results back to the canvas even if their upstream provider task later succeeds.
- Successful tasks should save output images to `CanvasAssests/output` before waiting for renderer write-back ack, because some cloud URLs may expire.
- Bottom status messages should derive from task state, not from persisted transient `status`/`running` fields.

## Batch Action Fission Behavior

`runningAll` and batch progress should become derived UI state, not persisted state.

Suggested derived values:

- `runningRows = rows.filter(row => isRecoverableOrRuntimeRunning(row.generationTask)).length`
- `pendingRows = rows.filter(row => task status is queued/submitting/running).length`
- `completedRows = rows.filter(row => task status is succeeded/failed/interrupted).length`
- Footer state can be derived from row tasks instead of a separate batch ID.

No `batchId` is required for the first implementation. It is acceptable to reconstruct the footer state by querying each row task.

Tradeoff:

- Without batch ID, we cannot distinguish "these four rows belonged to the same user click" after reopening.
- For current UX, that distinction is not required because the node can simply show each row's state and calculate aggregate counts.

## Failure Cases

### App closes after submit but before provider task ID is returned

With a persisted local backend task registry, this window is recoverable as long as the local backend task was created before the renderer closes.

Mitigation:

- Persist a local task immediately as `queued/submitting`.
- The local backend continues provider submission even if the renderer closes.
- If the whole app exits before provider submission returns and no `upstreamTaskId` was saved, mark the task as `interrupted`.
- Do not automatically resubmit after restart because that can cause duplicate generation and duplicate billing.
- Keep this window small by persisting `upstreamTaskId` immediately when returned.

Long-term ideal:

- A Forart backend/proxy creates a durable Forart job ID before submitting to the provider.
- The client can recover by Forart job ID even if provider task ID was not yet returned to the client.

### Provider returns direct image instead of task ID

Apply result immediately, mark task `succeeded`, write the result to canvas JSON, and ack the local registry task after the canvas save succeeds.

### Provider task fails

Persist failure status and error on the task. Write the failed task metadata/error to canvas JSON and ack the local registry task after the canvas save succeeds.

### User stops a task

Stop local waiting/polling and mark the local task as `interrupted`.

If provider cancellation API is unavailable:

- Mark local task as `interrupted`.
- Do not assume the cloud task is canceled.
- Write the interrupted task state back to canvas JSON.
- Ack the local registry task only after the canvas save succeeds.

UI wording:

- The internal behavior should be "stop tracking / stop waiting".
- The visible button text remains "Stop".
- The implementation must not treat this as guaranteed provider cancellation.

### Local backend task disappears

If a later backend task endpoint is introduced and returns 404 for a local task ID:

- If `upstreamTaskId` exists, fall back to direct provider task query.
- If no `upstreamTaskId` exists, mark the task as interrupted.

### Canvas write-back fails after task completion

If provider polling has already reached a terminal state but the canvas JSON cannot be saved:

- Keep the terminal task in the local registry as `writeback_failed` or `writeback_pending`.
- Do not clean the registry record.
- Retry write-back when the renderer starts, when the canvas is opened, or when the task manager resumes.
- If the target node/row no longer exists, mark the task `orphaned` and keep it for a short diagnostic TTL.

## Implementation Plan

### Phase 1: Shared Types and Local Backend Task Interface

1. Extend `CanvasGenerationTask` with `target`.
2. Add optional `generationTask` to `ActionFissionRow`.
3. Add compatibility helpers for old image node tasks.
4. Add a persisted local task registry in the Electron/main or local backend layer.
5. Expose create/get/stop task methods to the renderer.
6. Expose a write-back ack method so terminal registry tasks are cleaned only after canvas JSON save succeeds.
7. Update save sanitization so `generationTask` persists but transient UI does not.
8. Derive row/node running UI from task status where possible.

### Phase 2: Route Image Generation Node Through Local Tasks

1. Replace direct renderer provider submit with local backend task creation.
2. Store local task ID on `node.generationTask`.
3. Poll local task state from renderer.
4. Apply success/failure/interrupted to the image generation node.
5. Save the target canvas JSON and ack the local registry task after save success.

### Phase 3: Route Action Fission Rows Through Local Tasks

1. In `runActionFissionRow`, create a local row task before provider submit.
2. Store local task ID on `row.generationTask`.
3. Poll local task state from renderer.
4. Apply success/failure/interrupted to the row.
5. Save the target canvas JSON and ack the local registry task after save success.
6. Ensure row status messages derive from task state.

### Phase 4: Recovery for Both Targets

1. Add scanner for image-node and action-fission-row task references.
2. Query local backend task state by local task ID.
3. Recover provider task directly by `upstreamTaskId` if local task state is missing.
4. Apply recovered result back to the correct target.
5. Ensure reopening a canvas does not show stale running UI unless polling is active.
6. Automatically resume polling without prompting.
7. Retry unacked terminal task write-back before cleaning registry records.

### Phase 5: Unified Task Manager Cleanup

1. Extract common submit/poll/recover logic from `useImageGenerationActions`.
2. Route image node and action fission row generation through the shared manager.
3. Centralize abort controller handling and active task dedupe.

### Phase 6: Canvas-Level Task Store

Optional later refactor:

1. Add `generationTasks` at canvas level.
2. Store task IDs on nodes/rows.
3. Migrate embedded task objects into the task store.
4. Make task list inspectable for debugging and future queue UI.

## Open Questions

No open product decisions remain for the first implementation.
