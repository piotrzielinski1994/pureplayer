# Spec: Video playback progress (resume where you left off)

**Version:** 0.1.0
**Created:** 2026-11-23
**Status:** Approved (headless run, no approval gate)
**Branch:** `20261123173613-video-playback-progress`

## 1. Overview

pureplayer always starts a file at 00:00. Closing the app or switching files loses the
position, so a long video has to be scrubbed back by hand.

This feature remembers the playback position per file and resumes there, **for video
materials only**. Audio items (`MP3`, `M4A`, `AAC`, `FLAC`, `WAV`, `OGG`, `OPUS`, `WMA`)
keep starting from 0 and are never written to the progress file.

Progress is per file `path` (the media id), persisted in a separate `progress.json`
Tauri store so it does not bloat `settings.json` and never mixes with settings merging.

### Scope

- **In:**
  - Record position (and duration) while a video plays, at most every 5 s, plus on pause
    and on seek.
  - Write `{ version: 1, entries: { [path]: { positionSec, durationSec, updatedAtMs } } }`
    to `progress.json` (Tauri `LazyStore`), through a store interface with an in-memory
    implementation for the dev browser and tests.
  - Resume a video at the saved position when it becomes active (open, drop, prev/next,
    select, playlist reload). Resume works on both playback paths - `<video>` and the
    native mpv window - by issuing one normal seek once the media has loaded.
  - Do not resume when the saved position is under 5 s or within 5 s of the end.
  - Forget a video's entry when it reaches the end (it is finished, next play starts at 0).
- **Out:**
  - Audio progress (explicitly excluded).
  - Background/global "continue watching" UI, progress bars in the playlist, history list.
  - Playlist persistence, cross-device sync, pruning of entries for deleted files.

## 2. Acceptance Criteria

- **AC-1** `isVideoFormat` returns true for `MP4`, `MKV`, `MOV`, `WEBM`, `AVI` and false
  for every `AudioFormat`.
- **AC-2** While a video plays, its position is persisted at most once per 5 s of playback
  time, and the persisted entry carries the position and duration.
- **AC-3** An audio item never produces a progress entry, even when it reports progress.
- **AC-4** Activating a video with a saved mid-file position sets the resume position and
  the transport time readout to that position; the player seeks there once the media has
  loaded (HTML `<video>` path and mpv path).
- **AC-5** A saved position under 5 s or within 5 s of the saved duration resumes at 0.
- **AC-6** When a video reaches the end, its entry is removed from the map and the store.
- **AC-7** The persisted `progress.json` payload is validated on load: malformed entries are
  dropped, a malformed file loads as empty, and an entry from a different `version` is
  discarded.
- **AC-8** The dev browser run uses an in-memory progress store (no Tauri plugin calls).

## 3. User test cases

- **UT-1** Play a video to 10:00, close the app, reopen the same file: playback starts at
  10:00 and the transport shows 10:00.
- **UT-2** Do the same with an audio file: it starts at 00:00 and no entry appears in
  `progress.json`.
- **UT-3** Play a video to its end, close and reopen: it starts at 00:00.
- **UT-4** Watch 8 s of a video, switch to the next file, then back: it resumes near 8 s
  (last save), not 00:00.
- **UT-5** Start a video, pause at 3 s, quit and reopen: it starts at 00:00 (under the 5 s
  resume threshold).

## 4. Data model

`progress.json` (Tauri app data dir), key `progress`:

```json
{
  "version": 1,
  "entries": {
    "/videos/film.mkv": { "positionSec": 3721.5, "durationSec": 7200, "updatedAtMs": 1764000000000 }
  }
}
```

Pure model in `src/lib/progress/progress.ts`:

- `ProgressEntry = { positionSec: number; durationSec: number; updatedAtMs: number }`
- `ProgressMap = Record<string, ProgressEntry>` (keyed by media `path`)
- `parseProgressFile(raw: unknown): ProgressMap` - tolerant, never throws
- `recordProgress(map, path, positionSec, durationSec, nowMs): ProgressMap | null` -
  `null` means "nothing worth writing" (audio filtered earlier, non-positive duration,
  or less than 5 s of movement since the last entry)
- `clearProgress(map, path): ProgressMap`
- `resumePosition(entry): number` - 0 when absent/below 5 s/near the end

## 5. Edge cases

- Duration unknown (`0` / `NaN`) at save time: skip the write, keep the previous entry.
- Position past the duration after a seek: clamped to `[0, duration]` before saving.
- A file is renamed/moved: the path key no longer matches, so it starts at 0 (accepted).
- mpv cannot seek before `loadfile` completes: the resume seek is issued after the load
  resolves.
- A pending resume must not be re-applied when an audio-swap or HLS seek restart swaps
  the source: the resume is consumed once, then cleared.

## 6. Dependencies

- `@tauri-apps/plugin-store` (already used by settings).
- No new dependency.
