# Plan: User settings + remappable hotkeys (FR-7)

Implements [spec.md](spec.md). TDD red-green-refactor. Branch: `20260620231145-user-settings-hotkeys`.
Mirrors the sibling `requi` repo's settings/shortcuts subsystem (see [adr.md](../../adr.md)).

## Approach

Three layers, all pure-core + thin-shell, copied/adapted from `requi`:

1. **Persistence + settings ADT** (`src/lib/settings/`):
   - `settings.ts` - `Settings` type (`version:1`, `shortcuts`, `volume`, `isMuted`,
     `playbackRate`, `sidebarHidden`, `transportHidden`, `sortDirection`), `DEFAULT_SETTINGS`,
     pure `mergeSettings(defaults, partial)` that validates each field defensively (unknown ->
     default, non-object/wrong version -> defaults; `mergeShortcuts` keeps only known action ids
     with `safeNormalize`-able strings). Drops `requi`'s layouts/openTabs/workspacePath/env fields
     (out of scope); adds the playback + UI prefs.
   - `tauri-store.ts` - `createTauriSettingsStore()`: `LazyStore("settings.json")`, get+merge on
     load, set+save on save, `.catch` -> defaults (host-less / corrupt fail-safe). One file (no
     separate keymap file like `requi` - vidui has no reason to split).
   - `in-memory-store.ts` - `createInMemorySettingsStore(initial?)` for tests.
   - `settings-context.tsx` - `SettingsProvider({store})`: load-once effect, `update(mutate)` saves
     on change, renders `null` until loaded. Exposes `settings` + granular savers: `saveShortcut`,
     `resetShortcut`, `saveVolume`, `saveMuted`, `savePlaybackRate`, `saveSidebarHidden`,
     `saveTransportHidden`, `saveSortDirection`. `useSettings()` hook.

