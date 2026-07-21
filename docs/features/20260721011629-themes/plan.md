# Plan: Theme system (light / dark / system + custom app-token colors)

**Spec:** [spec.md](spec.md)
**Branch:** `20260721011629-themes`
**Approach:** one branch, three sequenced stages. TDD per stage (RED -> GREEN -> REFACTOR).

## Key decisions / patterns

- **Model is file-agnostic; the split lives only in the Tauri adapter.** `Settings` gains one
  `theme: ThemeSettings` field (`mode` + `colors`). `createTauriSettingsStore` strips `theme.colors`
  into `theme.json` and keeps `theme.mode` in `settings.json`. `mergeSettings`, the context, and the
  in-memory store never know about the file boundary.
- **No `Settings.version` bump.** `theme` is tolerant-merged like the existing fields - a settings.json
  without `theme` loads to the default.
- **Sparse overrides + canonical default table.** `theme-defaults.ts` holds the 18 built-in light/dark
  app-token oklch values (mirroring `index.css`). `theme.json` stores only the diff. The JSON editor is
  seeded with the full effective set; on Save, `diffOverrides` strips back to the diff.
- **Apply via inline CSS vars on `document.documentElement`** for the active effective mode, plus the
  `.dark` class toggle. Inline beats `:root`/`.dark`; Tailwind's `@theme inline` re-derives `--color-*`.
