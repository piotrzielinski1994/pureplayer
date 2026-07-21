import { formatForDisplay } from "@tanstack/hotkeys";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import {
  SHORTCUT_ACTIONS,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";

// jsdom reports a non-mac platform, so the recorder resolves `Mod` to `Control`
// (see docs/learnings.md). Recording Control+Y therefore canonicalizes to the
// "Mod+Y" override; recording Control+B reproduces the "Mod+B" binding.

function renderSection(overrides: ShortcutOverrides = {}) {
  const seeded: Settings = { ...DEFAULT_SETTINGS, shortcuts: overrides };
  const inner = createInMemorySettingsStore(seeded);
  const saveSpy = vi.fn(inner.save);
  const store: SettingsStore = { load: inner.load, save: saveSpy };

  const result = render(
    <HotkeysProvider>
      <SettingsProvider store={store}>
        <ShortcutsSection />
      </SettingsProvider>
    </HotkeysProvider>,
  );

  return { ...result, saveSpy };
}

const TOGGLE_PLAY = SHORTCUT_ACTIONS.find((a) => a.id === "toggle-play")!;
const TOGGLE_SIDEBAR = SHORTCUT_ACTIONS.find((a) => a.id === "toggle-sidebar")!;
const TOGGLE_TRANSPORT = SHORTCUT_ACTIONS.find(
  (a) => a.id === "toggle-transport",
)!;

describe("ShortcutsSection", () => {
  // behavior: a row renders for every registered action (TC-006, AC-007)
  it("should render a row for every registered action", async () => {
    renderSection();

    for (const action of SHORTCUT_ACTIONS) {
      expect(await screen.findByText(action.name)).toBeInTheDocument();
    }
  });

  // behavior: the new open/close-settings + palette actions are listed (TC-006, AC-007)
  it("should list rows for open-settings, close-settings and open-command-palette", async () => {
    renderSection();

    for (const id of [
      "open-settings",
      "close-settings",
      "open-command-palette",
    ]) {
      const action = SHORTCUT_ACTIONS.find((a) => a.id === id);
      expect(action).toBeDefined();
      expect(await screen.findByText(action!.name)).toBeInTheDocument();
    }
  });

  // behavior: each action's current default binding is shown formatted (AC-006)
  it("should show an action's default binding formatted for display", async () => {
    renderSection();

    const defaultLabel = formatForDisplay(TOGGLE_PLAY.defaultHotkey);
    expect(await screen.findByText(defaultLabel)).toBeInTheDocument();
  });

  // behavior: a seeded override is shown as the binding label (TC-002, AC-006)
  it("should show the override binding label if an override is set", async () => {
    renderSection({ "toggle-play": "Mod+P" });

    const overrideLabel = formatForDisplay("Mod+P");
    expect(await screen.findByText(overrideLabel)).toBeInTheDocument();
  });

  // side-effect-contract: recording a free combo persists the normalized override (TC-001, AC-003)
  it("should persist the override if a new free combo is recorded for an action", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection();

    const editButton = await screen.findByRole("button", {
      name: new RegExp(`edit.*${TOGGLE_PLAY.name}`, "i"),
    });
    await user.click(editButton);

    // Control+Y -> "Mod+Y", which is free in the pureplayer registry.
    await user.keyboard("{Control>}y{/Control}");

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(persisted.shortcuts["toggle-play"]).toBe("Mod+Y");
  });

  // behavior: recording a combo owned by another action is rejected, owner named (TC-003, AC-005)
  it("should name the owning action and not persist if a used combo is recorded", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection();

    const editButton = await screen.findByRole("button", {
      name: new RegExp(`edit.*${TOGGLE_TRANSPORT.name}`, "i"),
    });
    await user.click(editButton);

    // toggle-sidebar owns Mod+B by default; recording it for toggle-transport conflicts.
    await user.keyboard("{Control>}b{/Control}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(new RegExp(TOGGLE_SIDEBAR.name, "i"));
    expect(saveSpy).not.toHaveBeenCalled();
  });

  // behavior: re-recording an action's own current binding is allowed (TC-004, AC-005)
  it("should allow recording an action's own current binding", async () => {
    const user = userEvent.setup();
    renderSection();

    const editButton = await screen.findByRole("button", {
      name: new RegExp(`edit.*${TOGGLE_SIDEBAR.name}`, "i"),
    });
    await user.click(editButton);

    // toggle-sidebar's own binding is Mod+B; recording it must not raise a conflict.
    await user.keyboard("{Control>}b{/Control}");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // behavior: Escape while recording cancels - nothing persisted, no override (E-7, AC-003)
  it("should not persist a binding if Escape is pressed while recording", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection();

    const editButton = await screen.findByRole("button", {
      name: new RegExp(`edit.*${TOGGLE_PLAY.name}`, "i"),
    });
    await user.click(editButton);

    // Escape is never assignable - the recorder treats it as cancel.
    await user.keyboard("{Escape}");

    expect(saveSpy).not.toHaveBeenCalled();
    // the row keeps its default binding (no override was written)
    expect(
      screen.getByText(formatForDisplay(TOGGLE_PLAY.defaultHotkey)),
    ).toBeInTheDocument();
  });

  // side-effect-contract: Reset removes the override and the row reverts to default (TC-005, AC-006)
  it("should remove the override and restore the default label if reset is clicked", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection({ "toggle-play": "Mod+P" });

    const resetButton = await screen.findByRole("button", {
      name: new RegExp(`reset.*${TOGGLE_PLAY.name}`, "i"),
    });
    await user.click(resetButton);

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(persisted.shortcuts).not.toHaveProperty("toggle-play");

    expect(
      await screen.findByText(formatForDisplay(TOGGLE_PLAY.defaultHotkey)),
    ).toBeInTheDocument();
  });
});
