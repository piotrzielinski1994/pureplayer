# Plan: Audio player support

Implements [spec.md](spec.md). TDD red-green-refactor. Branch: `20260718222553-audio-player-support`.

## Approach

Two independent slices, backend first (it carries the real risk), then the domain rename. The
frontend needs **no playback change** - the `<video>` element already plays an audio-only source as
a black frame, so every existing transport/queue/seek behavior transfers for free once the file is
importable and the pipeline stops rejecting it.

1. **Backend pipeline (`media.rs`)** - widen the existing `MediaPlan` / `MediaStrategy` ADT with the
   "no video stream" shape. This is the deep module: the whole audio decision hides behind
   `plan_media` / `strategy_for` / `parse_probe_json`, all pure and unit-tested with no ffmpeg host.
   - `parse_probe_json` skips `disposition.attached_pic == 1` streams when reading the video codec,
     so embedded cover art never reads as a motion-video track.
   - `plan_media`: empty vcodec -> audio-only branch (`Passthrough` if native, else
     `Convert { video: None, audio }`).
   - `VideoAction::None` (drop track, `-vn`) added; `CompleteRemux` carries a `VideoAction` so an
     audio remux emits `-vn` instead of `-c:v copy`.
   - `prepare_media` guard flips from "no video -> Err" to `has_playable_stream` (Err only when
     neither stream exists).
2. **Import filter (`import.rs`)** - `VIDEO_EXTENSIONS` gains the audio set; `has_video_extension` ->
   `has_media_extension`, `collect_video_paths` -> `collect_media_paths`. Command name
   `expand_dropped_paths` is unchanged (no "video" in it).
3. **Domain rename (FE)** - `video` -> `media` across the playlist-item layer (type, importer,
   picker, sort, list, context). Mechanical; the renamed suites prove behavior is unchanged.
4. **Picker + badges (FE)** - `openMediaFiles` filter admits audio exts; `EXTENSION_FORMAT` and
   `FORMAT_COLOR` gain the 8 audio formats.

### Why no HLS for audio

HLS exists solely to decode-ahead an un-copyable **video** stream while playback starts in ~0.2s.
Audio has no picture to show instantly, and an audio transcode to AAC is fast, so a single
`CompleteRemux` (complete file, native seek) is strictly better - no loopback server, no progressive
playlist. `strategy_for` routes every audio Convert to `CompleteRemux`.

### Why rename the domain layer but not the stream layer

`VideoNode`/`videosFromPaths`/`openVideoFiles` describe *playlist items*, which are now audio-or-video
- the name lies, rename to `media`. `VideoAction`/`AudioAction` and the `<video>` element describe an
actual video **stream** / the correct HTML tag - "video" is accurate there, leave them.

## File Structure

### Create
- `src/components/workspace/media-from-paths.ts` - renamed from `videos-from-paths.ts`
  (`mediaFromPaths`, `EXTENSION_FORMAT` with audio entries).
- `src/components/workspace/media-list.tsx` - renamed from `video-list.tsx` (`MediaList`).
- `src/components/workspace/__tests__/media-from-paths.test.ts` - renamed from
  `videos-from-paths.test.ts` + audio-format cases (TC-016/017).

### Modify (backend)
- `src-tauri/src/media.rs`:
  - `VideoAction` gains `None`.
  - `MediaStrategy::CompleteRemux` gains `video: VideoAction`.
  - `parse_probe_json` - skip `attached_pic` streams for the video-codec lookup.
  - `plan_media` - audio-only branch + `is_native_audio` helper.
  - `strategy_for` - `Convert { video: None, .. }` -> `CompleteRemux { video: None, audio }`; other
    audio Converts map to `CompleteRemux` too (never HLS when video is None).
  - `has_playable_stream` helper; `prepare_media` guard uses it.
  - `complete_remux` takes `VideoAction`, uses `video_convert_args` (which maps `None -> ["-vn"]`).
  - `video_convert_args` - add `VideoAction::None => vec!["-vn"]`.
  - `#[cfg(test)] mod tests` - new cases TC-001..011, TC-014.
