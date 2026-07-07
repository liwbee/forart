# Library Tag Color Plan

## Background

The resource library uses one shared tag table, `library_tags`, for model, outfit, and action libraries. Tags are scoped by `kind + project_id`, and the renderer shares tag UI through `renderer/src/features/library-tags`.

The first version should add a small, predictable color marker to tags without changing tag filtering semantics, tag names, sort order, or entry/tag relationships.

## Goals

- Add a preset color choice to project tags.
- Use exactly seven tag color values:
  - Default, stored as `default`, displayed as gray.
  - Red, stored as `red`, displayed as pink.
  - Yellow, stored as `yellow`, displayed as orange.
  - Brown, stored as `brown`, displayed as brown.
  - Blue, stored as `blue`, displayed as sky blue.
  - Green, stored as `green`, displayed as light green.
  - Purple, stored as `purple`, displayed as purple.
- Show the tag color as a circular dot marker on each tag chip.
- The dot must have a 2px outer stroke.
- Existing databases that do not have a tag color column must be backfilled with the default color.
- Keep local IPC mode and remote HTTP mode behavior consistent.

## Non-Goals

- Do not add free-form color picking in the first version.
- Do not store raw arbitrary hex values in tag records.
- Do not use tag color as the only indicator of selection, inclusion, or exclusion.
- Do not move tag color onto `library_entry_tags`; color belongs to the tag itself.
- Do not change current tag filtering behavior.
- Do not change existing import or bulk tag rules beyond preserving tag color data returned by tag APIs.

## Data Model

Add `color` to `library_tags`:

```sql
color TEXT NOT NULL DEFAULT 'default'
```

Allowed values:

```ts
type LibraryTagColor = "default" | "red" | "yellow" | "brown" | "blue" | "green" | "purple";
```

Use these stable English enum keys as the only persisted values. Do not persist Chinese labels or raw CSS colors.

Rationale:

- English enum keys are stable across UI languages.
- They decouple storage from the actual display color. For example, `red` can intentionally render as pink.
- They are safer than raw hex values because the renderer can control contrast and theme-specific display.

The backend should validate incoming values. Unknown, empty, or missing values should resolve to `default`.

## Migration And Backfill

Both database initialization paths need the same migration:

- `server/src/library/library-runtime.mjs`
- `server/forart-server.mjs`

Migration behavior:

1. Read `PRAGMA table_info(library_tags)`.
2. If `color` is missing, run:

   ```sql
   ALTER TABLE library_tags ADD COLUMN color TEXT NOT NULL DEFAULT 'default';
   ```

3. Normalize old or invalid values defensively:

   ```sql
   UPDATE library_tags
   SET color = 'default'
   WHERE color IS NULL
      OR color = ''
      OR color NOT IN ('default', 'red', 'yellow', 'brown', 'blue', 'green', 'purple');
   ```

This makes old databases safe without requiring a separate migration file.

## Backend API Changes

Update tag create and update handlers for all three services:

- `server/src/library/model-library-service.mjs`
- `server/src/library/outfit-library-service.mjs`
- `server/src/library/action-library-service.mjs`
- Matching legacy routes in `server/forart-server.mjs`, if they are still shipped.

Create tag:

- New tags start as `default`.
- If an unexpected `color` is present, validate it and fall back to `default` when invalid.
- Insert `color` with the tag row.

Update tag:

- Accept optional `color`.
- If present, validate and update it.
- Keep existing partial update behavior for `name` and `sort_order`.

List tag:

- Existing `SELECT *` will return `color` after the column exists.
- Returned tag objects should always include `color`; old defensive fallback can map missing values to `default` if needed.

## Renderer Type Changes

Add a shared color type under `renderer/src/features/library-tags`, then use it in:

- `renderer/src/features/model-library/types.ts`
- `renderer/src/features/outfit-library/types.ts`
- `renderer/src/features/action-library/types.ts`
- `renderer/src/features/library-tags/LibraryTagManagerDialog.tsx`
- `renderer/src/features/library-tags/LibraryTagChoiceButton.tsx`
- `renderer/src/features/library-tags/LibraryTagFilterButton.tsx`

Example:

