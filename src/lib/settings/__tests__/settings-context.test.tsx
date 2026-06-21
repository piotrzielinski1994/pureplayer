import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SettingsProvider, useSettings } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";

// Probe that surfaces settings state + exercises the granular savers as
// observable DOM, mirroring the requi render-under-provider convention.
function Probe() {
  const {
    settings,
    saveShortcut,
    resetShortcut,
    saveVolume,
    saveMuted,
    saveSidebarHidden,
    saveLayout,
    saveRevealTransportOnHover,
  } = useSettings();

  return (
    <div>
      <span data-testid="loaded">loaded</span>
      <span data-testid="toggle-play-binding">
        {settings.shortcuts["toggle-play"] ?? "none"}
      </span>
      <span data-testid="volume">{String(settings.volume)}</span>
      <span data-testid="muted">{String(settings.isMuted)}</span>
      <span data-testid="sidebar-hidden">
        {String(settings.sidebarHidden)}
      </span>
      <button type="button" onClick={() => saveShortcut("toggle-play", "Mod+P")}>
        save shortcut
      </button>
      <button type="button" onClick={() => resetShortcut("toggle-play")}>
        reset shortcut
      </button>
      <button type="button" onClick={() => saveVolume(0.5)}>
        save volume
      </button>
      <button type="button" onClick={() => saveMuted(true)}>
        save muted
      </button>
      <button type="button" onClick={() => saveSidebarHidden(true)}>
        save sidebar hidden
      </button>
      <button
        type="button"
        onClick={() => saveLayout({ sidebar: 30, content: 70 })}
      >
        save layout
      </button>
      <button
        type="button"
        onClick={() => saveRevealTransportOnHover(false)}
      >
        save reveal
      </button>
    </div>
  );
}

function spiedStore(initial?: Settings) {
  const inner = createInMemorySettingsStore(initial ?? DEFAULT_SETTINGS);
  const saveSpy = vi.fn(inner.save);
  const store: SettingsStore = { load: inner.load, save: saveSpy };
  return { store, saveSpy };
}

describe("SettingsProvider", () => {
  // behavior: provider renders nothing until the async store load resolves (UI state: Settings loading)
  it("should render null until the store load resolves, then render children", async () => {
    const { store } = spiedStore();

    render(
      <SettingsProvider store={store}>
        <Probe />
      </SettingsProvider>,
    );

    // First paint is before the load resolves, so children are absent.
    expect(screen.queryByTestId("loaded")).not.toBeInTheDocument();

    expect(await screen.findByTestId("loaded")).toBeInTheDocument();
  });

  // behavior: seeded shortcut override is exposed after load (AC-001, TC-002)
  it("should expose a seeded shortcut override to children", async () => {
    const seeded: Settings = {
      ...DEFAULT_SETTINGS,
      shortcuts: { "toggle-play": "Mod+P" },
    };
    const { store } = spiedStore(seeded);

    render(
      <SettingsProvider store={store}>
        <Probe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("toggle-play-binding")).toHaveTextContent(
      "Mod+P",
    );
  });
});

