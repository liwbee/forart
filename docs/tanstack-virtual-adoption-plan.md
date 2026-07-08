# TanStack Virtual Adoption Plan

## Context

The project now includes `@tanstack/react-virtual`. It should replace hand-written list virtualization first, then be applied selectively to high-volume resource grids and maintenance lists.

TanStack Virtual is a headless virtualizer. It handles scroll ranges, item measurement, overscan, and scroll APIs, but it does not provide markup or layout. For grids, this means we usually virtualize rows, not individual cards.

## Current Fix Already Applied

- `ActionFolderImportDialog` now uses `useVirtualizer` instead of local `scrollTop`, viewport height, and manual `translateY` calculations.
- The Electron action folder import preview is registered before progressive row batches are emitted. This prevents first-visible images from requesting `forart-asset://action-folder-import-preview/...` before the resolver knows the active preview.

## Priority 1: Replace Existing Hand-Written Virtualization

### Action Folder Import Dialog

File:

- `renderer/src/features/action-library/ActionFolderImportDialog.tsx`

Status:

- Done for the virtualizer replacement.
- Done for the preview registration race fix.

Why it fits:

- Fixed row height.
- Single scroll container.
- Row count can grow with folder size.
- It previously duplicated virtual list mechanics manually.

Follow-up checks:

- Load a folder with hundreds of image/text pairs.
- Confirm the first visible thumbnail renders without scrolling away and back.
- Search while scrolled down and confirm the list returns to top.
- Import a selected subset and confirm live row status remains aligned with rows.

### Image Review Page

File:

- `renderer/src/features/image-review/ImageReviewPage.tsx`

Current code:

- Local `useVirtualWindow`.
- Virtualized product list.
- Virtualized horizontal thumbnail strip.

Recommended change:

- Replace `useVirtualWindow` with two `useVirtualizer` instances:
  - vertical or horizontal product list, depending on responsive layout
  - horizontal thumbnail strip
- Keep `scrollVirtualItemIntoView` behavior by replacing it with `virtualizer.scrollToIndex(index, { align: "auto" })`.

Risk:

- Product list switches between vertical and horizontal layout based on CSS.
- Keyboard/image navigation depends on scroll alignment.

Validation:

- Large product folder.
- Resize between desktop and narrow layouts.
- Arrow navigation across product list and thumbnail strip.
- Momentum wheel behavior on thumbnails.

## Priority 2: High-Volume Resource Grids

These pages render full image card grids with `.map()`. They already use `content-visibility: auto`, which helps paint cost, but React still mounts every card. TanStack Virtual can reduce mounted components and image elements.

### Action Library Grid

File:

- `renderer/src/features/action-library/ActionLibraryPage.tsx`

Current code:

- `ActionGrid` renders `actions.map(...)`.
- Uses `.outfit-grid` style with responsive `auto-fill` columns.
- Has an add card before real action cards when not in selection mode.

Recommended change:

- Create a reusable `VirtualLibraryGrid` for square-ish card grids.
- Measure grid width with `ResizeObserver`.
- Compute column count from available width and active card width.
- Convert cards into virtual rows:
  - row index -> slice of N cards
  - estimated row height -> card width plus grid gap
- Include the add card as the first item only when not in selection mode.

Risk:

- Selection mode changes item indexing because the add card disappears.
- Drag/drop overlay from `LibraryImageDropZone` must still cover the full scroll area.
- Card size slider changes column count and row height.

Validation:

- Change card size while scrolled.
- Search/tag filter while scrolled.
- Enter/exit selection mode.
- Create/delete/rename action.
- Drag image into the drop zone.

### Outfit Library Grid

File:

- `renderer/src/features/outfit-library/OutfitLibraryPage.tsx`

Current code:

- `OutfitGrid` renders `outfits.map(...)`.
- Layout is similar to action library and simpler than model library.

Recommended change:

- Reuse the same `VirtualLibraryGrid`.
- Treat add card as first item when not in selection mode.

Risk:

- Similar to action library, but without inline rename/prompt editor complexity.

Validation:

- Card size slider.
- Tag filtering.
- Selection mode.
- Create/delete outfit.
- Drag/drop upload.

### Model Library Grid

File:

- `renderer/src/features/model-library/ModelLibraryPage.tsx`

Current code:

- `ModelGrid` renders `models.map(...)`.
- It inserts `model-inline-editor` after the row containing the open model.
- It computes column count from the CSS grid.

Recommended change:

- Defer until action/outfit virtual grids are stable.
- Model grid needs a custom virtual row model:
  - normal rows contain model cards
  - the open editor becomes a full-width virtual row after the card row
- Keep the existing column count measurement.

Risk:

- Inline editor height is dynamic.
- Opening a model changes virtual row structure.
- Uploading/deleting model images changes editor content height.
- Scroll-to-open-editor behavior must be preserved.

