# Plan: Playback serves a complete file

Implements [spec.md](spec.md). TDD red-green-refactor. Branch: `20260620194833-playback-complete-file`.

## Approach

The bug is entirely in `src-tauri/src/media.rs` (the served file). Frontend is correct and unchanged.

Replace the codec-only `is_directly_playable` + fragmented-streaming spawn with:

1. **Pure decision** `plan_media(container, vcodec, acodec) -> MediaPlan` using the ADT
   (`MediaPlan`/`VideoAction`/`AudioAction`). All branching lives here, unit-tested - the spawn
   path just matches on the plan.
2. **Probe the container too**: add `format_name` to the ffprobe calls
   (`-show_entries format=format_name`). Today only v:0/a:0 codecs are probed.
3. **Complete-file output**: build ffmpeg args from the plan, write to `<hash>.mp4.part`,
   AWAIT `CommandEvent::Terminated`, and on success `rename` to `<hash>.mp4`. The rename is the
   atomic cache-complete marker. Output flags: `-movflags +faststart` (finalized moov, seekable),
   NOT `frag_keyframe+empty_moov+default_base_moof`.
4. **Passthrough** returns the source path untouched (`transcoded: false`).
5. **Cache hit**: `target.exists()` -> return it (only complete files are renamed in, so existence
   = complete; drop the `> MIN_STREAM_BYTES` heuristic).

ffmpeg arg shape per plan:
- video Copy -> `-c:v copy`; video Reencode -> `h264_videotoolbox -b:v 6M` (macOS) / `libx264 -preset veryfast -crf 23`.
- audio Copy -> `-c:a copy`; Reencode -> `-c:a aac`; Drop -> `-an`.
- always `-y -v error -i <src> ... -movflags +faststart <target.part>`.

The detached-drain task stays (the shell plugin still force-pipes the bounded channel), but now we
WAIT for termination before returning (no early "first bytes" break), so the file is complete.
Remove the 20s first-bytes timeout for the convert path (a legit long transcode must not be killed);
keep ffmpeg failure detection via the `Terminated` code.

## Files

### Modify
- `src-tauri/src/media.rs` - ADT + `plan_media` (replace `is_directly_playable`); probe
  `format_name`; rewrite the spawn/wait/rename; drop fragmented flags + first-bytes loop;
  update `#[cfg(test)] mod tests` (codec-pair tests become `plan_media` tests).
- `docs/adr.md` - row: complete-file over fragmented-streaming; container-aware decision.
- `docs/learnings.md` - the served-growing-file -> stale-size -> wrong-duration gotcha + the
  container-vs-codec distinction.
- `README.md` - workspace prose: drop the "starts playing in under a second" / streaming claim;
  state remux-is-fast / full-transcode-waits.
- `.pzielinski/FR-2-playback-fix.md` - AC traceability at the end.

### No change
- Frontend (`viewport.tsx`, `tauri.ts`) - the served file was the bug, not the player.

## Tests (TDD)

Rust (`cargo test` in `src-tauri`), the layer that owns this:
- `plan_media` for every TC-001..TC-007 combination (passthrough / remux / full transcode /
  mp4+bad-video / no-audio / bad-audio-only / h264+mp3). (AC-002..AC-005, AC-007)
- `cache_path` determinism + pureplayer-transcode + .mp4 (regression guard, TC-008). (AC-006)

Not unit-testable (needs a Tauri host + real binaries + real media): the actual ffmpeg spawn,
correct duration in `<video>`, remux speed. Covered by `cargo build` + **user `npm start`** with
the same MKV/WebM clips that exposed the bug (AC-001/006 end-to-end).

## Acceptance verification

| AC | Verified by |
|----|-------------|
| AC-001 | user `npm start` - long clip shows real duration (was 00:01) |
| AC-002 | `plan_media` remux test + user `npm start` (MKV plays, fast) |
| AC-003 | `plan_media` reencode tests + user `npm start` (WebM/AV1 plays whole) |
| AC-004 | `plan_media` audio tests (copy/drop/reencode) |
| AC-005 | `plan_media` passthrough tests (mp4/h264/aac, mp4/h264/mp3) |
| AC-006 | code review (`.part`->rename, complete-file existence cache) + user re-open |
| AC-007 | `cargo test` (plan_media pure tests) + grep: no codec branching in spawn path |
| AC-008 | `cargo test` + `cargo build` + `cargo clippy` + `npm run lint` + `npm run typecheck` + `npm test` |

## Risks

- Long transcode = long spinner: accepted; remuxables fast. Progress UI is a later feature.
- `-c:v copy` MKV->MP4 fails on exotic h264 profiles: surfaces as the existing error UI, not silent.
- Removing the first-bytes timeout could hang on a stuck ffmpeg: mitigate by keeping a (generous)
  upper bound or relying on `Terminated`; a stuck encode is rare and visible as a stuck spinner.

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-20 | Complete finalized MP4, drop fragmented <1s-start streaming. | Growing file -> `<video>` stale size -> 00:01 duration + partial play. Correctness wins. |
| 2026-06-20 | `plan_media` is container-aware (replaces codec-only `is_directly_playable`). | MKV/h264/aac wrongly "direct"; WKWebView can't play MKV - must remux container. |
| 2026-06-20 | Per-stream ADT (Video/AudioAction). | Remux when only container is wrong; re-encode only the stream that needs it - speed + no ifology. |
| 2026-06-20 | `.part` -> atomic rename as cache-complete marker. | Existence then reliably means complete; never serve a half-written file. |

## Verification (final)

All gates green: `cargo test` (12), `cargo build`, `cargo clippy` (0 warns - old
`is_directly_playable`/`file_len`/unused imports removed), `npm test` (200, FE unchanged),
`npm run lint` (0 err), `npm run typecheck`. Fresh-context verifier: PASS on all 8 ACs.
Adversarial check confirmed `plan_media` matches the REAL ffprobe `format_name` comma-list
(`mov,mp4,...`) via `contains("mp4")`, and tests exercise that real form (no false-green).

Status: code complete + machine-verified. AC-001/006 end-to-end (real duration + complete-file
playback, remux speed) need a user `npm start` with the MKV/WebM clips that exposed the bug.