describe("SettingsProvider shortcut savers", () => {
  // side-effect-contract: saveShortcut persists the override via store.save (TC-001, AC-003)
  it("should persist the override via store.save if saveShortcut is called", async () => {
    const user = userEvent.setup();
    const { store, saveSpy } = spiedStore();

    render(
      <SettingsProvider store={store}>
        <Probe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-play-binding");
    await user.click(screen.getByRole("button", { name: /save shortcut/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(persisted.shortcuts["toggle-play"]).toBe("Mod+P");
  });

  // behavior: saveShortcut reflects the new override in exposed state (TC-001, AC-003)
  it("should set settings.shortcuts[id] if saveShortcut is called", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();

    render(
      <SettingsProvider store={store}>
        <Probe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-play-binding");
    expect(screen.getByTestId("toggle-play-binding")).toHaveTextContent("none");

    await user.click(screen.getByRole("button", { name: /save shortcut/i }));

    await waitFor(() => {
      expect(screen.getByTestId("toggle-play-binding")).toHaveTextContent(
        "Mod+P",
      );
    });
  });

  // side-effect-contract: resetShortcut removes the override and persists the removal (TC-005)
  it("should remove the override and persist it if resetShortcut is called", async () => {
    const user = userEvent.setup();
    const seeded: Settings = {
      ...DEFAULT_SETTINGS,
      shortcuts: { "toggle-play": "Mod+P" },
    };
    const { store, saveSpy } = spiedStore(seeded);

    render(
      <SettingsProvider store={store}>
        <Probe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("toggle-play-binding")).toHaveTextContent(
      "Mod+P",
    );

    await user.click(screen.getByRole("button", { name: /reset shortcut/i }));

    await waitFor(() => {
      expect(screen.getByTestId("toggle-play-binding")).toHaveTextContent(
        "none",
      );
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(persisted.shortcuts).not.toHaveProperty("toggle-play");
  });
});

describe("SettingsProvider playback + UI savers", () => {
  // side-effect-contract: saveVolume calls store.save with the new volume (TC-009, AC-008)
  it("should persist via store.save if saveVolume is called", async () => {
    const user = userEvent.setup();
    const { store, saveSpy } = spiedStore();

    render(
      <SettingsProvider store={store}>
        <Probe />
      </SettingsProvider>,
    );

    await screen.findByTestId("volume");
    await user.click(screen.getByRole("button", { name: /save volume/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    expect(saveSpy.mock.calls.at(-1)![0].volume).toBe(0.5);
  });

  // side-effect-contract: saveMuted calls store.save with the new mute flag (TC-009, AC-008)
  it("should persist via store.save if saveMuted is called", async () => {
    const user = userEvent.setup();
    const { store, saveSpy } = spiedStore();

    render(
      <SettingsProvider store={store}>
        <Probe />
      </SettingsProvider>,
    );

    await screen.findByTestId("muted");
    await user.click(screen.getByRole("button", { name: /save muted/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    expect(saveSpy.mock.calls.at(-1)![0].isMuted).toBe(true);
  });

  // side-effect-contract: saveLayout calls store.save with the new panel layout (AC-013)
  it("should persist via store.save if saveLayout is called", async () => {
    const user = userEvent.setup();
    const { store, saveSpy } = spiedStore();

    render(
      <SettingsProvider store={store}>
        <Probe />
      </SettingsProvider>,
    );

    await screen.findByTestId("loaded");
    await user.click(screen.getByRole("button", { name: /save layout/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    expect(saveSpy.mock.calls.at(-1)![0].layout).toEqual({
      sidebar: 30,
      content: 70,
    });
  });

  // side-effect-contract: saveRevealTransportOnHover persists the new flag (AC-014)
  it("should persist via store.save if saveRevealTransportOnHover is called", async () => {
    const user = userEvent.setup();
    const { store, saveSpy } = spiedStore();

    render(
      <SettingsProvider store={store}>
        <Probe />
      </SettingsProvider>,
    );

    await screen.findByTestId("loaded");
    await user.click(screen.getByRole("button", { name: /save reveal/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    expect(saveSpy.mock.calls.at(-1)![0].revealTransportOnHover).toBe(false);
  });

  // side-effect-contract: saveSidebarHidden calls store.save with the new flag (TC-011, AC-009)
  it("should persist via store.save if saveSidebarHidden is called", async () => {
    const user = userEvent.setup();
    const { store, saveSpy } = spiedStore();

    render(
      <SettingsProvider store={store}>
        <Probe />
      </SettingsProvider>,
    );

    await screen.findByTestId("sidebar-hidden");
    await user.click(
      screen.getByRole("button", { name: /save sidebar hidden/i }),
    );

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    expect(saveSpy.mock.calls.at(-1)![0].sidebarHidden).toBe(true);
  });
});
