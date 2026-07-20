# Plan: Mini-player playlist variant

From the approved `spec.md`. TDD (red-green-refactor). Vitest frontend only; no Rust change (capabilities already present).

## Approach

Replace the `isMiniPlayer: boolean` with a `miniMode: "off" | "bar" | "playlist"` ADT (three mutually-exclusive states, illegal states unrepresentable - pz-codebase-design). One verb `toggleMiniMode(target: "bar" | "playlist")` handles enter/exit/direct-switch. `Content` grows a playlist branch (sidebar above bar) gated on `miniMode === "playlist"`; the viewport stays mounted-but-hidden in every mini mode (video continuity). `setMiniWindow` takes the mode and picks the target window size; geometry + panel snapshot are stashed once on first entry and preserved across direct switches.

Shared `MiniMode`/`MiniTarget` types live in a new `src/lib/mini-mode.ts` so both `workspace-context.tsx` (components) and `lib/tauri.ts` (lib) import them without a components->lib upward dependency.

## File Structure

- Create `src/lib/mini-mode.ts` - `MiniMode`, `MiniTarget` type aliases + `nextMiniMode(current, target)` pure helper.
- Create `src/lib/__tests__/mini-mode.test.ts` - unit tests for `nextMiniMode`.
- Modify `src/components/workspace/workspace-context.tsx` - swap `isMiniPlayer`/`toggleMiniPlayer`/`initialMiniPlayer`/`preMiniChrome` to `miniMode`/`toggleMiniMode`/`initialMiniMode`.
- Modify `src/components/workspace/content.tsx` - render playlist-mini (sidebar above bar), hide viewport in any mini mode.
- Modify `src/lib/tauri.ts` - `setMiniWindow(mode: MiniMode)` + playlist geometry constants.
- Modify `src/lib/shortcuts/registry.ts` - add `toggle-mini-playlist` action id + entry.
- Modify `src/components/workspace/workspace.tsx` - handler for `toggle-mini-playlist`; update bar handler to the new verb.
- Modify tests: `__tests__/workspace-context.test.tsx` (Probe), `__tests__/content-mini-player.test.tsx`, `__tests__/mini-window.test.ts`, `shortcuts/__tests__/registry.test.ts`.
- Modify `README.md` (Mini player line) + `docs/design.md` only if a new pureplayer-only rule emerges (likely just README).

## Tasks

### Task 1: MiniMode ADT + context state

**Files:** Create `src/lib/mini-mode.ts`, `src/lib/__tests__/mini-mode.test.ts`; Modify `workspace-context.tsx`, `__tests__/workspace-context.test.tsx`.

**Interfaces:**
- Produces: `type MiniMode = "off" | "bar" | "playlist"`; `type MiniTarget = "bar" | "playlist"`; `nextMiniMode(current: MiniMode, target: MiniTarget): MiniMode` (returns `target` unless `current === target`, then `"off"`). Context value drops `isMiniPlayer`/`toggleMiniPlayer`, adds `miniMode: MiniMode` and `toggleMiniMode: (target: MiniTarget) => void`; provider prop `initialMiniPlayer` -> `initialMiniMode?: MiniMode` (default `"off"`).

- [ ] Write failing tests (nextMiniMode table; context default off; toggle bar/playlist enter+exit; direct switch; snapshot preserved across direct switch)
- [ ] Run, confirm RED
- [ ] Implement `mini-mode.ts` + rewire context (snapshot ref taken only on `off -> mini`)
- [ ] Run, confirm GREEN
- [ ] Commit (`feat(mini-playlist): AC-001..004 miniMode ADT + toggleMiniMode`)

### Task 2: registry action + workspace handlers

**Files:** Modify `shortcuts/registry.ts`, `workspace.tsx`, `shortcuts/__tests__/registry.test.ts`.

**Interfaces:**
- Consumes: `toggleMiniMode` (Task 1), `setMiniWindow` (Task 4).
- Produces: `ShortcutActionId` union gains `"toggle-mini-playlist"`; `SHORTCUT_ACTIONS` entry `Mod+Shift+L` with keywords `["playlist","mini","list","tracks","compact"]`.

