import { describe, it, expect } from "vitest";

import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type Settings,
} from "@/lib/settings/settings";
import { SHORTCUT_ACTIONS } from "@/lib/shortcuts/registry";

describe("mergeSettings", () => {
  // behavior: a valid full settings object passes through unchanged (AC-002, TC-007)
  it("should pass a valid full settings object through unchanged", () => {
    const full: Settings = {
      version: 1,
      shortcuts: { "toggle-play": "Mod+P" },
      layout: { sidebar: 25, content: 75 },
      volume: 0.5,
      isMuted: true,
      playbackRate: 1.5,
      sidebarHidden: true,
      transportHidden: true,
      revealTransportOnHover: false,
      sortDirection: "desc",
    };

    expect(mergeSettings(DEFAULT_SETTINGS, full)).toEqual(full);
  });

  // behavior: a non-object partial yields DEFAULT_SETTINGS (AC-002, TC-007, E-2)
  it("should return defaults if the partial is null", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS);
  });

  // behavior: an undefined partial yields DEFAULT_SETTINGS (AC-002, TC-007, E-1)
  it("should return defaults if the partial is undefined", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, undefined)).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  // behavior: a string partial yields DEFAULT_SETTINGS (AC-002, TC-007)
  it("should return defaults if the partial is a string", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, "not an object")).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  // behavior: a number partial yields DEFAULT_SETTINGS (AC-002, TC-007)
  it("should return defaults if the partial is a number", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, 123)).toEqual(DEFAULT_SETTINGS);
  });

  // behavior: an array partial yields DEFAULT_SETTINGS (AC-002)
  it("should return defaults if the partial is an array", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, [])).toEqual(DEFAULT_SETTINGS);
  });

  // behavior: an unknown version yields DEFAULT_SETTINGS (AC-002, TC-007)
  it("should return defaults if the version is unknown", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { version: 99 })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  // behavior: a corrupt partial never throws (AC-002, E-2)
  it("should not throw if the partial is garbage", () => {
    expect(() => mergeSettings(DEFAULT_SETTINGS, [])).not.toThrow();
    expect(() => mergeSettings(DEFAULT_SETTINGS, true)).not.toThrow();
    expect(() => mergeSettings(DEFAULT_SETTINGS, null)).not.toThrow();
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, { volume: {}, sortDirection: 1 }),
    ).not.toThrow();
  });
});

describe("mergeSettings per-field type guards", () => {
  // behavior: a non-number volume falls back to the default (AC-002, TC-007, E-2)
  it("should fall back to default volume if volume is not a number", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { volume: "loud" });

    expect(merged.volume).toBe(DEFAULT_SETTINGS.volume);
  });

  // behavior: a valid number volume is kept (AC-008)
  it("should keep a valid number volume", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { volume: 0.5 });

    expect(merged.volume).toBe(0.5);
  });

  // behavior: a non-boolean isMuted falls back to the default (AC-002, TC-007, E-2)
  it("should fall back to default isMuted if isMuted is not a boolean", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { isMuted: "yes" });

    expect(merged.isMuted).toBe(DEFAULT_SETTINGS.isMuted);
  });

  // behavior: a non-number playbackRate falls back to the default (AC-002, E-2)
  it("should fall back to default playbackRate if it is not a number", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { playbackRate: null });

    expect(merged.playbackRate).toBe(DEFAULT_SETTINGS.playbackRate);
  });

  // behavior: a non-boolean sidebarHidden falls back to the default (AC-002, E-2)
  it("should fall back to default sidebarHidden if it is not a boolean", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { sidebarHidden: 1 });

    expect(merged.sidebarHidden).toBe(DEFAULT_SETTINGS.sidebarHidden);
  });

  // behavior: a non-boolean transportHidden falls back to the default (AC-002, E-2)
  it("should fall back to default transportHidden if it is not a boolean", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { transportHidden: "no" });

    expect(merged.transportHidden).toBe(DEFAULT_SETTINGS.transportHidden);
  });

  // behavior: a non-boolean revealTransportOnHover falls back to the default (AC-014, E-2)
  it("should fall back to default revealTransportOnHover if it is not a boolean", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      revealTransportOnHover: "yes",
    });

    expect(merged.revealTransportOnHover).toBe(
      DEFAULT_SETTINGS.revealTransportOnHover,
    );
  });

  // behavior: a valid false revealTransportOnHover is kept (AC-014)
  it("should keep a valid false revealTransportOnHover", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      revealTransportOnHover: false,
    });

    expect(merged.revealTransportOnHover).toBe(false);
  });

  // behavior: the default for revealTransportOnHover is true (AC-014)
  it("should default revealTransportOnHover to true", () => {
    expect(DEFAULT_SETTINGS.revealTransportOnHover).toBe(true);
  });

  // behavior: a bad sortDirection falls back to the default (AC-002, TC-007, E-2)
  it("should fall back to default sortDirection if it is not asc or desc", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { sortDirection: "sideways" });

    expect(merged.sortDirection).toBe(DEFAULT_SETTINGS.sortDirection);
  });

  // behavior: a valid desc sortDirection is kept (AC-009)
  it("should keep a valid 'desc' sortDirection", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { sortDirection: "desc" });

    expect(merged.sortDirection).toBe("desc");
  });
});

