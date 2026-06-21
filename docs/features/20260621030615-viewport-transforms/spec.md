# Spec: Viewport transforms (rotate, fit-mode, zoom)

**Version:** 0.1.0
**Created:** 2026-06-21
**Status:** Draft
**Feature:** FR-10

## 1. Overview

Add three viewport transforms to the active `<video>`, all sharing the established control
shape: a `WorkspaceProvider` field/verb -> a `<video>` CSS property synced in the `Viewport` ->
an action-registry entry (global hotkey + command-palette command) -> tests. No transport
buttons (matches seek/speed/frame-step precedent); a passive readout appears in the transport
bar only when at least one transform is non-default (mirrors the existing rate readout).

1. **Rotate** - cycle the video clockwise `0 -> 90 -> 180 -> 270 -> 0` degrees. One action.
2. **Fit mode** - cycle CSS `object-fit`: `contain` (default, letterbox) -> `cover` (fill +
   crop) -> `fill` (stretch/distort) -> back to `contain`. One action.
3. **Zoom** - discrete centered scale, `+/- 0.1` step, clamped `[1.0, 4.0]`, 1-decimal. Scales
   from center (`transform-origin: center`); no pan. Two actions (in/out).
4. **Reset viewport** - return all three to defaults (`0deg`, `contain`, `1.0x`). One action.

Transforms are **session-sticky**: they live in the provider and persist across active-video
switches within the session. They are **not** persisted to disk (out of FR-7). App restart =
defaults.

The video element switches from intrinsic sizing (`max-h-full max-w-full`) to box-filling
(`h-full w-full`) so `object-fit` is meaningful. `contain` reproduces today's letterboxed look.
Rotate and zoom apply via one inline `transform: rotate(Ndeg) scale(Z)`.

What this delivers:
- New registry actions (each a global hotkey AND a palette command): `rotate-cw`,
  `cycle-fit-mode`, `zoom-in`, `zoom-out`, `reset-viewport`.
- Context state `viewportTransform: { rotationDeg, fitMode, zoom }` (default `0/contain/1`) with
  verbs `rotateClockwise`, `cycleFitMode`, `zoomBy(delta)`, `resetViewportTransform`.
- `Viewport` syncs `object-fit` + `transform` onto the `<video>` element from that state.
- Transport bar: a passive transform readout (right zone) shown only when state != default.
- Pure helpers (`viewport-transform.ts`): `nextRotation`, `nextFitMode`, `clampZoom`,
  `isDefaultTransform`, `formatTransform` + the `DEFAULT_TRANSFORM` / range constants.

What this does **not** deliver (out of scope):
- Pan / drag-to-move when zoomed (centered zoom only).
- Continuous (non-stepped) zoom or pinch/scroll-wheel zoom.
- Auto-rescaling a rotated video to refill the box (a 90deg landscape clip letterboxes; the
  user zooms manually to compensate). See E-6.
- Persisting transforms to disk across app restarts (FR-7 territory).
- Per-file transform memory or transport-bar buttons for these actions.
- Counter-clockwise rotate or arbitrary angles (cycle clockwise only).

### User Story

