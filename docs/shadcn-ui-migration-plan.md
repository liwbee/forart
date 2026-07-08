# Shadcn UI Migration Plan

## Goal

Forart should progressively move from mostly hand-written UI primitives and feature CSS toward a shadcn/ui based component system.

The target is not to make every screen look like the default shadcn demo. The target is:

- Use shadcn/ui and Radix primitives for common controls, overlays, menus, forms, tabs, and feedback.
- Keep Forart's product-specific interaction model, especially canvas, library grids, virtualized lists, and Electron window behavior.
- Reduce one-off CSS by moving shared visual decisions into theme tokens and reusable components.
- Allow a small set of custom components where the product really needs domain-specific behavior.

## Current UI Shape

The renderer is a Vite + React + TypeScript app under `renderer/src`. The current UI system is mostly:

- Global tokens and base styles in `renderer/src/styles/global.css`.
- Shared component styles in `renderer/src/styles/components.css`.
- Feature-level CSS files such as `library-layout.css`, `image-review.css`, `free-canvas.css`, and `infinite-canvas.css`.
- A few hand-written shared components in `renderer/src/components`, such as `Select`, `SizePresetPicker`, `LazyImage`, and `ErrorCopyLine`.
- Many feature components that directly render native `button`, `input`, `textarea`, menus, dialogs, and portal overlays.

The existing token system is already valuable. It defines light/dark surfaces, text colors, borders, accent colors, radii, spacing, focus states, disabled states, and shadows. The shadcn migration should bridge to this system first, then gradually rename or replace it after the new architecture has proven stable.

## Official Shadcn Baseline

The current shadcn Vite installation path expects:

- Tailwind CSS and `@tailwindcss/vite`.
- A Vite alias such as `@` pointing to the source directory.
- `components.json` configured with CSS variables enabled.
- Components added on demand with the shadcn CLI.

References:

- <https://ui.shadcn.com/docs/installation/vite>
- <https://ui.shadcn.com/docs/theming>

For Forart, the alias should point to `renderer/src`, not a root-level `src`.

## Architecture Direction

### Directory Layout

Use a layered structure:

```text
renderer/src/
  components/
    ui/                  # shadcn generated primitives, lightly edited only when needed
    forart/              # product-level components built from shadcn primitives
    Select.tsx           # legacy shared components during migration
    SizePresetPicker.tsx # legacy shared components during migration
  styles/
    global.css           # existing app tokens, reset, layout base
    shadcn.css           # shadcn token bridge and Tailwind theme mapping
    components.css       # legacy shared styles, shrinks over time
  lib/
    utils.ts             # cn() helper used by shadcn
```

`components/ui` should remain close to shadcn output. Avoid putting business logic there. If a component needs Forart-specific behavior, wrap it in `components/forart`.

Examples:

- `components/ui/button.tsx`: base shadcn Button.
- `components/forart/IconButton.tsx`: standard icon-only button with tooltip, aria-label, size, and app-specific density.
- `components/forart/ConfirmDialog.tsx`: Forart destructive confirmation pattern built on shadcn Dialog or AlertDialog.
- `components/forart/StatusBadge.tsx`: app status badge variants using shadcn Badge.
- `components/forart/AppTabs.tsx`: consistent tab style for settings, resource library, and dialogs.

### Token Strategy

Use shadcn CSS variable mode as the target theme direction. The initial migration should not force shadcn to imitate the current Forart visual system, because the desired end state is closer to shadcn's default light/dark feel than the current hand-written theme.

The bridge should therefore run in the other direction:

- Define the shadcn semantic variables with the preferred shadcn theme values.
- Map the existing Forart variables to those shadcn variables where practical.
- Keep any Forart-only variables that describe product-specific states, canvas behavior, or legacy layout until the owning surface migrates.

Example direction:

