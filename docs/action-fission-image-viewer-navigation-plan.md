# Action Fission Image Viewer Navigation Plan

## Goal

Extend the existing `ImageViewer` with optional gallery navigation and reusable viewer actions.

Action Fission must have two separate gallery modes:

- Result gallery: clicking a result image navigates only between rows with `resultUrl`.
- Action preview gallery: clicking an action preview navigates only between rows with `selectedActionAssetUrl`.

These modes must never mix. A viewer opened from a result image must not navigate into action preview images, and a viewer opened from an action preview must not navigate into generated results.

## Confirmed Decisions

1. Previous/next navigation wraps around: previous on the first image goes to the last image, next on the last image goes to the first image.
2. The counter is shown in the top-right.
3. Navigation is scoped to the current Action Fission node only.
4. Gallery order follows current row order.
5. If the current image disappears, close the viewer.
6. All `ImageViewer` usages should show the current image resolution beside the back button.
7. The top-left back button and resolution should be contained in one capsule.
8. Action Fission result previews should show a top-right "Rerun" button to the left of the counter.
9. Action Fission action preview galleries should show a top-right "Switch Action" button to the left of the counter.
10. Switching the current action while the action preview viewer is open should update the preview image for the same row only. It must not fall through to the next row's action preview if the current row's image changes or temporarily becomes unavailable.

## Current State

`ImageViewer` currently receives one image:

```tsx
<ImageViewer src={src} alt={alt} onClose={...} />
```

It already handles:

- Portal rendering
- Backdrop close
- Escape close
- Image preload
- Fit-to-viewport sizing
- Wheel zoom
- Drag pan

Action Fission currently opens previews in `CanvasPage.tsx`:

- `previewActionFissionResultStable(nodeId, row)` opens `row.resultUrl`.
- `previewActionFissionActionStable(nodeId, row)` opens `row.selectedActionAssetUrl`.
- Both write a lightweight `{ src, alt }` preview state.

Because the preview state stores only `src` and `alt`, the viewer cannot derive neighboring rows or preserve the distinction between result images and action preview images.

## ImageViewer API

Keep `ImageViewer` generic. It should know about gallery navigation and optional actions, but not Action Fission-specific row structures.

Suggested API:

```ts
interface ImageViewerNavigation {
  index: number;
  total: number;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
}

interface ImageViewerAction {
  id: string;
  label: string;
  icon: "refresh" | "shuffle";
  disabled?: boolean;
  onClick: () => void;
}

interface ImageViewerProps {
  src: string;
  alt: string;
  ariaLabel?: string;
  onClose: () => void;
  navigation?: ImageViewerNavigation;
  actions?: ImageViewerAction[];
}
```

Behavior:

- Render previous/next buttons only when `navigation.total > 1`.
- Previous/next always wrap around.
- `ArrowLeft` triggers previous when `navigation.total > 1`.
- `ArrowRight` triggers next when `navigation.total > 1`.
- `Escape` closes the viewer as it does today.
- Changing `src` resets zoom/pan because the existing `src`-keyed preload effect already resets transform state.
- Navigation and action buttons stop propagation so they do not trigger pan or backdrop close.

Use lucide icons:

- `ChevronLeft`
- `ChevronRight`
- `RefreshCw` for rerun
- `Shuffle` or `RefreshCw` for switch action; prefer `Shuffle` if available because it better communicates random replacement

## Top-Left Capsule

Replace the standalone top-left back button with a capsule containing:

```text
[Back icon]  1024 x 1536
```

Rules:

- Applies to every `ImageViewer` usage, not just Action Fission.
- Back icon keeps the existing close behavior.
- Resolution comes from the loaded image natural size.
- If image size is not ready yet, keep the capsule visible and hide or reserve the resolution text.
- The capsule should have a single shared surface so the back button and resolution read as one control group.

Suggested classes:

