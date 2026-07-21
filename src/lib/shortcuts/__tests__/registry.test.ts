import { describe, expect, it } from "vitest";

import { SHORTCUT_ACTIONS } from "@/lib/shortcuts/registry";

describe("shortcut registry", () => {
  // behavior: registry is the single source of truth; the palette opener is part of it (AC-003)
  it("should include an 'open-command-palette' action bound to Mod+K if read", () => {
    const opener = SHORTCUT_ACTIONS.find(
      (action) => action.id === "open-command-palette",
    );

    expect(opener).toBeDefined();
    expect(opener?.defaultHotkey).toBe("Mod+K");
  });

  // behavior: the new open-files action is registered and bound to Mod+O (AC-001)
  it("should include an 'open-files' action bound to Mod+O if read", () => {
    const openFiles = SHORTCUT_ACTIONS.find(
      (action) => action.id === "open-files",
    );

    expect(openFiles).toBeDefined();
    expect(openFiles?.defaultHotkey).toBe("Mod+O");
    expect(openFiles?.name.trim().length).toBeGreaterThan(0);
  });

  // behavior: visibility toggles are registered with requi-matching bindings (AC-003)
  it("should bind 'toggle-sidebar' to Mod+B and 'toggle-transport' to Mod+J if read", () => {
    const sidebar = SHORTCUT_ACTIONS.find(
      (action) => action.id === "toggle-sidebar",
    );
    const transport = SHORTCUT_ACTIONS.find(
      (action) => action.id === "toggle-transport",
    );

    expect(sidebar?.defaultHotkey).toBe("Mod+B");
    expect(transport?.defaultHotkey).toBe("Mod+J");
  });

  // behavior: settings navigation actions are registered (FR-7 AC-010)
  it("should include 'open-settings' bound to Mod+, and 'close-settings' bound to Escape if read", () => {
    const openSettings = SHORTCUT_ACTIONS.find(
      (action) => action.id === "open-settings",
    );
    const closeSettings = SHORTCUT_ACTIONS.find(
      (action) => action.id === "close-settings",
    );

    expect(openSettings?.defaultHotkey).toBe("Mod+,");
    expect(closeSettings?.defaultHotkey).toBe("Escape");
  });

  // behavior: fullscreen + reveal-transport actions are registered (FR-7 AC-015)
  it("should include 'toggle-fullscreen' and 'toggle-reveal-transport' actions if read", () => {
    const fullscreen = SHORTCUT_ACTIONS.find(
      (action) => action.id === "toggle-fullscreen",
    );
    const reveal = SHORTCUT_ACTIONS.find(
      (action) => action.id === "toggle-reveal-transport",
    );

    expect(fullscreen?.defaultHotkey).toBe("Mod+Shift+F");
    expect(reveal?.defaultHotkey).toBe("Mod+Shift+H");
  });

  // behavior: the transport action carries 'bottom bar' as a search keyword (AC-015)
  it("should give the transport action a 'bottom bar' keyword if read", () => {
    const transport = SHORTCUT_ACTIONS.find(
      (action) => action.id === "toggle-transport",
    );

    expect(transport?.keywords).toContain("bottom bar");
  });

  // behavior: the mini-player action is registered on Mod+Shift+M and there is no
  // longer a separate mini-playlist action (mini-playlist is now just the mini
  // player with the sidebar toggled on, via cmd+b)
  it("should register 'toggle-mini-player' on Mod+Shift+M and NOT register a separate mini-playlist action", () => {
    const miniPlayer = SHORTCUT_ACTIONS.find(
      (action) => action.id === "toggle-mini-player",
    );

    expect(miniPlayer).toBeDefined();
    expect(miniPlayer?.defaultHotkey).toBe("Mod+Shift+M");
    expect(miniPlayer?.name.trim().length).toBeGreaterThan(0);

    const ids: string[] = SHORTCUT_ACTIONS.map((action) => action.id);
    expect(ids).not.toContain("toggle-mini-playlist");
    expect(
      SHORTCUT_ACTIONS.some((a) => a.defaultHotkey === "Mod+Shift+L"),
    ).toBe(false);
  });

  // behavior: action ids must be unique so each maps to exactly one handler/binding (AC-003)
  it("should expose a unique id for every registered action if enumerated", () => {
    const ids = SHORTCUT_ACTIONS.map((action) => action.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  // behavior: every action is displayable + bindable -> non-empty name and defaultHotkey (AC-003)
  it("should give every action a non-empty name and defaultHotkey if enumerated", () => {
    expect(SHORTCUT_ACTIONS.length).toBeGreaterThan(0);

    SHORTCUT_ACTIONS.forEach((action) => {
      expect(action.name.trim().length).toBeGreaterThan(0);
      expect(action.defaultHotkey.trim().length).toBeGreaterThan(0);
    });
  });
});
