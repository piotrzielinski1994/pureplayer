# Spec: Playback serves a complete file (correct duration)

**Version:** 0.1.0
**Created:** 2026-06-20
**Status:** Draft

## 1. Overview

On-device verification of FR-2 (bundled ffmpeg) surfaced two playback bugs with one root cause.
`prepare_media` (`src-tauri/src/media.rs`) starts ffmpeg writing a **fragmented** MP4
(`-movflags frag_keyframe+empty_moov+default_base_moof`) and returns the path the moment ~256KB
exist, while ffmpeg keeps appending. `<video src="asset://...">` reads the file's size once (the
asset protocol serves the on-disk length at request time), so it treats the buffered ~1s as the
entire clip:

1. **Wrong duration** - a long clip shows `00:01 / 00:01`. VLC reads the finished *source*, so it
   is unaffected; only our served, still-growing temp file is wrong.
2. **Slow first frame** - for WebM/VP9/AV1 even the first 256KB of a re-encode takes seconds.

Additionally `is_directly_playable` checks only the **codec** (h264/aac), not the **container**:
an MKV with h264/aac is wrongly tagged "direct" and served raw, but macOS WKWebView cannot play
MKV/AVI at all.

The fix: stop serving a growing file. Produce a **complete, finalized** MP4 and return only when
it is whole. Decide what each stream needs (a small ADT), so we remux (fast, stream-copy) when
only the container is wrong and re-encode only the streams that truly need it.

What this delivers:
- Container-aware, per-stream decision: `plan_media(container, vcodec, acodec) -> MediaPlan`.
- `prepare_media` produces a complete MP4 (`+faststart`, finalized moov) and waits for it.
- Atomic cache via `.part` -> rename so a cache hit always means a complete file.

What this does NOT deliver (out of scope):
- Progress percentage / ETA during a long transcode (spinner only, as today).
- Hardware-tuned bitrate ladders, subtitle burn-in, multi-audio-track handling.
- Any frontend change (the viewport + `prepareMediaUrl` were already correct).

### User Story

As a user I open a long video and want the player to show its real length and play the whole
thing, fast for ordinary files (MKV/H.264) and correctly for exotic codecs - instead of a clip
that claims to be one second long.

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | A long clip reports its REAL duration once metadata loads (not `00:01`). | Must |
| AC-002 | H.264 video in a non-MP4 container (MKV/AVI) is REMUXED with `-c:v copy` (no video re-encode) into a complete playable MP4. | Must |
| AC-003 | Video the webview can't decode (VP9/AV1/HEVC) is fully re-encoded to H.264 into a complete MP4 that plays start-to-finish. | Must |
| AC-004 | Audio is copied when webview-playable (aac/mp3), dropped when absent, else re-encoded to AAC (opus/ac3/...). | Must |
| AC-005 | H.264/AAC (or H.264/MP3) already in an MP4/MOV container is served as-is - passthrough, no transcode/copy. | Must |
| AC-006 | The returned file is COMPLETE before `prepare_media` returns (no fragmented/empty-moov streaming); a finished transcode is cached and reused on next open of the same source. | Must |
| AC-007 | The decision is a PURE function `plan_media(container, vcodec, acodec)` unit-tested across container/codec combinations; the spawn path has no codec ifology. | Must |
| AC-008 | `cargo test`, `cargo build`, `cargo clippy` (0 warns), `npm run lint`, `npm run typecheck`, `npm test` all exit 0. | Must |

## 3. User Test Cases

### TC-001: Passthrough (mp4/h264/aac)
`plan_media("mov,mp4,m4a,3gp,3g2,mj2", "h264", "aac")` -> `Passthrough`. Maps to: AC-005.

### TC-002: Remux (mkv/h264/aac)
`plan_media("matroska,webm", "h264", "aac")` -> `Convert { video: Copy, audio: Copy }`. Maps to: AC-002.