```css
.model-image-viewer-top-left
.model-image-viewer-back-button
.model-image-viewer-resolution
```

## Top-Right Controls

The top-right area contains optional action buttons and the counter.

Result gallery:

```text
[Refresh icon  Rerun] [3 / 8]
```

Action preview gallery:

```text
[Shuffle icon  Switch Action] [3 / 8]
```

Normal single image viewer:

- No counter.
- No rerun action unless another caller passes an action later.

The action button should support icon + text because these are explicit commands, not just passive controls.

Suggested classes:

```css
.model-image-viewer-top-right
.model-image-viewer-tool-button
.model-image-viewer-tool-button__label
.model-image-viewer-counter
```

## Previous / Next Buttons

Place the previous/next buttons in the viewer stage:

- Left button vertically centered near the left edge.
- Right button vertically centered near the right edge.
- Minimum hit area: 44px by 44px.
- Use translucent viewer surface, subtle border, and clear hover/focus state.
- Hide when there is only one image.
- No disabled boundary state is needed because navigation wraps around.

Suggested classes:

```css
.model-image-viewer-nav
.model-image-viewer-nav--previous
.model-image-viewer-nav--next
```

## Action Fission Preview State

Replace the raw image preview state with contextual state:

```ts
type ActionFissionPreviewMode = "result" | "action";

interface ActionFissionPreviewState {
  nodeId: string;
  rowId: string;
  mode: ActionFissionPreviewMode;
}
```

Open behavior:

- Clicking result image sets `{ nodeId, rowId, mode: "result" }`.
- Clicking action preview image sets `{ nodeId, rowId, mode: "action" }`.

This is the key guardrail that prevents result images and action preview images from mixing.

## Gallery Derivation

Derive the active gallery from current `nodes` during render.

For `mode: "result"`:

- Use current node's `actionFission.rows`.
- Keep rows with `row.resultUrl`.
- `src = row.resultUrl`.
- `alt = row.resultFileName || row.selectedActionName || fallback`.

For `mode: "action"`:

- Use current node's `actionFission.rows`.
- Keep rows with `row.selectedActionAssetUrl`.
- `src = resolveLibraryImageUrl(row.selectedActionAssetUrl)`.
- `alt = row.selectedActionName || fallback`.

If the current node, current row, or current image source is gone, close the viewer.

Navigation update:

```ts
const nextIndex = (index + 1) % items.length;
const previousIndex = (index - 1 + items.length) % items.length;
setActionFissionPreview({ ...preview, rowId: items[nextIndex].rowId });
```

## Top-Right Action Button

The top-right action is an optional `ImageViewer` action. The caller decides which action to pass based on the active preview mode.

### Result Mode: Rerun

- Label: `Rerun` / `重新运行`.
- Icon: `RefreshCw`.
- Show only in `mode: "result"`.
- Keep the viewer open after clicking rerun.
- Rerun the current row represented by `actionFissionPreview.rowId`.
- Disable rerun if the row is already active or cannot run.
- Reuse the same execution path as the row run button: `runActionFissionRow(nodeId, rowId, actions, tags)`.

### Action Mode: Switch Action

- Label: `Switch Action` / `更换动作`.
- Icon: prefer `Shuffle`; fallback to `RefreshCw` if `Shuffle` is not available.
- Show only in `mode: "action"`.
- Keep the viewer open after clicking switch.
- Select a new random action for the current row using the same rule as the row's refresh action.
- Reuse the existing selection path:

```ts
refreshActionFissionRow(nodeId, rowId, actions, tags)
```

Same-row preview update is feasible:

- The viewer state stays `{ nodeId, rowId, mode: "action" }`.
- `refreshActionFissionRow` patches the current row with a new `selectedActionId`, `selectedActionName`, `selectedActionPrompt`, and `selectedActionAssetUrl`.
- The gallery is derived from the latest `nodes`.
- When `selectedActionAssetUrl` changes, the derived current image `src` changes.
- `ImageViewer` already resets loading, pan, and zoom when `src` changes.