As a user I want to rotate a sideways clip upright, switch how the video fits its frame
(letterbox / crop-to-fill / stretch), and zoom in on detail - all from the keyboard or the
command palette - so I can correct and inspect playback without external tools.

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | Registry has `rotate-cw` (`Mod+Shift+R`); global hotkey AND palette command. `rotateClockwise` cycles `rotationDeg` `0->90->180->270->0`; the `<video>` element's inline `transform` includes `rotate(<deg>deg)`. | Must |
| AC-002 | Registry has `cycle-fit-mode` (`F`); global hotkey AND palette command. `cycleFitMode` cycles `fitMode` `contain->cover->fill->contain`; the `<video>` element's `object-fit` reflects the current mode. | Must |
| AC-003 | Registry has `zoom-in` (`=`, +0.1) and `zoom-out` (`-`, -0.1); each a global hotkey AND a palette command. `zoomBy(delta)` steps `zoom`, rounded to 1 decimal and clamped to `[1.0, 4.0]`; the `<video>` element's `transform` includes `scale(<zoom>)` with `transform-origin: center`. | Must |
| AC-004 | Registry has `reset-viewport` (`Mod+0`); global hotkey AND palette command. `resetViewportTransform` returns `rotationDeg=0`, `fitMode="contain"`, `zoom=1`; the element reflects defaults. | Must |
| AC-005 | Transforms are session-sticky: switching the active video does NOT reset `viewportTransform`; the new video renders with the same rotation/fit/zoom. They are not written to the settings store. | Must |
| AC-006 | With no active video, all five verbs are safe no-ops that throw nothing and leave `viewportTransform` at defaults. | Must |
| AC-007 | The transport bar shows a passive transform readout (right zone) only when `viewportTransform != default`; it is absent at defaults. The readout names each non-default facet (e.g. `90deg`, `cover`, `1.5x`). | Must |
| AC-008 | At defaults the `<video>` renders `object-fit: contain` and `transform: rotate(0deg) scale(1)` (visually identical to the prior letterboxed view) and fills its box (`h-full w-full`). | Must |
| AC-009 | Every new action is reachable BOTH as a global hotkey and as a command-palette entry (no on-screen button). | Must |
| AC-010 | `npm run lint`, `npm run typecheck`, and `npm test` exit 0. | Must |

## 3. User Test Cases

### TC-001: Rotate cycles through four quarter-turns
**Precondition:** A video is active; rotation 0deg.
**Steps:** Trigger `rotate-cw` (Mod+Shift+R) four times.
**Expected:** rotationDeg goes 0 -> 90 -> 180 -> 270 -> 0; the element `transform` shows the
matching `rotate(Ndeg)` each step.
**Maps to:** AC-001.

### TC-002: Fit mode cycles contain -> cover -> fill -> contain
**Precondition:** A video is active; fit `contain`.
**Steps:** Trigger `cycle-fit-mode` (F) three times.
**Expected:** object-fit goes contain -> cover -> fill -> contain on the element.
**Maps to:** AC-002.

### TC-003: Zoom step + clamp at bounds
**Precondition:** A video is active; zoom 1.0.
**Steps:** Trigger `zoom-in` (`=`) five times, then `zoom-out` (`-`) past 1.0.
**Expected:** zoom 1.0 -> 1.5 (scale(1.5) on element); continuing up clamps at 4.0; zooming
out past 1.0 clamps at 1.0.
**Maps to:** AC-003.

### TC-004: Reset restores all defaults
**Precondition:** A video is active; rotation 90, fit cover, zoom 1.5.
**Steps:** Trigger `reset-viewport` (Mod+0).
**Expected:** rotationDeg 0, object-fit contain, scale(1); the readout disappears.
**Maps to:** AC-004, AC-007.

### TC-005: Transforms persist across a video switch
**Precondition:** Two videos; the active one zoomed to 1.5 and rotated 90deg.
**Steps:** Activate the other video.
**Expected:** The newly active video renders rotate(90deg) scale(1.5); state unchanged.
**Maps to:** AC-005.

### TC-006: No-active-video no-ops
**Precondition:** Empty playlist, nothing active.
**Steps:** Trigger every new hotkey.
**Expected:** Nothing throws; no readout; transform stays default.
**Maps to:** AC-006.

### TC-007: Readout visibility
**Precondition:** A video is active; transforms default.
**Steps:** Confirm no readout; trigger `zoom-in` once; confirm a readout naming `1.1x` appears;
`reset-viewport`; confirm it disappears.
**Maps to:** AC-007.

### TC-008: Palette parity
**Precondition:** Workspace open.
**Steps:** Open the palette (Mod+K).
**Expected:** It lists a command for each of the five new actions.
**Maps to:** AC-009.

## 4. UI States

| State    | Behavior |
| -------- | -------- |
| Empty    | No active video: verbs no-op; no readout; element absent. |
| Default  | rotate 0 / fit contain / zoom 1: no readout; element fills box, letterboxed via object-fit contain (looks like today). |
| Rotated  | element `transform` includes `rotate(Ndeg)`; readout names `Ndeg`. A 90/270 landscape clip letterboxes (E-6) until zoomed. |
| Fit      | object-fit cover (crop-to-fill) or fill (stretch); readout names `cover`/`fill`. |
| Zoomed   | element `transform` includes `scale(Z)`, origin center; readout names `Zx`. Overflow clipped by the viewport region. |
| Combined | rotate + fit + zoom compose; readout names each non-default facet. |