- `src-tauri/src/import.rs`:
  - `VIDEO_EXTENSIONS` -> keep video + add `AUDIO_EXTENSIONS`; matcher checks both.
  - `has_video_extension` -> `has_media_extension`; `collect_video_paths` -> `collect_media_paths`.
  - test renames + TC-012/013.

### Modify (frontend)
- `src/components/workspace/mock-data.ts` - `AudioFormat`, `MediaFormat`, `MediaNode` (keep
  `VideoFormat` as the video subset).
- `src/components/workspace/format-color.ts` - `Record<MediaFormat, string>` + 8 audio entries.
- `src/components/workspace/sort-natural.ts` - `sortVideos` -> `sortMedia`, `VideoNode` -> `MediaNode`.
- `src/components/workspace/workspace-context.tsx` - `loadVideos`->`loadMedia`, `addVideos`->`addMedia`,
  `activeVideo`->`activeMedia`, `activeVideoId`->`activeMediaId`, `sourceVideos`->`sourceMedia`, types.
- `src/components/workspace/workspace.tsx` - import `mediaFromPaths`, `openMediaFiles`, call renamed
  context verbs, render `<MediaList>`.
- `src/components/workspace/viewport.tsx` - rename consumed `activeVideo`->`activeMedia` only (no
  logic change; still an `<video>` element).
- `src/components/workspace/transport-bar.tsx` + any other consumer of the renamed context fields.
- `src/lib/tauri.ts` - `openVideoFiles`->`openMediaFiles`; add `AUDIO_EXTENSIONS`; picker filter uses
  the union (one "Media" filter, or "Video"+"Audio" filters).
- All `__tests__/*` referencing renamed symbols - update imports/usages (mechanical).
- `README.md` - workspace prose: audio files are first-class (black viewport); accepted audio exts.
- `docs/learnings.md` - cover-art `attached_pic` gotcha; `<video>` plays audio natively.

## Tasks

### Task 1: Probe ignores cover-art streams

**Files:** Modify `src-tauri/src/media.rs` (`parse_probe_json` + tests).

**Interfaces:**
- Consumes: existing `ProbeResult`, `parse_probe_json(&str)`.
- Produces: `parse_probe_json` where the video-codec lookup skips any stream with
  `disposition.attached_pic == 1` (still returns first real video codec; empty when only cover art).

- [ ] Write failing tests TC-009 (cover art -> vcodec ""), TC-010 (real h264 -> "h264").
- [ ] Run, confirm FAIL (cover art currently returns `mjpeg`).
- [ ] Add the `attached_pic` filter to the `codec_for("video")` closure.
- [ ] Run, confirm PASS. Existing probe tests stay green.
- [ ] Commit (`feat: ignore attached_pic cover-art streams in probe`).

### Task 2: Audio-only plan + strategy + guard

**Files:** Modify `src-tauri/src/media.rs` (`VideoAction`, `MediaStrategy`, `plan_media`,
`strategy_for`, `is_native_audio`, `has_playable_stream`, `video_convert_args` + tests).

**Interfaces:**
- Consumes: `parse_probe_json` (Task 1), `ProbeResult`, existing `AudioAction`, `MediaPlan::Convert`.
- Produces:
  - `enum VideoAction { Copy, Reencode, None }`.
  - `fn is_native_audio(container: &str, acodec: &str) -> bool`.
  - `fn has_playable_stream(vcodec: &str, acodec: &str) -> bool`.
  - `plan_media(container, "", acodec)` -> `Passthrough` | `Convert { video: VideoAction::None, audio }`.
  - `strategy_for(Convert { video: None, audio })` -> `CompleteRemux { video: None, audio }`.
  - `MediaStrategy::CompleteRemux { video: VideoAction, audio: AudioAction }`.
  - `video_convert_args(VideoAction::None)` -> `vec!["-vn"]`.

- [ ] Write failing tests TC-001..008, TC-011, TC-014 (video regression).
- [ ] Run, confirm FAIL (audio-only currently mis-plans / no `None` variant compiles).
- [ ] Add `VideoAction::None`, `is_native_audio`, `has_playable_stream`, audio branch in `plan_media`,
      `CompleteRemux { video, audio }`, `strategy_for` audio mapping, `video_convert_args` arm.