```ts
export type LibraryTagColor = "default" | "red" | "yellow" | "brown" | "blue" | "green" | "purple";

export interface LibraryTagColorLike {
  color?: LibraryTagColor | string | null;
}
```

Recommended shared helpers:

```ts
export const LIBRARY_TAG_COLORS = ["default", "red", "yellow", "brown", "blue", "green", "purple"] as const;

export function normalizeLibraryTagColor(value: unknown): LibraryTagColor {
  return LIBRARY_TAG_COLORS.includes(value as LibraryTagColor) ? value as LibraryTagColor : "default";
}

export function createLibraryTagsByName<TTag extends { name: string; color?: string | null }>(tags: readonly TTag[]) {
  return new Map(tags.map((tag) => [tag.name, { ...tag, color: normalizeLibraryTagColor(tag.color) }]));
}
```

Each concrete tag interface should include:

```ts
color: LibraryTagColor;
```

## Renderer API Changes

Update tag API helpers to include color:

- `createModelTag(projectId, name, color?)`
- `updateModelTag(projectId, tagId, payload)` where payload can include `color`
- Same for outfit and action libraries.

If the new tag form does not choose a color, it should create the tag with `default`.

## UI Behavior

### Tag Manager

In `LibraryTagManagerDialog`:

- Tag list chips show a color dot marker.
- Floating drag chip also shows the dot.
- The selected tag editor includes a preset color row below the name editor.
- Each color option is shown as a circular swatch button.
- Selecting a swatch saves the active tag color immediately via `onUpdateTagColor` or through a unified `onUpdateTag`.
- If the immediate save fails, revert the visible swatch to the previous color without showing an extra error message.
- Keep rename, delete, and drag sort behavior unchanged.

Suggested prop addition:

```ts
onChangeTagColor: (tagId: string, color: LibraryTagColor) => void;
```

### Tag Chips And Menus

Add the same dot marker in:

- `LibraryTagChoiceButton`
- `LibraryTagFilterButton`
- Tag manager list chips
- Action fission tag selectors if they render project tags directly
- Card tag chips and any other existing tag surface
- Bulk add/remove tag dialogs

The dot should not replace current include/exclude styles. Include and exclude states remain border/shadow/text-decoration states.

## Visual Design

Use semantic CSS classes or data attributes rather than inline raw colors in components.

Suggested class structure:

```tsx
<span className={`library-tag-color-dot library-tag-color-dot--${color}`} aria-hidden="true" />
```

Dot requirements:

- Diameter: 10px to 12px.
- Border radius: 999px.
- Outer stroke: 2px.
- The outer stroke should be a fixed neutral stroke.
- The outer stroke should remain visible on light and dark themes.
- The dot should always be visible.
- To avoid increasing tag width, render the dot as an upper-left corner badge on chip-like tags rather than as an inline element before the text.
- The dot is decorative, so it should use `aria-hidden="true"`.

Suggested implementation:

```tsx
<span className={`library-tag-color-dot library-tag-color-dot--${color}`} aria-hidden="true" />
```

For chip-like containers:

```css
.library-tag-chip-with-color {
  position: relative;
}

.library-tag-color-dot {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--tag-dot-stroke);
  border-radius: 999px;
  pointer-events: none;
}
```

Implementation detail: existing tag buttons often use `overflow: hidden` for text ellipsis. The dot should stay inside the chip bounds, near the upper-left corner, so it is not clipped and does not require extra horizontal padding.

Suggested visual mapping:

| Stored value | User label | Display color intent |
| --- | --- | --- |
| `default` | 默认色 | gray |
| `red` | 红色 | pink |
| `yellow` | 黄色 | orange |
| `brown` | 棕色 | brown |
| `blue` | 蓝色 | sky blue |
| `green` | 绿色 | light green |
| `purple` | 紫色 | purple |

Exact CSS tokens can be tuned during implementation, but they should be readable on both light and dark surfaces.

Define both light and dark theme values in the first implementation. Do not rely on one theme automatically working in the other.

The color names do not need to be displayed as visible UI text in the first version. Swatch buttons should still have accessible labels/title text if they are interactive controls.

## Architecture Notes

### Keep tag color separate from entry tag names

Current entries store tag membership as `tags: string[]`, where each item is a tag name. Do not change entry payloads to nested tag objects just for color. That would widen the API change and touch filtering, bulk operations, imports, and action fission logic.

