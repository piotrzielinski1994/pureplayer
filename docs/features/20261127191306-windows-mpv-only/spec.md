# 20261127191306-windows-mpv-only | Windows plays only through bundled libmpv

## Overview

The Windows installer ships `ffmpeg.exe` and `ffprobe.exe` but not the two libraries
`tauri-plugin-libmpv` loads (`libmpv-wrapper.dll`, `libmpv-2.dll`). The plugin looks for
them next to the exe, in `lib/` beside the exe, then on `PATH`; on a clean install it finds
none, `mpv` init fails, and every file plays through the ffmpeg + `<video>` fallback. The
log of an installed build confirms it: `Attempting to load libmpv-wrapper from:
libmpv-wrapper.dll` with no `Successfully loaded` line, then `prepare_media plan=Passthrough`.

This feature makes the Windows build ship both libmpv libraries and drops the ffmpeg
sidecars from the Windows build only. On Windows every file plays through `mpv`; there is
no ffmpeg fallback. macOS and Linux keep the current ffmpeg path unchanged (mpv on macOS
was abandoned, see `docs/adr.md`).

## Acceptance Criteria

- AC-001: The Windows bundle (NSIS installer and its updater artifact) contains
  `libmpv-wrapper.dll` and `libmpv-2.dll` at a path the plugin searches, and contains no
  `ffmpeg.exe` / `ffprobe.exe`.
- AC-002: The macOS and Linux bundles still contain `ffmpeg` / `ffprobe` and no libmpv
  libraries; their playback is unchanged.
- AC-003: On Windows, a fresh install plays a file through `mpv`: the log shows
  `Successfully loaded libmpv-wrapper` and no `prepare_media` line.
- AC-004: On Windows, when `mpv` init or `loadfile` fails, the viewport shows the
  existing "Could not play this file" state; the app never calls `prepare_media` or any
  ffmpeg/ffprobe sidecar.
- AC-005: The libmpv libraries are fetched by a script with pinned URLs and SHA-256
  checksums (same model as `scripts/fetch-ffmpeg.sh`), not committed; the `Release`
  workflow runs it on the Windows runner.
- AC-006: On Windows the app does not warm ffmpeg/ffprobe sidecars at startup.

## User Test Cases

- TC-001: Install the new Windows build on a machine with no mpv on `PATH` -> drop an
  `.mkv` (HEVC) and an `.mp4` -> both play in the native mpv window; the log has
  `Successfully loaded libmpv-wrapper`.
- TC-002: Open the install folder -> `libmpv-wrapper.dll` and `libmpv-2.dll` are present,
  `ffmpeg.exe` / `ffprobe.exe` are absent.
- TC-003: Rename `libmpv-2.dll` in the install folder, start the app, drop a file -> the
  viewport shows "Could not play this file"; no ffmpeg process starts.
- TC-004: Update an installed older build to the new one through the in-app updater ->
  after relaunch the DLLs are present and playback goes through mpv.

## Data Model

No change.

## Edge Cases

- File type mpv cannot open: "Could not play this file", same as today's fallback failure.
- Delta update from a build with sidecars to a build without them: the patch is large
  (the artifact members change); it must still install, falling back to the full download.
- An older libmpv on `PATH`: the plugin prefers the exe directory, so the bundled copy
  wins.
- Audio-only files (`audio-player-support`): also played by mpv on Windows.

## Dependencies

- `tauri-plugin-libmpv` 0.3.2 (already present) and its runtime libraries:
  `libmpv-wrapper.dll` from [nini22P/libmpv-wrapper](https://github.com/nini22P/libmpv-wrapper/releases),
  `libmpv-2.dll` from the LGPL `mpv-dev-lgpl-x86_64` build of
  [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild/releases).
- Tauri platform config (`tauri.windows.conf.json`) to give Windows its own
  `bundle.externalBin` / `bundle.resources`.