Important guardrail:

- The current displayed image must be resolved by `preview.rowId` first, not by the current numeric `index`.
- If the current row's `selectedActionAssetUrl` changes, update the viewer to that new image.
- If the current row loses its usable `selectedActionAssetUrl`, close the viewer or keep the previous image with an error state; do not show another row's image.
- Recommended implementation: close the viewer if the current row loses its image, because that matches the confirmed "image disappeared" rule and avoids stale previews.
- The action-mode switch command should choose only candidates with a usable `asset_url` when the viewer is open, so a successful switch normally updates to another image in the same row immediately.

Important implementation detail:

`runActionFissionRow` and `refreshActionFissionRow` both need row-specific `actions` and `tags`. Those are currently derived in `ActionFissionNodeBody` through `useActionFissionLibraryData(state)`, while the viewer is rendered in `CanvasPage.tsx`.

Implementation options:

- Option A: Recompute row library data in `CanvasPage.tsx` for the active preview row.
- Option B: Extract a shared helper from the Action Fission data layer so both the row component and `CanvasPage.tsx` can resolve row data without duplication.

Recommendation: Option B if extraction stays small. Use Option A only if helper extraction causes a larger refactor.

## Keyboard Behavior

Viewer key handling:

- `Escape`: close.
- `ArrowLeft`: previous image, wrapping from first to last.
- `ArrowRight`: next image, wrapping from last to first.

Only handle left/right when `navigation.total > 1`.

## Edge Cases

- Only one image in the current gallery: hide previous/next and counter.
- Current row is deleted: close viewer.
- Current row loses image source: close viewer.
- Current Action Fission node is deleted: close viewer.
- `resolveLibraryImageUrl` returns empty in action mode: skip that row.
- Result gallery never includes action preview images.
- Action preview gallery never includes result images.
- Gallery navigation may use a filtered `items` list, but the currently displayed item must remain row-anchored by `preview.rowId`.
- After Switch Action, never preserve the old numeric index and re-read `items[index]`; this is the bug pattern that would show the next row's preview.
- Rerun button is hidden in action preview mode.
- Switch Action button is hidden in result mode.
- Rerun button is disabled for active rows or rows without enough data to run.
- Switch Action button is disabled for active rows or rows without enough candidates.
- If Switch Action cannot find another eligible action with an image, keep the current row preview as-is and surface the same row error used by the row refresh action.

## Implementation Steps

1. Extend `ImageViewer` props with optional `navigation` and `actions`.
2. Import `ChevronLeft`, `ChevronRight`, and `RefreshCw` in `ImageViewer.tsx`.
3. Replace the standalone close button with the top-left capsule containing back and resolution.
4. Add top-right controls for optional actions and counter.
5. Add left/right navigation buttons with wrap-around behavior.
6. Add `ArrowLeft` / `ArrowRight` keyboard handling.
7. Add CSS for the capsule, resolution, top-right cluster, counter, tool button, and nav buttons.
8. Replace `actionFissionPreview` state in `CanvasPage.tsx` with `{ nodeId, rowId, mode }`.
9. Update result preview opener to set `mode: "result"`.
10. Update action preview opener to set `mode: "action"`.
11. Derive the current gallery from `nodes` and `actionFissionPreview`.
12. Wire navigation callbacks to update `rowId` with wrap-around.
13. Close the viewer when the derived gallery is missing.
14. Add "Rerun" action for result gallery.
15. Add "Switch Action" action for action preview gallery.
16. Ensure action preview source updates immediately after switching the current row action without changing `rowId`.
17. Ensure a missing current-row action image closes the viewer or keeps the same row with an error, never falls through to another row.
18. Resolve rerun/switch row data through an extracted helper or a narrow recomputation in `CanvasPage.tsx`.
19. Run `npm run build`.
