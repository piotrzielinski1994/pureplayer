# Spec: Audio player support

**Version:** 0.1.0
**Created:** 2026-07-18
**Status:** Implemented (code complete + machine-verified; on-device audio playback pending user `npm start`)
**Branch:** `20260718222553-audio-player-support`

## 1. Overview

Let pureplayer open and play **audio-only files** (mp3, m4a, aac, flac, wav, ogg, opus, wma) as
first-class playlist items. An audio file behaves **exactly like a video** everywhere - it appears
as a playlist row, drives the transport bar, queue (next/prev/auto-advance/shuffle/repeat), seek,
volume, mute, and speed identically. The only difference is the viewport shows a **black frame**
(no picture), because there is no video track. There is no audio-specific UI: no cover art, no
waveform, no now-playing screen (explicitly cut by the user).

Two coupled changes:

1. **Backend media pipeline (`media.rs`)** learns an **audio-only** shape. Today `prepare_media`
   hard-errors on any file with no video stream, and `plan_media` assumes a video track exists
   (a non-h264 vcodec routes to HLS video re-encode). We widen the existing `MediaPlan` /
   `MediaStrategy` ADT with a "no video stream" case so an audio file is either played untouched
   (native codec) or remuxed/re-encoded to a complete AAC-in-MP4 (non-native codec). No HLS is ever
   used for audio (no video to decode-ahead).
2. **Rename `video` -> `media`** across the *domain* layer (playlist item, importers, pickers,
   sort) so the names stop lying now that a playlist item can be audio. Stream-level ffmpeg terms
   (`VideoAction` / `AudioAction`) and the HTML `<video>` element are **intentionally unchanged** -
   there "video" means the actual video stream / the correct HTML tag, which plays audio too.

### Cover-art gotcha (drives AC-005)

An mp3/flac carrying embedded cover art exposes a still-image "video" stream (`mjpeg`/`png`) with
ffprobe `disposition.attached_pic == 1`. Naively that reads as a non-h264 video track and routes to
HLS re-encode of a nonexistent motion video. The probe must **ignore `attached_pic` streams** so the
file is correctly seen as audio-only.

### User Story

As a user I want to open a music file (or drop a folder of songs) into pureplayer and have it play,
queue, seek, and shuffle exactly like a video - just with a black screen - so I can use the one
player for both without switching apps.

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | The Open Files picker and drag-drop import accept audio extensions (`mp3`/`m4a`/`aac`/`flac`/`wav`/`ogg`/`opus`/`wma`, case-insensitive) alongside the existing video set; each accepted audio file becomes a playlist row. | Must |
| AC-002 | An audio-only file with a webview-native codec+container (mp3; aac-in-mp4/m4a; flac; wav/pcm) is played **passthrough** - `prepare_media` returns the original path, `transcoded == false`, no ffmpeg run. | Must |
| AC-003 | An audio-only file with a non-native codec (opus / vorbis / wma) is produced as a **complete** AAC-in-MP4 with the video track dropped (`CompleteRemux`, `transcoded == true`), so playback plays and seeks natively. No HLS is used. | Must |
| AC-004 | `prepare_media` no longer errors on a file that has no video stream; it errors only when the file has **neither** an audio nor a video stream. | Must |
| AC-005 | An audio file carrying embedded cover art (a `mjpeg`/`png` stream with `disposition.attached_pic == 1`) is treated as audio-only (the cover-art stream is ignored), not as a video to re-encode. A genuine motion-video stream (no `attached_pic`) is still detected as video. | Must |
| AC-006 | An audio item is fully generic in the workspace: it shows a format badge (`MP3`/`FLAC`/...), and playlist selection, sort (title/type), transport play/pause, prev/next, auto-advance on end, shuffle, repeat (off/all/one), seek, volume, mute, and speed all operate on it identically to a video item. | Must |
| AC-007 | Audio-only playback renders in the existing viewport as a black frame via the same `<video>` element - no audio-specific UI is added. The transient title card still shows the filename briefly, as it does for video. | Must |
| AC-008 | Domain `video`-named identifiers are renamed to `media` with no behavioral change: `MediaNode`, `MediaFormat`, `mediaFromPaths`, `openMediaFiles`, `loadMedia`, `addMedia`, `activeMedia`/`activeMediaId`, `sortMedia`, `has_media_extension`, `collect_media_paths`. Stream-level `VideoAction`/`AudioAction` and the `<video>` element are deliberately **not** renamed. | Must |
| AC-009 | `npm run lint`, `npm run typecheck`, `npm test`, `cargo test`, `cargo build`, `cargo clippy` all exit 0. | Must |