Validation:

- Open editor in each column position.
- Upload multiple images inside editor.
- Delete/set cover image.
- Rename model.
- Change card size while editor is open.

## Priority 3: Picker and Maintenance Lists

### Library Asset Picker

File:

- `renderer/src/features/library-asset-picker/LibraryAssetPickerContent.tsx`

Current code:

- `picker.activeItems.map(...)` in a responsive image grid.
- Model image choices also map all images.

Recommended change:

- Reuse `VirtualLibraryGrid` with smaller card dimensions.
- Apply to:
  - main picker grid
  - model choice grid
- For the rail variant, verify popover positioning because virtual rows change mounted elements.

Risk:

- Rail variant positions choices relative to clicked item.
- Model choices popover can be open while main grid changes.

Validation:

- Open picker from canvas.
- Switch tabs.
- Switch projects.
- Apply tag/gender filters.
- Open model choices from dialog and rail variants.

### Settings Cache List

File:

- `renderer/src/features/settings/SettingsPage.tsx`

Current code:

- `filteredCacheAssets.map(...)`.

Recommended change:

- Use a simple vertical `useVirtualizer`.
- Fixed or estimated row height is enough.
- Keep bulk selection based on `filteredCacheAssets`, not visible rows.

Risk:

- Rows include image thumbnails and variable reference text.
- Selection count must include filtered rows, not mounted rows.

Validation:

- Scan a large cache.
- Select visible cleanable assets.
- Filter by kind/status/canvas.
- Delete a single row and bulk rows.

### Settings Fetched Model Picker

File:

- `renderer/src/features/settings/SettingsPage.tsx`

Current code:

- `filteredFetchedModels.map(...)`.

Recommended change:

- Use a fixed-height vertical virtualizer.

Risk:

- Each row contains a portaled `Select`; make sure menu placement still works for virtualized rows.

Validation:

- Fetch a provider with many models.
- Search/filter model types.
- Open row select menus near top and bottom.
- Select visible/clear visible.

## Usually Not Worth Virtualizing

### Infinite Canvas Main Stage

Files:

- `renderer/src/features/infinite-canvas/CanvasPage.tsx`
- `renderer/src/features/infinite-canvas/layers/NodeLayer.tsx`
- `renderer/src/features/infinite-canvas/layers/ConnectionLayer.tsx`
- `renderer/src/features/infinite-canvas/layers/GroupLayer.tsx`

Reason:

- The canvas already does spatial culling by viewport bounds.
- TanStack Virtual solves list/grid scrolling, not arbitrary 2D canvas space.

Possible future work:

- Improve spatial indexing if node count becomes very high.
- Keep visible activity nodes forced into the render set.

### Small Project, Tag, and Menu Lists

Files:

- `renderer/src/features/library-layout/LibraryProjectSidebar.tsx`
- `renderer/src/features/library-tags/LibraryTagManagerDialog.tsx`
- small tag filter and menu components

Reason:

- Usually low item count.
- Drag/reorder relies on measuring all rendered row rects.
- Virtualizing these adds more complexity than performance benefit.

## Shared Components to Add

### `VirtualList`

Suggested path:

- `renderer/src/components/virtual/VirtualList.tsx`

Purpose:

- Fixed/estimated-height vertical lists.
- Used by action folder import, settings cache list, fetched model picker, and possibly project-like long lists if needed.

Core props:

- `items`
- `estimateSize`
- `overscan`
- `getItemKey`
- `renderItem`
- `className`
- `ariaLabel`

### `VirtualLibraryGrid`

Suggested path:

- `renderer/src/features/resource-library/VirtualLibraryGrid.tsx`

Purpose:

- Responsive card grids backed by row virtualization.
- Reused by action, outfit, model, and picker grids where practical.

Core responsibilities:

- Measure container width.
- Resolve column count.
- Group items into virtual rows.
- Preserve grid gap and card size presets.
- Allow special leading item such as add card.
- Expose a full-width row hook for model inline editor.

## Rollout Order

1. Finish and manually verify action folder import.
2. Replace image review page `useVirtualWindow`.
3. Build `VirtualLibraryGrid` and migrate action library.
4. Migrate outfit library.
5. Migrate library asset picker.
6. Migrate settings cache list and fetched model picker.
7. Migrate model library after the grid abstraction supports full-width inline editor rows.

## General Validation Checklist

- Build passes with `npm run build`.
- Scroll positions remain stable while filtering/searching.
- Images do not request broken preview URLs because of stale or premature `src` values.
- Keyboard navigation still scrolls active items into view.
- Portaled menus still anchor correctly.
- Selection and bulk actions operate on the full filtered dataset, not just visible rows.
- Card size changes recompute virtual row height and column count.
