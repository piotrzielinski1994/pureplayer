# Plan: Viewport transforms (rotate, fit-mode, zoom)

Implements [spec.md](spec.md). TDD red-green-refactor. Branch: `20260621030615-viewport-transforms`.

## Approach

Mirror the established transport-control shape (seek/speed/frame-step): one pure helper module +
context state/verbs + a `Viewport` effect syncing CSS onto the `<video>` element + registry
actions wired in `Workspace` (which feeds BOTH `useActionHotkeys` and the palette command list,
so palette parity is automatic) + a passive transport-bar readout.

- **State**: context owns one `viewportTransform: { rotationDeg, fitMode, zoom }` object (default
  `0 / "contain" / 1`). It is provider-level, NOT touched by `activateVideo` -> session-sticky
  across video switches (AC-005). Not written to the settings store.
- **Verbs**: `rotateClockwise`, `cycleFitMode`, `zoomBy(delta)`, `resetViewportTransform`. Each
  guards on `activeVideoId === null` (no-op, AC-006/E-1), matching the existing seek/volume verbs.
- **Pure helpers** (`viewport-transform.ts`): `nextRotation`, `nextFitMode`, `clampZoom`,
  `isDefaultTransform`, `formatTransform`, plus `DEFAULT_TRANSFORM` + range constants. Unit-tested
  in isolation - keeps the cycle/clamp/format logic out of the component (no ifology in JSX).
- **Viewport sync**: the `<video>` switches `max-h-full max-w-full` -> `h-full w-full` so
  `object-fit` is meaningful; `style={{ objectFit, transform: rotate(Ndeg) scale(Z), transformOrigin: "center" }}`
  driven from `viewportTransform`. At defaults this renders `contain` + `rotate(0deg) scale(1)`,
  visually identical to today's letterbox (AC-008). The region already has `overflow` clipping via
  its flex centering + black bg; add `overflow-hidden` if a zoomed video bleeds past the region.
- **Registry/wiring**: 5 new actions in `SHORTCUT_ACTIONS` (+ union ids); `Workspace.handlers`
  maps each id to its context verb. Palette commands derive from `handlers` automatically.
- **Transport readout**: a passive `<span>` in the right zone, rendered only when
  `!isDefaultTransform(viewportTransform)`, showing `formatTransform(...)`. Mirrors the existing
  conditional rate readout; sits left of it.

## Files

### Create
- `src/components/workspace/viewport-transform.ts` - types (`FitMode`, `Rotation`,
  `ViewportTransform`), `DEFAULT_TRANSFORM`, `ZOOM_MIN/MAX/STEP`, `ROTATIONS`, `FIT_MODES`, and
  pure `nextRotation` / `nextFitMode` / `clampZoom` / `isDefaultTransform` / `formatTransform`.
- `src/components/workspace/__tests__/viewport-transform.test.ts` - unit tests (RED).
- `src/components/workspace/__tests__/viewport-transforms.test.tsx` - integration tests under a
  real provider + `Viewport` + `TransportBar` (element object-fit/transform sync, readout
  visibility, session-stickiness across switch, no-active no-ops).

### Modify
- `src/lib/shortcuts/registry.ts` - add 5 actions (`rotate-cw`, `cycle-fit-mode`, `zoom-in`,
  `zoom-out`, `reset-viewport`) + extend `ShortcutActionId` union.
- `src/components/workspace/workspace-context.tsx` - add `viewportTransform` state + the 4 verbs
  (+ context type + memo deps).
- `src/components/workspace/viewport.tsx` - apply `object-fit` + `transform` + `transformOrigin`
  to the `<video>`; switch sizing classes to `h-full w-full`; ensure region clips overflow.
- `src/components/workspace/transport-bar.tsx` - conditional transform readout in the right zone.
- `src/components/workspace/workspace.tsx` - wire the 5 new handlers (hotkeys + palette commands).

### Test setup
No jsdom stub needed: `style.objectFit` / `style.transform` are plain inline-style reads. Pointer
+ currentTime stubs already exist in `src/test/setup.ts`.

## Execution order

1. **RED** (test-writer subagent): unit tests for `viewport-transform.ts` (rotation wrap, fit-mode
   wrap, zoom clamp+round, isDefault, formatTransform); registry tests for the 5 actions/bindings;
   integration tests for verb cycling + element object-fit/transform sync, readout
   visibility/content, session-stickiness across a video switch, no-active no-ops; palette-parity
   test. All fail.