## 3. User Test Cases

Two layers: pure Rust unit tests (`cargo test`) own the pipeline decisions; Vitest behavior tests
own the domain/import layer through the mocked `@/lib/tauri` seam.

### Rust (pure, no Tauri host / ffmpeg)

- **TC-001 (passthrough mp3):** `plan_media("mp3", "", "mp3")` -> `Passthrough`. Maps to: AC-002.
- **TC-002 (passthrough m4a/aac):** `plan_media("mov,mp4,m4a,3gp,3g2,mj2", "", "aac")` -> `Passthrough`. Maps to: AC-002.
- **TC-003 (passthrough flac):** `plan_media("flac", "", "flac")` -> `Passthrough`. Maps to: AC-002.
- **TC-004 (passthrough wav):** `plan_media("wav", "", "pcm_s16le")` -> `Passthrough`. Maps to: AC-002.
- **TC-005 (opus transcode):** `plan_media("ogg", "", "opus")` -> `Convert { video: None, audio: Reencode }`. Maps to: AC-003.
- **TC-006 (wma transcode):** `plan_media("asf", "", "wmav2")` -> `Convert { video: None, audio: Reencode }`. Maps to: AC-003.
- **TC-007 (strategy audio reencode):** `strategy_for(Convert { video: None, audio: Reencode })` -> `CompleteRemux { video: None, audio: Reencode }`. Maps to: AC-003.
- **TC-008 (strategy audio copy):** `strategy_for(Convert { video: None, audio: Copy })` -> `CompleteRemux { video: None, audio: Copy }` (e.g. aac in a non-native container). Maps to: AC-003.
- **TC-009 (cover art ignored):** `parse_probe_json` on a payload whose video stream has `disposition.attached_pic == 1` (codec `mjpeg`) plus an `mp3` audio stream -> `vcodec == ""`, `acodec == "mp3"`. Maps to: AC-005.
- **TC-010 (real video not ignored):** `parse_probe_json` on a normal `h264` video stream (no `disposition`, or `attached_pic == 0`) -> `vcodec == "h264"`. Maps to: AC-005 (negative).
- **TC-011 (playable guard):** `has_playable_stream("", "")` -> false; `has_playable_stream("", "aac")` -> true; `has_playable_stream("h264", "")` -> true. Maps to: AC-004.
- **TC-012 (media extension helper):** `has_media_extension` on `song.mp3`, `a.FLAC`, `x.OPUS`, `clip.mp4`, `CLIP.MKV` -> true; on `doc.pdf`, `noext` -> false. Maps to: AC-001.
- **TC-013 (collect mixed tree):** `collect_media_paths` on a temp dir with `song.mp3`, `nested/clip.mp4`, `notes.txt` -> `[song.mp3, nested/clip.mp4]` sorted, `notes.txt` excluded. Maps to: AC-001.
- **TC-014 (video regression):** existing video plans are unchanged - `plan_media("mov,mp4,...","h264","aac")` -> `Passthrough`; `plan_media("matroska,webm","h264","opus")` -> `Convert { Copy, Reencode }`; `plan_media("matroska,webm","av1","aac")` -> `Convert { Reencode, Copy }`. Maps to: AC-008 (no behavior change).

