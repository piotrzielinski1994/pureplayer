# 20260720181300-auto-update | Plan

Mirror of `purerequest` `20260719141621-auto-update`. Same Port/Adapter +
headless-bridge design; pureplayer-specific deltas noted per task.

## Approach

Port/Adapter (hexagonal) for the Tauri boundary + a thin headless-bridge
component, mirroring purerequest. pureplayer has no window-controller port to
copy, but the same shape applies: keep every Tauri API call behind a narrow,
fakeable `UpdateController` so all logic is unit-testable in jsdom, and select
native-vs-noop with `isTauri()`.

### pureplayer deltas vs purerequest

- **No toast component** - port `src/components/ui/toast.tsx` + its test wholesale.
- **No `isDevBrowser`/environment.ts** - guard with `isTauri()` from
  `@tauri-apps/api/core` directly.
- **Settings is a plain stacked route** (`src/routes/settings.tsx` rendering
  `PlaybackSection` + `ShortcutsSection`), NOT a Tabs strip - add `UpdatesSection`
  as another stacked section.
- **Providers** live in `src/app/providers.tsx`; `__root.tsx` is just an Outlet
  wrapper. Mount `ToastProvider` + `UpdaterProvider` + `UpdateChecker` in
  `providers.tsx`. `UpdatesSection` reads controller/version from `useUpdater()`.

## File Structure

**Rust / config**
- `src-tauri/Cargo.toml` (modify) - add `tauri-plugin-updater` (rustls-tls),
  `tauri-plugin-process`.
- `src-tauri/src/lib.rs` (modify) - register both plugins.
- `src-tauri/tauri.conf.json` (modify) - `bundle.createUpdaterArtifacts: true`;
  `plugins.updater.{pubkey,endpoints}`.
- `src-tauri/capabilities/default.json` (modify) - add `updater:default`,
  `process:default`.
- `package.json` (done) - JS deps added.

**Frontend**
- `src/components/ui/toast.tsx` (create) - port from purerequest.
- `src/lib/updater/update-controller.ts` (create) - port + endpoint.
- `src/lib/updater/app-version.ts` (create) - port.
- `src/lib/updater/show-update-toast.ts` (create) - port.
- `src/lib/updater/update-checker.tsx` (create) - port.
- `src/lib/updater/updater-context.tsx` (create) - port.
- `src/components/settings/updates-section.tsx` (create) - port.
- `src/routes/settings.tsx` (modify) - render `<UpdatesSection>` via `useUpdater`.
- `src/app/providers.tsx` (modify) - wrap with ToastProvider + UpdaterProvider,
  build controller per-env, mount `<UpdateChecker>`.

**Tests** (port from purerequest, adapt imports)
- `src/components/ui/__tests__/toast.test.tsx`
- `src/lib/updater/__tests__/update-controller.test.ts`
- `src/lib/updater/__tests__/update-checker.test.tsx`
- `src/components/settings/__tests__/updates-section.test.tsx`

**CI / docs**
- `.github/workflows/release.yml` (modify) - pass signing env to tauri-action.
- `docs/learnings.md` + `README.md` (modify) - record the gotcha + secrets.

## Task Breakdown

### Task 1: Toast persistent + action support (create component + test)
RED: port purerequest toast test. GREEN: port toast.tsx.
Commit `feat(auto-update): AC-002 persistent action toast`.

### Task 2: UpdateController port + noop + app-version
RED: port update-controller.test.ts. GREEN: port update-controller.ts +
app-version.ts (endpoint -> pureplayer repo).
Commit `feat(auto-update): AC-006/AC-007 UpdateController port + noop`.

### Task 3: UpdateChecker startup bridge + show-update-toast
RED: port update-checker.test.tsx. GREEN: port show-update-toast.ts +
update-checker.tsx.
Commit `feat(auto-update): AC-001/AC-002/AC-003 startup update checker`.

### Task 4: Settings Updates section + updater context
RED: port updates-section.test.tsx. GREEN: port updater-context.tsx +
updates-section.tsx; wire into settings.tsx.
Commit `feat(auto-update): AC-004/AC-005 Settings Updates section`.

### Task 5: Native wiring + Tauri/CI config
Cargo deps + lib.rs plugins + tauri.conf.json (pubkey/endpoint/artifacts) +
capabilities + providers.tsx wiring + release.yml signing env + docs.
`cargo build` + `npm test` + `npm run build` green.
Commit `feat(auto-update): AC-006 wire updater plugin, config, CI signing`.

## Acceptance Verification

- AC-001/002/003: update-checker tests + toast tests.
- AC-004/005: updates-section tests.
- AC-006: cargo build + config inspection.
- AC-007: update-controller noop test + full jsdom suite green.
- E2E update swap: only verifiable after two signed releases exist - post-merge
  manual check, not a pre-merge gate.

## AC -> Test Traceability (verified)

| AC | Test(s) |
| --- | --- |
| AC-001 | update-checker: "should not show any toast if no update is available", "should swallow a rejected check…", "should check for updates only once across re-renders" |
| AC-002 | update-checker: version+button toast, "…keep past 2500ms", "…remove and not install on dismiss"; toast: persistent/action/×/handle-update |
| AC-003 | update-checker: "should download+install then relaunch…", "should replace the Update now button with progress…"; update-controller: progress-percent + NaN-guard |
| AC-004 | updates-section: version render, up-to-date toast, update-found toast, check-failed toast |
| AC-005 | updates-section: "should disable the button while checking and ignore a second click", re-enable on latest/failed |
| AC-006 | cargo build + config inspection (createUpdaterArtifacts, pubkey, endpoint, capabilities, lib.rs, release.yml) |
| AC-007 | update-controller: noop check resolves null; full jsdom suite (incl. bootstrap) green |

## Status

Implemented + verified 2026-07-20. Gates: npm test 537 pass, cargo test 64 pass, typecheck clean, lint 0 errors, vite build ok. Fresh-context verifier: PASS all 7 ACs + all 5 gates. NaN-percent edge (contentLength absent) now pinned by a test.

Post-merge manual check (not a pre-merge gate): full update swap only verifiable after two signed releases exist.