```css
:root {
  /* shadcn target tokens */
  --background: oklch(...);
  --foreground: oklch(...);
  --card: oklch(...);
  --card-foreground: var(--foreground);
  --popover: var(--card);
  --popover-foreground: var(--foreground);
  --primary: oklch(...);
  --primary-foreground: oklch(...);
  --secondary: oklch(...);
  --secondary-foreground: var(--foreground);
  --muted: oklch(...);
  --muted-foreground: oklch(...);
  --accent: oklch(...);
  --accent-foreground: var(--foreground);
  --destructive: oklch(...);
  --border: oklch(...);
  --input: oklch(...);
  --ring: oklch(...);
  --radius: 0.625rem;

  /* legacy Forart compatibility tokens */
  --surface-app: var(--background);
  --surface-panel: var(--card);
  --surface-card: var(--card);
  --surface-card-muted: var(--muted);
  --surface-control: var(--background);
  --text-primary: var(--foreground);
  --text-secondary: var(--muted-foreground);
  --text-muted: var(--muted-foreground);
  --border-subtle: var(--border);
  --border-strong: var(--ring);
  --accent-strong: var(--primary-foreground);
  --danger: var(--destructive);
}
```

The current app uses `:root.theme-dark` for dark mode. shadcn commonly uses `.dark`. During the first phase, support both selectors:

```css
:root.theme-dark,
.dark {
  /* same shadcn dark token overrides and legacy compatibility mapping */
}
```

After the migration is stable, decide whether to keep `theme-dark`, switch to `dark`, or make the app store apply both classes. During the spike, applying both classes is acceptable if it reduces compatibility risk.

### Tailwind and Preflight Strategy

Tailwind preflight can affect global defaults for `button`, `input`, `select`, `textarea`, `img`, headings, lists, and body. Forart already has many global styles for those elements.

Use a conservative rollout:

1. Add Tailwind and shadcn in a small branch.
2. Keep existing `global.css` import order stable.
3. Add shadcn/Tailwind CSS in a dedicated file and verify which base rules change visual output.
4. If preflight causes widespread regressions, either isolate the import order carefully or disable/neutralize specific base effects through Forart's base layer.

Do not convert feature CSS to Tailwind utilities immediately. The first goal is component infrastructure and theme compatibility, not a styling rewrite.

### Component Ownership Rules

Use shadcn primitives for:

- Button, Input, Textarea, Label, Checkbox, Switch.
- Dialog, AlertDialog, DropdownMenu, Popover, Tooltip.
- Tabs, Badge, Separator, Progress, Skeleton.
- Select/Command/Combobox when keyboard behavior matters.
- ScrollArea where native scroll styling is not enough.

Keep or custom-build Forart components for:

- Canvas nodes, canvas toolbar mechanics, selection layer, resize handles, minimap, connection layer.
- Virtualized library grids and rows.
- Image viewers and image-heavy inspection surfaces.
- Size and aspect-ratio pickers if the current interaction remains more domain-specific than a generic Select.
- Electron titlebar controls, because `-webkit-app-region` and window APIs are special.

## Migration Phases

### Phase 0: Baseline Inventory

Purpose: know the blast radius before changing behavior.

Tasks:

- List all shared primitive patterns: buttons, inputs, dialogs, dropdown menus, tabs, badges, progress, empty states.
- Identify all portal overlays and their z-index layers.
- Identify global selectors that may conflict with Tailwind preflight.
- Capture screenshots of light and dark mode for Settings, update modal, resource library, image review, and canvas.
- Run `npm run build` before migration to establish baseline.

Exit criteria:

- A short inventory exists in this document or a follow-up note.
- Baseline build succeeds or known unrelated failures are documented.

### Phase 1: Shadcn Infrastructure and Theme Spike

Purpose: prove shadcn's preferred light/dark theme can become Forart's new visual baseline without causing unacceptable global regressions.

Scope:

- Add Tailwind and shadcn configuration.
- Add `@/*` alias for `renderer/src`.
- Add `components.json`.
- Add `renderer/src/lib/utils.ts` with `cn`.
- Add only the first set of components:
  - `button`
  - `dialog`
  - `progress`
  - `separator`
  - `badge`
  - `tooltip`

Theme work:

- Create `renderer/src/styles/shadcn.css`.
- Define shadcn semantic tokens as the target theme values.
- Map current Forart legacy tokens to shadcn semantic tokens for compatibility.
- Support both light and dark modes.
- Keep the existing app theme state as source of truth.

Validation target:

- Only the update interface is converted enough to evaluate visual fit.
- No Canvas, library grid, or Settings form migration yet.

Exit criteria:

- Light and dark modes use the new shadcn-aligned theme and look better than the current hand-written theme.
- Update modal, update progress, update notes, connectivity rows, and update buttons render correctly.
- Electron window titlebar behavior is unchanged.
- No new global scroll or focus regressions are visible.
- `npm run build` succeeds.

### Phase 2: Update Interface Sample