### TC-003: Full transcode (mkv/vp9/opus)
`plan_media("matroska,webm", "vp9", "opus")` -> `Convert { video: Reencode, audio: Reencode }`. Maps to: AC-003, AC-004.

### TC-004: MP4 container but undecodable video (mp4/av1/aac)
`plan_media("mov,mp4,m4a,3gp,3g2,mj2", "av1", "aac")` -> `Convert { video: Reencode, audio: Copy }`. Maps to: AC-003.

### TC-005: No audio (mkv/h264/none)
`plan_media("matroska,webm", "h264", "")` -> `Convert { video: Copy, audio: Drop }`. Maps to: AC-004.

### TC-006: Bad audio only (avi/h264/ac3)
`plan_media("avi", "h264", "ac3")` -> `Convert { video: Copy, audio: Reencode }`. Maps to: AC-004.

### TC-007: H.264/MP3 in mp4 is fine (mp4/h264/mp3)
`plan_media("mov,mp4,m4a,3gp,3g2,mj2", "h264", "mp3")` -> `Passthrough`. Maps to: AC-005.

### TC-008: Cache path deterministic
`cache_path(src)` stable for the same source, under `pureplayer-transcode`, `.mp4` suffix. Maps to: AC-006 (regression guard).

## 4. UI States

| State     | Behavior |
| --------- | -------- |
| Preparing | Spinner "Preparing <name>…" until the COMPLETE file is ready (remux: seconds; full transcode: up to clip length). |
| Ready     | `<video>` plays a finalized file; transport shows real duration. |
| Error     | ffmpeg failed -> "Could not play this file" + message. |

## 5. Data Model

```rust
enum VideoAction { Copy, Reencode }
enum AudioAction { Copy, Reencode, Drop }
enum MediaPlan {
    Passthrough,                                   // serve the source untouched
    Convert { video: VideoAction, audio: AudioAction },
}

// container = ffprobe format_name (comma list), vcodec/acodec = ffprobe codec_name (a:"" = none)
fn plan_media(container: &str, vcodec: &str, acodec: &str) -> MediaPlan;
```

Rules:
- MP4-family container (`format_name` contains `mp4`) AND vcodec h264 AND acodec in {aac, mp3, none} -> `Passthrough`.
- Else `Convert`: video `Copy` if h264 else `Reencode`; audio `Drop` if none, `Copy` if {aac, mp3}, else `Reencode`.

`PreparedMedia { path, transcoded }` unchanged. `prepare_media` builds ffmpeg args from the plan;
output uses `-movflags +faststart` (finalized, seekable) - NOT `frag_keyframe+empty_moov`.

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | MP4 container but av1/hevc video | `Convert{Reencode, ...}` - container says mp4 but codec undecodable, so still convert |
| E-2 | h264 in mkv with aac | `Convert{Copy, Copy}` remux - fast, no re-encode |
| E-3 | No audio stream (a:0 empty) | `AudioAction::Drop` -> ffmpeg `-an` |
| E-4 | ffmpeg copy fails (exotic h264) | non-zero exit -> Err -> existing "Could not play" UI |
| E-5 | Re-open same source | complete cached `<hash>.mp4` exists -> returned immediately |
| E-6 | Stale `.part` from a killed run | overwritten (`-y`) / removed before spawn; only a renamed complete file is a cache hit |
| E-7 | Very long transcode | awaited to completion; spinner stays; no premature timeout kill on the convert path |

## 7. Dependencies

Bundled ffmpeg/ffprobe sidecars (FR-2) - already shipped. No new packages, no frontend change.

## 8. Out of Scope

Progress %, subtitles, multi-track audio, bitrate ladders, HW-encoder tuning beyond the existing
`h264_videotoolbox` on macOS.

## 9. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-06-20 | Initial - serve a complete finalized MP4; container-aware per-stream `plan_media`; fixes 00:01 duration + slow start. |