- [ ] Run, confirm PASS incl. video regression.
- [ ] Commit (`feat: plan audio-only media as passthrough or complete remux`).

### Task 3: prepare_media accepts audio-only + audio remux emits -vn

**Files:** Modify `src-tauri/src/media.rs` (`prepare_media` guard, `complete_remux` signature +
call sites, `strategy_for` match arm wiring).

**Interfaces:**
- Consumes: Task 2 (`has_playable_stream`, `CompleteRemux { video, audio }`, `video_convert_args`).
- Produces: `complete_remux(app, path, video: VideoAction, audio: AudioAction, duration, started)`;
  `prepare_media` errors only when `!has_playable_stream(vcodec, acodec)`.

- [ ] (Guard is unit-covered by TC-011; `prepare_media` itself needs a live ffmpeg host so it is
      exercised by `cargo build` + user runtime test, not a unit test.)
- [ ] Swap the `if vcodec.is_empty()` guard for `has_playable_stream`; update the error message to
      "no audio or video stream".
- [ ] Thread `VideoAction` from `CompleteRemux { video, audio }` into `complete_remux`; replace the
      hardcoded `VideoAction::Copy` with the passed action.
- [ ] `cargo build` + `cargo clippy` clean.
- [ ] Commit (`feat: prepare_media plays audio-only files, remux drops absent video track`).

### Task 4: Import accepts audio extensions

**Files:** Modify `src-tauri/src/import.rs` (extensions, `has_media_extension`, `collect_media_paths`
+ tests).

**Interfaces:**
- Consumes: existing walk (`collect_into`).
- Produces: `fn has_media_extension(name: &str) -> bool` (video ∪ audio exts),
  `fn collect_media_paths(roots: &[String]) -> Vec<String>`; `expand_dropped_paths` delegates to it.

- [ ] Write failing tests TC-012 (`has_media_extension` audio true / non-media false), TC-013
      (mixed-tree collect) + rename existing video tests to the new fn names.
- [ ] Run, confirm FAIL (fn not renamed / audio ext rejected).
- [ ] Add `AUDIO_EXTENSIONS`, rename fns, matcher checks both sets.
- [ ] Run, confirm PASS.
- [ ] Commit (`feat: accept audio extensions in drag-drop import`).

### Task 5: FE data model + importer rename + audio formats

**Files:** Modify `mock-data.ts`, `format-color.ts`, `sort-natural.ts`; create `media-from-paths.ts`
+ `__tests__/media-from-paths.test.ts` (from the `videos-from-paths` pair).

**Interfaces:**
- Consumes: nothing new.
- Produces: `MediaNode`, `MediaFormat`, `AudioFormat`, `VideoFormat`; `mediaFromPaths(paths)`;
  `sortMedia(media, keys, dir)`; `FORMAT_COLOR: Record<MediaFormat, string>`.

- [ ] Write failing tests TC-016/017 (map audio+video, case-insensitive ext), TC-018 (badge color
      defined for every `MediaFormat`), TC-019 (`sortMedia` mixed list).
- [ ] Run, confirm FAIL (types/fns not renamed, audio formats undefined).
- [ ] Rename type + fns; add 8 audio entries to `EXTENSION_FORMAT` + `FORMAT_COLOR`.
- [ ] Run, confirm PASS.
- [ ] Commit (`feat: MediaNode model + audio formats and colors`).

### Task 6: FE picker + context + consumers rename

**Files:** Modify `lib/tauri.ts`, `workspace-context.tsx`, `workspace.tsx`, `viewport.tsx`,
`transport-bar.tsx`, `sidebar.tsx` (renders `<MediaList>`), `media-list.tsx` (create from
`video-list.tsx`), all touched `__tests__/*`, `lib/__tests__/tauri.test.ts`.

**Interfaces:**
- Consumes: Task 5 (`MediaNode`, `mediaFromPaths`).
- Produces: `openMediaFiles()` (picker filter includes audio exts); context `loadMedia`, `addMedia`,
  `activeMedia`, `activeMediaId`; `<MediaList>`.

- [ ] Write/adjust failing test TC-015 (`openMediaFiles` filter includes audio exts); rename the
      context/behavior suite usages (TC-020 - existing behavior must stay green post-rename).
