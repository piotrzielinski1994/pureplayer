import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";

import { ThemeSection } from "@/components/settings/theme-section";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsStore,
  type ThemeColors,
} from "@/lib/settings/settings";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";
import { applyDefaults } from "@/lib/theme/overrides";

// Stage 3 - Themes (AC-005/007/008/009). Below the mode selector the ThemeSection
// now renders a CodeMirror JSON color editor seeded with the FULL effective color
// set (every one of the 18 app tokens, both modes, override-or-default value) plus
// a Save button. The buffer is local useState. On Save it persists the SPARSE diff
// (diffOverrides). Malformed JSON DISABLES the Save button (invalid never persists).
// This exercises the whole color flow end-to-end through the real editor UI.

const NEW_PRIMARY = "oklch(0.55 0.22 27)";

// jsdom has no matchMedia; the ThemeProvider subscribes to it, so stub it.
function stubMatchMedia(matches = false) {
  window.matchMedia = ((query: string) => {
    void query;
    return {
      matches,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    };
  }) as unknown as typeof window.matchMedia;
}

function liveView(): EditorView {
  const el = document.querySelector<HTMLElement>(".cm-editor");
  if (!el) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(el);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view;
}

function liveDoc(): string {
  return liveView().state.doc.toString();
}

// Replace the whole document inside act so the CM onChange -> local setState
// (the buffer) flushes BEFORE the test reads the Save button / clicks it.
async function setDoc(text: string) {
  const view = liveView();
  await act(async () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  });
}

function renderSection(overrides: ThemeColors = DEFAULT_SETTINGS.theme.colors) {
  stubMatchMedia(false);
  const seeded: Settings = {
    ...DEFAULT_SETTINGS,
    theme: { mode: "light", colors: overrides },
  };
  const inner = createInMemorySettingsStore(seeded);
  const saveSpy = vi.fn(inner.save);
  const store: SettingsStore = { load: inner.load, save: saveSpy };

  const result = render(
    <SettingsProvider store={store}>
      <ThemeProvider>
        <ThemeSection />
      </ThemeProvider>
    </SettingsProvider>,
  );
  return { ...result, saveSpy };
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /save/i });
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("style");
  // @ts-expect-error - drop the stub between tests.
  delete window.matchMedia;
});

describe("ThemeSection color editor", () => {
  // AC-009 behavior: the editor seeds with the FULL effective color set - every
  // one of the 18 app tokens for BOTH modes, at its override-or-default value.
  it("should seed the editor with the full effective color set for both modes", async () => {
    renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const seeded = JSON.parse(liveDoc()) as ThemeColors;
    const full = applyDefaults(DEFAULT_SETTINGS.theme.colors, DEFAULT_THEME_COLORS);
    expect(seeded).toEqual(full);

    // A couple of concrete default token values are present for BOTH modes.
    expect(seeded.light.background).toBe(DEFAULT_THEME_COLORS.light.background);
    expect(seeded.light.primary).toBe(DEFAULT_THEME_COLORS.light.primary);
    expect(seeded.dark.background).toBe(DEFAULT_THEME_COLORS.dark.background);
    expect(seeded.dark.primary).toBe(DEFAULT_THEME_COLORS.dark.primary);

    // All 18 tokens show up in each mode (full effective set, not sparse).
    expect(Object.keys(seeded.light)).toHaveLength(18);
    expect(Object.keys(seeded.dark)).toHaveLength(18);
  });

  // AC-005/AC-009 side-effect-contract: editing a token to a new valid oklch and
  // clicking Save persists ONLY the diff (the changed token) to theme.colors.
  it("should persist only the sparse diff if a token is edited and saved", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const full = applyDefaults(DEFAULT_SETTINGS.theme.colors, DEFAULT_THEME_COLORS);
    const edited: ThemeColors = {
      ...full,
      light: { ...full.light, primary: NEW_PRIMARY },
    };
    await setDoc(JSON.stringify(edited, null, 2));

    await user.click(saveButton());

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0].theme.colors;
    // ONLY the primary override survives; every default-valued token drops out.
    expect(persisted.light.primary).toBe(NEW_PRIMARY);
    expect(persisted.light.background).toBeUndefined();
    expect(persisted.dark).toEqual({});
  });

  // AC-008 side-effect-contract: editing a token BACK to its built-in default and
  // saving drops it from the stored diff (per-token reset).
  it("should drop an override edited back to its default on save", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection({
      light: { primary: NEW_PRIMARY },
      dark: {},
    });

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const full = applyDefaults({ light: { primary: NEW_PRIMARY }, dark: {} }, DEFAULT_THEME_COLORS);
    const resetToDefault: ThemeColors = {
      ...full,
      light: { ...full.light, primary: DEFAULT_THEME_COLORS.light.primary },
    };
    await setDoc(JSON.stringify(resetToDefault, null, 2));

    await user.click(saveButton());

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0].theme.colors;
    expect(persisted.light.primary).toBeUndefined();
  });

  // AC-009 side-effect-contract: malformed JSON disables the Save button (invalid
  // JSON never persists).
  it("should disable the Save button if the JSON is malformed", async () => {
    renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });
    // Valid seed => Save starts enabled.
    expect(saveButton()).toBeEnabled();

    await setDoc("{ not json");

    await waitFor(() => {
      expect(saveButton()).toBeDisabled();
    });
  });

  // AC-009 side-effect-contract: a structurally-wrong shape (missing the {light,
  // dark} sections) also disables the Save button.
  it("should disable the Save button if the JSON is the wrong shape", async () => {
    renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    await setDoc(JSON.stringify({ light: {} }));

    await waitFor(() => {
      expect(saveButton()).toBeDisabled();
    });
  });

  // AC-009 / AC-010 side-effect-contract: well-formed JSON whose token value is
  // NOT a string (e.g. the quotes deleted -> a number) must disable Save so the
  // Save handler never runs diffOverrides on a non-string (which would throw).
  it("should disable the Save button if a token value is not a string", async () => {
    renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });
    expect(saveButton()).toBeEnabled();

    await setDoc(JSON.stringify({ light: { primary: 42 }, dark: {} }));

    await waitFor(() => {
      expect(saveButton()).toBeDisabled();
    });
  });

  // AC-009 behavior: valid {light,dark} JSON keeps the Save button enabled.
  it("should enable the Save button if the JSON is valid", async () => {
    renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    await setDoc("{ not json");
    await waitFor(() => {
      expect(saveButton()).toBeDisabled();
    });

    const full = applyDefaults(DEFAULT_SETTINGS.theme.colors, DEFAULT_THEME_COLORS);
    await setDoc(JSON.stringify(full, null, 2));

    await waitFor(() => {
      expect(saveButton()).toBeEnabled();
    });
  });
});