### Frontend (Vitest, mocked seam)

- **TC-015 (picker accepts audio):** `openMediaFiles()` opens the dialog with a filter whose extensions include the audio set (e.g. `mp3`, `flac`). (side-effect-contract) Maps to: AC-001.
- **TC-016 (map audio + video):** `mediaFromPaths(["/m/song.mp3", "/m/clip.mp4"])` -> two `MediaNode`s with `format` `MP3` and `MP4` and matching `path`/`name`. Maps to: AC-001, AC-006.
- **TC-017 (ext case-insensitive):** `mediaFromPaths(["/m/SONG.FLAC"])[0].format` -> `FLAC`. Maps to: AC-001.
- **TC-018 (badge color exists):** `FORMAT_COLOR` has a defined class for every `MediaFormat` value, audio included (no `undefined`). Maps to: AC-006.
- **TC-019 (sort audio):** `sortMedia` orders a mixed audio+video list by title and by type deterministically. Maps to: AC-006.
- **TC-020 (rename regression):** the existing workspace context/behavior suite passes against the renamed API (`loadMedia`/`addMedia`/`activeMedia`), proving playback/queue/seek behavior is byte-for-byte unchanged for the renamed items. Maps to: AC-008, AC-006.

## 4. UI States

Audio reuses every existing state; the only difference is the viewport picture is black.

| State                | Behavior                                                                              |
| -------------------- | ------------------------------------------------------------------------------------- |
| No selection         | Unchanged: `Film` icon + "No video selected".                                         |
| Preparing (audio)    | Unchanged: spinner + "Preparing &lt;name&gt;...".                                     |
| Playing (audio)      | `<video>` element mounted, renders a **black frame** (no picture); audio plays. Title card shows the filename for 5s, then the screen is fully black. Transport/queue/seek all live. |
| Error (audio)        | Unchanged: "Could not play this file" + message (e.g. neither stream present).        |
| Playlist row (audio) | A row with the filename + a format badge (`MP3`/`FLAC`/...), selectable/sortable like a video row. |

