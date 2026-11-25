# 20261125211134-delta-update | Plan

## Task breakdown

1. **Pure delta core** (`src-tauri/src/delta_update.rs`, TDD first):
   - `DeltaManifest` parse + `find(target, from, to)`.
   - `CacheLayout` (`artifact.bin` + `version`): `base()`, `store(version, bytes)`, `clear()`.
   - `apply_patch(base, patch) -> Vec<u8>` over `qbsdiff::Bspatch`.
   - `sha256_hex`, `sibling_url(download_url, name)`, `verify_artifact(bytes, signature, pubkey)`.
2. **Runtime glue** (same module): `update_check` / `update_install` Tauri commands -
   `updater().check()`, fetch `deltas.json`, patch or full download, cache refresh,
   `install(bytes)`; progress via `update-progress` events (`downloaded`, `total`).
3. **Patch producer** (`src-tauri/src/bin/patchgen.rs`): pair old/new artifacts by
   `<name>_<version>_<rest>` shape, write `<new-file>.to-<version>.patch`, emit
   `deltas.json`.
4. **Frontend** (`src/lib/updater/delta-controller.ts`): `UpdateController` over the two
   commands + `listen('update-progress')`; swap it in `src/app/providers.tsx` via the
   existing `isTauri()` seam (dev browser keeps the noop).
5. **CI** (`.github/workflows/release.yml`): download previous release assets, run
   `patchgen`, upload `deltas.json` + patches to the new release.
6. **Docs**: README "In-app auto-update" section gains the delta paragraph; learnings entry.

## Execution order

Core tests (red) -> core (green) -> `patchgen` -> runtime glue -> frontend controller +
tests -> providers wiring -> CI -> docs.

## File changes

- `src-tauri/src/delta_update.rs` (create) - pure core + commands + tests.
- `src-tauri/src/bin/patchgen.rs` (create) - patch producer.
- `src-tauri/src/lib.rs` (modify) - register commands, `mod delta_update`.
- `src-tauri/Cargo.toml` (modify) - `qbsdiff`, `sha2`, `minisign-verify`, `base64`,
  `reqwest` (rustls, stream).
- `src/lib/updater/delta-controller.ts` (create) + `__tests__/delta-controller.test.ts`.
- `src/app/providers.tsx` (modify) - delta controller on Tauri.
- `.github/workflows/release.yml` (modify) - patch generation + upload.
- `README.md` (modify) - delta paragraph.

## Risks

- **bsdiff on compressed archives** yields a patch roughly the size of the changed
  compressed members, not a fixed small fraction. Accepted: sidecars dominate the bundle.
- **Patch apply memory** holds base + patch + result (hundreds of MB at peak for the
  biggest bundle). Same order as today's full download (bytes in memory).
- **CI asset download** relies on the previous release still having updater artifacts;
  a missing previous release just skips patch generation (workflow step is skipped).
- **macOS/Linux install paths** are the plugin's own (`install(bytes)`), unchanged code
  path, but only Windows was exercised locally in this environment.

## Acceptance verification

- `cargo test` in `src-tauri/` (pure core + patch round-trip), `npm test` (controller),
  `npm run typecheck`, `npm run lint`.
- Real-app check on Windows (`npm run tauri build`, publish two releases) is documented in
  TC-001..TC-004 and not runnable from this Linux sandbox.
