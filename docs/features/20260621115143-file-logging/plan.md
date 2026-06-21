# Plan: File logging + playback diagnostics

Spec: [spec.md](spec.md). Branch `20260621115143-file-logging`.

## Approach

Backend-only. One pure unit (the per-launch filename), one plugin registration, one
instrumented command. TDD: the only sandbox-testable logic is `launch_log_name`; the plugin
wiring and the log output are build- + user-verified.

### Tauri 2 plugin API note

context7 surfaced mostly v1 (`LogTarget`). The crate is **Tauri 2** (`tauri-plugin-log = "2"`),
whose API is `tauri_plugin_log::{Builder, Target, TargetKind}` with `TargetKind::LogDir` and a
`Builder::new()...file_name(name)...build()`. Exact method names get pinned at compile (build +
clippy fail loudly if wrong); the plan assumes the v2 shape and the implementer adjusts to
whatever the installed crate exposes.

## Task breakdown

### T1 - deps (GREEN setup)
- `src-tauri/Cargo.toml`: add `tauri-plugin-log = "2"`, `log = "0.4"`.
- Confirm `cargo build` resolves (no code change yet beyond deps).

### T2 - RED: `launch_log_name` pure helper
- New module `src-tauri/src/logging.rs` (declared `mod logging;` in `lib.rs`).
- Fn signature (deterministic, no clock/FS): takes the launch time as input and returns the
  file stem. Use `time` (already transitively present via tauri) or format from components.
  Candidate: `launch_log_name(now: time::OffsetDateTime) -> String` -> `"vidui-YYYYMMDDHHMMSS"`.
  (If pulling `time` directly is awkward, accept the 6 numeric components as args - still pure.)
- Tests (cargo, in `logging.rs`):
  - `should_format_launch_name_as_vidui_plus_14_digits` - a fixed datetime ->
    exact `"vidui-20260621115143"`.
  - `should_zero_pad_single_digit_fields` - e.g. 2026-01-02 03:04:05 ->
    `"vidui-20260102030405"` (14 digits, padded).
  - `should_match_feature_folder_timestamp_shape` - output minus the `vidui-` prefix is 14
    ASCII digits.
- Run `cargo test` -> RED (fn unimplemented / module missing).

### T3 - GREEN: implement `launch_log_name`
- Format the passed datetime as `%Y%m%d%H%M%S`, prefix `vidui-`. Smallest code to pass T2.

### T4 - GREEN: register the log plugin in `lib.rs`
- Compute `let log_name = logging::launch_log_name(<now>);` at startup (local time).
- Register before/after the other plugins:
  `.plugin(tauri_plugin_log::Builder::new().target(Target::new(TargetKind::LogDir { file_name: Some(log_name) })).level(log::LevelFilter::Info).build())`
  (adjust to the v2 builder; keep Stdout too so `tauri dev` still shows lines).
- Non-fatal: if the plugin builder/registration can fail, guard so a logging failure does not
  abort `run()` (AC-007). Prefer registering a target that the plugin creates lazily.
- Emit `log::info!("vidui starting (log {})", log_name);` once after registration (AC-006).

### T5 - GREEN: instrument `prepare_media` (media.rs)
- At entry: `let started = std::time::Instant::now();`
- After probes: `log::info!("prepare_media: path={path} container={container} v={vcodec} a={acodec}");`
- After `plan_media`: `log::info!("prepare_media plan={plan:?}");`
- Cache branch: `log::info!("prepare_media cache HIT -> {target:?}");` on `target.exists()`.
- Convert branch end (success): `log::info!("prepare_media transcoded in {}ms -> {target:?}", started.elapsed().as_millis());`
- Passthrough: `log::info!("prepare_media passthrough in {}ms", started.elapsed().as_millis());`
- Errors: replace the bare `Err(format!..)` returns' neighbours with a `log::error!` before
  returning (no behaviour change - still returns the same `Err`).
- No `unwrap`/`expect` added (AC-007).

### T6 - REFACTOR
- Collapse any duplicated log-format strings; keep messages greppable (stable key=val shape).
- Ensure `clippy` is clean (e.g. `uninlined_format_args`).

