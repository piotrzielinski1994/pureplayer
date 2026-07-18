# Spec: User settings + remappable hotkeys (FR-7)

**Version:** 0.1.0
**Created:** 2026-06-20
**Status:** Draft

## 1. Overview

Today every preference resets on reload: hotkeys are fixed compile-time defaults
(`src/lib/shortcuts/registry.ts`), and volume / mute / playback-speed / sidebar /
transport / sort-direction all live in `WorkspaceProvider` `useState` with no persistence.
The `/settings` route is a dead stub ("No settings yet."). FR-7 gives the app a single
**persisted user-preferences store** and the first surface that uses it: a settings screen
with **user-remappable keyboard shortcuts** plus persisted playback and UI defaults.

The sibling `requi` repo already ships this exact subsystem; pureplayer mirrors it (settings
ADT + `LazyStore` persistence + `SettingsProvider` + `resolveShortcuts`/`findConflict` +
capture-keystroke `ShortcutRow`). See `docs/adr.md` for the reuse decision.

What this delivers:

- A `Settings` ADT (`src/lib/settings/settings.ts`) with a `version`, defensive `mergeSettings`
  validation, and `DEFAULT_SETTINGS`.
- Disk persistence via the official `tauri-plugin-store` (`LazyStore`, `settings.json`), behind
  a `SettingsStore` seam with an in-memory implementation for tests.
- A `SettingsProvider` mounted at the app root; load-once on boot, save-on-change.
- **Remappable hotkeys:** `registry.ts` gains `ShortcutOverrides`; a pure `resolve.ts`
  (`resolveShortcuts` / `findConflict` / `safeNormalize`) overlays user overrides on the
  defaults; `useActionHotkeys` binds the resolved (not default) hotkeys.
- **Settings screen:** a `ShortcutsSection` listing every action with its current binding,
  an Edit (record-keystroke) button, conflict detection, and a Reset-to-default per override.
- **Persisted playback prefs:** default `volume`, `isMuted`, `playbackRate` restore on boot.
- **Persisted UI prefs:** `sidebarHidden`, `transportHidden`, `sortDirection`, and the resizable
  **panel layout** (sidebar/content split sizes) restore on boot.
- A way to reach `/settings` (hotkey `Mod+,` + command-palette entry) and get back.

What this does NOT deliver (out of scope, YAGNI):

- Playlist / active-video / per-file resume persistence (that is FR-5, skipped).
- Persisting `repeatMode` / `isShuffling` (queue modes stay session-only for now).
- Import/export of settings, multiple profiles, cloud sync.

### User Story