2. **GREEN**: helpers -> registry -> context -> viewport sync -> transport readout -> workspace
   wiring. One commit per AC where it maps cleanly.
3. **REFACTOR**: tidy; keep green.
4. **VERIFY**: fresh verifier subagent; lint/typecheck/test. Manual `npm start` smoke for real
   rotate/fit/zoom (jsdom can't render real layout).

## Edge cases (from spec)

E-1 no active -> verbs no-op. E-2 zoom clamp [1,4] + 1-decimal. E-3 rotate wrap to 0 after 270.
E-4 fit-mode wrap to contain after fill. E-5 transform survives video switch. E-6 rotated
landscape underfills (accepted, no auto-refit). E-7 palette-open hotkeys suppressed by
`ignoreInputs`. E-8 `=`/`-`/`Mod+0`/`Mod+Shift+R` valid tokens, no conflict with existing binds
(`F`, `Mod+Shift+R`, `=`, `-`, `Mod+0` all currently free).

## Tests to write (>= 1 per AC)

AC-001 registry rotate bind + cycle 0/90/180/270 + element `rotate(Ndeg)`; AC-002 registry fit
bind + cycle contain/cover/fill + element `object-fit`; AC-003 registry zoom x2 binds + step +
clamp both bounds + element `scale(Z)` + origin center; AC-004 registry reset bind + restores
defaults; AC-005 transform persists across `selectNode` switch; AC-006 no-active no-ops keep
defaults; AC-007 readout absent at default / present + named when non-default; AC-008 default
element object-fit contain + rotate(0deg) scale(1) + `h-full w-full`; AC-009 palette lists all 5;
AC-010 gates. Helper units: rotation/fit wrap, zoom clamp+round, isDefault, formatTransform.

## Acceptance verification

Verifier subagent (fresh context) maps every AC -> test, runs lint/typecheck/test, probes edges.
Manual: `npm start`, confirm real rotate/fit/zoom + reset with a file (incl. a sideways clip).

### Status: DONE (verifier PASS, all gates green)

Gates: `npm test` 421 pass (34 files; 50 in the 2 new files), `npm run typecheck` clean,
`npm run lint` 0 errors (5 accepted baseline warnings, unchanged from base). Manual `npm start`
smoke still recommended for real rotate/fit/zoom/reset (jsdom renders no real layout).

### AC -> test traceability

| AC | Test(s) |
|----|---------|
| AC-001 | `viewport-transforms.test.tsx`: "should register rotate-cw bound to Mod+Shift+R", "...cycle rotationDeg 0->90->180->270->0...", "...transform to include rotate(90deg)..."; `viewport-transform.test.ts` nextRotation x4 |
| AC-002 | "should register cycle-fit-mode bound to F", "...cycle fitMode contain->cover->fill->contain...", "...object-fit to cover..."; nextFitMode x3 |
| AC-003 | "should register zoom-in bound to = and zoom-out bound to -", "...step zoom to 1.5... scale(1.5)...", "...clamp zoom to 4...", "...clamp zoom to 1...", "...transform-origin to center..."; clampZoom (7) + ZOOM constants |
| AC-004 | "should register reset-viewport bound to Mod+0", "...restore rotation 0, fit contain and zoom 1...", "...hide the transform readout..." |
| AC-005 | "should keep rotation 90 and zoom 1.5 on the newly active video if the active video is switched" |
| AC-006 | "should not throw and should keep transform at defaults...", "...show no transform readout..." (no active video) |
| AC-007 | "should show no transform readout if the transform is the default", "...show a 1.1x readout...", "...name 90deg, cover and 1.5x..."; isDefaultTransform (5) + formatTransform (5) |
| AC-008 | "should render object-fit contain, transform rotate(0deg) scale(1) and h-full w-full at defaults"; DEFAULT_TRANSFORM unit |
| AC-009 | "should list a palette command for each of the five new actions if the palette is open" |
| AC-010 | all gates green |

## Risks

- jsdom renders no real layout: assert inline-style strings + context state, not pixels. Manual
  smoke covers visual correctness.
- Bare `F` / `=` / `-` as hotkeys could clash with typing -> only fire when no input focused
  (`ignoreInputs: true`, same guard as existing bare `M`/`S`/`R`).
- A zoomed video could bleed past the viewport region -> region clips with `overflow-hidden`.
- Rotated landscape clip underfills the frame (E-6) -> documented v1 limitation, not a bug.
