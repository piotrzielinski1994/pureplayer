# 20261127191306-windows-mpv-only | Plan

## Task Breakdown

1. Frontend gate (AC-004): `hasFfmpegFallback()` in `src/lib/tauri.ts` (false for a Windows user agent, built on a pure `hasFfmpegFallbackFor(userAgent)`). `viewport.tsx` `prepareFfmpeg` checks it first; without the fallback it sets the `error` source ("mpv could not play this file") and never calls `prepareMediaUrl`.
2. Backend (AC-006): `lib.rs` calls `media::prewarm_sidecars` only under `#[cfg(not(windows))]`.
3. Bundle (AC-001, AC-002): new `src-tauri/tauri.windows.conf.json` (merged by Tauri over `tauri.conf.json` on Windows) sets `bundle.externalBin` to `[]` and `bundle.resources` to `["lib/*.dll"]`, so the DLLs land in `<install dir>/lib/`, which the plugin searches.
4. Fetch (AC-005): `scripts/fetch-libmpv.sh` downloads `libmpv-2.dll` and `libmpv-wrapper.dll` from the `libmpv-windows-20261127` mirror release (pre-release, not "latest") into `src-tauri/lib/` (already gitignored), SHA-256 pinned.
5. CI (AC-005): `release.yml` Windows step runs `fetch-libmpv.sh` instead of `fetch-ffmpeg.sh`; the `deltas` job lists releases with `--exclude-pre-releases` so a mirror release is never taken as the previous app release.
6. Docs: README (fetch script, Windows playback), CLAUDE.md Playback section, ADR row.

## Execution Order

1 (red -> green) -> 2 -> 3 + 4 -> 5 -> 6 -> `npm test`, `cargo test`, `npm run tauri build` (Windows) -> check install folder and log (TC-001, TC-002).

## File Changes

- `src/lib/tauri.ts`, `src/lib/__tests__/tauri.test.ts`
- `src/components/workspace/viewport.tsx`, `src/components/workspace/__tests__/viewport.test.tsx`
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.windows.conf.json` (new)
- `scripts/fetch-libmpv.sh` (new)
- `.github/workflows/release.yml`
- `README.md`, `CLAUDE.md`, `docs/adr.md`

## Acceptance Verification

- AC-001, AC-002: Windows build output contains `lib/libmpv-2.dll`, `lib/libmpv-wrapper.dll`, no `ffmpeg.exe`; `tauri.conf.json` (macOS/Linux) unchanged.
- AC-003: log of the built app shows `Successfully loaded libmpv-wrapper`.
- AC-004: viewport tests (mpv init fails / `loadfile` fails without fallback).
- AC-005: `fetch-libmpv.sh` run with checksum verification; `release.yml` diff.
- AC-006: no `prewarm` on Windows (`cfg` gate), log shows no sidecar spawn.
