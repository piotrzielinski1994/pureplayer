import { language } from "@codemirror/language";
import { diagnosticCount, forceLinting } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

// Stage 3 - Themes. editor-theme.ts ships the BUILT-IN light + dark editor
// scheme (fixed hues, NOT user-customizable) plus the JSON language + an
// empty-tolerant linter. makeChrome(isDark) / makeHighlight(isDark) /
// jsonEditorExtensions(isDark) / emptyTolerantJsonLinter() do not exist yet, so
// the import fails RED.
import {
  emptyTolerantJsonLinter,
  jsonEditorExtensions,
  makeChrome,
  makeHighlight,
} from "@/lib/theme/editor-theme";

// CodeMirror themes/highlights are global StyleModule rules injected into <style>
// tags, deduped across the whole run. To read a factory's CSS in isolation we
// mount each editor inside its OWN shadow root and read only that root's <style>
// tags - so a color's PRESENCE/ABSENCE is a reliable per-factory signal.
function shadowCss(
  extension: unknown,
  doc = '"x"',
): { css: string; view: EditorView } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const parent = document.createElement("div");
  shadow.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [extension as never] }),
    parent,
    root: shadow,
  });
  const css = Array.from(shadow.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
  return { css, view };
}

describe("makeHighlight", () => {
  // behavior: the built-in dark scheme differs from the built-in light scheme -
  // the string-tag color (at least) is not the same between the two modes.
  it("should produce a different highlight scheme for dark vs light", () => {
    const dark = shadowCss(makeHighlight(true));
    const light = shadowCss(makeHighlight(false));
    const darkCss = dark.css;
    const lightCss = light.css;
    dark.view.destroy();
    light.view.destroy();

    // Both must actually inject highlight rules...
    expect(darkCss.length).toBeGreaterThan(0);
    expect(lightCss.length).toBeGreaterThan(0);
    // ...and the two schemes must not be byte-identical (different hues).
    expect(darkCss).not.toEqual(lightCss);
  });

  // side-effect-contract: the two modes yield DISTINCT extensions, so a mode flip
  // reconfigures the editor rather than reusing a shared instance.
  it("should produce distinct extensions for dark vs light", () => {
    expect(makeHighlight(true)).not.toBe(makeHighlight(false));
  });
});

describe("makeChrome", () => {
  // side-effect-contract: makeChrome(isDark) carries { dark: isDark } in its
  // EditorView.theme spec - readable via the darkTheme facet.
  it("should carry { dark: true } in the dark chrome theme spec", () => {
    const state = EditorState.create({ extensions: [makeChrome(true)] });
    expect(state.facet(EditorView.darkTheme)).toBe(true);
  });

  it("should carry { dark: false } in the light chrome theme spec", () => {
    const state = EditorState.create({ extensions: [makeChrome(false)] });
    expect(state.facet(EditorView.darkTheme)).toBe(false);
  });

  // side-effect-contract: the editor wrapper background stays transparent in BOTH
  // modes so the editor inherits the themed pane (no white-flash). We match a
  // `background-color: transparent` on a rule NOT under a `.cm-*` selector (the
  // `&` wrapper rule), mirroring purerequest's editor-theme test.
  it("should keep the wrapper background transparent in dark mode", () => {
    const { css, view } = shadowCss(makeChrome(true), "x");
    const transparent = css
      .split("}")
      .filter((rule) => !/\.cm-/.test(rule))
      .some((rule) => /\{[^{]*background-color:\s*transparent/i.test(rule));
    view.destroy();
    expect(transparent).toBe(true);
  });

  it("should keep the wrapper background transparent in light mode", () => {
    const { css, view } = shadowCss(makeChrome(false), "x");
    const transparent = css
      .split("}")
      .filter((rule) => !/\.cm-/.test(rule))
      .some((rule) => /\{[^{]*background-color:\s*transparent/i.test(rule));
    view.destroy();
    expect(transparent).toBe(true);
  });
});

describe("jsonEditorExtensions", () => {
  // behavior: composes a non-empty Extension[] wiring the JSON language.
  it("should return a non-empty extension set that wires the json language", () => {
    const exts = jsonEditorExtensions(true);
    expect(Array.isArray(exts)).toBe(true);
    expect(exts.length).toBeGreaterThan(0);

    const state = EditorState.create({ extensions: exts as never });
    const lang = state.facet(language);
    expect(lang?.name).toBe("json");
  });

  // behavior: the composed set includes the linter - malformed JSON produces a
  // diagnostic once linting is forced.
  it("should lint malformed JSON when composed via jsonEditorExtensions", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "{ not json",
        extensions: jsonEditorExtensions(false) as never,
      }),
      parent,
    });
    forceLinting(view);
    await Promise.resolve();
    const count = diagnosticCount(view.state);
    view.destroy();

    expect(count).toBeGreaterThan(0);
  });
});

describe("emptyTolerantJsonLinter", () => {
  // behavior: an empty document yields no diagnostics (empty is a valid state).
  it("should report no diagnostics for an empty document", () => {
    const lint = emptyTolerantJsonLinter();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "" }),
      parent,
    });

    expect(lint(view)).toEqual([]);

    view.destroy();
  });

  // behavior: a non-empty malformed document still produces diagnostics.
  it("should report diagnostics for malformed non-empty JSON", () => {
    const lint = emptyTolerantJsonLinter();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "{" }),
      parent,
    });

    expect(lint(view).length).toBeGreaterThan(0);

    view.destroy();
  });
});