Purpose: create the first real Forart-shadcn example.

Target files:

- `renderer/src/app/App.tsx`
- `renderer/src/styles/global.css`
- `renderer/src/styles/components.css`
- New `components/forart` wrappers if needed.

Recommended replacements:

- Update modal shell: shadcn `Dialog`.
- Update action buttons: shadcn `Button`.
- Progress bar: shadcn `Progress`.
- Connectivity rows: shadcn `Badge` plus existing row layout or a small `StatusRow`.
- Close/test/check/start actions: `Button` variants with Lucide icons.
- Keep titlebar window buttons hand-written.

Design goals:

- More consistent button height, radius, focus ring, hover state, and disabled state.
- Clearer modal hierarchy without changing the update flow.
- Same or better information density than the current modal.
- No nested cards inside cards.
- No heavy decorative styling.

Exit criteria:

- The update modal proves the new look works in both themes.
- The code demonstrates the pattern for future migrations.
- Any token gaps are added once in `shadcn.css`, not patched per component.

### Phase 3: Settings Page Migration

Purpose: migrate the highest-value standard UI surface.

Why Settings first:

- It is form-heavy.
- It has tabs, sidebars, model rows, buttons, inputs, selects, modals, and status indicators.
- It is less interaction-fragile than the canvas.

Recommended replacements:

- Settings top tabs: `Tabs` or Forart `AppTabs`.
- General inputs: `Input`, `Label`, `Button`.
- API provider actions: `Button`, `Badge`, `DropdownMenu`.
- Model picker modal: `Dialog`, `Checkbox`, `Input`, `Button`, `ScrollArea`.
- Cache scan/delete progress: `Progress`, `Badge`, `Button`.

Keep custom:

- Virtualized lists.
- Drag ordering behavior.
- Libtv install/login business flow.

Exit criteria:

- Settings has minimal raw native controls.
- Feature CSS for Settings shrinks significantly.
- Keyboard navigation and focus remain correct.

### Phase 4: Resource and Action Libraries

Purpose: migrate reusable library management UI.

Targets:

- Resource library tabs and search.
- Project sidebar actions.
- Tag filters and tag manager dialog.
- Card action menus.
- Bulk action bar.
- Action folder import dialog.

Recommended replacements:

- `DropdownMenu` for card/project menus.
- `Dialog` or `AlertDialog` for create/delete/rename flows.
- `Button`, `Badge`, `Checkbox`, `Input`, `Tooltip`.
- `Tabs` for top navigation if it remains tab-like.

Keep custom:

- Image cards and grid layout.
- Bulk selection state.
- Virtualization.
- Drag/drop upload zones.

Exit criteria:

- Menu/dialog behavior becomes consistent across resource, model, outfit, and action libraries.
- Legacy `.button`, `.dialog`, and menu CSS usage is mostly gone outside canvas/image-specific surfaces.

### Phase 5: Image Review and Image Viewer

Purpose: standardize controls while keeping image inspection specialized.

Recommended replacements:

- Toolbar buttons: Forart `IconButton` built on shadcn `Button`.
- Bottom bar actions: `Button`.
- Status chips: `Badge`.
- Review confirmation dialogs: `AlertDialog`.

Keep custom:

- Image viewer layout.
- Image navigation and preview behavior.
- Any keyboard shortcut logic.

Exit criteria:

- User-facing actions look consistent with the rest of the migrated app.
- Image display behavior is unchanged.

### Phase 6: Canvas Periphery

Purpose: migrate canvas-adjacent UI without destabilizing the canvas engine.

Targets:

- Canvas home panel.
- Composer controls.
- Node toolbar buttons.
- Action fission selector dialog.
- Library asset picker rail/dialog.

Recommended replacements:

- Dialogs and selector overlays: shadcn `Dialog`, `Command`, `ScrollArea`, `Button`.
- Toolbar icon buttons: Forart `IconButton`.
- Composer inputs: `Textarea`, `Select` or existing custom Select if layout constraints require it.
- Tabs and segmented controls: Forart wrapper around shadcn Tabs or ToggleGroup.

Keep custom:

- Canvas stage.
- Node rendering surface.
- Selection, resize, drag, pan, crop, minimap, connection layers.
- Pointer event arbitration.

Exit criteria:

- Canvas tool UI is visually consistent.
- Canvas interactions remain unchanged.
- Portal overlays do not break pointer capture or z-index layering.

