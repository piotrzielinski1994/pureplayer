import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type ThemeMode } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { ThemeProvider, useTheme } from "@/lib/theme/theme-context";

// Stage 1 - Themes. The ThemeProvider mounts INSIDE a SettingsProvider, reads
// settings.theme.mode, and as a side effect toggles the `dark` class on
// document.documentElement for the effective mode. Under "system" it follows a
// stubbed matchMedia and reacts live to a dispatched `change` event (AC-003).

// jsdom has no matchMedia - install a controllable stub per test.
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

  return {
    setPrefersDark(matches: boolean) {
      mql.matches = matches;
      for (const listener of listeners) {
        listener({ matches });
      }
    },
  };
}

function ThemeProbe() {
  const { mode, effectiveMode } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="effective-mode">{effectiveMode}</span>
    </div>
  );
}

function renderWithMode(mode: ThemeMode) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    theme: { ...DEFAULT_SETTINGS.theme, mode },
  });

  return render(
    <SettingsProvider store={store}>
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    </SettingsProvider>,
  );
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  // @ts-expect-error - clean the stub so a later test re-stubs from scratch.
  delete window.matchMedia;
});

describe("ThemeProvider", () => {
  // side-effect-contract: mode light leaves no dark class, even removing a stale one (AC-001)
  it("should NOT put the dark class on the html element if mode is light", async () => {
    stubMatchMedia(true); // OS prefers dark, but explicit light must win.
    document.documentElement.classList.add("dark"); // start dirty to prove removal

    renderWithMode("light");

    expect(await screen.findByTestId("effective-mode")).toHaveTextContent(
      "light",
    );
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  // side-effect-contract: mode dark adds the dark class regardless of OS (AC-002)
  it("should put the dark class on the html element if mode is dark", async () => {
    stubMatchMedia(false); // OS prefers light, but explicit dark must win.

    renderWithMode("dark");

    expect(await screen.findByTestId("effective-mode")).toHaveTextContent(
      "dark",
    );
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });

  // side-effect-contract: system + OS-prefers-dark applies dark (AC-003)
  it("should put the dark class if mode is system and the OS prefers dark", async () => {
    stubMatchMedia(true);

    renderWithMode("system");

    expect(await screen.findByTestId("effective-mode")).toHaveTextContent(
      "dark",
    );
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });

  // side-effect-contract: system + OS-prefers-light applies light (AC-003)
  it("should NOT put the dark class if mode is system and the OS prefers light", async () => {
    stubMatchMedia(false);

    renderWithMode("system");

    expect(await screen.findByTestId("effective-mode")).toHaveTextContent(
      "light",
    );
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  // side-effect-contract: system flips the dark class live on an OS change, no remount (AC-003)
  it("should flip the dark class live if the OS preference changes while system", async () => {
    const media = stubMatchMedia(false);

    renderWithMode("system");

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    act(() => {
      media.setPrefersDark(true);
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    act(() => {
      media.setPrefersDark(false);
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  // side-effect-contract: no matchMedia (jsdom) falls back to light without throwing (AC-003)
  it("should fall back to light under system if matchMedia is absent", async () => {
    // Deliberately do NOT stub matchMedia for this case.
    renderWithMode("system");

    expect(await screen.findByTestId("effective-mode")).toHaveTextContent(
      "light",
    );
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  // behavior: useTheme exposes the chosen mode plus the resolved effective mode (AC-003, AC-011)
  it("should expose the chosen mode and the resolved effective mode via useTheme", async () => {
    stubMatchMedia(true);

    renderWithMode("system");

    expect(await screen.findByTestId("mode")).toHaveTextContent("system");
    expect(screen.getByTestId("effective-mode")).toHaveTextContent("dark");
  });
});
