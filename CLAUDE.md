# pureplayer

Briefing for Claude Code. Read [README.md](README.md) first - setup, commands, repo layout. This file lists conventions and the non-obvious bits not visible from reading individual files.

## Communication

- Keep replies short and to the point. No filler, no pleasantries, no recap of what the user just said.
- Status updates fit in one or two sentences.

## UI / design

- Read [docs/design.md](docs/design.md) before any UI change - it's the visual contract, shared verbatim with the `requi` and `dbui` repos to keep all three consistent. Key rule: **no rounded corners anywhere** (`--radius` and every `--radius-*` pinned to `0rem` in `index.css`); don't raise them or add `rounded-full` / `rounded-xs` / `rounded-[..]` (token-based `rounded-{sm,md,lg}` resolve to 0 so are tolerated, but prefer stripping). Buttons in a thin bar (the transport bar) fill the bar's full height, square, divided by a 1px border - not floating chips with their own height/padding (see `transport-bar.tsx` `BAR_BUTTON`).
- Keep design.md in sync with `requi`/`dbui` when the shared contract changes; pureplayer-only rules can be added but mark them as such.

## Logging (mandatory)

- Every action - a button, shortcut, menu item, drop, window change, backend command - gets a log line when it is added or extended, in the SAME change. No action ships unlogged.
- Frontend: `import { log } from "@/lib/logging/log"` then `log.info("area: what happened")` (`debug`/`warn`/`error` for those levels). It forwards to tauri-plugin-log, so the line lands in the per-launch log file and the in-app Logs panel; outside Tauri it goes to the console. Include the identifiers that matter (path, name, count, seconds) as `key=value` so the Logs search can filter them.
- Rust: `log::info!` / `warn!` / `error!` in every `#[tauri::command]` and every long-running step (spawn, process exit, file write, network fetch). Log outcomes AND failure branches, never just the happy path.
- Prefix the message with the area (`playback:`, `playlist:`, `layout:`, `settings:`, `update:`, `hls:`, `mpv:`, `app:`) so lines group in the panel.
- High-frequency loops (`timeupdate` progress reports, pointer-move scrubbing, per-request serving) stay at `debug` or are logged only when state is actually written, so the log file stays readable.

## Playback (pureplayer-only)

- Every file is played through a **native `mpv` window** (`useMpv = mpvAvailable`); the ffmpeg + `<video>` path is only the fallback when mpv fails to start. The `<video>` CSS (rotate/fit/zoom/invert) does not reach the mpv picture, so each viewport transform also needs an mpv equivalent (`mpvSetTransform`, `mpvSetInvertColors`), and status text for changes with no HTML overlay (track change, invert) goes through mpv OSD (`mpvShowText`). A React overlay above the mpv window IS visible (the top-right corner overlay proves it), so never duplicate one in the OSD: mpv `show-text` ignores `{\an9}` and always draws at the window's top-left, where the sidebar covers it. Never disable the mpv path to "fix" an overlay - forcing ffmpeg to transcode large files burns ~50% CPU and kills playback performance.

## Environment (Windows repo, read first)

- This repo lives on a Windows drive and is edited from WSL, but **ALL commands (install, build, test, lint, typecheck, tauri) must run in PowerShell on Windows - never in WSL/Ubuntu.** WSL runs overwrite `node_modules` with Linux binaries and break Windows tooling; `npm ci`/`npm install`/builds/tests in WSL have already broken the tree multiple times.
- Only release builds are tested - never debug builds. Iterating: `npm run tauri:fast` (release, no-bundle); final verification: `npm run tauri build` (release, with bundle).
- If a WSL run broke `node_modules`, restore with `npm install` in PowerShell.
- The build target is the host OS: Windows `.exe` from Windows, Linux bundle from WSL/Linux - say which one you built.

## Learning from conversation

If during a session you learn something project-specific that future-you would otherwise have to re-derive - a non-obvious convention the user prefers, a constraint that bit us, a gotcha worth recording - append it to [docs/learnings.md](docs/learnings.md). Examples: formatting rules the user repeated, gotchas that broke a hook/CI, naming conventions enforced via review.

For architectural trade-offs (significant, costly-to-reverse, or contested choices) use [docs/adr.md](docs/adr.md) instead - that's a separate log.

Don't add: one-off task context, debugging notes, things obvious from the code itself, or anything that would fit better in [README.md](README.md). Don't ask permission for small additions - just keep the file tight and the diff visible in the next commit.

## Features

- Each feature lives in its own folder: `docs/features/<timestamp>-<slug>/`.
  - `<timestamp>` = `YYYYMMDDHHMMSS` (creation time). `<slug>` = short kebab-case name.
  - Example: `docs/features/20260618193518-bootstrap/`.
- Every feature folder holds two files:
  - `spec.md` - what + why. Follows the spec template structure (overview, acceptance criteria, user test cases, data model, edge cases, dependencies).
  - `plan.md` - how. Follows the plan template structure (task breakdown, execution order, file changes, acceptance verification).
- Adding a new feature:
  1. Create the folder with current timestamp + slug.
  2. Write `spec.md` first. Get it approved before planning.
  3. Write `plan.md` from the approved spec.
  4. Log any significant choices made while specing to [docs/adr.md](docs/adr.md).
- Branch naming: when working on a feature (not a quick fix), the branch name must match the feature's folder name under `docs/features/` exactly (e.g. folder `20260618223203-layout` -> branch `20260618223203-layout`). Quick fixes are exempt.

## Architectural Decisions

- Log only significant, costly-to-reverse or contested decisions to [docs/adr.md](docs/adr.md).
- Significant = changes architecture/data model, hard to undo later, or had real alternatives debated. NOT routine config (script aliases, package manager, default lib options).

## Before committing

- Rebuild the app after a code change, not just the tests: `npm run tauri build` (or `npm start` for a dev run) so the change is proven to compile and bundle in the real app. Passing `cargo test` / `npm test` is not enough. Run it in PowerShell on Windows - see **Environment (Windows repo, read first)**; never in WSL. The build target is the host OS - a Windows `.exe` is built on Windows, a Linux bundle from WSL/Linux; say which one you built rather than implying the other.
- Check whether the change makes README.md or CLAUDE.md drift:
  - New script / removed dependency / renamed module -> update README.
  - New convention or gotcha that future-you would miss -> add to CLAUDE.md (or docs/learnings.md).
  - Removed feature or file referenced in either doc -> remove the reference.
- No duplicates between README.md and CLAUDE.md. Each fact lives in exactly one place:
  - README.md = human onboarding: what the app is, install/run steps, commands, a short feature summary, repo layout sketch. No agent-facing internals.
  - CLAUDE.md = working rules for an agent editing this repo: conventions, gotchas, architecture internals, "how to add a feature", invariants.
  - If a fact would fit both, put it in CLAUDE.md and link from README only if a human reader needs the pointer.
- If neither doc needs to change, say so explicitly in the pre-commit summary so it's a deliberate decision, not an oversight.

## TDD

Write code red-green-refactor:

1. Red - add a failing test that pins the behaviour you want. Run the relevant suite and confirm it fails for the right reason (not a typo, not a missing import).
2. Green - write the smallest production change that makes it pass. No speculative branches, no helper extraction yet.
3. Refactor - once green, clean up names, extract duplication, tighten types. Tests stay green throughout.

Two test layers, pick the one that owns the behaviour:
- Frontend (React/TS) -> `npm test` (Vitest).
- Rust backend / Tauri commands -> `cargo test` in `src-tauri/`.

Don't skip red. A test that's never seen failing is a test you can't trust. Don't refactor on red - get to green first, then improve.