- **Lean CodeMirror layer** (not purerequest's `RawJsonEditor`): one `CodeEditor` wrapper + a fixed
  built-in editor chrome/highlight scheme + `json()` + empty-tolerant linter. Explicit **Save** button
  gated on a synchronous parse - no Mod+S, no active-editor registry.
- **`ThemeColors` flattened** to `{ light: Partial<Record<AppTokenName,string>>, dark: {...} }` - no
  `tokens`/`editor` wrapper (editor customization is out of scope).

## Glossary terms sharpened

- **Mode** = the user's *choice* (`light` | `dark` | `system`). **Effective mode** = the resolved
  concrete scheme actually applied (`light` | `dark`), equal to Mode unless Mode is `system`, in which
  case it is `matchMedia`-derived.
- **App token** = a shadcn CSS var driving app chrome (`--background`, ...). The customizable set is 18.

## File Structure map

```
package.json                                (modify)  + 9 CodeMirror deps
src/lib/settings/settings.ts                (modify)  ThemeMode/AppTokenName/ThemeColors/ThemeSettings + defaults + mergeTheme
src/lib/settings/settings-context.tsx       (modify)  saveThemeMode + saveThemeColors
src/lib/settings/tauri-store.ts             (modify)  theme.json LazyStore split (strip colors out of settings.json)
src/lib/theme/effective-mode.ts             (new)     resolveEffectiveMode (pure)
src/lib/theme/theme-defaults.ts             (new)     APP_TOKENS + DEFAULT_THEME_COLORS (from index.css)
src/lib/theme/overrides.ts                  (new)     applyDefaults + diffOverrides (pure)
src/lib/theme/apply-vars.ts                 (new)     applyThemeVars (inline CSS vars)
src/lib/theme/theme-context.tsx             (new)     ThemeProvider + useTheme + useThemeOptional
src/lib/theme/editor-theme.ts               (new)     makeChrome/makeHighlight/json+linter (built-in scheme)
src/components/ui/code-editor.tsx           (new)     lean @uiw/react-codemirror wrapper
src/components/settings/theme-section.tsx   (new)     mode selector + CM color editor + Save
src/app/providers.tsx                       (modify)  mount <ThemeProvider> inside <SettingsProvider>
src/routes/settings.tsx                      (modify)  render <ThemeSection /> in the stack
src/index.css                               (no change) canonical default source only
```

Tests co-located under each dir's `__tests__/` following the repo convention.

---

## Stage 1 - Mode (light / dark / system)

### Task 1: Settings model - theme mode

**Files:** Modify `src/lib/settings/settings.ts`; Test `src/lib/settings/__tests__/settings.test.ts`
(add a `mergeSettings theme` describe block).

**Interfaces:**
- Produces: `ThemeMode = "light"|"dark"|"system"`, `ThemeSettings = { mode: ThemeMode; colors: ThemeColors }`,
  `Settings.theme: ThemeSettings`, `DEFAULT_SETTINGS.theme = { mode: "system", colors: { light:{}, dark:{} } }`,
  `mergeTheme(defaults, partial)` folded into `mergeSettings`. (In Stage 1 `ThemeColors` = `{light:{},dark:{}}`
  empty maps; the token unions + merge land in Stage 2.)

- [ ] RED: `mergeSettings` defaults `theme.mode` to `"system"`; tolerates a missing / garbage `theme`;
  keeps a valid `theme.mode`; drops a bad mode string to the default.
- [ ] GREEN: add the type, default, and `mergeTheme` guard (mirror the `sortDirection` union guard).
- [ ] Commit `feat(themes): add theme mode to settings model + tolerant merge`.

### Task 2: Effective-mode resolver (pure)

**Files:** New `src/lib/theme/effective-mode.ts`; Test `src/lib/theme/__tests__/effective-mode.test.ts`.

**Interfaces:**
- Produces: `resolveEffectiveMode(mode: ThemeMode, prefersDark: boolean): "light"|"dark"`, `type EffectiveMode`.

- [ ] RED: `system`+prefersDark -> dark; `system`+!prefersDark -> light; `light` -> light; `dark` -> dark
  (ignores prefersDark).
- [ ] GREEN: the 4-line pure function.
- [ ] Commit `feat(themes): resolve effective mode from mode + OS preference`.

### Task 3: ThemeProvider (.dark toggle + system matchMedia)

**Files:** New `src/lib/theme/theme-context.tsx`; Modify `src/app/providers.tsx`; Test
`src/lib/theme/__tests__/theme-context.test.tsx`.

**Interfaces:**
- Consumes: `useSettings().settings.theme.mode`, `saveThemeMode` (Task 4), `resolveEffectiveMode` (Task 2).
- Produces: `ThemeProvider`, `useTheme() -> { mode, effectiveMode, setMode, colors, effectiveColors, setColors }`,
  `useThemeOptional()`. (Stage 1 wires only mode + the `.dark` toggle; colors fields are stubbed to
  empty defaults until Stage 2.)

- [ ] RED (mirror `purerequest` `theme-context.test.tsx`): mode `dark` puts `.dark` on `<html>`;
  `light` removes it; `system` follows a stubbed `matchMedia` and flips live on a dispatched `change`;
  no-`matchMedia` falls back to light without throwing.
- [ ] GREEN: `ThemeProvider` with the `useLayoutEffect` `.dark` toggle + guarded matchMedia listener;
  mount it in `providers.tsx` between `SettingsProvider` and `HotkeysProvider`.
- [ ] Commit `feat(themes): ThemeProvider toggles .dark + follows system preference`.

### Task 4: saveThemeMode on the settings context

**Files:** Modify `src/lib/settings/settings-context.tsx`; Test
`src/lib/settings/__tests__/settings-context.test.tsx`.

**Interfaces:**
- Produces: `saveThemeMode(mode: ThemeMode): void` on `SettingsContextValue` (mirror `saveSortDirection`:
  `update(base => ({ ...base, theme: { ...base.theme, mode } }))`).

- [ ] RED: `saveThemeMode("dark")` persists `theme.mode === "dark"` through the (spied) store.
- [ ] GREEN: the `useCallback` + add to the memo object + dep array.
- [ ] Commit `feat(themes): persist theme mode via settings context`.

### Task 5: Mode selector UI

**Files:** New `src/components/settings/theme-section.tsx` (mode selector only for now); Modify
`src/routes/settings.tsx`; Test `src/components/settings/__tests__/theme-section.test.tsx`.

**Interfaces:**
- Consumes: `useSettings().settings.theme.mode` + `saveThemeMode`.
- Produces: `ThemeSection` (exported), rendered in the settings stack above `ShortcutsSection`.

- [ ] RED: three buttons (Light/Dark/System); clicking Dark calls `saveThemeMode("dark")`; the active
  mode reads `aria-pressed="true"`.
- [ ] GREEN: the segmented Button row (square, 1px-divided, no rounding per design.md); render in the route.
- [ ] Commit `feat(themes): mode selector in the settings screen`.

Stage 1 gate: `npm test` + `npm run typecheck` + `npm run lint` green. Light/dark/system switch +
persist works (AC-001..004, AC-011 mode half).

---

## Stage 2 - App-token custom colors (model + apply + persistence)

### Task 6: Token unions + defaults table + tolerant color merge

**Files:** New `src/lib/theme/theme-defaults.ts`; Modify `src/lib/settings/settings.ts` (flesh out
`AppTokenName`, `ThemeColorOverrides`, `ThemeColors`, `FullThemeColors`, `mergeTheme` colors half);
Test `src/lib/theme/__tests__/theme-defaults.test.ts` + extend `settings.test.ts`.

**Interfaces:**
- Produces: `AppTokenName` (18), `ThemeColorOverrides = Partial<Record<AppTokenName,string>>`,
  `ThemeColors = {light,dark}`, `FullThemeColors`, `APP_TOKENS`, `DEFAULT_THEME_COLORS`,
  `mergeThemeColors` (drops unknown keys / non-string values, keyed to the `AppTokenName` set).

- [ ] RED: the table has all 18 tokens for both modes with valid `oklch(...)` values (cross-check 2-3
  against `index.css` via `readFileSync`, per purerequest learnings #137); `mergeThemeColors` keeps
  known tokens, drops an unknown key + a non-string value, tolerates a missing `colors`.
- [ ] GREEN: the table + the `mergeTokenMap`/`mergeThemeColors` guards.
- [ ] Commit `feat(themes): canonical app-token defaults + tolerant color merge`.

### Task 7: Override diff/apply (pure)

**Files:** New `src/lib/theme/overrides.ts`; Test `src/lib/theme/__tests__/overrides.test.ts`.

**Interfaces:**
- Consumes: `ThemeColors`, `FullThemeColors`.
- Produces: `applyDefaults(overrides, defaults): ThemeColors`, `diffOverrides(edited, defaults): ThemeColors`.

- [ ] RED: `applyDefaults` layers a sparse override over defaults; `diffOverrides` keeps only differing
  entries, drops a token edited back to default (whitespace-insensitive); round-trip `diff(apply(x)) === x`
  for a sparse `x`.
- [ ] GREEN: the two pure functions (mirror purerequest `overrides.ts`, flattened).
- [ ] Commit `feat(themes): sparse override diff + apply-defaults`.

### Task 8: Apply overrides as inline CSS vars (pure)

**Files:** New `src/lib/theme/apply-vars.ts`; Test `src/lib/theme/__tests__/apply-vars.test.ts`.

**Interfaces:**
- Consumes: `ThemeColorOverrides`, `APP_TOKENS`.
- Produces: `applyThemeVars(el, mode, overrides): void`.

- [ ] RED: sets `--primary` inline when overridden; clears a previously-set var when the override is
  gone; a mode with no overrides leaves no stray inline vars.
- [ ] GREEN: the loop over `APP_TOKENS` set/removeProperty.
- [ ] Commit `feat(themes): apply app-token overrides as inline CSS vars`.

### Task 9: saveThemeColors + theme-context colors wiring

**Files:** Modify `src/lib/settings/settings-context.tsx` (add `saveThemeColors`); Modify
`src/lib/theme/theme-context.tsx` (compute `effectiveColors`, apply vars in the layout effect, expose
`colors`/`effectiveColors`/`setColors`); Test `settings-context.test.tsx` +
`src/lib/theme/__tests__/theme-context-colors.test.tsx`.

**Interfaces:**
- Consumes: `applyDefaults`, `applyThemeVars`, `DEFAULT_THEME_COLORS`.
- Produces: `saveThemeColors(colors: ThemeColors): void`; `useTheme()` now returns real
  `colors`/`effectiveColors`/`setColors`.

- [ ] RED: an override on light `primary` sets the `--primary` inline var when the effective mode is
  light; switching to dark clears it and applies dark's set; `saveThemeColors` persists through the store.
- [ ] GREEN: the context saver + the layout-effect `applyThemeVars` call + the memo fields.
- [ ] Commit `feat(themes): apply + persist custom app-token colors`.

### Task 10: theme.json adapter split

**Files:** Modify `src/lib/settings/tauri-store.ts`; Test `src/lib/settings/__tests__/tauri-store.test.ts`
(new - PP has none today; use a fake `LazyStore`, mirror purerequest `tauri-store-theme.test.ts`).

**Interfaces:**
- Consumes: `Settings.theme`.
- Produces: on `save`, `theme.colors` -> `theme.json` (key `colors`) and `theme: { mode }` only into
  `settings.json`; on `load`, overlay `theme.json`'s colors onto the merged settings.

- [ ] RED: `save` writes the colors to the theme store and leaves only `theme.mode` in the settings
  store; `load` recombines; a round-trip preserves both; a missing/garbage `theme.json` loads to
  defaults without throwing.
- [ ] GREEN: the second `LazyStore("theme.json")` + strip/overlay (mirror purerequest, minus workspacePath).
- [ ] Commit `feat(themes): split custom colors into theme.json`.

Stage 2 gate: `npm test` + `npm run typecheck` + `npm run lint` green. (AC-005..008, AC-010, AC-011
colors half - model + apply + persistence, still no editor UI.)

---

## Stage 3 - CodeMirror color editor UI

### Task 11: Add CodeMirror deps + lean CodeEditor wrapper

**Files:** Modify `package.json` (+ the 9 CM deps, exact versions in spec §8); New
`src/components/ui/code-editor.tsx`; Test `src/components/ui/__tests__/code-editor.test.tsx`.

**Interfaces:**
- Produces: `CodeEditor({ value, onChange, extensions, ariaLabel })` - the one `@uiw/react-codemirror`
  wrapper (`theme="none"`, `basicSetup={{ lineNumbers: false }}`).

- [ ] Run `npm install` after editing `package.json`; confirm the CM packages resolve.
- [ ] RED: renders a textbox seeded with `value`; typing fires `onChange` with the new text.
- [ ] GREEN: the wrapper (mirror purerequest `code-editor.tsx`, drop `withFold`/`onBlur`/`height` extras
  PP doesn't need yet).
- [ ] Commit `feat(themes): add CodeMirror + lean CodeEditor wrapper`.

### Task 12: Built-in editor chrome + highlight scheme

**Files:** New `src/lib/theme/editor-theme.ts`; Test `src/lib/theme/__tests__/editor-theme.test.ts`.

**Interfaces:**
- Produces: `makeChrome(isDark): Extension`, `makeHighlight(isDark): Extension`,
  `jsonEditorExtensions(isDark): Extension[]` (`json()` + empty-tolerant linter + chrome + highlight),
  `emptyTolerantJsonLinter()`.

- [ ] RED: `makeHighlight(true)` yields the dark string color; `makeHighlight(false)` the light one;
  `makeChrome(_, true)` carries `{ dark: true }`; chrome bg is `transparent` in both.
- [ ] GREEN: the factories (built-in light + dark hues from purerequest's table, fixed - NOT
  user-customizable; assert via the factory output, not pixels, per learnings #49).
- [ ] Commit `feat(themes): built-in light + dark editor scheme`.

### Task 13: Theme section - CM JSON color editor + Save

**Files:** Modify `src/components/settings/theme-section.tsx` (add the editor + Save below the mode
selector); Test `src/components/settings/__tests__/theme-section-colors.test.tsx`.

**Interfaces:**
- Consumes: `useTheme()` colors / `setColors` (or `useSettings().saveThemeColors`), `applyDefaults`,
  `diffOverrides`, `DEFAULT_THEME_COLORS`, `jsonEditorExtensions(isDark)`, `CodeEditor`.
- Produces: the full Theme section (mode + editor + Save).

- [ ] RED: the editor seeds with the full effective set (both modes, every token); editing a token to a
  new valid `oklch` and clicking Save calls `setColors` with the sparse diff; editing a token back to
  default drops it; malformed JSON disables the Save button and persists nothing.
- [ ] GREEN: local `useState` buffer + `parseThemeColors` shape validator + Save button gated on
  `parse !== null` -> `setColors(diffOverrides(parsed, DEFAULT_THEME_COLORS))`.
- [ ] Commit `feat(themes): CodeMirror JSON color editor in settings`.

Stage 3 gate: full suite + typecheck + lint green (AC-009 + the full color flow end-to-end).

---

## Execution order

1. Stage 1 (mode) RED -> GREEN -> REFACTOR -> `npm test` + `npm run typecheck` + `npm run lint`.
2. Stage 2 (colors model/apply/persist) same loop.
3. Stage 3 (CM editor UI) same loop.
4. Fresh-context verifier over the whole diff once all three stages land.
5. Manual webview check (`npm start`): switch light/dark/system, edit a color + Save, confirm the app
   recolors live; confirm `settings.json` has only `theme.mode` and `theme.json` has the colors; do a
   dark-mode pass over the app chrome (the `.dark` block is now live). **Shut the app down after**
   (`pkill`/kill the dev port per CLAUDE.md).

## Doc drift (pre-commit)

- **README.md**: the settings/persistence description gains `theme.json` (custom colors) + a note that
  the mode lives in `settings.json`; mention the Settings -> Theme section. The repo-layout `lib/` line
  gains `theme/`, and `settings/` gains the theme fields; the `ui/` line gains `code-editor`. The
  "Not yet" list is unaffected.
- **docs/design.md**: §"Color & status" says "light/dark both work" - update to note the mode is now
  user-selectable + customizable and the `.dark` block is now live (mark pureplayer-specific vs the
  shared contract as needed).
- **docs/learnings.md**: add entries for (a) the inline-var application + `.dark`-now-live, (b) the lean
  CM port vs purerequest's coupled RawJsonEditor + the explicit-Save-over-Mod+S choice, (c) the
  theme.json split needing no capability change (`store:default` is plugin-scoped).
- **CLAUDE.md**: no new agent-editing convention beyond what design.md/learnings capture - state so in
  the pre-commit summary.

## docs/adr.md (offer)

Candidate ADR (hard-to-reverse-ish, surprising, real alternative existed): "custom theme colors edited
as raw JSON in CodeMirror (not a hex picker), applied as inline CSS vars, colors split into theme.json".
Offer at the end of implementation.

## Acceptance verification (filled after implementation)

Status: **all ACs PASS** (fresh-context verifier + manual webview pass, 2026-07-21). Full suite 634
green, typecheck clean, lint 0 errors. Post-verify fix: `parseThemeColors` now screens non-string
token values so a well-formed-JSON-but-non-string value disables Save instead of throwing in the
onClick (regression test added).

| AC | Proving test(s) |
| --- | --- |
| AC-001 | `theme-context.test.tsx` "should NOT put the dark class ... if mode is light"; `effective-mode.test.ts` light cases; manual: light body bg `oklch(1 0 0)` |
| AC-002 | `theme-context.test.tsx` "should put the dark class ... if mode is dark"; `theme-section.test.tsx` "should apply the dark class live ..."; manual: dark body bg `oklch(0.145 0 0)` |
| AC-003 | `theme-context.test.tsx` "should flip the dark class live ..." + "should fall back to light ... if matchMedia is absent"; `effective-mode.test.ts` system cases |
| AC-004 | `settings.test.ts` "mergeSettings theme" block; `settings-context.test.tsx` "should persist theme.mode ..."; `theme-section.test.tsx` persist Dark/Light |
| AC-005 | `apply-vars.test.ts` (`--primary` set); `theme-context-colors.test.tsx` (`--primary` on documentElement + persist via save spy); manual: dark primary override -> inline `--primary` on `<html>` |
| AC-006 | `tauri-store.test.ts` (colors->theme.json, only mode->settings.json, recombine on load, round-trip) |
| AC-007 | `overrides.test.ts` (keep-only-differing); `theme-context-colors.test.tsx` (un-overridden = built-in default); `theme-defaults.test.ts` (table mirrors index.css) |
| AC-008 | `overrides.test.ts` (drop == default, whitespace-insensitive); `theme-section-colors.test.tsx` "should drop an override edited back to its default on save" |
| AC-009 | `theme-section-colors.test.tsx` (full-set seed, persist sparse diff, malformed/wrong-shape/non-string-value disables Save, valid enables); `editor-theme.test.ts` (lint malformed JSON); manual: `{ not json` -> lint marker + Save disabled |
| AC-010 | `settings.test.ts` "mergeSettings theme colors" (drop unknown key / non-string / garbage, no throw); `tauri-store.test.ts` (garbage theme.json -> defaults, no throw) |
| AC-011 | `tauri-store.ts` `.catch` guards + in-memory-store path exercised by every context/section/provider test; manual: dev-browser (`npm run dev`) applies live, persistence is a no-op |