### Transport bar - with transform readout (ASCII)

```
+================================================================+  <- seek progress (top border)
| [mute] [====vol=====] [sh][rp]   [<<] [ || ] [>>]   90deg cover 1.5x 1.5x 00:30/01:00 |
+----------------------------------------------------------------+
   left zone: mute + volume + shuffle + repeat
   right zone: transform readout (only != default) | rate (only != 1x) | time
```

(The `90deg cover 1.5x` transform segment is absent at defaults. It sits left of the existing
rate readout in the same right zone of the `[1fr_auto_1fr]` grid. Box edges are flush.)

## 5. Data Model

New `WorkspaceProvider` state + verbs (context-owned, no prop drilling):

```ts
type FitMode = "contain" | "cover" | "fill";
type Rotation = 0 | 90 | 180 | 270;

type ViewportTransform = {
  rotationDeg: Rotation;   // default 0
  fitMode: FitMode;        // default "contain"
  zoom: number;            // default 1, clamp [1, 4], 1-decimal steps
};

viewportTransform: ViewportTransform;
rotateClockwise: () => void;            // (deg + 90) % 360
cycleFitMode: () => void;               // contain -> cover -> fill -> contain
zoomBy: (delta: number) => void;        // clampZoom(zoom + delta)
resetViewportTransform: () => void;     // -> DEFAULT_TRANSFORM
```

Pure helpers (`viewport-transform.ts`, unit-tested in isolation):

```ts
nextRotation(current: Rotation): Rotation;     // (current + 90) % 360
nextFitMode(current: FitMode): FitMode;        // cycle the 3 modes
clampZoom(zoom: number): number;               // [1, 4], rounded to 1 decimal
isDefaultTransform(t: ViewportTransform): boolean;
formatTransform(t: ViewportTransform): string; // e.g. "90deg cover 1.5x" (non-default facets only)
DEFAULT_TRANSFORM, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, ROTATIONS, FIT_MODES;
```

New default bindings added to `SHORTCUT_ACTIONS`:

| id | hotkey | effect |
|----|--------|--------|
| `rotate-cw` | `Mod+Shift+R` | cycle +90deg |
| `cycle-fit-mode` | `F` | cycle object-fit |
| `zoom-in` | `=` | +0.1 |
| `zoom-out` | `-` | -0.1 |
| `reset-viewport` | `Mod+0` | reset all transforms |

No new Tauri IPC: all changes are frontend `<video>` CSS properties.

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | No active video | all five verbs no-op when `activeVideoId === null` |
| E-2 | Zoom past bounds | `clampZoom` clamps `[1, 4]`; float drift removed by 1-decimal rounding |
| E-3 | Rotate wrap | `(deg + 90) % 360` returns to 0 after 270 |
| E-4 | Fit-mode wrap | cycles back to `contain` after `fill` |
| E-5 | Active-video switch | transform state is session-level, untouched by `activateVideo`; element re-applies it on remount (AC-005) |
| E-6 | Rotated landscape clip underfills the box | accepted v1 limitation: pure CSS `rotate` does not refit; user zooms to compensate. No auto-rescale. |
| E-7 | Hotkeys while palette open | `useActionHotkeys({ ignoreInputs: true })` suppresses them when the cmdk input is focused |
| E-8 | `=` / `-` key tokens | valid `@tanstack/hotkeys` tokens; `Mod+0` and `Mod+Shift+R` follow the existing Mod-combo convention |

## 7. Dependencies

Reused only: `@tanstack/react-hotkeys` (`=`, `-`, `F`, `Mod+0`, `Mod+Shift+R` are valid tokens),
the existing shortcut registry + `useActionHotkeys` + command palette, Tailwind tokens. No new
packages, no Rust/Tauri changes, no settings-store changes.

## 8. Out of Scope

Pan/drag, pinch/wheel zoom, continuous zoom, auto-refit-on-rotate, disk persistence (FR-7),
per-file memory, counter-clockwise/arbitrary rotation, transport-bar buttons.

## 9. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-06-21 | Initial draft - rotate (90deg cycle), fit-mode cycle, centered zoom 1-4x, reset, session-sticky |
