import { describe, expect, it } from "vitest";

import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";

const seeded: Settings = {
  version: 1,
  shortcuts: { "toggle-play": ["Mod+P"] },
  layout: { sidebar: 25, content: 75 },
  volume: 0.5,
  isMuted: true,
  playbackRate: 1.5,
  sidebarHidden: true,
  transportHidden: false,
  revealTransportOnHover: false,
  sortDirection: "desc",
  theme: { mode: "dark", colors: { light: {}, dark: {} } },
};

describe("createInMemorySettingsStore", () => {
  // behavior: an empty store loads DEFAULT_SETTINGS (AC-001, E-1)
  it("should return DEFAULT_SETTINGS if the store was created empty", async () => {
    const store = createInMemorySettingsStore();

    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  // behavior: a seeded store loads the seeded settings (AC-001)
  it("should return the seeded initial settings if one was provided", async () => {
    const store = createInMemorySettingsStore(seeded);

    expect(await store.load()).toEqual(seeded);
  });

  // side-effect-contract: save then load returns the saved settings (AC-001)
  it("should return the last-saved settings on a subsequent load", async () => {
    const store = createInMemorySettingsStore();

    await store.save(seeded);

    expect(await store.load()).toEqual(seeded);
  });
});