- [ ] Write failing registry test (new action bound to Mod+Shift+L, keywords, ids unique; bar still Mod+Shift+M)
- [ ] Run, confirm RED
- [ ] Add action + both handlers (`toggle-mini-player` -> `toggleMiniMode("bar")` + `setMiniWindow(nextMiniMode(miniMode,"bar"))`; `toggle-mini-playlist` -> playlist)
- [ ] Run, confirm GREEN
- [ ] Commit (`feat(mini-playlist): AC-007..008 register Mod+Shift+L + handlers`)

### Task 3: Content playlist-mini render

**Files:** Modify `content.tsx`, `__tests__/content-mini-player.test.tsx`.

**Interfaces:**
- Consumes: `miniMode` (Task 1). Reuses `<Sidebar />`.
- Produces: nothing downstream.

- [ ] Write failing tests (playlist mode: list present + viewport hidden + video mounts; bar mode: no list; off: viewport visible, no list; empty playlist -> "(no media)" + bar)
- [ ] Run, confirm RED
- [ ] Render `<Sidebar/>` in a `flex-1` wrapper when `miniMode==="playlist"`; hide viewport when `miniMode!=="off"`
- [ ] Run, confirm GREEN
- [ ] Commit (`feat(mini-playlist): AC-005..006 sidebar-above-bar Content render`)

### Task 4: setMiniWindow(mode) geometry

**Files:** Modify `tauri.ts`, `__tests__/mini-window.test.ts`.

**Interfaces:**
- Consumes: `MiniMode` (Task 1).
- Produces: `setMiniWindow(mode: MiniMode): Promise<void>` (was `(enter: boolean)`).

- [ ] Write failing tests (playlist dims; bar dims = stashed width; off restore; direct switch no re-stash; off-without-enter no-op)
- [ ] Run, confirm RED
- [ ] Rewrite `setMiniWindow` + add `MINI_PLAYLIST_WIDTH`, `SIDEBAR_HEADER_HEIGHT`, `MEDIA_ROW_HEIGHT`, `MINI_PLAYLIST_ROWS`; stash `preMini` once
- [ ] Run, confirm GREEN
- [ ] Commit (`feat(mini-playlist): AC-009 setMiniWindow per-mode sizing`)

## Edge cases (from spec §Edge cases)

Empty playlist; sidebar-hidden-then-mini snapshot; direct-switch stash preserve; video continuity; non-Tauri no-op. Each has a TC.

## Tests to write

One per AC minimum + the edge TCs (TC-001..012). Frontend Vitest. Assert observable state (DOM roles, `setSize` args), never mock the SUT; `@/lib/tauri` is the only mocked seam for Content-level tests. `setMiniWindow` unit test mocks `@tauri-apps/api/window` (existing pattern).

## Acceptance verification

- `npm test` green (full suite, includes the renamed `isMiniPlayer` call-sites).
- `npm run typecheck` + lint clean (no `any`, no new comments).
- Fresh verifier subagent maps each AC to a passing, non-tautological test.
- On-device (manual, out of automated scope): `Mod+Shift+L` shrinks to the list-over-bar window; `Mod+Shift+M` still gives bar-only; direct switch keeps `<video>` playing.

## Completion (2026-07-19)

