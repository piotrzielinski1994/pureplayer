# 20261125211134-delta-update | Incremental (delta) auto-update

## Overview

The in-app updater (`docs/features/20260720181300-auto-update/`) always downloads the whole
signed updater artifact. A release bundle is dominated by the `ffmpeg`/`ffprobe` sidecars
(`externalBin`), which almost never change, so a one-line fix currently costs a full
download.

This feature makes an update download only the bytes that changed: CI produces a binary
patch (bsdiff) between the previous release's updater artifact and the new one, publishes
it next to `latest.json`, and the app applies the patch to a locally cached copy of the
artifact it is running from. The result is verified with the existing minisign signature
before it is handed to the Tauri installer. Everything else (signing keys, endpoints,
`latest.json` format, UI) stays as it is.

**Not a promise of "a fraction of a percent":** the artifacts are compressed archives
(`.nsis.zip` / `.AppImage.tar.gz` / `.app.tar.gz`), so a change inside a compressed member
(e.g. the app binary) invalidates that member's byte stream. The saving comes from the
unchanged members (the ffmpeg/ffprobe sidecars). Expected effect: a patch of a few MB
instead of a bundle of ~100-200 MB.

## Acceptance Criteria

- AC-001: The `Release` workflow produces, for each platform artifact, a patch from the
  previous published release's artifact of the same kind, plus a `deltas.json` manifest,
  and uploads both to the new release.
- AC-002: `patchgen` (a Rust bin in `src-tauri/`) generates a patch from two artifact
  files and emits manifest entries; patches round-trip exactly (patched bytes equal the
  new artifact byte for byte).
- AC-003: On `Settings -> Updates -> Check for updates` (and the startup check), when the
  running version has a cached artifact and the manifest has a matching patch entry, the
  app downloads the patch instead of the full artifact.
- AC-004: A patched artifact is installed only if it matches `artifact_sha256` from the
  manifest **and** the minisign signature from `latest.json`; any mismatch logs the reason
  and falls back to a full download.
- AC-005: The app keeps exactly one cached artifact under the app data dir, tagged with
  the version it belongs to, and only an artifact tagged with the *running* version is ever
  used as a patch base. The cache is written before the installer runs (on Windows the
  installer terminates the process, so there is no after-install hook); a cancelled or failed
  install therefore leaves a cache tagged with a version the app does not run, which is a
  cache miss, not a bad base.
- AC-006: When no patch entry exists, no cached artifact exists, or anything in the delta
  path fails, the update completes via the full download (behaviour today).
- AC-007: No UI change: `UpdateController`/`UpdatesSection`/toast keep their current
  contracts; the delta path hides behind the same "Update now" action and percent progress.

## User Test Cases

- TC-001: Install version N, keep the app idle, publish N+1 with patches -> startup
  check offers the update, "Update now" downloads a patch (log line states delta vs full
  and byte counts) and the app relaunches on N+1.
- TC-002: Same as TC-001 but with the cache directory deleted -> the app downloads the
  full artifact and still ends on N+1.
- TC-003: Corrupt the published patch (or its manifest hash) -> the app logs the failed
  verification and falls back to the full download; the user never sees a broken install.
- TC-004: Updating when the previous release has no `deltas.json` (older release) -> full
  download, no error surfaced.

## Data Model

`deltas.json`, published as a release asset next to `latest.json`:

```json
{
  "version": "0.4.0",
  "patches": [
    {
      "target": "windows-x86_64",
      "from_version": "0.3.0",
      "to_version": "0.4.0",
      "file": "pureplayer_0.3.0_x64-setup.nsis.zip.to-0.4.0.patch",
      "sha256": "<sha256 of the patch file>",
      "artifact_sha256": "<sha256 of the reconstructed artifact>"
    }
  ]
}
```

Cache layout, `<app_data_dir>/updates/`:

- `artifact.bin` - the updater artifact of the running version.
- `version` - the version string that artifact belongs to (plain text, trimmed).

## Edge Cases

- Cache written by an older build that predates the feature: absent, so full download.
- Manifest lists a target/version pair that does not match the running platform: full
  download.
- Patch download aborted or content-length unknown: progress stays at 0%, download either
  completes or fails over to the full path.
- Disk write of the cache fails: update still installs (cache error is logged, not fatal).
- The `from_version` of a cached artifact differs from the running version (app updated
  outside the in-app updater): treated as a miss.

## Dependencies

- Crates: `qbsdiff` (bsdiff/bspatch), `sha2`, `minisign-verify`, `base64`, `reqwest`
  (rustls), `tauri-plugin-updater` (already present: `check()`, `download()`, `install()`).
- CI: `gh` CLI on the runner, `GITHUB_TOKEN` with `contents: write` (already granted).
- Existing signing keypair (`TAURI_SIGNING_PRIVATE_KEY`) - unchanged, reused for
  verification of the reconstructed artifact.