### Phase 7: Cleanup and Design System Consolidation

Purpose: remove migration leftovers.

Tasks:

- Delete unused legacy CSS selectors.
- Replace generic `.button` and `.dialog` usage.
- Decide final dark mode class name strategy.
- Move durable product wrappers into `components/forart`.
- Document component usage rules.
- Audit bundle impact and remove unused dependencies.

Exit criteria:

- New UI work defaults to shadcn primitives or Forart wrappers.
- Legacy hand-written controls exist only where intentionally justified.
- CSS is mostly token, layout, and feature-specific behavior, not duplicated primitive styling.

## First Implementation Slice

The first slice should be small and reversible:

1. Add Tailwind/shadcn infrastructure.
2. Add shadcn target theme tokens and legacy Forart compatibility mappings.
3. Add `button`, `dialog`, `progress`, `separator`, `badge`, and `tooltip`.
4. Convert only the update modal and related update controls enough to judge visual fit.
5. Run build and inspect light/dark mode manually.
6. Compare the main existing pages for Tailwind preflight regressions before expanding the migration.

Do not include Settings, library pages, or Canvas in the first slice.

## Risk Register

### Tailwind Preflight

Risk: global element defaults change and affect existing hand-written UI.

Mitigation:

- Keep the first slice small.
- Compare screenshots before and after.
- Avoid converting feature CSS at the same time.
- Add compatibility overrides in one base layer if needed.

### Radix Portal Layering

Risk: Dialog, DropdownMenu, Popover, and Tooltip render into `document.body`, bypassing feature container CSS and changing z-index behavior.

Mitigation:

- Define a z-index scale for app shell, titlebar, modal, popover, tooltip, canvas overlays, and image viewer.
- Test update modal first, then menu-heavy pages.
- Be careful around canvas pointer handling and Electron titlebar regions.

### Focus and Keyboard Behavior

Risk: Radix focus trap or escape handling conflicts with existing shortcuts.

Mitigation:

- Test Escape, Tab, Shift+Tab, Enter, and click-outside behavior for every converted overlay.
- Keep canvas global shortcuts away from active dialogs.

### Visual Inconsistency During Migration

Risk: migrated and legacy areas look different for a while.

Mitigation:

- Bridge shadcn tokens to existing Forart tokens first.
- Build product-level wrappers before doing broad page migrations.
- Migrate one surface at a time and remove duplicated legacy styles as each surface completes.

### Over-Customizing Shadcn

Risk: generated shadcn components become heavily edited and hard to update.

Mitigation:

- Keep `components/ui` close to generated output.
- Put Forart behavior and opinionated variants in `components/forart`.
- Prefer token changes over per-component one-off CSS.

## Component Decision Matrix

| UI need | Preferred solution | Notes |
| --- | --- | --- |
| Normal action button | `components/ui/button` | Use variants for primary, secondary, ghost, destructive. |
| Icon-only action | `components/forart/IconButton` | Wrap Button + Tooltip + required `aria-label`. |
| Confirmation modal | `AlertDialog` or `ForartConfirmDialog` | Use for destructive or irreversible operations. |
| Standard modal | `Dialog` | Use for update, settings pickers, tag manager, import flows. |
| Menu | `DropdownMenu` | Replace hand-written portal menus gradually. |
| Form field | `Input`, `Textarea`, `Label`, optional Forart field wrapper | Keep labels visible. |
| Boolean setting | `Switch` or `Checkbox` | Choose Switch for persistent settings, Checkbox for selection. |
| Tabs | `Tabs` or `ForartTabs` | Use one wrapper to keep density consistent. |
| Status | `Badge` or `ForartStatusBadge` | Map ready/error/busy/warn to semantic variants. |
| Progress | `Progress` | Use for update and cache operations. |
| Canvas node body | Custom | Do not force generic components into tight canvas behavior. |
| Image grid card | Custom + shadcn actions | Keep image layout custom; standardize controls. |

## Acceptance Checklist Per Phase

- Light and dark mode both verified.
- No obvious contrast regression.
- Keyboard focus visible on all converted controls.
- Escape/click-outside behavior verified for overlays.
- No horizontal layout overflow.
- Electron titlebar drag/window controls still work.
- Canvas pointer interactions still work for any phase touching canvas-adjacent UI.
- `npm run build` succeeds.
- Removed or documented any legacy CSS made obsolete by the phase.