### T7 - capability + docs
- `src-tauri/capabilities/default.json`: add the log plugin permission if v2 requires one
  (the plugin's default permission set; check build error to confirm necessity).
- `README.md`: one line - logs at `~/Library/Logs/com.pzielinski.vidui/vidui-<ts>.log`, new
  file each launch.
- `docs/learnings.md`: note "app had no logging until FR-12; per-launch file via plugin
  `file_name`".
- `.pzielinski/todos.md`: add FR-12 entry (or fold under FR-11 follow-ups), tag when done.

## Execution order

T1 -> T2 (RED) -> T3 (GREEN) -> T4 -> T5 -> T6 (REFACTOR) -> T7 -> gates -> verifier -> on-device.

## File changes

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | + `tauri-plugin-log`, `log` |
| `src-tauri/src/logging.rs` | NEW - `launch_log_name` + tests |
| `src-tauri/src/lib.rs` | `mod logging;`, register log plugin w/ per-launch file_name, startup info |
| `src-tauri/src/media.rs` | `log::info!`/`error!` instrumentation in `prepare_media` |
| `src-tauri/capabilities/default.json` | log plugin permission (if required) |
| `README.md` | where logs land |
| `docs/learnings.md` | logging history note |
| `.pzielinski/todos.md` | FR-12 entry + tag |

## Acceptance verification

| AC | Proof |
|----|-------|
| AC-001 | user `npm start` + `ls ~/Library/Logs/com.pzielinski.vidui/` shows `vidui-<14d>.log` |
| AC-002 | launch/quit/launch -> two files, distinct stamps |
| AC-003 | `logging::tests` (3 pure tests) |
| AC-004 | read the log after dropping the MKV: path+container+codecs+plan+HIT/MISS+ms present |
| AC-005 | drop a non-video / corrupt file -> ERROR line with path+reason |
| AC-006 | log non-empty immediately after launch (startup line) |
| AC-007 | code review: no unwrap/expect on hot path; plugin failure non-fatal |
| AC-008 | cargo test/build/clippy + npm lint/typecheck/test all 0 |

## Tests to write (TDD RED)

Rust (`cargo test`, in `logging.rs`):
- `should_format_launch_name_as_vidui_plus_14_digits`
- `should_zero_pad_single_digit_fields`
- `should_match_feature_folder_timestamp_shape`

No frontend tests (no FE change). AC-001/002/004/005/006 are runtime/on-device (no unit test
can prove a file lands in the OS log dir from a spawned process).

## AC traceability (verifier PASS 2026-06-21, 2 passes)

| AC | Proof |
|----|-------|
| AC-001 | code: `logging::init` registers `LogDir{file_name:Some(current_launch_log_name())}` (local chrono stamp); plugin appends `.log`. File appearing = on-device |
| AC-002 | fresh stamp per process + KeepAll/50MB (no overwrite). Two launches = two files = on-device |
| AC-003 | `logging::tests` 3 pure tests (exact string, zero-pad, 14-digit shape) - PASS |
| AC-004 | `media.rs` INFO: path/container/codecs, `plan={:?}`, cache HIT/MISS, elapsed ms on each branch. Content = on-device |
| AC-005 | `media.rs` ERROR on no-video-stream + ffmpeg-nonzero + finalize-rename fail; same `Err` returned |
| AC-006 | startup `log::info!("vidui starting ...")` after successful register |
| AC-007 | FIXED: plugin registered at RUNTIME in `.setup` via `app.plugin(..)`, Err swallowed (`is_err()` -> eprintln + return); app launches even if log dir unwritable. No unwrap/expect on hot path |
| AC-008 | cargo test 25, clippy 0, FE 453, lint 0 err, typecheck - all 0 |

## Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-06-21 | Register the log plugin at RUNTIME inside `.setup` (`app.plugin(..)`, Err swallowed), not at build time on the Builder. | The `LogDir` target does `app_log_dir()?` + `create_dir_all()?` in its setup; registered on the Builder that Err aborts app launch. Runtime registration lets an unwritable log dir disable logging without killing the app (AC-007 / spec E-1/E-3). |
| 2026-06-21 | `chrono` (clock feature) for local time, not `time::now_local()`. | `time::now_local()` bails to UTC under multithreading; the stamp must be local to match `docs/features/*`. |
| 2026-06-21 | `KeepAll` + 50MB cap, override plugin defaults (40KB / KeepOne). | Defaults rotate + delete mid-session; "one file per launch" needs the whole session to stay in one un-rotated file. |

## Extension: drop -> first-frame timeline (AC-009..013)

### Approach
The backend file logging already works; this adds a FRONTEND -> same-file channel so the
`<video>` element load (the invisible ~6s of the ~8s wait) is measured. No new JS log plugin and
no capability change: reuse the existing custom-command pattern (`prepare_media`) with a tiny
`log_playback(message: String)` Rust command that just `log::info!`s. The log file's own
timestamps are second-granularity, so sub-second phases are measured in the FE with
`performance.now()` and emitted as explicit ms in the message.

### Pure unit (TDD)
`src/lib/playback-timing.ts`:
```ts
type PlaybackMarks = { activatedAtMs: number; prepareResolvedAtMs: number; firstFrameAtMs: number };
formatTimeline(name: string, marks: PlaybackMarks): string
// e.g. 'playback "clip.mkv": prepare 2100ms | element-load 5800ms | total 7900ms'
```
Durations by subtraction (prepare = prepareResolved - activated; element-load = firstFrame -
prepareResolved; total = firstFrame - activated). Non-negative when marks monotonic. Pure - no
clock, no DOM. Tested in isolation (AC-011).

### Tasks
- TE1 RED: `playback-timing.test.ts` - exact string for known marks; zero-duration phase; total =
  sum of phases; (decide rounding - round to integer ms).
- TE2 GREEN: implement `formatTimeline`.
- TE3 Rust: `log_playback(message: String)` command in `media.rs` (or `logging.rs`) -> `log::info!("{message}")`; register in `lib.rs` `generate_handler!`.
- TE4 `tauri.ts`: `logPlayback(message: string): Promise<void>` wrapper, try/catch no-op outside Tauri host (same guard shape as `focusWebview`).
- TE5 `viewport.tsx`: capture `performance.now()` marks per activation in a ref keyed by video id -
  `activatedAtMs` when the prepare effect fires, `prepareResolvedAtMs` when `prepareMediaUrl`
  resolves, `firstFrameAtMs` on the `<video>` `canplay` (or first `playing`). When all three exist
  for the active id, call `logPlayback(formatTimeline(name, marks))` once. Never throw into render;
  guard nulls. A prepare ERROR logs a failure marker (AC-012) but must not crash.
- TE6 verify: gates + on-device read of the timeline line.

### File changes (extension)
| File | Change |
|------|--------|
| `src/lib/playback-timing.ts` | NEW - `formatTimeline` + `PlaybackMarks` |
| `src/lib/__tests__/playback-timing.test.ts` | NEW - pure tests |
| `src/lib/tauri.ts` | + `logPlayback` wrapper |
| `src-tauri/src/media.rs` (or logging.rs) | + `log_playback` command |
| `src-tauri/src/lib.rs` | register `log_playback` in `generate_handler!` |
| `src/components/workspace/viewport.tsx` | capture marks + emit timeline on first frame |

### Extension AC verification
| AC | Proof |
|----|-------|
| AC-009 | `log_playback` command -> `log::info!`; FE `logPlayback` calls it; line lands in the same file (on-device) |
| AC-010 | timeline line on first frame names prepare/element-load/total ms (on-device read) |
| AC-011 | `playback-timing.test.ts` pure tests |
| AC-012 | `logPlayback` try/catch no-op (`tauri.ts`); marks in a ref (no extra renders); null-guarded; `viewport.test.tsx` fire-once + prepare-FAILED tests; full suite green |
| AC-013 | activation marker `activatedAtMs` set at prepare-effect entry, anchors start (prepare = activation->resolved) |

### Extension verification (verifier PASS 2026-06-21)

Verifier confirmed AC-009..013 wired correct (line-content on-device by design), base AC-001..008
not regressed, all gates green. Closed the flagged coverage gap with two `viewport.test.tsx` tests:
single-timeline-on-first-`canplay` (fire-once guard) + prepare-FAILED marker. Cross-id mark mixing
ruled out (prepare-resolve guarded by `forId`; `<video>` unmounts to "Preparing" on id switch so a
stale `canplay` can't fire into newer marks).

## Risks

- v2 plugin API differs from context7's v1 docs: pinned at compile; implementer adjusts builder
  method names to the installed crate.
- Same-second double launch collides (E-2): accepted, documented.
- `time` crate access for the datetime: if awkward, pass numeric components to `launch_log_name`
  keeping it pure; format in `lib.rs` from `std::time::SystemTime` -> components.
- FE instrumentation could perturb playback or throw in an effect: keep marks in a ref, guard
  every access, `logPlayback` is best-effort no-op; covered by AC-012 + a non-throw test.
- `canplay` vs `playing` for "first frame": `canplay` fires when enough data buffered to start;
  use it as the first-frame proxy (closer to "ready to show"); note the choice in the log wording.