- [ ] Run, confirm FAIL (symbols not renamed / audio ext absent from filter).
- [ ] Rename `openVideoFiles`->`openMediaFiles` + add `AUDIO_EXTENSIONS` to the filter; rename context
      verbs/fields + every consumer; rename `video-list.tsx`->`media-list.tsx`.
- [ ] Run full `npm test`, confirm PASS (whole suite - proves the rename is behavior-preserving).
- [ ] Commit (`feat: openMediaFiles picker + media-named context and playlist`).

### Task 7: Docs + full gate

**Files:** Modify `README.md`, `docs/learnings.md`.

- [ ] README workspace prose: audio files first-class (black viewport), accepted audio exts.
- [ ] learnings.md: `attached_pic` cover-art gotcha; `<video>` plays audio natively.
- [ ] Run all gates: `npm run lint`, `npm run typecheck`, `npm test`, `cargo test`, `cargo build`,
      `cargo clippy`.
- [ ] Commit (`docs: audio player support`).

## Edge cases (from spec §6)

E-1 cover art (Task 1), E-2 neither-stream Err (Task 3), E-3 raw aac ADTS copy-to-mp4 (Task 2),
E-4 m4a passthrough (Task 2), E-5 audio-only opus transcode (Task 2), E-7 mixed folder (Task 4),
E-8 unmapped ext unreachable (Task 5 filter), E-9 native-audio decode fallback (runtime test).

## Tests (one per AC minimum)

| AC | Test(s) |
|----|---------|
| AC-001 | TC-012, TC-013 (Rust), TC-015, TC-016, TC-017 (FE) |
| AC-002 | TC-001..004 (Rust) |
| AC-003 | TC-005..008 (Rust) |
| AC-004 | TC-011 (Rust) + `prepare_media` guard swap (build) |
| AC-005 | TC-009, TC-010 (Rust) |
| AC-006 | TC-016, TC-018, TC-019, TC-020 (FE) |
| AC-007 | viewport unchanged (renamed field) + user runtime test (black frame) |
| AC-008 | TC-014 (Rust regression) + TC-020 (FE full-suite green post-rename) |
| AC-009 | Task 7 gate run |

## Risks

- Native-audio passthrough (flac/wav) relies on the webview decoding it: mitigate by user `npm start`
  runtime test of one flac + one wav; non-native codecs always transcode (safe fallback).
- `CompleteRemux` blocks until done for long non-native audio (E-6): acceptable - no instant-picture
  need for audio; a few seconds for AAC. Not adding a two-phase audio path (YAGNI).
- Rename touches ~15 files incl. tests: mitigate by running the **full** `npm test` + `cargo test`
  after Task 6 - any behavior drift surfaces as a red existing test.
- `prepare_media` end-to-end (AC-002/003/004) needs a live ffmpeg host -> `cargo build` + user runtime
  test; pure decision logic is fully unit-covered.

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-18 | Design gate: `pz-codebase-design` invoked; `pz-ddd` + `pz-archetypes` evaluated, not applicable. | No new domain model/aggregate/archetype; the work widens an existing module's interface (the media-pipeline ADT) - a structural-depth question, which `pz-codebase-design` owns. |
| 2026-07-18 | Audio = first-class playlist items, black viewport, no audio-specific UI. | User: "dokladnie to samo co jest teraz, tylko po prostu nie ma video - jest czarny ekran". `<video>` plays audio-only natively, so reuse the whole workspace. |
| 2026-07-18 | Widen existing `MediaPlan`/`MediaStrategy` ADT (audio-only branch) rather than a parallel audio pipeline. | Keeps one deep decision module; audio is just the `vcodec == ""` shape. Alternatives (separate `prepare_audio` command) duplicated the probe/remux/state machinery. |
| 2026-07-18 | No HLS for audio; every audio Convert -> `CompleteRemux`. | HLS only earns its keep decode-ahead of un-copyable video; audio has no picture to show instantly and AAC transcode is fast. |
| 2026-07-18 | Probe ignores `disposition.attached_pic` streams. | Embedded cover art (mjpeg/png) otherwise reads as a non-h264 video track and routes to HLS re-encode of a nonexistent motion video. |
| 2026-07-18 | Rename domain `video`->`media`; keep stream-level `VideoAction`/`AudioAction` + `<video>` element. | Playlist items are now audio-or-video (name lies); stream/tag names remain accurate. User chose the rename over widen-in-place. |
| 2026-07-18 | Accepted audio exts: mp3/m4a/aac/flac/wav/ogg/opus/wma; picker + import. | User-selected "common set"; non-native (ogg/opus/wma) transcode via the existing ffmpeg path. |
| 2026-07-18 | Full rename incl. shortcut action ids (`next-video`->`next-media`) + UI labels + `videos` prop + viewport strings, beyond AC-008's list. | User chose "everything". Action-id rename is a persisted-key breaking change, so a `RENAMED_ACTION_IDS` migration in `mergeShortcuts` maps old override keys to new ids so saved rebinds survive upgrade. Kept `VideoFormat` (video subset of `MediaFormat`), stream-level `VideoAction`/`AudioAction`, `<video>` element. |

