# Plan: Video playback progress

**Spec:** [spec.md](spec.md)
**Branch:** `20261123173613-video-playback-progress`
**Approach:** one branch, TDD (RED -> GREEN -> REFACTOR) per file.

## Key decisions

- **Separate `progress.json` store**, not a settings field: progress is per-file, grows
  with the library, and throttled writes would make every settings save rewrite it.
- **Model is store-agnostic**, mirroring `src/lib/settings/*`: pure `progress.ts` model
  (parse/record/resume), a `ProgressStore` interface with a Tauri `LazyStore` adapter and
  an in-memory adapter, and a `ProgressProvider` that blocks render until loaded (same
  pattern as `SettingsProvider`).
- **Resume is an explicit context field**, not a reuse of `seekToSec`: `resumeAtSec` is set
  only when the user accepts the resume prompt and is consumed by `Viewport` once the media
  has loaded (or immediately when it already has), where it is turned into a normal `seek()` -
  so the existing native-seek / HLS-restart / mpv-seek logic is reused instead of duplicated.
- **The offer is a prompt, not an automatic jump**: activation always plays from 0 and sets
  `resumePrompt` (file name + saved position). `ResumePrompt` renders it in a bar above the
  transport bar - outside the viewport box - because the native mpv window covers the
  viewport and would hide any overlay inside it.
- **Saves are throttled in the pure layer** (`recordProgress` returns `null` below 5 s of
  movement), so the context/provider never writes on every `timeupdate` (~4/s).
- **Video-only rule lives in one place**: `isVideoFormat` gates both resume and save.

## Task breakdown / execution order

1. `src/lib/progress/progress.ts` + tests - format gate, parse, record/throttle, clear,
   resume thresholds. (AC-1, AC-2, AC-3, AC-5, AC-7)
2. `src/lib/progress/progress-store.ts` + `progress-context.tsx` + tests - Tauri/memory
   stores, provider load/persist. (AC-7, AC-8)
3. `src/components/workspace/workspace-context.tsx` - `initialProgress`, `onProgressChange`,
   `resumeAtSec`, `clearResume`; resume on activation, save on progress/pause/seek, forget
   on end. Tests with a probe. (AC-2, AC-3, AC-4, AC-5, AC-6)
4. `src/components/workspace/viewport.tsx` - consume `resumeAtSec` on `<video>`
   `loadedmetadata` and after `mpvLoadFile`. (AC-4)
5. `src/app/providers.tsx` + `src/routes/index.tsx` - mount provider, wire props.
6. Verify: `npm run typecheck`/`npm test` for changed logic, then `npm run tauri:fast`
   in PowerShell on Windows.

## File changes

```
src/lib/progress/progress.ts                     (new)     pure model
src/lib/progress/progress-store.ts               (new)     ProgressStore + Tauri/memory adapters
src/lib/progress/progress-context.tsx            (new)     ProgressProvider + useProgress
src/lib/progress/__tests__/progress.test.ts      (new)
src/lib/progress/__tests__/progress-context.test.tsx (new)
src/components/workspace/workspace-context.tsx   (modify)  resume prompt + save wiring
src/components/workspace/resume-prompt.tsx       (new)     resume offer bar (from start / resume)
src/components/workspace/content.tsx             (modify)  mount the bar above the transport
src/components/workspace/viewport.tsx            (modify)  consume resumeAtSec (late acceptance)
src/components/workspace/__tests__/playback-progress.test.tsx (new)
src/components/workspace/__tests__/resume-prompt.test.tsx (new)
src/app/providers.tsx                            (modify)  mount ProgressProvider
src/routes/index.tsx                             (modify)  pass progress props
README.md / docs/learnings.md                    (check)   feature + gotcha if needed
```

## Acceptance verification

- `npm test` covers AC-1..AC-8 at the model/context/workspace level.
- `npm run tauri:fast` on Windows proves the app compiles and bundles with the new store.
- Manual UT-1..UT-5 require real media files; not run headlessly - reported as such.
