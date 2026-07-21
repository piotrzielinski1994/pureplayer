import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsStore,
  type ThemeMode,
} from "@/lib/settings/settings";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { ThemeSection } from "@/components/settings/theme-section";

// Stage 1 - Themes. The Theme section is a mode selector (Light / Dark /
// System). Clicking a mode persists it (saveThemeMode) and the active mode's
// button reads aria-pressed="true". Only the mode selector is exercised here;
// the CodeMirror color editor lands in a later stage.

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

function renderSection(mode: ThemeMode = "system") {
  stubMatchMedia(false);
  const seeded: Settings = {
    ...DEFAULT_SETTINGS,
    theme: { ...DEFAULT_SETTINGS.theme, mode },
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

afterEach(() => {
  document.documentElement.classList.remove("dark");
  // @ts-expect-error - drop the stub between tests.
  delete window.matchMedia;
});

describe("ThemeSection", () => {
  // behavior: renders one button per mode (AC-001, AC-002, AC-003)
  it("should render a Light, Dark, and System button", async () => {
    renderSection();

    expect(
      await screen.findByRole("button", { name: /light/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /system/i })).toBeInTheDocument();
  });

  // side-effect-contract: clicking Dark persists theme.mode = "dark" (AC-002, AC-004)
  it("should persist theme.mode dark if Dark is clicked", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection("system");

    const dark = await screen.findByRole("button", { name: /dark/i });
    await user.click(dark);

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(persisted.theme.mode).toBe("dark");
  });

  // side-effect-contract: clicking Light persists theme.mode = "light" (AC-001, AC-004)
  it("should persist theme.mode light if Light is clicked", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection("dark");

    const light = await screen.findByRole("button", { name: /light/i });
    await user.click(light);

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(persisted.theme.mode).toBe("light");
  });

  // behavior: the active mode's button is aria-pressed, the others are not (AC-004)
  it("should mark only the active mode button as aria-pressed", async () => {
    renderSection("dark");

    const dark = await screen.findByRole("button", { name: /dark/i });
    await waitFor(() => {
      expect(dark).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.getByRole("button", { name: /light/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /system/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  // side-effect-contract: clicking Dark applies the dark class live to <html> (AC-002)
  it("should apply the dark class live to the html element if Dark is clicked", async () => {
    const user = userEvent.setup();
    renderSection("light");

    const dark = await screen.findByRole("button", { name: /dark/i });
    await user.click(dark);

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });
});
