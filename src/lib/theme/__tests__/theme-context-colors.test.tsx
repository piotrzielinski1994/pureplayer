import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsStore,
  type ThemeColors,
  type ThemeMode,
} from "@/lib/settings/settings";
import { ThemeProvider, useTheme } from "@/lib/theme/theme-context";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";

// Stage 2 - Themes feature. useTheme() is EXTENDED to also return:
//  - colors: ThemeColors          (the sparse overrides from settings)
//  - effectiveColors: ThemeColors (= applyDefaults(colors, DEFAULT_THEME_COLORS))
//  - setColors(colors)            (persists via saveThemeColors)
// As a side effect it applies the active effective mode's app-token vars to
// document.documentElement via applyThemeVars (set on override, cleared otherwise),
// re-applied on a mode flip. PP model is FLATTENED: colors.light is a flat map.

// jsdom has no matchMedia - controllable stub (copied from the Stage 1 test).
type MediaListener = (event: { matches: boolean }) => void;

function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<MediaListener>();
  const mql = {
    matches: initialMatches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: MediaListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: MediaListener) => {
      listeners.delete(listener);
    },
    addListener: (listener: MediaListener) => listeners.add(listener),
    removeListener: (listener: MediaListener) => listeners.delete(listener),
    dispatchEvent: () => true,
  };
  window.matchMedia = ((query: string) => {
    void query;
    return mql;
  }) as unknown as typeof window.matchMedia;
}

const LIGHT_PRIMARY = "oklch(0.55 0.22 27)";

const lightPrimaryOverride: ThemeColors = {
  light: { primary: LIGHT_PRIMARY },
  dark: {},
};

function ColorProbe() {
  const { colors, effectiveColors, setColors } = useTheme();
  return (
    <div>
      <span data-testid="override-primary">{colors.light.primary ?? ""}</span>
      <span data-testid="effective-primary">
        {effectiveColors.light.primary ?? ""}
      </span>
      <span data-testid="effective-bg">
        {effectiveColors.light.background ?? ""}
      </span>
      <button
        type="button"
        onClick={() =>
          setColors({ light: { background: "oklch(0.99 0 0)" }, dark: {} })
        }
      >
        set colors
      </button>
    </div>
  );
}

function renderWithColors(mode: ThemeMode, colors: ThemeColors) {
  stubMatchMedia(false);
  const seeded: Settings = { ...DEFAULT_SETTINGS, theme: { mode, colors } };
  const inner = createInMemorySettingsStore(seeded);
  const saveSpy = vi.fn(inner.save);
  const store: SettingsStore = { load: inner.load, save: saveSpy };

  const result = render(
    <SettingsProvider store={store}>
      <ThemeProvider>
        <ColorProbe />
      </ThemeProvider>
    </SettingsProvider>,
  );
  return { ...result, saveSpy };
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("style");
  // @ts-expect-error - clean the stub between tests.
  delete window.matchMedia;
});

describe("ThemeProvider colors", () => {
  // AC-005 - behavior: the sparse override is exposed verbatim via useTheme.
  it("should expose the sparse override via useTheme().colors", async () => {
    renderWithColors("light", lightPrimaryOverride);

    expect(await screen.findByTestId("override-primary")).toHaveTextContent(
      LIGHT_PRIMARY,
    );
  });

  // AC-007 - behavior: effectiveColors merges overrides over the built-in defaults.
  it("should expose effectiveColors as the override layered over the defaults", async () => {
    renderWithColors("light", lightPrimaryOverride);

    expect(await screen.findByTestId("effective-primary")).toHaveTextContent(
      LIGHT_PRIMARY,
    );
  });

  // AC-007 - behavior: an un-overridden effective token stays at its built-in default.
  it("should keep an un-overridden effective token at its built-in default", async () => {
    renderWithColors("light", lightPrimaryOverride);

    expect(await screen.findByTestId("effective-bg")).toHaveTextContent(
      DEFAULT_THEME_COLORS.light.background,
    );
  });

  // AC-005 - side-effect-contract: a light primary override sets --primary on the
  // <html> element when the effective mode is light.
  it("should set --primary on document.documentElement if light primary is overridden and mode is light", async () => {
    renderWithColors("light", lightPrimaryOverride);

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue("--primary").trim(),
      ).toBe(LIGHT_PRIMARY);
    });
  });

  // AC-007 / spec §6 - side-effect-contract: a light-only override leaves the var
  // CLEARED while the effective mode is dark (dark has no override).
  it("should NOT set --primary if the effective mode is dark and only light is overridden", async () => {
    renderWithColors("dark", lightPrimaryOverride);

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(
      document.documentElement.style.getPropertyValue("--primary").trim(),
    ).toBe("");
  });

  // AC-005 - side-effect-contract: overriding a dark token applies it while the
  // effective mode is dark (per-mode DOM application).
  it("should apply the dark override set when the effective mode is dark", async () => {
    renderWithColors("dark", {
      light: {},
      dark: { primary: "oklch(0.3 0.1 200)" },
    });

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue("--primary").trim(),
      ).toBe("oklch(0.3 0.1 200)");
    });
  });

  // AC-005, AC-006 - side-effect-contract: setColors persists through
  // saveThemeColors (asserted via the save spy's payload).
  it("should persist the colors via the store if setColors is called", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderWithColors("light", { light: {}, dark: {} });

    await screen.findByTestId("override-primary");
    await user.click(screen.getByRole("button", { name: /set colors/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(persisted.theme.colors.light.background).toBe("oklch(0.99 0 0)");
  });

  // AC-005 - side-effect-contract: persisting an override then re-rendering applies
  // the new inline var (the colors flow back from settings to the DOM).
  it("should apply a setColors override to the DOM through useTheme", async () => {
    const user = userEvent.setup();
    renderWithColors("light", { light: {}, dark: {} });

    await screen.findByTestId("override-primary");
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /set colors/i }));
    });

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue("--background").trim(),
      ).toBe("oklch(0.99 0 0)");
    });
  });
});
