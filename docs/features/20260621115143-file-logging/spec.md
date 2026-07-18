# Spec: File logging + playback diagnostics

**Version:** 0.1.0
**Created:** 2026-06-21
**Status:** Draft
**Feature:** FR-12 (new)

## 1. Overview / why

The app has **zero logging** today (no `log::`/`println!` in Rust, `tauri dev` prints only
build output). That made on-device FR-2 verification guesswork: we could not tell whether an
8s MKV load was a fresh remux or a cache hit, because nothing records what `prepare_media`
decided. This feature adds **file logging** so playback behaviour is observable after the fact.

Two parts:

1. **Logging infrastructure** - register `tauri-plugin-log` writing to the OS app-log dir. Each
   app launch creates a **fresh** log file named `pureplayer-<timestamp>.log`, where `<timestamp>`
   is the same `YYYYMMDDHHMMSS` form used for `docs/features/*` folders (e.g.
   `pureplayer-20260621115143.log`). Computed once at startup.
2. **Playback diagnostics** - instrument `prepare_media` so each prepare emits: source path,
   probed container + video/audio codecs, the chosen `MediaPlan` (Passthrough / Convert{..}),
   cache HIT vs MISS, and the wall-clock duration of the prepare call. Errors are logged too.
   This directly answers "why did that file take 8s".

Log location (decided): OS app-log dir via the plugin's `LogDir` target -
macOS `~/Library/Logs/com.pzielinski.pureplayer/`. Not the repo, not temp.

## 2. Scope

In: `tauri-plugin-log` wiring in `lib.rs`, a startup-timestamp helper for the per-launch
filename, `log` crate macros in `media.rs` instrumenting `prepare_media`, a one-line startup
log. Backend only.

Out: forwarding JS/webview console to the file (backend-only this round); a log viewer UI; log
retention/cleanup policy; instrumenting `import.rs`/`focus.rs`; changing any playback behaviour.

## 3. Acceptance Criteria

| ID | Criterion | Priority | How verified |
|----|-----------|----------|--------------|
| AC-001 | On app launch a new log file `pureplayer-<YYYYMMDDHHMMSS>.log` is created in the OS app-log dir (macOS `~/Library/Logs/com.pzielinski.pureplayer/`). The timestamp matches the `docs/features/*` format (14 digits, local time at launch). | Must | User `npm start`; `ls` the dir |
| AC-002 | Two launches produce two distinct files (the timestamp differs); an earlier launch's file is never overwritten or appended to by a later launch. | Must | User: launch, quit, launch; `ls` shows 2 files |
| AC-003 | The timestamp-formatting logic is a PURE function `launch_log_name(secs, nsecs?)`-style (input = a time value, output = `pureplayer-<14digits>`), unit-tested without touching the clock or filesystem. | Must | `cargo test` |
| AC-004 | A successful `prepare_media` logs at INFO: the source path, container, vcodec, acodec, the decided plan (Passthrough / Convert{video,audio}), whether it was a cache HIT or a fresh transcode, and the elapsed milliseconds. | Must | User run + read the log file |
| AC-005 | A failed `prepare_media` (no video stream, or ffmpeg non-zero) logs at ERROR with the path and reason. | Must | Code review + user run with a bad file |
| AC-006 | A one-line INFO is logged at startup recording app start (so an empty session still yields a non-empty, identifiable file). | Must | User run; file non-empty |
| AC-007 | Logging never panics or blocks playback: if the log dir is unwritable the app still runs (plugin failure is non-fatal). The instrumentation adds no `unwrap`/`expect` on the hot path. | Must | Code review |
| AC-008 | `cargo test`, `cargo build`, `cargo clippy` (0 new warnings), `npm run lint`, `npm run typecheck`, `npm test` all exit 0. | Must | Gates |

### Extension: drop -> first-frame playback timeline (added 2026-06-21 after on-device verify)

On-device the backend `prepare_media` log showed only a 2s slice of an ~8s wait; the dominant
cost is the `<video>` element loading the prepared file, which nothing logged. This extension
records the full activate -> first-frame timeline so playback latency is debuggable end to end.