describe("mergeSettings layout", () => {
  // behavior: layout defaults to an empty map if absent (AC-013, E-1)
  it("should default layout to an empty map if the key is absent", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { volume: 0.5 }).layout).toEqual({});
  });

  // behavior: a valid panel layout (id -> number) is kept (AC-013)
  it("should keep a valid panel layout map", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      layout: { sidebar: 22, content: 78 },
    });

    expect(merged.layout).toEqual({ sidebar: 22, content: 78 });
  });

  // behavior: a layout with a non-number value falls back to empty (AC-013, E-2)
  it("should fall back to an empty layout if a value is not a number", () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, { layout: { sidebar: "wide" } }).layout,
    ).toEqual({});
  });

  // behavior: a non-object layout yields an empty map (AC-013, E-2)
  it("should yield an empty layout if the persisted value is not an object", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { layout: 42 }).layout).toEqual({});
  });

  // behavior: a garbage layout never throws (AC-013, E-2)
  it("should not throw if the persisted layout is garbage", () => {
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, { layout: [1, 2] }),
    ).not.toThrow();
  });
});

describe("mergeSettings shortcuts", () => {
  const togglePlayDefault = SHORTCUT_ACTIONS.find(
    (a) => a.id === "toggle-play",
  )!.defaultHotkey;

  // behavior: shortcuts defaults to an empty map if absent (AC-002, E-1)
  it("should default shortcuts to an empty map if the key is absent", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { volume: 0.5 });

    expect(merged.shortcuts).toEqual({});
  });

  // behavior: a valid override map is kept, normalized (AC-002, TC-007)
  it("should keep a valid shortcuts override map", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      shortcuts: { "toggle-play": "Mod+P" },
    });

    expect(merged.shortcuts).toEqual({ "toggle-play": "Mod+P" });
  });

  // behavior: a lower-case override is normalized on merge (AC-002)
  it("should normalize a valid override hotkey on merge", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      shortcuts: { "toggle-play": "mod+p" },
    });

    expect(merged.shortcuts["toggle-play"]).toBe("Mod+P");
  });

  // behavior: a non-string hotkey value is dropped (AC-002, TC-007, E-2)
  it("should drop a non-string shortcut value", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      shortcuts: { "toggle-play": 42, "toggle-mute": "Mod+Shift+M" },
    });

    expect(merged.shortcuts).not.toHaveProperty("toggle-play");
    expect(merged.shortcuts["toggle-mute"]).toBe("Mod+Shift+M");
  });

  // behavior: an unparseable hotkey string is dropped (AC-002, TC-007, E-4)
  it("should drop an invalid hotkey string", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      shortcuts: { "toggle-play": "bogus!!", "toggle-mute": "Mod+Shift+M" },
    });

    expect(merged.shortcuts).not.toHaveProperty("toggle-play");
    expect(merged.shortcuts["toggle-mute"]).toBe("Mod+Shift+M");
  });

  // behavior: an override for an unknown action id is dropped (AC-002, TC-007, E-3)
  it("should drop an override for an unknown action id", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      shortcuts: { bogus: "Mod+Q", "toggle-play": "Mod+P" },
    });

    expect(merged.shortcuts).not.toHaveProperty("bogus");
    expect(merged.shortcuts["toggle-play"]).toBe("Mod+P");
  });

  // behavior: a non-object shortcuts value yields an empty map (AC-002)
  it("should yield an empty shortcuts map if the persisted value is not an object", () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, { shortcuts: "nope" }).shortcuts,
    ).toEqual({});
  });

  // behavior: a garbage shortcuts map never throws (AC-002)
  it("should not throw if the persisted shortcuts map is garbage", () => {
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, { shortcuts: 42 }),
    ).not.toThrow();
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, {
        shortcuts: { "toggle-play": null, bogus: [] },
      }),
    ).not.toThrow();
  });

  // behavior: references a real registry default for toggle-play (AC-002)
  it("should reference a real registry default for the toggle-play action", () => {
    expect(typeof togglePlayDefault).toBe("string");
    expect(togglePlayDefault.length).toBeGreaterThan(0);
  });
});
