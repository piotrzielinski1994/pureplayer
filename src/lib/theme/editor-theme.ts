import { json, jsonParseLinter } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

type EditorScheme = {
  caret: string;
  selection: string;
  gutter: string;
  keyword: string;
  string: string;
  number: string;
  property: string;
  comment: string;
  invalid: string;
};

// Built-in editor schemes, fixed (NOT user-customizable). Dark = the JetBrains
// Darcula-derived hues; light = a readable light palette. The color editor is the
// only CodeMirror surface, so these follow the active mode but are not themable.
const DARK_SCHEME: EditorScheme = {
  caret: "oklch(0.78 0 0)",
  selection: "oklch(0.4 0.08 260)",
  gutter: "oklch(0.46 0 0)",
  keyword: "oklch(0.68 0.13 55)",
  string: "oklch(0.66 0.09 135)",
  number: "oklch(0.66 0.1 245)",
  property: "oklch(0.62 0.12 305)",
  comment: "oklch(0.6 0 0)",
  invalid: "oklch(0.55 0.18 25)",
};

const LIGHT_SCHEME: EditorScheme = {
  caret: "oklch(0.205 0 0)",
  selection: "oklch(0.85 0.05 250)",
  gutter: "oklch(0.6 0 0)",
  keyword: "oklch(0.5 0.18 30)",
  string: "oklch(0.5 0.13 145)",
  number: "oklch(0.5 0.15 250)",
  property: "oklch(0.45 0.18 300)",
  comment: "oklch(0.6 0 0)",
  invalid: "oklch(0.55 0.22 25)",
};

function scheme(isDark: boolean): EditorScheme {
  return isDark ? DARK_SCHEME : LIGHT_SCHEME;
}

// Chrome (caret/selection/gutter) for one mode. The background stays transparent
// so the editor inherits the themed pane behind it (avoids the white-flash the
// default light theme injects).
export function makeChrome(isDark: boolean): Extension {
  const colors = scheme(isDark);
  return EditorView.theme(
    {
      "&": { backgroundColor: "transparent", height: "100%" },
      ".cm-content": { caretColor: colors.caret },
      "&.cm-focused": { outline: "none" },
      "&.cm-focused .cm-cursor": { borderLeftColor: colors.caret },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: colors.selection },
      ".cm-activeLine": { backgroundColor: "transparent" },
      ".cm-activeLineGutter": { backgroundColor: "transparent" },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: colors.gutter,
        border: "none",
      },
      ".cm-scroller": {
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
      },
    },
    { dark: isDark },
  );
}

export function makeHighlight(isDark: boolean): Extension {
  const colors = scheme(isDark);
  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: [t.keyword, t.bool, t.null], color: colors.keyword },
      { tag: [t.string, t.special(t.string)], color: colors.string },
      { tag: [t.number], color: colors.number },
      {
        tag: [t.propertyName, t.definition(t.propertyName)],
        color: colors.property,
      },
      { tag: [t.comment], color: colors.comment, fontStyle: "italic" },
      { tag: [t.invalid], color: colors.invalid },
    ]),
  );
}

// jsonParseLinter flags an empty document as "Unexpected EOF". An empty color set
// is not a state the editor should nag about, so suppress diagnostics until
// something is typed.
export function emptyTolerantJsonLinter(): (view: EditorView) => Diagnostic[] {
  const lint = jsonParseLinter();
  return (view) => (view.state.doc.toString().trim() === "" ? [] : lint(view));
}

export function jsonEditorExtensions(isDark: boolean): Extension[] {
  return [
    json(),
    linter(emptyTolerantJsonLinter()),
    makeChrome(isDark),
    makeHighlight(isDark),
  ];
}
