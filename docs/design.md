# Design

UI design rules for this app. Entries are about *visual language and interaction*, not domain logic. Read this before any UI change.

## Corners

- **No rounded corners. Anywhere.** Sharp edges only. The radius token is pinned to zero (`--radius: 0rem` and every `--radius-{sm,md,lg,xl}: 0rem`) - never raise it.
- Do not use `rounded-*` utilities (`rounded`, `rounded-sm/md/lg/full/xs`, ...). If a UI primitive (e.g. shadcn) ships with a `rounded-*` class, strip it.
- Treat any rounded corner as a defect.

## Borders & dividers

- **Dividers are 1px. Never thicken, brighten, or colour on hover or drag.** A resize handle (sidebar split, console split, editor/results split) is a `w-px`/`h-px` line in `bg-border`.
- Give a thin divider a larger **invisible** hit area instead of a visible thick bar: an `::after` overlay (`after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2` for a vertical handle) catches the pointer while the visible line stays 1px.
- Cursor signals affordance (`cursor-col-resize` / `cursor-row-resize`), not thickness.
- Borders use the `border`/`border-border` token, 1px. Don't introduce heavier borders for emphasis - use background/spacing instead.

## Tables / grids

- One grid component, reused everywhere a result set is shown. All grids look identical: same row height, padding, header treatment, single-line cells (`overflow-hidden text-ellipsis whitespace-nowrap`), resizable columns.
- _(pureplayer-only)_ Exception to the single-line-ellipsis rule for the **playlist sidebar** (`media-list`): track names are NOT truncated - they stay full-width on one line (`whitespace-nowrap`, no `truncate`) and the list scrolls **horizontally** instead (the `ScrollArea` opts into the horizontal axis via its `horizontal` prop). Rationale: in the narrow mini-player window a filename is more useful scrollable-in-full than ellipsized. The scrollbar itself uses the shared `type="hover"` auto-hide style (same as everywhere else / `purerequest`) - only the no-truncate behavior is the exception, not the scrollbar. Do not propagate the no-truncate rule to the shared grid or to `requi`/`dbui`.

## Scrollbars

- One scrollbar style everywhere, consistent across OSes (mirrors `requi`/`purerequest`). Native scrollers get a thin, square, semi-transparent bar via the global `@layer base` rule in `index.css` (`scrollbar-width: thin` + `scrollbar-color` for Firefox; `::-webkit-scrollbar` 8px track/thumb for WebKit, thumb `color-mix(foreground 20%)`, hover 35%). Regions that own a Radix `ScrollArea` get the matching overlay thumb (`type="hover"`, `scrollHideDelay=600`, `w-1.5`, `bg-foreground/20` hover `/30`); opt into a horizontal bar with the `horizontal` prop.
- Headers always render, even for an empty result, so the column structure stays visible; show an empty-state message ("No rows.") beneath the header row, not instead of it.
- NULL renders as a dim `[NULL]`, visually distinct from an empty string.
- Edited/dirty cells get a subtle highlight (`bg-amber-500/15`), applied identically in every view (list and single-record).

## Density & typography

- Compact, keyboard-first, IDE-like. Rows and controls are single-line and tight (`py-1`/`py-1.5`, `text-xs`/`text-sm`).
- Monospace (`font-mono`) for data, SQL, identifiers, and anything tabular. UI chrome (labels, buttons, tabs) uses the default sans stack.
- Muted foreground (`text-muted-foreground`) for secondary text (column headers, hints, timestamps); full foreground for primary content.

## Color & status

- Theme via CSS tokens (`bg-background`, `bg-muted/30`, `text-foreground`, `border-border`), not hard-coded colors, so light/dark both work.
- Status colors: success green (`text-green-600 dark:text-green-400`), error/destructive red (`text-red-600 dark:text-red-400`). A destructive action button (e.g. Disconnect) is filled red.
- Status dots are a small `size-2` filled circle, right-aligned, never with a text label leaking into an accessible name (give the row an explicit `aria-label`).

## Layout

- Resizable splits at the shell level (sidebar|content, content|console). Inside a tab panel, a split must be hand-rolled (the `react-resizable-panels` group breaks tab-switching) but still obey the 1px-divider rule.
- Tabs are flat, square, separated by 1px borders; the active tab reads via `bg-background` + full foreground, inactive via muted foreground.
- Buttons in a thin bar (toolbar / editor header / URL bar) **fill the bar's full height** (`h-full`, square, no margin), divided from siblings by a 1px border (`border-l`/`border-r`), not floating chips with their own height/padding. The bar height is the button height.
- All bar buttons share one size: the `Button` default (`text-sm`, `px-4`) - do NOT shrink some to `text-xs` or re-pad them. Add only `h-full rounded-none border-0 border-l` (+ optional `border-l-border`); keep everything else from the default so Send/Save/Close read identically across every bar.
- _(pureplayer-only)_ The transport bar reflows by its **own** width via a container query, not the viewport width, so it lays out correctly in the narrow mini-player window regardless of the sidebar. The `@container` marker is on the outer bar; the responsive layout lives on an inner element (a container-query variant queries its ancestor, so the `@container` node cannot match its own width). Layout is a `grid-cols-[1fr_auto_1fr]` reflowed by `grid-template-areas`: wide (`@2xl`) is one row `'controls playback meta'`; narrow is two rows `'left playback meta' / 'controls controls controls'` - the transport buttons (playback) and the time/rate/transform readout (meta) share the top row with playback centered (the empty `left` cell balances `meta`), and the mute/volume/shuffle/repeat controls get their own full-width row below, centered (`justify-center`, `@2xl:justify-start`). Zones are placed by name (`[grid-area:*]`), not source order.

## Accessibility

- Interactive affordances that are purely visual (resize handles, status dots) are `aria-hidden` or carry an explicit non-leaking label so they don't pollute the accessible name of their container (treeitem, columnheader).
- Inputs opt out of browser autofill noise: `autoComplete="off"`, `autoCorrect="off"`, `autoCapitalize="off"`, `spellCheck={false}`, plus `data-1p-ignore` / `data-lpignore` for password managers.