2. **Remappable hotkeys** (`src/lib/shortcuts/`):
   - `registry.ts` - add `ShortcutOverrides` type; add `open-settings` (`Mod+,`) and
     `close-settings` (`Escape`) action ids + entries.
   - `resolve.ts` (new, pure) - `safeNormalize` (validateHotkey + normalizeHotkey, reject unknown
     keys), `resolveShortcuts(overrides)` (overlay on defaults), `findConflict(hotkey, forAction,
     effective)` (owner of a duplicate, own id excluded).
   - `use-action-hotkeys.ts` - read `useSettings()`, bind `resolveShortcuts(settings.shortcuts)`
     instead of `action.defaultHotkey`. Drop the global `ignoreInputs: true`? No - vidui's bare
     keys (Space/M/S/R/arrows/brackets) must stay suppressed while typing in the (future) inputs;
     keep `ignoreInputs: true` (vidui has no text-entry surface that needs Mod combos to fire over
     it, unlike `requi`'s editors). Settings rebind UI doesn't use these hotkeys (it uses the
     recorder), so `ignoreInputs` is safe.

3. **Settings UI** (`src/components/settings/`):
   - `shortcut-row.tsx` - copied from `requi`: `useHotkeyRecorder`, Edit/Cancel/Reset buttons,
     conflict alert via `findConflict`, `formatForDisplay` binding label.
   - `shortcuts-section.tsx` - copied: lists a `ShortcutRow` per `SHORTCUT_ACTIONS`.
   - settings route (`src/routes/settings.tsx`) - render `<ShortcutsSection />` + a Back link to `/`.

4. **Workspace integration** (DI-pure provider + route bridge):
   - `workspace-context.tsx` - add optional init props `initialVolume`/`initialMuted`/
     `initialPlaybackRate`/`initialSidebarHidden`/`initialTransportHidden` (default to today's
     values); state inits from them. NO settings/IPC import - stays pure.
   - `src/routes/index.tsx` (the bridge) - read `useSettings()`, seed `WorkspaceProvider`
     `initial*` from `settings`, and pass save callbacks so the workspace verbs persist. Wiring
     option (pick simplest that tests support): expose optional `on*Change` callbacks on
     `WorkspaceProvider` (mirrors `requi`'s `onTreeChange`/`onEnvChange` pattern) that fire when the
     corresponding state changes; the bridge maps them to the savers. The provider calls them but
     does not own the store.
   - `useActionHotkeys` now needs settings -> the 4 tests rendering `<Workspace/>` must wrap in
     `<SettingsProvider store={createInMemorySettingsStore()}>`.

5. **Navigation** (`workspace.tsx` + bridge): `open-settings` handler navigates to `/settings`
   (TanStack `useNavigate`); `close-settings` handler navigates to `/`. Both flow into the palette
   automatically via the existing `SHORTCUT_ACTIONS.map`. `close-settings` (Escape) only meaningful
   on the settings route - register its handler there (or guard on route).

6. **Tauri plumbing**: `package.json` += `@tauri-apps/plugin-store`; `Cargo.toml` +=
   `tauri-plugin-store = "2"`; `lib.rs` registers the plugin; `capabilities/default.json` +=
   `"store:default"`.

## Files

### Create
- `src/lib/settings/settings.ts` - `Settings`, `DEFAULT_SETTINGS`, `mergeSettings`, `SettingsStore`.
- `src/lib/settings/tauri-store.ts` - `createTauriSettingsStore`.
- `src/lib/settings/in-memory-store.ts` - `createInMemorySettingsStore`.
- `src/lib/settings/settings-context.tsx` - `SettingsProvider` + `useSettings`.
- `src/lib/shortcuts/resolve.ts` - `safeNormalize` / `resolveShortcuts` / `findConflict`.
- `src/components/settings/shortcut-row.tsx` - capture-keystroke row.
- `src/components/settings/shortcuts-section.tsx` - the list.
- Tests:
  - `src/lib/settings/__tests__/settings.test.ts` - `mergeSettings` defensive matrix (TC-007).
  - `src/lib/settings/__tests__/in-memory-store.test.ts` - load/save round-trip.
  - `src/lib/settings/__tests__/settings-context.test.tsx` - load-once, savers persist (TC-001, TC-009, TC-011).
  - `src/lib/shortcuts/__tests__/resolve.test.ts` - `resolveShortcuts`/`findConflict`/`safeNormalize` (TC-013, TC-014).
  - `src/components/settings/__tests__/shortcuts-section.test.tsx` - rows, record, conflict, reset (TC-002..TC-006).

### Modify
- `src/lib/shortcuts/registry.ts` - `ShortcutOverrides`; `open-settings` (`Mod+,`), `close-settings` (`Escape`).
- `src/lib/shortcuts/use-action-hotkeys.ts` - bind resolved overrides from `useSettings()`.
- `src/lib/shortcuts/__tests__/registry.test.ts` - assert the two new actions registered.
- `src/components/workspace/workspace-context.tsx` - new `initial*` props + optional `on*Change`
  callbacks; state inits from props, verbs invoke callbacks.
- `src/components/workspace/__tests__/workspace-context.test.tsx` - cover init props + callbacks (TC-008, TC-010, and the persist-callback side-effects).
- `src/routes/index.tsx` - the persistence bridge (seed `initial*`, wire savers).
- `src/routes/settings.tsx` - render `ShortcutsSection` + Back link + `close-settings` handling.
- `src/components/workspace/workspace.tsx` - `open-settings`/`close-settings` navigate handlers.
- The 4 `<Workspace/>` tests (`workspace-palette`, `workspace-open-files`, `workspace-drop`,
  `extended-transport`) - wrap render in `SettingsProvider` (in-memory store).
- `src/main.tsx` or `src/app/providers.tsx` - mount `SettingsProvider` (with the tauri store) above
  the router, so `useActionHotkeys` + the bridge can read it. (Decide: providers.tsx keeps
  app-wide providers; put it there next to `HotkeysProvider`.)
- `package.json`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` - plugin-store.
- `README.md` - note persisted settings + `/settings` reachable (`Mod+,`), remappable hotkeys; drop
  the "bindings are fixed defaults / no persistence" sentence; add the new commands/hotkeys.
- `docs/adr.md` - already appended (3 rows).
- `docs/learnings.md` - append any gotcha (e.g. jsdom Mod->Control recorder quirk reuse, plugin-store host guard).

### No change
- `viewport.tsx` - reads `volume`/`muted`/`playbackRate`/`sortDirection` from context already; once
  context inits from settings, playback prefs apply with no viewport edit.
- `transport-bar.tsx` - same; reflects context state.

## Edge cases handled (from spec §6)

E-1 first launch -> defaults; E-2 corrupt JSON -> `mergeSettings` per-field fallback (never throws);
E-3/E-4 unknown action id / unparseable hotkey dropped on merge + `resolveShortcuts`; E-5 conflict
-> not saved + alert; E-6 own-binding excluded from conflict; E-7 Escape = recorder cancel;
E-8 host-less store `.catch` -> defaults + in-memory store in tests; E-9 fullscreen still
runtime-overrides chrome, only windowed sidebar/transport choice persisted; E-10 last-write-wins.

## Tests (TDD, Vitest)

Pure:
- `resolve.test.ts` - `safeNormalize` valid/invalid/unknown-key; `resolveShortcuts` empty +
  override + invalid-override-falls-back; `findConflict` owner / own-binding-null / unparseable-null (TC-013, TC-014).
- `settings.test.ts` - `mergeSettings`: non-object -> defaults, bad version -> defaults, per-field
  type guards, `mergeShortcuts` drops unknown id + non-string + invalid hotkey (TC-007).

Store/context:
- `in-memory-store.test.ts` - save then load returns the saved settings.
- `settings-context.test.tsx` - renders null then loads; `saveShortcut` persists override (TC-001);
  `resetShortcut` removes it (TC-005 core); a saver (e.g. `saveVolume`) calls `store.save` (TC-009).

UI (`shortcuts-section.test.tsx`, wrap `HotkeysProvider` + `SettingsProvider` + in-memory store,
mirror `requi`'s test):
- Row per action incl. open/close-settings + palette (TC-006).
- Override label shown when seeded (TC-002).
- Record free combo persists (TC-001 via UI); record conflicting combo rejected + owner named
  (TC-003); record own binding allowed (TC-004); Reset removes override (TC-005).
- jsdom reports non-mac so `Mod` records as `Control` -> recording Control+Y canonicalizes to
  `Mod+Y` (reuse the learnings note; assert on the normalized override).

Workspace integration (`workspace-context.test.tsx` Probe):
- `initialVolume`/`initialMuted`/`initialPlaybackRate` seed state (TC-008 at context level;
  viewport-level reflection is the side-effect-contract);
- `initialSidebarHidden`/`initialTransportHidden`/`initialSortDirection` seed state (TC-010);
- `on*Change` callbacks fire with the new value when the verb runs (TC-009, TC-011).

Navigation (TC-012): a `<Workspace/>` test wrapped in router + SettingsProvider - fire
`open-settings` hotkey -> route is `/settings`; `close-settings` -> `/`. (If router-in-jsdom is
heavy, assert the navigate callback is invoked instead.)

Not unit-testable (needs a real Tauri host): actual disk read/write via `LazyStore`. Covered by
user `npm start` - change a binding + volume, relaunch, confirm both restored. jsdom uses the
in-memory store.

## Acceptance verification

Each AC maps to >=1 TC. Pure resolve/merge tests cover AC-011; lint+typecheck+test green covers
AC-012. On-device `npm start` confirms AC-001 disk persistence end-to-end (the one path jsdom can't prove).

## Risks

- **Provider blast radius:** adding `useSettings()` to `useActionHotkeys` breaks the 4 `<Workspace/>`
  tests until wrapped. Mitigation: wrap all 4 in the same RED step; in-memory store keeps them host-free.
- **Bridge re-render loop:** seeding `initial*` from settings + persisting back could loop if the
  bridge resets state on every save. Mitigation: `initial*` are init-only (used in `useState`
  initializer); persistence is one-way (verb -> callback -> save), store is read only on boot.
- **`Mod+,` validity:** confirm `@tanstack/hotkeys` accepts comma as a key in RED (else pick another binding).
- **plugin-store cargo build:** new Rust dep must compile; run `cargo test`/build in GREEN before claiming done.

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-20 | Mirror `requi` settings/shortcuts subsystem; `tauri-plugin-store` persistence | User rule: check `requi` first + reuse. Logged in adr.md. |
| 2026-06-20 | `WorkspaceProvider` stays DI-pure; persistence via route-level bridge + `initial*`/`on*Change` | Protects the 13 existing provider tests; extends the existing seam pattern. Logged in adr.md. |
| 2026-06-20 | Single `settings.json` (no split keymap file like `requi`) | vidui has no reason to separate the keymap; one file is simpler. |

## Status: DONE 2026-06-21

ACs verified by fresh-context verifiers. AC-013 (panel-layout persistence) added after user
feedback that requi persists split sizes; AC-014 (reveal-transport-on-hover) added on user request
(vidui-specific, no requi precedent); AC-015 (palette completeness: fullscreen + reveal-transport
actions + search keywords) and AC-016 (idle auto-hide of the reveal overlay) added on follow-up;
AC-017 (don't auto-hide while the cursor is on the bar) and AC-018 (title overlay auto-hides after
5s) added on follow-up.
Gates: `npm test` 348 passed (30 files, 0 skipped), `npm run typecheck` clean, `npm run lint` 0 errors
(5 pre-existing/accepted warnings), `cargo test` 22 passed (new `tauri-plugin-store` dep compiles).

### AC -> proving test

| AC | Proving test(s) |
|----|-----------------|
| AC-001 | `in-memory-store.test.ts` save/load round-trip; `settings-context.test.tsx` "expose a seeded shortcut override" (disk I/O is host-only, scoped out of jsdom) |
| AC-002 | `settings.test.ts` mergeSettings matrix (null/string/number/array/bad-version -> defaults, per-field guards, "should not throw if garbage") |
| AC-003 | `shortcuts-section.test.tsx` "persist the override if a new free combo is recorded"; E-7 "should not persist a binding if Escape is pressed while recording" |
| AC-004 | `resolve.test.ts` resolveShortcuts overlay; `use-action-hotkeys.ts` binds `resolveShortcuts(settings.shortcuts)` |
| AC-005 | `shortcuts-section.test.tsx` "name the owning action and not persist" + "allow recording an action's own current binding" |
| AC-006 | `shortcuts-section.test.tsx` "remove the override and restore the default label if reset is clicked" |
| AC-007 | `shortcuts-section.test.tsx` "render a row for every registered action" + "list rows for open-settings, close-settings and open-command-palette" |
| AC-008 | `workspace-context.test.tsx` "seed volume/isMuted/playbackRate from initial* props" (boot) + "fire onVolumeChange/onMutedChange/onPlaybackRateChange ..." (persist-on-change); `settings-context.test.tsx` saveVolume/saveMuted |
| AC-009 | `workspace-context.test.tsx` "seed sidebar/transport hidden and desc sort" (boot) + "fire onSidebarHiddenChange/onTransportHiddenChange/onSortDirectionChange ..." (persist); E-9 "hide chrome without firing the savers if fullscreen is entered" |
| AC-010 | `settings-navigation.test.tsx` "navigate to /settings if the open-settings hotkey is pressed" + "navigate back to / if Escape is pressed on the settings route" |
| AC-011 | `resolve.test.ts` (safeNormalize/resolveShortcuts/findConflict) + `settings.test.ts` (mergeSettings) - all pure |
| AC-012 | full suite + lint + typecheck + cargo green |
| AC-013 | `settings.test.ts` mergeSettings layout matrix; `settings-context.test.tsx` "persist via store.save if saveLayout is called"; `workspace-layout-persistence.test.tsx` "pass the persisted layout ... as defaultLayout" + "persist the new layout ... if the panels are resized" |
| AC-014 | `settings.test.ts` revealTransportOnHover merge/default; `settings-context.test.tsx` "persist via store.save if saveRevealTransportOnHover is called"; `content-hover-transport.test.tsx` reveal-on-move + flag-off; `playback-section.test.tsx` toggle state + persist |
| AC-015 | `registry.test.ts` "include 'toggle-fullscreen' and 'toggle-reveal-transport'" + "'bottom bar' keyword"; `workspace-palette.test.tsx` "list a row for every registered action" + "toggle fullscreen ... selected" + "match the transport action by its 'bottom bar' keyword" |
| AC-016 | `content-hover-transport.test.tsx` "auto-hide ... after 3000ms" + "re-reveal on a new move ... restarting the idle timer" + "hide ... immediately on mouse leave" |
| AC-017 | `content-hover-transport.test.tsx` "not auto-hide ... while the mouse is over the bar" + "stay open while the mouse moves over the bar itself" |
| AC-018 | `viewport.test.tsx` "hide the active video's name after 5 seconds" + "re-show the title if the active video switches after the timeout" |

### Decisions during implementation (also in docs/adr.md)

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-21 | `mergeSettings` rejects only a PRESENT+mismatched `version`, not a missing one | The route bridge + tests pass partials with no `version`; treating absence as corrupt would wipe valid per-field values. |
| 2026-06-21 | `SettingsProvider` gates render (null until loaded); the 4 `<Workspace/>` tests use `findBy*` for the first query | Init-only `initial*` props must see loaded settings on first mount; gating broke synchronous leading assertions, fixed by awaiting. Logged in docs/learnings.md. |