## AC traceability (final)

| AC | Proven by |
|----|-----------|
| AC-001 | Rust `should_accept_media_extensions_and_reject_others`, `should_collect_audio_and_video_sorted_excluding_non_media`; FE `mediaFromPaths` per-ext + mixed tests, `openMediaFiles` filter test |
| AC-002 | Rust `plan_media` passthrough tests (mp3/m4a-aac/flac/wav-pcm) |
| AC-003 | Rust `plan_media` ogg-opus/asf-wmav2/raw-aac + `strategy_for` -> `CompleteRemux{None,..}` tests |
| AC-004 | Rust `should_report_unplayable_only_when_neither_stream_present` + `prepare_media` guard |
| AC-005 | Rust `should_ignore_cover_art_stream_when_parsing_probe_json`, `should_keep_real_video_when_attached_pic_is_zero` |
| AC-006 | FE `FORMAT_COLOR` exhaustive test, `sortMedia` mixed-list tests, full workspace-context behavior suite |
| AC-007 | viewport renders `<video>` (unchanged), "Media viewport" region + "No media selected"; black frame = runtime (user npm start) |
| AC-008 | Rust `should_leave_video_plans_unchanged_when_widening_for_audio` + full FE suite green post-rename; migration tests for renamed action ids |
| AC-009 | lint 0-err, typecheck 0, npm test 481 pass, cargo test 64 pass, cargo build, clippy 0 |

## Verification (final)

All gates green: `npm run lint` (0 err, 5 pre-existing warns), `npm run typecheck`, `npm test` (481,
incl. e2e), `cargo test` (64), `cargo build`, `cargo clippy` (0). Two fresh-context verifier passes:
PASS on all 9 ACs, all 6 gates, all adversarial probes (audio-only never routes to HLS, `-vn` on
audio remux, `has_playable_stream` guard, cover-art skip is video-only, `is_native_audio` container
gate, settings migration key direction correct, no half-renames). E-3 gap (raw-aac plan test) closed.

Runtime-only (needs user `npm start`): AC-007 black-frame render + AC-002/003/004 end-to-end ffmpeg
(a real flac/wav plays passthrough, a real opus/wma transcodes, a cover-art mp3 is not HLS'd).

Status: code complete + machine-verified. On-device playback of real audio files is the only
unverified surface (no ffmpeg host in sandbox).

## Coverage threshold

`none` (no enforced coverage threshold in `vitest.config.*` / `package.json`).

## Infrastructure Prerequisites

| Category              | Requirement |
| --------------------- | ----------- |
| Environment variables | N/A |
| Registry images       | N/A |
| Cloud quotas          | N/A |
| Network reachability  | N/A |
| CI status             | N/A |
| External secrets      | N/A |
| Database migrations   | N/A |

Runtime prerequisite (not infra): bundled `ffmpeg`/`ffprobe` sidecars present
(`scripts/fetch-ffmpeg.sh`) - already required for the existing video path; confirmed by the passing
video pipeline. Verification: `cargo build` resolves the sidecars; user `npm start` plays a real
audio file end-to-end.
