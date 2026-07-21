# Spec: Theme system (light / dark / system + custom app-token colors)

**Version:** 0.1.0
**Created:** 2026-07-21
**Status:** Draft (awaiting approval)
**Branch:** `20260721011629-themes`
**Mirrors:** `purerequest/docs/features/20260625155948-themes/` (minus editor-syntax theming - see §Scope).

## 1. Overview

pureplayer is light-only today. `src/index.css` ships both a `:root` (light) and a `.dark`
(lines 28-47) token block, but **nothing ever toggles the `.dark` class** - the dark block is dead
code, and there is no theme UI. Confirmed: no `matchMedia`, `classList`, `ThemeProvider`, or
`setTheme` anywhere in `src/`.

This feature adds a real theme system:

- A **mode**: `light`, `dark`, or `system` (follows the OS `prefers-color-scheme`), applied live and
  persisted to `settings.json` under `theme.mode`.
- **Per-mode custom colors**: the user overrides any of the **18 app-token** CSS vars (the shadcn set
  in `index.css`), light and dark edited independently, via a **CodeMirror JSON editor** (mirrors
  purerequest's raw-JSON edit convention - the user asked to add CodeMirror rather than a
  hex-picker / plain textarea). Values are `oklch(...)` strings, matching `index.css`.
- **Two-file persistence** mirroring purerequest's `keymap.json` split: the **mode** stays in
  `settings.json`; the **custom colors** live in a new **`theme.json`** so a color scheme is portable
  independently of device-local UI state. The `Settings` model stays file-agnostic; the split lives
  only in the Tauri adapter.

### Scope

- **In:**
  - Mode selector (light / dark / system) in the `/settings` screen; applied live; persisted.
  - `system` resolves via `window.matchMedia("(prefers-color-scheme: dark)")` and reacts to OS
    changes while the app is open (no restart).
  - Per-mode customization of the **18 app tokens** via a **CodeMirror JSON editor** with JSON syntax
    highlighting + a lint underline on malformed JSON. The editor follows the active mode (built-in
    light/dark editor chrome scheme).
  - The editor is **seeded with the full effective color set** (every token, showing its
    override-or-built-in-default value) so all tokens are discoverable; on **Save**, the persisted
    `theme.json` keeps only entries that **differ from the built-in default** (sparse) so an untouched
    token always tracks the built-in default. Editing a token back to its default value drops it from
    `theme.json` = the per-token "reset".
  - A **Save** button, disabled while the JSON is malformed (invalid JSON never persists).
  - New CodeMirror dependency stack (same versions purerequest resolves) + a lean shared
    `CodeEditor` wrapper + a `theme.json` LazyStore adapter split.
  - `npm run dev` (no Tauri host): theme UI works and applies live; persistence is a no-op (mode /
    colors fall back to defaults on reload), consistent with existing settings behavior.