Status: **DONE**. 4 commits (fe1775f, c1b2a05, f99bd0d, 3575f75) on branch `20260719134345-mini-player-playlist`. Gates: 509 tests pass (44 files), typecheck clean, lint 0 errors (5 pre-existing warnings). On-device manual verification still pending (window resize can't run under jsdom).

### AC -> test traceability

| AC | Test(s) |
| --- | --- |
| AC-001 | mini-mode.test.ts nextMiniMode table; workspace-context "should default miniMode to off", "should seed miniMode from the initialMiniMode prop" |
| AC-002 | workspace-context "should enter bar-mini hiding the sidebar and return to off ... twice" |
| AC-003 | workspace-context "should enter playlist-mini and return to off restoring both panels ... twice" |
| AC-004 | mini-mode.test.ts (bar/playlist self+cross cases); workspace-context "should switch directly ..." + "should restore the exact pre-mini panel state after exit if the mini was switched directly" (mutation-verified discriminating); mini-window "should not re-stash on a direct bar-to-playlist switch ..." |
| AC-005 | content-mini-player "should render the playlist above a hidden-but-mounted viewport ...", "should show the viewport region and render no playlist inside Content if miniMode is off", "(no media) empty state" |
| AC-006 | content-mini-player playlist + bar tests (viewport hidden, `<video>` mounts) |
| AC-007 | registry.test.ts "should register 'toggle-mini-playlist' on Mod+Shift+L ..." |
| AC-008 | workspace-mini-mode.test.tsx (3 tests: setMiniWindow('playlist'/'bar'/'off') via palette + viewport visibility) |
| AC-009 | mini-window.test.ts (bar dims + restore, playlist fixed width/taller height, width-independent-of-stash, no-re-stash, no-recapture, off-no-op) |

### Decision log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-19 | Design gate: pz-ddd N/A, pz-archetypes N/A, pz-codebase-design APPLIED | No domain boundary/shape; interface reshape (isMiniPlayer boolean -> miniMode ADT) is a module-interface decision. ADT makes illegal states unrepresentable. |
| 2026-07-19 | Shared MiniMode/MiniTarget types in new src/lib/mini-mode.ts | Both workspace-context.tsx (components) and lib/tauri.ts (lib) need them; a lib module avoids a components->lib upward import. |
| 2026-07-19 | setMiniWindow keeps module-scope state (preMini, currentMiniMode) | Mirrors the pre-existing preMiniSize pattern; window geometry is inherently a singleton OS resource, not React state. Handler passes nextMiniMode(miniMode, target) so window mode and context mode never diverge. |
| 2026-07-19 | Content renders its own `<Sidebar/>` for playlist-mini (not WorkspaceLayout) | In mini the WorkspaceLayout sidebar panel is hidden (isSidebarVisible=false); the vertical sidebar-above-bar stack is a distinct layout that lives in Content next to the hidden viewport, preserving `<video>` mount. |

## Redesign (2026-07-20) - SUPERSEDES the miniMode ADT above

On-device use showed the miniMode model was wrong: playlist-mini rendered its OWN `<Sidebar/>` inside Content while `Mod+B` toggled the SEPARATE left `WorkspaceLayout` panel -> two sidebars. The user's model is one sidebar, grid-driven, where mini-playlist = mini-player with the sidebar toggled on.

New model (implemented, replaces everything above):
- **Dropped:** `miniMode` ADT, `src/lib/mini-mode.ts`, `nextMiniMode`, `toggle-mini-playlist` action + `Mod+Shift+L`, the pre-mini panel snapshot, the duplicate `<Sidebar/>` in Content.
- **Three independent visibility toggles:** `isSidebarVisible`, `isContentVisible`, `isTransportVisible`. `Mod+Shift+M` -> `toggleContent`; `Mod+B` -> `toggleSidebar`.
- **Layout (WorkspaceLayout):** the normal resizable `sidebar|content` tree stays MOUNTED but `hidden` (display:none) when content is off, so the `<video>` never remounts. When content is off, the single `<Sidebar/>` reflows into a top bar above the transport bar (stacked flex-col). Resizable split kept in normal mode.
- **`setMiniWindow(layout: MiniLayout)`** where `MiniLayout = { contentVisible, sidebarVisible }`: content hidden -> shrink (bar-only, or sidebar+bar when sidebar shown), sidebar toggle while mini re-sizes without re-stashing, content shown -> restore. Session-only.
- **Verified live** (playwright, resolved `getBoundingClientRect`) in all 4 states: content-on = 1 sidebar + viewport; content-off+sidebar-on = sidebar above bar; content-off+sidebar-off = bar only; content-on-again = viewport full-width. Video tree stays mounted (h=0) in every mini state. Full suite 507 green, typecheck + lint clean.
