import { describe, it, expect, vi, beforeEach } from "vitest";

// Stage 2 - Themes feature. The Tauri adapter now splits theme.colors into a
// separate theme.json store (key "colors"), leaving only theme: { mode } in
// settings.json. On load it recombines theme.colors from theme.json. There is no
// existing split-adapter test, so we fake the @tauri-apps/plugin-store LazyStore
// surface (get/set/save) per-file: the mock records every LazyStore instance keyed
// by its path, so we can assert WHICH file each value lands in. PP model is
// FLATTENED: theme.colors.light is a flat token->oklch map (no tokens/editor).

type FakeStore = {
  path: string;
  data: Map<string, unknown>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
};

const stores = new Map<string, FakeStore>();

function makeFakeStore(path: string): FakeStore {
  const data = new Map<string, unknown>();
  return {
    path,
    data,
    get: vi.fn((key: string) => Promise.resolve(data.get(key))),
    set: vi.fn((key: string, value: unknown) => {
      data.set(key, value);
      return Promise.resolve();
    }),
    save: vi.fn(() => Promise.resolve()),
  };
}

vi.mock("@tauri-apps/plugin-store", () => ({
  // LazyStore is `new`-ed in the adapter, so the mock must be constructable. We
  // return the SAME fake per path (the adapter constructs one per file), so we can
  // assert which file each value landed in.
  LazyStore: class {
    constructor(path: string) {
      const fake = stores.get(path) ?? makeFakeStore(path);
      stores.set(path, fake);
      return fake as unknown as object;
    }
  },
}));

import { createTauriSettingsStore } from "@/lib/settings/tauri-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";

const SETTINGS_FILE = "settings.json";
const THEME_FILE = "theme.json";

// Ensure a fake exists for the given path (the adapter may not construct the theme
// store yet under RED - seeding through here lets the assertion be the failure,
// not a structural undefined-deref).
function ensureStore(path: string): FakeStore {
  const existing = stores.get(path);
  if (existing) {
    return existing;
  }
  const created = makeFakeStore(path);
  stores.set(path, created);
  return created;
}

const settingsStore = () => ensureStore(SETTINGS_FILE);
const themeStore = () => ensureStore(THEME_FILE);

const seededColors: Settings["theme"]["colors"] = {
  light: { primary: "oklch(0.55 0.22 27)" },
  dark: { background: "oklch(0.12 0 0)" },
};

beforeEach(() => {
  stores.clear();
});

describe("createTauriSettingsStore theme split (save)", () => {
  // AC-006 - side-effect-contract: on save, the colors land in theme.json under
  // the "colors" key.
  it("should write theme.colors to the theme.json store under the colors key", async () => {
    const store = createTauriSettingsStore();
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      theme: { mode: "dark", colors: seededColors },
    };

    await store.save(settings);

    expect(themeStore().data.get("colors")).toEqual(seededColors);
  });

  // AC-006 - side-effect-contract: settings.json's theme carries ONLY { mode } (no
  // real color overrides), so the color map is never duplicated into settings.json.
  it("should leave only theme.mode in the settings.json store (no colors)", async () => {
    const store = createTauriSettingsStore();
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      theme: { mode: "dark", colors: seededColors },
    };

    await store.save(settings);

    const persisted = settingsStore().data.get("settings") as
      | Settings
      | undefined;
    expect(persisted).toBeDefined();
    expect(persisted!.theme.mode).toBe("dark");
    // the colors are stripped from the settings.json payload (empty sparse maps),
    // so no real color override is duplicated here.
    expect(persisted!.theme.colors.light).toEqual({});
    expect(persisted!.theme.colors.dark).toEqual({});
  });

  // AC-006 - side-effect-contract: each store is persisted (save() called) so the
  // split is durable.
  it("should call save on both the settings and theme stores", async () => {
    const store = createTauriSettingsStore();

    await store.save({
      ...DEFAULT_SETTINGS,
      theme: { mode: "light", colors: seededColors },
    });

    expect(settingsStore().save).toHaveBeenCalled();
    expect(themeStore().save).toHaveBeenCalled();
  });
});

describe("createTauriSettingsStore theme split (load)", () => {
  // AC-006 - side-effect-contract: on load, theme.json's colors are recombined
  // into settings.theme.colors.
  it("should recombine theme.colors from the theme.json store on load", async () => {
    const store = createTauriSettingsStore();
    settingsStore().data.set("settings", {
      ...DEFAULT_SETTINGS,
      theme: { mode: "dark", colors: { light: {}, dark: {} } },
    });
    themeStore().data.set("colors", seededColors);

    const loaded = await store.load();

    expect(loaded.theme.mode).toBe("dark");
    expect(loaded.theme.colors).toEqual(seededColors);
  });

  // AC-011 / first-launch edge case - behavior: no theme.json yet -> defaults (no
  // colors), never throws.
  it("should fall back to empty color overrides if theme.json has no colors", async () => {
    const store = createTauriSettingsStore();
    settingsStore().data.set("settings", {
      ...DEFAULT_SETTINGS,
      theme: { mode: "light", colors: DEFAULT_SETTINGS.theme.colors },
    });
    // no "colors" key set on the theme store.

    const loaded = await store.load();

    expect(loaded.theme.mode).toBe("light");
    expect(loaded.theme.colors).toEqual(DEFAULT_SETTINGS.theme.colors);
  });

  // AC-010 - behavior: garbage in theme.json is tolerated (merge drops it), never
  // throws.
  it("should not throw if theme.json holds garbage colors", async () => {
    const store = createTauriSettingsStore();
    settingsStore().data.set("settings", DEFAULT_SETTINGS);
    themeStore().data.set("colors", "garbage");

    await expect(store.load()).resolves.toBeDefined();
  });

  // AC-010 - behavior: a garbage theme.json falls back to empty color overrides
  // (the bad entry is ignored, the token shows its default).
  it("should fall back to empty color overrides if theme.json colors are garbage", async () => {
    const store = createTauriSettingsStore();
    settingsStore().data.set("settings", DEFAULT_SETTINGS);
    themeStore().data.set("colors", "garbage");

    const loaded = await store.load();

    expect(loaded.theme.colors).toEqual(DEFAULT_SETTINGS.theme.colors);
  });

  // AC-006, TC-006 - side-effect-contract: a save-then-load round-trip restores the
  // colors from theme.json (proving the split is symmetric).
  it("should round-trip the colors through theme.json on save then load", async () => {
    const store = createTauriSettingsStore();

    await store.save({
      ...DEFAULT_SETTINGS,
      theme: { mode: "system", colors: seededColors },
    });
    const loaded = await store.load();

    expect(loaded.theme.colors).toEqual(seededColors);
  });
});