- **Out:**
  - **Editor-syntax color customization** (purerequest's 9 editor tokens). PP has NO content editors
    (no body/config/env/response editors) - the only CodeMirror instance is the color editor itself,
    so customizing the syntax colors of an editor whose only job is editing theme colors has near-zero
    payoff (YAGNI). The color editor still gets a built-in light + dark chrome/highlight scheme so it
    is readable in both modes and follows the active mode - those colors are just not user-editable.
  - Per-workspace / per-playlist themes (theme is per-installation, like the rest of `settings.json`).
  - Importing/exporting theme files via a picker, named theme presets beyond light/dark.
  - Alpha-channel picker UI - colors are edited as raw `oklch(...)` strings, so the two dark tokens
    that ship with alpha (`border`, `input`) round-trip verbatim (no picker = no alpha loss).
  - A high-contrast / font / spacing theme - colors only.

### Decisions captured (from clarifying questions)

- **Scope = mode + app-token colors** (not mode-only). User picked "Mode + custom colors".
- **Color input = CodeMirror JSON editor** (user: "CodeMirror, jak w innych apkach"). Adds the CM
  dependency stack to PP. NOT a hex-picker, plain textarea, or per-token inputs.
- **File split into `theme.json`** (user: "Zrób rozdzielenie, jak w purerequest"). Mode ->
  `settings.json`, colors -> `theme.json`, split in the Tauri adapter only.
- **Editor-syntax tokens dropped** (user: "No - app tokens only (18)"). Only the 18 app tokens are
  customizable; the editor's own scheme is built-in.

## 2. Acceptance Criteria

- **AC-001**: Setting mode to **Light** applies the light token set: the `.dark` class is absent from
  `<html>` and `bg-background` resolves to the light value.
- **AC-002**: Setting mode to **Dark** applies the dark token set: the `.dark` class is present on
  `<html>`.
- **AC-003**: Setting mode to **System** follows `prefers-color-scheme`: dark when the OS prefers dark,
  light otherwise; **and** flips live when the OS preference changes while the app is open (no
  restart). With no `matchMedia` (jsdom / older webview) it falls back to light without throwing.
- **AC-004**: The selected mode persists to `settings.json` under `theme.mode` and is restored on next
  launch (a dark choice reopens dark).
- **AC-005**: A user-set custom value for an app token in a given mode is applied live (e.g. overriding
  light `primary` immediately recolors primary surfaces while in light mode) and persisted.
- **AC-006**: Custom colors persist to `theme.json` (NOT `settings.json`) and are restored on next
  launch; `settings.json` carries only `theme.mode`, never the color map.
- **AC-007**: Only overridden tokens are stored; an un-customized token always renders the built-in
  default for its mode (changing the built-in default in `index.css`/the defaults table moves an
  un-overridden token, a customized one does not).
- **AC-008**: Editing a token back to its built-in default value (or removing the line) and saving
  drops the override from `theme.json` and reverts the token (sparse-store = per-token reset). The
  compare is whitespace-insensitive.
- **AC-009**: The JSON editor seeds with the full effective color set (every app token for both modes,
  each showing its override-or-default value); saving a new valid `oklch(...)` value persists it.
  Malformed JSON shows a lint underline and the **Save** button is disabled (invalid JSON never
  persists).
- **AC-010**: A malformed value / unknown key / wrong-typed entry in a hand-edited `theme.json` is
  ignored on load (falls back to the built-in default for that token); load never throws.
- **AC-011**: In `npm run dev` (no Tauri host) the theme UI works and applies live; persistence is a
  no-op (mode / colors fall back to defaults on reload), consistent with existing settings behavior.

## 3. User Test Cases

- **TC-001** (happy, mode): Open `/settings` -> Theme -> pick **Dark** -> app turns dark immediately.
  Reload -> still dark. Maps to: AC-001, AC-002, AC-004.
- **TC-002** (system): Pick **System** with the OS in light -> app is light. Flip the OS to dark (or
  emulate) -> app turns dark with no reload. Maps to: AC-003.
- **TC-003** (custom app token): In **Light**, change `primary` to red in the JSON editor and Save ->
  primary surfaces turn red immediately. Reload -> still red. Switch to **Dark** -> dark `primary` is
  unchanged (per-mode). Maps to: AC-005, AC-006, AC-007.
- **TC-004** (reset): After TC-003, edit light `primary` back to its built-in oklch value (or remove
  the line) and Save -> the override disappears from `theme.json` and primary reverts. Maps to: AC-008.
- **TC-005** (invalid JSON): Type malformed JSON in the editor -> a lint underline shows and Save is
  disabled; nothing persists. Fix it -> Save re-enables. Maps to: AC-009.
- **TC-006** (file split): After customizing, inspect the config dir: `settings.json` has `theme.mode`
  only; `theme.json` has the color overrides. Maps to: AC-006.
- **TC-007** (persistence boundary): In `npm run dev`, pick Dark + customize a color -> applies live;
  reload -> reverts to defaults (no native store). Maps to: AC-011.
- **TC-008** (corrupt theme.json): Hand-edit `theme.json` with a garbage value / unknown key ->
  reload -> the bad entry is ignored, the token shows its default, nothing crashes. Maps to: AC-010.

## 4. UI States

| State                      | Behavior                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Theme section initial      | Mode selector shows the current mode; the JSON editor is seeded with the full effective color set (overrides layered over defaults), both modes present. |
| Mode = system, OS resolves | The applied DOM reflects the OS-resolved mode; the selector still reads "System".         |
| Editing the JSON           | Live lint underline on malformed JSON; the **Save** button is disabled while the JSON is invalid. |
| Saved with overrides       | Only tokens differing from the built-in default are written to `theme.json`; the editor re-seeds with the merged set. |
| Invalid stored color       | A malformed value / unknown key in `theme.json` is ignored on load (falls back to the default for that token). |
| Dev browser (no host)      | The section is fully interactive; changes apply live; persistence is a silent no-op on save. |

### 4.1 ASCII wireframe - `/settings` Theme section

```
+--------------------------------------------------------------------+
|  Settings                                              [ Back ]     |
+--------------------------------------------------------------------+
|  Playback                                                          |
|    Reveal transport bar on hover                        (o   )     |
|                                                                    |
|  Theme                                                             |
|    Choose the app appearance, or follow your OS preference.        |
|    +---------+---------+----------+                                 |
|    |  Light  |  Dark   | System * |   (* = active, filled)          |
|    +---------+---------+----------+                                 |
|                                                                    |
|    Customize colors per mode. Each token shows its current value;  |
|    edit a value to override it, or set it back to the default to   |
|    clear the override.                              [ Save ]       |
|    +------------------------------------------------------------+  |
|    | {                                                          |  |
|    |   "light": {                                               |  |
|    |     "background": "oklch(1 0 0)",                           |  |
|    |     "foreground": "oklch(0.145 0 0)",                       |  |
|    |     ... (18 tokens)                                         |  |
|    |   },                                                        |  |
|    |   "dark": {                                                 |  |
|    |     "background": "oklch(0.145 0 0)",                       |  |
|    |     ... (18 tokens)                                         |  |
|    |   }                                                         |  |
|    | }                                                          |  |
|    +------------------------------------------------------------+  |
|                                                                    |
|  Shortcuts                                                         |
|    ...                                                             |
|  Updates                                                          |
|    ...                                                             |
+--------------------------------------------------------------------+
```

Mode selector: three square buttons in a thin row, divided by a 1px left border, no rounded corners
(design.md); the active mode is the filled `default` variant, the others `outline`. The Save button is
square, `outline`/`sm`, disabled while the JSON is invalid. The editor box is a 1px `border-border`
frame, no rounding.

## 5. Data Model

### 5.1 Settings model additions (`src/lib/settings/settings.ts`)

```ts
export type ThemeMode = "light" | "dark" | "system";

export type AppTokenName =
  | "background" | "foreground" | "card" | "card-foreground"
  | "popover" | "popover-foreground" | "primary" | "primary-foreground"
  | "secondary" | "secondary-foreground" | "muted" | "muted-foreground"
  | "accent" | "accent-foreground" | "destructive" | "border" | "input" | "ring";

// Sparse per-mode override map. An absent key = "use the built-in default for
// that token in that mode". Flattened (no tokens/editor wrapper) because editor
// customization is out of scope for PP.
export type ThemeColorOverrides = Partial<Record<AppTokenName, string>>;

export type ThemeColors = { light: ThemeColorOverrides; dark: ThemeColorOverrides };

// The complete built-in default set: every token present in both modes.
export type FullThemeColors = {
  light: Record<AppTokenName, string>;
  dark: Record<AppTokenName, string>;
};

export type ThemeSettings = { mode: ThemeMode; colors: ThemeColors };

// Added to Settings:  theme: ThemeSettings
// DEFAULT_SETTINGS.theme = { mode: "system", colors: { light: {}, dark: {} } }
```

`Settings.version` stays `1`; `mergeSettings` gains a tolerant `mergeTheme(defaults.theme, partial.theme)`
(mirrors how the existing fields tolerate missing/garbage - a settings.json without `theme` loads to
the default). Unknown token keys and non-string values are dropped by a `mergeTokenMap` keyed to the
known `AppTokenName` set (exactly purerequest's tolerant merge, minus the editor sub-map).

### 5.2 Token defaults (single source of truth)

`src/lib/theme/theme-defaults.ts` holds `APP_TOKENS: AppTokenName[]` (the 18 names) and
`DEFAULT_THEME_COLORS: FullThemeColors` with the light/dark oklch values copied verbatim from
`index.css` (`:root` -> light, `.dark` -> dark). This is the target for "reset" and the seed for the
editor. **These values already match purerequest's table exactly** (verified: PP `index.css` 18 tokens
== PR `DEFAULT_THEME_COLORS`).

### 5.3 On-disk shape

`settings.json` (existing file, new field):
```json
{ "...": "...", "theme": { "mode": "dark" } }
```

`theme.json` (new file, mirrors purerequest):
```json
{ "colors": { "light": { "primary": "oklch(0.55 0.22 27)" }, "dark": {} } }
```

### 5.4 Override extraction (`src/lib/theme/overrides.ts`, pure, no dep)

- `applyDefaults(overrides: ThemeColors, defaults: FullThemeColors): ThemeColors` - layer the sparse
  overrides over the defaults to produce the full effective set (seeds the editor, applied to the DOM).
- `diffOverrides(edited: ThemeColors, defaults: FullThemeColors): ThemeColors` - keep an entry only if
  its value differs from the built-in default (whitespace-insensitive compare of the `oklch(...)`
  string). A token edited back to default drops out = per-token reset.

### 5.5 DOM application (`src/lib/theme/apply-vars.ts`, pure)

`applyThemeVars(el: HTMLElement, mode, overrides: ThemeColorOverrides)` - for each app token, set the
inline CSS var (`--background`, ...) when overridden, else clear it. An inline var beats both the
`:root` and `.dark` stylesheet rules, so only the active mode's SPARSE overrides need writing; the
built-in defaults come from `index.css`. Tailwind's `@theme inline` re-derives `--color-*` from these
base vars automatically. On a mode flip the vars are cleared + reapplied.

## 6. Theme application mechanism

A `ThemeProvider` (new, `src/lib/theme/theme-context.tsx`) mounts inside `SettingsProvider` (so it can
read `useSettings()`), reads `settings.theme.mode` + `.colors`, subscribes to
`matchMedia("(prefers-color-scheme: dark)")` (guarded for absence), computes the **effective mode**,
and in a `useLayoutEffect`:
- toggles `.dark` on `document.documentElement` for the effective mode,
- calls `applyThemeVars(documentElement, effectiveMode, colors[effectiveMode])`.

It exposes `useTheme()` -> `{ mode, effectiveMode, setMode, colors, effectiveColors, setColors }`.
Wired in `src/app/providers.tsx` just inside `SettingsProvider`:
`SettingsProvider -> ThemeProvider -> HotkeysProvider -> ...`.

### CodeMirror integration (lean, PP-specific)

purerequest's `RawJsonEditor` is coupled to its workspace/tree/active-editor-registry/token-completion/
JSON-Schema machinery, none of which exists in PP. So PP ports a **lean** CM layer:
- `src/components/ui/code-editor.tsx` - the one `@uiw/react-codemirror` wrapper (`theme="none"`,
  `lineNumbers: false`), taking `value`/`onChange`/`extensions` (mirrors PR's `code-editor.tsx`).
- `src/lib/theme/editor-theme.ts` - built-in light + dark editor **chrome + highlight** schemes
  (`makeChrome(isDark)`, `makeHighlight(isDark)`) using the JetBrains-derived hues purerequest ships,
  fixed (not user-customizable). Background stays `transparent` so the editor inherits the themed pane
  (no white-flash). Plus `json()` + an empty-tolerant JSON linter.
- The Theme section owns the edit buffer as local `useState`, a `parse` that validates the
  `{ light:{...}, dark:{...} }` shape, a **Save** button gated on `parse !== null`. NO Mod+S / active
  editor registry - explicit Save, which sidesteps purerequest's documented CM-save flakiness and is
  cleanly testable.

## 7. Edge cases

- **Malformed `theme.json`** (hand-edited garbage, wrong types): the tolerant merge drops invalid
  entries, falls back to defaults per token. Never throws on load. (AC-010)
- **Unknown token key** in `theme.json` (renamed/removed token): ignored by the merge (keyed to the
  known `AppTokenName` set). (AC-010)
- **Invalid oklch string** for a token: kept as-is if it's a string (the merge is type-only, not
  color-validity) - the DOM simply ignores an unparseable CSS var value, falling back to the
  stylesheet default. The JSON editor still seeds from the built-in default when the token is absent.
- **Alpha tokens** (dark `border`/`input` ship `/ 10%` and `/ 15%`): stored/edited verbatim as their
  `oklch(... / N%)` string; no picker = no alpha loss.
- **System mode with no `matchMedia`** (jsdom / older webview): default to light; the listener wiring
  is guarded so absence doesn't throw. (AC-003)
- **Malformed JSON in the editor**: lint underline + Save disabled; the last-saved colors stay applied
  (the editor buffer is local, the applied colors come from settings). (AC-009)
- **Dev browser**: in-memory settings store -> live apply works, save is a no-op (reload reverts).
  (AC-011)
- **First launch / no `theme.json`**: defaults (`mode: "system"`, no overrides).

## 8. Dependencies

New npm dependencies (same versions purerequest resolves, verified from its `node_modules`):
`@uiw/react-codemirror@^4.25.10`, `@codemirror/lang-json@^6.0.2`, `@codemirror/view@^6.43.1`,
`@codemirror/state@^6.6.0`, `@codemirror/language@^6.12.3`, `@codemirror/lint@^6.9.7`,
`@codemirror/commands@^6.10.3`, `@codemirror/autocomplete@^6.20.3`, `@lezer/highlight@^1.2.3`.
(purerequest also has `@codemirror/lang-javascript` + `codemirror-json-schema` - PP does NOT need
them: no JS script editor, no JSON-Schema intellisense.)

No new Rust dependency. The existing `store:default` capability is plugin-scoped (not per-file), so a
second `LazyStore("theme.json")` needs NO capability change. Colors are edited/stored as `oklch(...)`
strings - no color-space conversion.

Touches `index.css` only as the canonical default source (no structural CSS change - overrides are
injected as inline vars).

## 9. Domain-modeling gate (mandatory)

- **pz-ddd**: evaluated -> **does not apply.** No new domain model, aggregate, consistency boundary,
  or cross-module workflow; this is per-installation UI configuration plumbing (same layer as the
  existing shortcuts / playback / UI settings).
- **pz-archetypes**: evaluated -> **does not apply.** The problem shape is not accounting / inventory /
  ordering / pricing / party / product / quantity / rules / plan-vs-execution / graphs. It is a
  preferences/config surface.
- **pz-codebase-design**: evaluated -> **applies (lightly).** The lean `CodeEditor` wrapper and the
  `theme-defaults` / `overrides` / `apply-vars` pure modules each get a deep, single-responsibility
  interface (deletion test: each is consumed by 2+ callers or hides real complexity). The Tauri
  adapter split hides the file boundary behind the unchanged `SettingsStore` port.
- **Verdict:** ddd / archetypes do not apply; codebase-design shapes the module seams. (Recorded in
  the Decision Log.)

## 10. Risks

- **New CM dependency surface**: adds 9 packages + a jsdom-CM interaction. Mitigation - port only the
  lean subset (no schema / find / fold / tokens); assert highlight via the factory output + a rendered
  surface, not pixels (purerequest learnings #49/#137); keep chrome bg transparent (no white-flash).
- **jsdom CM save/lint timing**: purerequest saw CM-save flakiness under full-suite load. Mitigation -
  PP uses an explicit **Save button** gated on a synchronous `parse` result (no Mod+S / debounce / CM
  command), so the save path is a plain button click, not a CM keymap race.
- **Inline-var application timing** (flash of default before override applies): mitigation - apply in a
  `useLayoutEffect`; defaults already render correctly, so the worst case is a momentary default, not a
  broken state.
- **`.dark` block going live** could surface latent dark-mode contrast bugs in existing components
  (the block was dead until now). Mitigation - the dark values are copied verbatim from the shadcn set
  purerequest ships in production; a manual `npm start` dark-mode pass covers the app chrome.

## 11. Decision Log

Append-only.

| Date       | Decision                                                                                          | Rationale                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 2026-07-21 | Domain gate: pz-ddd evaluated/not invoked; pz-archetypes evaluated/not invoked; pz-codebase-design evaluated/invoked (lightly). | Per-install UI config plumbing; no aggregates / consistency boundaries / recurring domain shape. codebase-design shapes the CM-wrapper + pure-module + adapter seams. |
| 2026-07-21 | Scope = mode + 18 app-token colors (NOT mode-only, NOT +editor tokens).                           | User answers: "Mode + custom colors", "No - app tokens only (18)".                                 |
| 2026-07-21 | Color input = CodeMirror JSON editor (add the CM dep stack).                                       | User: "CodeMirror, jak w innych apkach" - matches purerequest's raw-JSON edit convention.          |
| 2026-07-21 | Mode -> `settings.json`; colors -> new `theme.json`; split in the Tauri adapter only.             | User: "Zrób rozdzielenie, jak w purerequest"; mirrors PR's `keymap.json` adapter-only split.       |
| 2026-07-21 | Port a LEAN CM layer, not purerequest's `RawJsonEditor`.                                           | PR's editor is coupled to workspace/tree/active-editor/schema/token machinery PP lacks; PP needs only json + lint + themed chrome. |
| 2026-07-21 | Explicit **Save** button (disabled on invalid JSON), NOT Mod+S / an active-editor registry.       | PP has no active-editor registry; a button sidesteps PR's documented CM-save flakiness and is cleanly testable. |
| 2026-07-21 | `ThemeColors` flattened to `{light: Partial<Record<AppTokenName,string>>, dark: {...}}` (no tokens/editor wrapper). | Editor customization is out of scope, so the `editor` sub-map purerequest carries is dead weight in PP. |
| 2026-07-21 | Editor's own chrome/highlight scheme is built-in (light + dark), not user-customizable.           | The only CM instance is the color editor; theming its own syntax has near-zero payoff (YAGNI).     |
| 2026-07-21 | `DEFAULT_SETTINGS.theme.mode = "system"`.                                                          | Sensible default - respect the OS until the user chooses.                                          |

## 12. Coverage threshold

Detected from `vitest.config.ts`: **none** (no coverage gate configured). The verifier asserts the
full suite passes, not a %.

## 13. Infrastructure Prerequisites

| Category              | Requirement |
| --------------------- | ----------- |
| Environment variables | N/A         |
| Registry images       | N/A         |
| Cloud quotas          | N/A         |
| Network reachability  | N/A         |
| CI status             | N/A         |
| External secrets      | N/A         |
| Database migrations   | N/A (the `theme.json` store auto-creates; the `settings.json` `theme` field is tolerant-merged) |

Verification before implementation: none required - all client-side. The only prerequisite is
`npm install` picking up the new CM dependencies.
