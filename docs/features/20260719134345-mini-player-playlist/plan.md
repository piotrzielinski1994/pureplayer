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