| ID | Criterion | Priority | How verified |
|----|-----------|----------|--------------|
| AC-009 | A frontend-emitted playback timeline reaches the SAME per-launch log file as the backend lines, via a Rust command `log_playback(message)` that logs at INFO (no separate JS log plugin, no new capability). | Must | User run + read the log |
| AC-010 | When a newly activated video reaches its first frame (`playing`), one INFO timeline line is logged naming the per-phase durations in ms - prepare (activation -> `prepareMediaUrl` resolved), element load (`<video>` src set -> `canplay`/first frame) - and the total ms. | Must | User run + read the log |
| AC-011 | The timeline-formatting logic is a PURE function `formatTimeline(marks)` (input = the captured `performance.now()` marks, output = the log string), unit-tested without a clock or DOM. Durations are computed by subtraction, never negative when marks are monotonic. | Must | `npm test` |
| AC-012 | Instrumentation is non-intrusive: it never changes playback behaviour, never throws into the React render/effects, and is a no-op outside a Tauri host (same guard as the other `tauri.ts` wrappers). A prepare error logs nothing broken (it may log a failure marker but must not crash). | Must | Code review + `npm test` |
| AC-013 | A drop-to-activation marker is logged so the timeline's start is anchored (the moment the user dropped / activated, distinct from prepare start). If activation start and prepare start are effectively the same instant, the line states that rather than implying a hidden gap. | Should | Code review + user run |

## 4. UI States

No UI. Logging is a side channel; the window is unchanged.

## 5. Surface

- `src-tauri/Cargo.toml` - add `tauri-plugin-log = "2"` and `log = "0.4"`.
- `src-tauri/src/lib.rs` - register the log plugin with `LogDir` target + the per-launch
  `file_name`; emit the startup INFO line. New small module (or inline) for `launch_log_name`.
- `src-tauri/src/media.rs` - `log::info!`/`log::error!` instrumenting `prepare_media`
  (path, codecs, plan, cache HIT/MISS, elapsed ms, errors). `MediaPlan` etc. gain `Debug`
  (already derived) for `{:?}` logging.
- `src-tauri/capabilities/default.json` - add the log plugin's permission if required by v2.
- `.gitignore` - nothing (logs live outside the repo).
- `README.md` / `docs/learnings.md` - note where logs land + that each launch = new file.

## 6. Data model / key decisions

- **Per-launch filename via static `file_name`:** the plugin writes to one `<file_name>.log`
  per process; computing `pureplayer-<ts>` once at startup and passing it as `file_name` yields a
  fresh file per launch (new process -> new timestamp). No rotation needed for the "new file
  per open" requirement; `RotationStrategy` left default.
- **Timestamp source:** the launch wall-clock formatted `%Y%m%d%H%M%S` in **local** time
  (matches how `docs/features/*` folders are stamped). The pure helper takes the time value as
  input so the test is deterministic.
- **Plan logging via `{:?}`:** `MediaPlan`/`VideoAction`/`AudioAction` already derive `Debug`;
  log them directly - no bespoke formatting, no ifology.
- **Elapsed timing:** wrap the probe+transcode body with `std::time::Instant` and log
  `elapsed().as_millis()`.

## 7. Edge cases

| # | Case | Handling |
|---|------|----------|
| E-1 | Log dir not yet present | plugin's `LogDir` creates it; if creation fails the plugin errors at registration - guard so the app still launches (AC-007). |
| E-2 | Two launches within the same second | timestamps collide -> same filename -> the second appends to the first. Accepted: 1s granularity matches the `docs/features` convention; a human can't open the app twice in <1s in practice. Documented, not engineered around. |
| E-3 | Unwritable dir / read-only FS | logging is best-effort; playback must still work (AC-007). |
| E-4 | Very long transcode | elapsed ms is large but correct; no timeout added by this feature. |
| E-5 | Non-UTF8 / unusual path | logged via `Debug`/lossy display; never panics. |

## 8. Out of scope

JS/webview console forwarding to file, log viewer UI, retention/cleanup, instrumenting other
commands, signing/notarization, any playback behaviour change.

## 9. Verification

`cargo test` pins `launch_log_name`. `cargo build`/`clippy` prove the plugin wiring compiles.
The file-creation + diagnostics ACs (AC-001/002/004/006) are **user-verified on device** via
`npm start` - open the app, drop the slow MKV, read `~/Library/Logs/com.pzielinski.pureplayer/
pureplayer-<ts>.log`, confirm it names the plan + cache HIT/MISS + elapsed ms.

## 10. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-06-21 | Initial draft - per-launch file logging + prepare_media diagnostics |