Instead, keep entry membership as tag names and resolve visual metadata in the renderer:

- Query project tags as usual.
- Build `tagsByName` from the project tag list.
- When rendering an entry tag name, look up `tagsByName.get(tagName)?.color`.
- If not found, render `default`.

This keeps tag color as a project tag property while preserving existing entry update payloads.

### Add one shared visual primitive

Create a shared `LibraryTagColorDot` or `LibraryTagLabel` component under `renderer/src/features/library-tags`.

Recommended split:

- `LibraryTagColorDot`: renders only the decorative dot from a color value.
- `LibraryTagLabel`: renders tag name plus the corner dot wrapper and can be reused inside buttons/chips.

This avoids duplicating color normalization and CSS class construction across model, outfit, action, bulk dialogs, filter menus, and action fission UI.

Because the dot is an overlay badge, the shared component should not force additional inline spacing. Components that need text ellipsis should keep the label text as its own child and add `position: relative` to the chip/button container.

### Keep backend service boundaries intact

The project currently keeps model, outfit, and action services separate. Do not merge those services for this feature.

Accept the small repeated changes in each service:

- validate color
- insert color
- update color

If duplication becomes noisy, extract only tiny pure helpers such as `normalizeLibraryTagColor` into a shared server module. Avoid a broad generic tag service refactor in this change.

### Treat `server/forart-server.mjs` as a compatibility surface

There are newer service modules under `server/src/library`, plus a larger `server/forart-server.mjs`. The color schema and tag CRUD behavior should stay aligned in both surfaces if both are still packaged or reachable.

### Optimistic UI behavior

For immediate swatch saves:

- Either rely on the mutation result and query invalidation, or apply a narrow optimistic update to the current tag query.
- On failure, revert to the previous cached color.
- Do not show a new error toast/message for color save failure in the first version.

This should be scoped to color changes only; do not alter existing name/sort/delete error behavior.

## Implementation Steps

1. Add shared tag color helpers and constants in `renderer/src/features/library-tags`.
2. Add `color` to tag TypeScript interfaces and API payload types.
3. Add database migration/backfill in both DB initialization paths.
4. Update model/outfit/action tag services to create and update `color`.
5. Update local IPC/HTTP behavior through existing tag routes.
6. Update `LibraryTagManagerDialog` with color dots and the color swatch row.
7. Update shared tag filter/choice components to show corner color dots.
8. Wire all three resource library pages to pass `color` when creating/updating tags.
9. Run typecheck/build and manually verify model, outfit, and action libraries.

## Verification

Minimum checks:

- Open an existing database without `library_tags.color`; app starts and old tags show default gray dots.
- Create a model tag without choosing a color; it gets `default`.
- Change a model tag color; it persists after reload.
- Repeat color changes for outfit and action tags.
- Force or simulate a failed color update; the visible swatch returns to the previous color without a new error message.
- Rename, delete, reorder, include filter, exclude filter, and untagged filter still work.
- Tag dots appear left of the tag name in tag manager, filter menus, and tag choice chips.
- Tag dots appear left of the tag name on card tag chips and action fission tag selectors.
- Tag dots appear in bulk add/remove tag dialogs.
- Tag dots remain visible on narrow chips without increasing chip width.
- Light and dark theme dot colors and neutral strokes are both defined.
- Include/exclude visual states remain distinguishable without relying on color alone.
- Build passes with `npm run build`.

## Confirmed Decisions

1. New tags start as default gray.
2. Clicking a swatch saves immediately.
3. Color names do not need visible display labels.
4. The color dot should appear on every tag surface.
5. Unexpected auto-created/import-created tags fall back to `default`.
6. Failed immediate color saves revert the UI without a new error message.
7. The dot uses a fixed neutral 2px outer stroke.
8. Bulk add/remove tag dialogs also show the color dot.
9. The color swatch row lives only in the tag manager selected-tag editor, below the name editor.
10. Light and dark theme values should both be defined in the first implementation.
11. The dot should always be visible.
12. To reduce tag width, the dot should be implemented as an upper-left corner badge on chip-like tags instead of an inline prefix.

## Questions To Confirm

No open product decisions remain for the first version.