As a user I want my keyboard shortcuts, volume, playback speed, and panel layout to be the
way I left them - and to rebind any shortcut that clashes with my habits - so the player
fits my workflow instead of resetting to defaults every launch.

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | Settings persist to disk via `tauri-plugin-store` and are reloaded on next launch; the in-memory store seam keeps jsdom tests host-free. | Must |
| AC-002 | `mergeSettings` defensively validates persisted JSON: unknown/invalid fields fall back to defaults, an unknown `version` or non-object yields `DEFAULT_SETTINGS`; a corrupt file never throws on boot. | Must |
| AC-003 | A user can rebind any action by recording a new key combination; the override persists and survives reload. Recording Escape cancels (Escape is never assignable). | Must |
| AC-004 | `useActionHotkeys` fires the RESOLVED binding (user override if set, else default). A rebind takes effect without restart. | Must |
| AC-005 | Recording a combination already used by another action is REJECTED (not saved); the UI names the conflicting action. The action's own current binding is not treated as a conflict. | Must |
| AC-006 | Each shortcut row shows the action name and its current binding (override or default), formatted for display. An overridden action shows a Reset control that removes the override (reverting to default). | Must |
| AC-007 | The settings screen lists a row for EVERY registered action, including `open-settings`, `close-settings`, and `open-command-palette`. | Must |
| AC-008 | Default `volume`, `isMuted`, and `playbackRate` restore from settings on boot (a saved 0.5 volume / 1.5x rate comes back). Changing them in the workspace persists the new default. | Must |
| AC-009 | `sidebarHidden`, `transportHidden`, and `sortDirection` restore from settings on boot; toggling them persists. (Fullscreen's transient chrome-hiding still overrides at runtime and is NOT persisted.) | Must |
| AC-010 | `/settings` is reachable via `Mod+,` and a command-palette entry; `Escape` (or a palette entry / back affordance) returns to the workspace. | Must |
| AC-011 | `resolveShortcuts`, `findConflict`, `safeNormalize`, and `mergeSettings` are PURE and unit-tested; verbs carry no validation ifology. | Must |
| AC-012 | `npm run lint`, `npm run typecheck`, `npm test` all exit 0; `cargo test` (if Rust touched) exits 0. | Must |
| AC-013 | The resizable panel layout (sidebar/content split) persists on resize and restores on boot via `settings.layout` (a `{panelId -> size}` map); a corrupt/non-numeric layout falls back to an empty map (defaults). | Must |
| AC-014 | A persisted `revealTransportOnHover` flag (default `true`): when the transport bar is HIDDEN and the flag is on, hovering the video content reveals the bar as a bottom-edge overlay (no layout shift). Flag off = hidden stays hidden. A toggle in the settings screen flips and persists it. A visible (docked) transport is unaffected. | Must |
| AC-015 | The command palette lists EVERY runnable action (incl. fullscreen + reveal-transport toggle); `toggle-fullscreen` (`Mod+Shift+F`) and `toggle-reveal-transport` (`Mod+Shift+H`) are registered actions with hotkeys + palette entries. Actions carry optional search `keywords` so e.g. "bottom bar" matches "Toggle transport bar". | Must |
| AC-016 | While the reveal overlay is shown, it AUTO-HIDES after 3000ms with no mouse movement; any mouse move re-reveals it instantly and restarts the 3000ms idle timer; leaving the video hides it immediately. | Must |
| AC-017 | The reveal overlay does NOT auto-hide while the cursor is over the bar itself (idle timer frozen on bar-enter, even as moves bubble up); the 3000ms countdown restarts when the cursor leaves the bar back onto the video. | Must |
| AC-018 | The video title overlay is a brief intro card, not a permanent watermark: it shows for 5s after the active video changes, then hides; switching to another video re-shows it for that file. (Still suppressed entirely in fullscreen.) | Must |

## 3. User Test Cases

### TC-001: Override persists and resolves (AC-003, AC-004)
Seed empty overrides. Record `Mod+P` for `toggle-play`. `resolveShortcuts` now returns `Mod+P`
for `toggle-play` (default for the rest); the store's `save` was called with `shortcuts["toggle-play"]="Mod+P"`. Maps to: AC-003, AC-004.

### TC-002: Reload restores overrides (AC-001, AC-003)
A store seeded with `shortcuts["toggle-mute"]="Mod+Shift+M"` loads into the provider; the mute
row renders that binding after mount. Maps to: AC-001, AC-003.

### TC-003: Conflict rejected, owner named (AC-005)
`toggle-sidebar`=`Mod+B`. Recording `Mod+B` for `toggle-transport` is NOT persisted; the row
shows a "Toggle sidebar already uses that shortcut" alert. Maps to: AC-005.

### TC-004: Re-recording an action's own binding is not a conflict (AC-005)
Recording `Space` for `toggle-play` (whose current binding is `Space`) is allowed (own binding
ignored by `findConflict`). Maps to: AC-005.

### TC-005: Reset removes the override (AC-006)
With `toggle-play` overridden to `Mod+P`, clicking Reset removes the key from `shortcuts`; the
row reverts to the default `Space` label and Reset disappears. Maps to: AC-006.

### TC-006: Every action has a row (AC-007)
The section renders a row whose name matches each entry in `SHORTCUT_ACTIONS`, including
`open-settings`, `close-settings`, `open-command-palette`. Maps to: AC-007.

### TC-007: Corrupt persisted JSON falls back (AC-002)
`mergeSettings(DEFAULT_SETTINGS, "not an object")` -> `DEFAULT_SETTINGS`; `mergeSettings(d, {version: 99})`
-> defaults; an override with an unknown action id or a non-string hotkey is dropped. Maps to: AC-002.

### TC-008: Playback prefs restore on boot (AC-008)
Store seeded `volume: 0.5, isMuted: true, playbackRate: 1.5`. On boot the `<video>` reflects
volume 0.5, muted, rate 1.5 (via context init from settings). Maps to: AC-008.

### TC-009: Playback pref change persists (AC-008)
`changeVolume`/`toggleMute`/`changeRate` in the workspace call the store's save with the new
value. Maps to: AC-008.

### TC-010: UI prefs restore on boot (AC-009)
Store seeded `sidebarHidden: true, transportHidden: true, sortDirection: "desc"`. On boot the
sidebar + transport are hidden and the sort is descending. Maps to: AC-009.

### TC-011: UI pref change persists (AC-009)
`toggleSidebar`/`toggleTransport`/`toggleSortDirection` call the store's save with the new state. Maps to: AC-009.

### TC-015: Panel layout persists + restores (AC-013)
A store seeded `layout: {sidebar:30, content:70}` seeds the resizable group's `defaultLayout` on
boot; resizing fires `onLayoutChanged`, which persists the new `{panelId->size}` via the store. A
non-numeric layout value merges to `{}`. Maps to: AC-013.

### TC-016: Reveal transport on hover + idle auto-hide (AC-014, AC-016)
Transport hidden + `revealTransportOnHover: true`: the bar is absent until a mouse MOVE over the
video reveals it (overlay). With no movement for 3000ms it auto-hides; a fresh move re-reveals and
restarts the timer; leaving the video hides immediately. With the flag `false` it never appears.
The settings toggle flips + persists the flag; a docked (visible) transport is unaffected. Maps to: AC-014, AC-016.

### TC-019: Title overlay auto-hides after 5s (AC-018)
Active video v-3: its name shows initially, then disappears after 5s. Selecting v-9 (after the
timeout) re-shows that file's name. Maps to: AC-018.

### TC-018: Bar-hover freezes auto-hide (AC-017)
Reveal overlay shown; mouse enters the bar -> advancing 1000ms does NOT hide it (idle timer frozen);
a move bubbling up from the bar also doesn't re-arm; leaving the bar restarts the 3000ms countdown,
after which it hides. Maps to: AC-017.

### TC-017: Palette completeness + keyword search (AC-015)
Opening the palette lists a row for every action except the opener (and the route-scoped
`close-settings`), including Toggle sidebar, Toggle transport bar, Toggle fullscreen, Toggle reveal
transport. Selecting "Toggle fullscreen" runs the fullscreen IPC. Typing "bottom bar" matches the
transport action via its keyword. Maps to: AC-015.

### TC-012: Navigate to settings and back (AC-010)
`Mod+,` navigates to `/settings`; the shortcuts list renders. `Escape` returns to `/`. Maps to: AC-010.

### TC-013 (pure): resolveShortcuts overlays defaults (AC-011)
`resolveShortcuts({})` returns every action's default; `resolveShortcuts({"toggle-play":"Mod+P"})`
returns `Mod+P` for that one, defaults elsewhere; an invalid override string falls back to default. Maps to: AC-011.

### TC-014 (pure): findConflict (AC-011)
`findConflict("Mod+B", "toggle-transport", effective)` returns `"toggle-sidebar"`;
`findConflict(<own binding>, ownId, effective)` returns `null`; an unparseable hotkey returns `null`. Maps to: AC-011.

## 4. UI States

| State | Behavior |
| ----- | -------- |
| Settings loading | `SettingsProvider` renders `null` until the store resolves (boot flash avoided; matches `requi`). |
| Shortcut row (default) | Action name + grey default binding; an "Edit" button; no Reset. |
| Shortcut row (overridden) | Action name + override binding; "Edit" + "Reset" buttons. |
| Recording | Binding cell reads "Press keys…"; button becomes "Cancel"; Escape aborts. |
| Conflict | A `role="alert"` line "<Owner> already uses that shortcut"; nothing saved. |
| Settings route empty of nav | A back affordance + `Escape`/palette return to workspace. |

### Settings screen wireframe (single scrolling column, sharp corners, 1px dividers)

```
+-----------------------------------------------------------------------+
| Settings                                                  [ Back ]    |
+-----------------------------------------------------------------------+
|                                                                       |
| Keyboard Shortcuts                                                    |
| Press Edit and type a new combination. Escape cancels.                |
| --------------------------------------------------------------------- |
| Play / pause                              Space         [Edit]        |
| Open command palette                      Ctrl K        [Edit]        |
| Toggle sidebar                            Ctrl Y    [Edit] [Reset]    |
|   ^ Toggle console already uses that shortcut (role=alert, on clash)  |
| ... one row per registered action ...                                 |
|                                                                       |
+-----------------------------------------------------------------------+
```

- Rows are 1px-divided (`divide-y`), `py-1.5`, `text-sm` name + `font-mono text-xs` binding (design.md density).
- No rounded corners; buttons are the shared `Button` sizes, not floating chips.
- The Back affordance returns to `/`; `Escape` (the `close-settings` action) does the same.

## 5. Data Model

```ts
// src/lib/shortcuts/registry.ts (additions)
export type ShortcutOverrides = Partial<Record<ShortcutActionId, string>>;
// + new action ids: "open-settings" (Mod+,), "close-settings" (Escape)

// src/lib/shortcuts/resolve.ts (pure)
function safeNormalize(hotkey: string): string | null;             // validate + normalize, else null
function resolveShortcuts(o: ShortcutOverrides): Record<ShortcutActionId, string>;
function findConflict(hotkey, forAction, effective): ShortcutActionId | null;

// src/lib/settings/settings.ts
type PanelLayout = Record<string, number>;   // panelId -> size (react-resizable-panels Layout)
type Settings = {
  version: 1;
  shortcuts: ShortcutOverrides;
  layout: PanelLayout;       // resizable sidebar/content split sizes
  volume: number;            // 0..1
  isMuted: boolean;
  playbackRate: number;      // 0.5..2
  sidebarHidden: boolean;
  transportHidden: boolean;
  revealTransportOnHover: boolean;   // default true; reveal hidden bar on video hover
  sortDirection: "asc" | "desc";
};
const DEFAULT_SETTINGS: Settings;                       // volume 1, rate 1, asc, nothing hidden
function mergeSettings(defaults: Settings, partial: unknown): Settings;  // defensive per-field

type SettingsStore = { load: () => Promise<Settings>; save: (s: Settings) => Promise<void> };
```

- `createTauriSettingsStore()` (`tauri-store.ts`): `LazyStore("settings.json")`, get/merge on load,
  set+save on save, `.catch` so a host-less / corrupt read fails safe to defaults.
- `createInMemorySettingsStore(initial?)` (`in-memory-store.ts`): pure in-memory, for tests.
- `SettingsProvider` (`settings-context.tsx`): load-once effect, `update(mutate)` saves on every change;
  exposes `settings` + granular savers (`saveShortcut`, `resetShortcut`, `saveVolume`, `saveMuted`,
  `savePlaybackRate`, `saveSidebarHidden`, `saveTransportHidden`, `saveSortDirection`). Renders `null` until loaded.

**Integration with `WorkspaceProvider`** (keep it DI-pure):

- `WorkspaceProvider` already takes `initialSortKeys` / `initialSortDirection`. Add matching
  `initialVolume` / `initialMuted` / `initialPlaybackRate` / `initialSidebarHidden` /
  `initialTransportHidden` init props (all optional, defaulting to today's values). The provider
  stays free of any settings/IPC dependency, so the ~13 existing provider tests are unaffected.
- A thin **bridge** at the route level reads `useSettings()`, seeds those `initial*` props into
  `WorkspaceProvider`, and (via a small effect/callback) calls the matching `save*` when the
  workspace verbs change the value. Persistence wiring lives in one place; the store is the
  single source of truth on boot, the workspace owns it at runtime.
- `useActionHotkeys` reads `useSettings()` and binds `resolveShortcuts(settings.shortcuts)`.

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | No persisted file yet (first launch) | `load` returns `DEFAULT_SETTINGS` (get -> undefined -> merge defaults). |
| E-2 | Corrupt / partial JSON | `mergeSettings` validates each field; bad fields -> default, never throws (AC-002). |
| E-3 | Override references a removed action id | `mergeSettings`/`resolveShortcuts` drop unknown ids (only known `ShortcutActionId`s overlay). |
| E-4 | Override is an unparseable hotkey string | `safeNormalize` returns null -> default used; dropped on merge. |
| E-5 | Recording a combo already bound elsewhere | `findConflict` returns the owner -> not saved, alert shown (AC-005). |
| E-6 | Re-recording an action's existing binding | own id excluded from conflict scan -> allowed, no-op-ish save. |
| E-7 | Recording Escape | `useHotkeyRecorder` treats Escape as cancel -> never assignable (AC-003). |
| E-8 | Running outside a Tauri host (browser dev / jsdom) | `LazyStore` calls are `.catch`-guarded to defaults; tests inject the in-memory store. |
| E-9 | Fullscreen vs persisted chrome | Fullscreen still force-hides chrome at runtime and restores the pre-fullscreen state on exit; only the user's explicit windowed `sidebarHidden`/`transportHidden` is persisted, not the transient fullscreen state. |
| E-10 | Concurrent rapid saves | Last-write-wins; `update` mutates from the latest `settings` snapshot, `LazyStore.save` serializes writes. |

## 7. Dependencies

- New npm dep: `@tauri-apps/plugin-store` (`^2`), mirroring `requi`.
- New Rust dep: `tauri-plugin-store = "2"` in `src-tauri/Cargo.toml`; register
  `tauri_plugin_store::Builder::new().build()` in `src-tauri/src/lib.rs`; add `"store:default"`
  to `src-tauri/capabilities/default.json`.
- `@tanstack/react-hotkeys` `useHotkeyRecorder` + `@tanstack/hotkeys` `validateHotkey`/`normalizeHotkey`/`formatForDisplay` (already installed).
- `lucide-react` for a settings/cog icon (already installed). No other new packages.

## 8. Out of Scope

Playlist/session persistence (FR-5), queue-mode persistence, panel split sizes, settings
import/export, profiles, cloud sync.

## 9. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-06-20 | Initial - persisted settings store (`tauri-plugin-store`) mirrored from `requi`; remappable hotkeys (resolve/conflict/reset, capture-keystroke); persisted playback (volume/mute/rate) + UI (sidebar/transport/sort) defaults; `/settings` screen + `Mod+,` + palette. |
| 0.2.0 | 2026-06-21 | Added panel-layout persistence (AC-013): `settings.layout` ({panelId->size}) seeds the resizable group's `defaultLayout` and `onLayoutChanged` -> `saveLayout`, mirroring `requi`. Moved from out-of-scope after user feedback. |
| 0.3.0 | 2026-06-21 | Added `revealTransportOnHover` (AC-014, default `true`): a hidden transport bar reveals as a bottom-edge overlay while the video is hovered; toggled in a new settings Playback section. pureplayer-specific (no `requi` precedent). New `ui/switch.tsx` primitive (sharp-cornered per design.md). |
| 0.4.0 | 2026-06-21 | AC-015: palette now lists every runnable action - added `toggle-fullscreen` (`Mod+Shift+F`, was double-click only) + `toggle-reveal-transport` (`Mod+Shift+H`) actions, and optional per-action search `keywords` (so "bottom bar" finds the transport toggle). AC-016: the reveal overlay auto-hides after 500ms idle, re-reveals on mouse move (timer reset), hides on leave. |
| 0.5.0 | 2026-06-21 | AC-017: the reveal overlay no longer auto-hides while the cursor rests on the bar - bar-enter freezes the idle timer (and a bubbling move from the bar doesn't re-arm it via an `isOverBar` ref), bar-leave restarts the 500ms countdown. |
| 0.6.0 | 2026-06-21 | AC-018: the video title overlay now auto-hides 5s after the active video changes (was shown permanently while windowed); switching files re-shows it. Implemented in `viewport.tsx` via a `titleHiddenForId` state set by a per-id 5s timer (no synchronous setState-in-effect, lint-clean). |
| 0.7.0 | 2026-06-21 | Tuned the reveal-overlay idle timeout 500ms -> 3000ms (`IDLE_HIDE_MS` in `content.tsx`) per user; AC-016/AC-017 + tests rescaled accordingly. |