No new components, no layout change. (Per user: "dokladnie to samo co jest teraz, tylko po prostu
nie ma video - jest czarny ekran".)

## 5. Data Model

### Frontend

```ts
// mock-data.ts - widen the format union; add an audio family.
export type VideoFormat = "MP4" | "MKV" | "MOV" | "WEBM" | "AVI";        // unchanged set
export type AudioFormat = "MP3" | "M4A" | "AAC" | "FLAC" | "WAV" | "OGG" | "OPUS" | "WMA";
export type MediaFormat = VideoFormat | AudioFormat;

// VideoNode -> MediaNode (only the name + format type change).
export type MediaNode = { id: string; name: string; format: MediaFormat; path: string };
```

- `videos-from-paths.ts` -> `media-from-paths.ts`: `videosFromPaths` -> `mediaFromPaths`;
  `EXTENSION_FORMAT` gains the 8 audio entries.
- `format-color.ts`: `FORMAT_COLOR: Record<MediaFormat, string>` gains an entry per audio format.
- `sort-natural.ts`: `sortVideos` -> `sortMedia` (signature over `MediaNode`).
- `video-list.tsx` -> `media-list.tsx`: `VideoList` -> `MediaList` (renders playlist rows; no logic change).
- `workspace-context.tsx`: `loadVideos` -> `loadMedia`, `addVideos` -> `addMedia`,
  `activeVideo` -> `activeMedia`, `activeVideoId` -> `activeMediaId` (types swap `VideoNode` -> `MediaNode`).
- `lib/tauri.ts`: `openVideoFiles` -> `openMediaFiles`; `VIDEO_EXTENSIONS` -> `VIDEO_EXTENSIONS` +
  `AUDIO_EXTENSIONS` (picker filter uses the union).

### Backend (`media.rs`)

Widen the existing ADT for the "no video stream" shape:

```rust
enum VideoAction { Copy, Reencode, None }   // + None = drop the (absent/cover-art) video track (-vn)

enum MediaStrategy {
    CompleteRemux { video: VideoAction, audio: AudioAction },  // now carries the video action
    VideoThenAudio,                                            // unchanged (video-with-bad-audio only)
    HlsStream { video: VideoAction, audio: AudioAction },      // unchanged
}
```

- `plan_media(container, vcodec, acodec)`: if `vcodec.is_empty()` -> audio-only branch
  (`Passthrough` when `is_native_audio`, else `Convert { video: None, audio }`); existing video
  branch unchanged.
- `is_native_audio(container, acodec) -> bool`: native codec (`aac`/`mp3`/`flac`/`pcm*`) in a native
  container (`mp4`/`mov`/`mp3`/`flac`/`wav`).
- `has_playable_stream(vcodec, acodec) -> bool`: `!(vcodec.is_empty() && acodec.is_empty())` -
  the new `prepare_media` guard.
- `parse_probe_json`: the video-codec lookup skips streams with `disposition.attached_pic == 1`.
- `complete_remux` takes the `VideoAction` (from the strategy) instead of hardcoding `Copy`, so an
  audio-only remux emits `-vn`.
- `import.rs`: `VIDEO_EXTENSIONS` -> video + audio sets; `has_video_extension` -> `has_media_extension`;
  `collect_video_paths` -> `collect_media_paths`. Command name `expand_dropped_paths` is unchanged
  (contains no "video"; it now filters media).

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | mp3/flac with embedded cover art (`attached_pic`) | probe ignores the cover-art stream -> audio-only path (AC-005) |
| E-2 | File with neither audio nor video (corrupt / empty) | `has_playable_stream` false -> `prepare_media` Err -> viewport error state (AC-004) |
| E-3 | Raw `.aac` ADTS (container `aac`, non-native container) | not native container -> `Convert { None, Copy }` -> `CompleteRemux` copies aac into mp4 |
| E-4 | `.m4a` with aac (native container+codec) | `Passthrough` (AC-002) |
| E-5 | Audio-only `.webm`/`.ogg` with opus (no video stream) | `vcodec == ""` -> audio-only, opus non-native -> transcode to AAC-in-MP4 (AC-003) |
| E-6 | Long non-native audio (e.g. 3h opus podcast) | `CompleteRemux` blocks until the remux completes (a few seconds); no instant-picture requirement for audio, so this is acceptable (see Risks) |
| E-7 | Folder drop mixing audio + video | `collect_media_paths` keeps both, sorted (AC-001) |
| E-8 | Audio file with an unmapped extension reaching the FE | import filter only admits known exts; `formatOf` fallback is never user-reachable |
| E-9 | Native-audio passthrough that a given webview can't decode | falls to the viewport error state; the transcode path is the safe fallback for non-native codecs. macOS/WKWebView flac/wav support is validated in runtime testing (Risks) |

## 7. Out of Scope

- Cover art, ID3/metadata display (artist/album/title), waveform, or any now-playing audio UI.
- A separate audio mode/view or layout switching.
- Playlist persistence, subtitles (already out of scope repo-wide).
- Renaming stream-level `VideoAction`/`AudioAction` or the `<video>` element / `viewport.tsx`.
- Per-platform native-codec detection (e.g. play opus directly on Chromium); non-native always transcodes.

## 8. Dependencies

Reused only: the bundled `ffmpeg`/`ffprobe` sidecars, `@tauri-apps/plugin-dialog`, the existing
`WorkspaceProvider` context, the asset protocol, Tailwind tokens. No new npm or cargo packages.

## 9. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-07-18 | Initial draft - audio as first-class playlist items (black viewport); widen media ADT for audio-only (passthrough / complete-remux, no HLS); ignore cover-art streams; rename domain `video` -> `media`. |
