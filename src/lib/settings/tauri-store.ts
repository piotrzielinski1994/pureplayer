import { LazyStore } from "@tauri-apps/plugin-store";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";

const SETTINGS_FILE = "settings.json";
const THEME_FILE = "theme.json";
const SETTINGS_KEY = "settings";
const THEME_COLORS_KEY = "colors";

export function createTauriSettingsStore(): SettingsStore {
  const settingsStore = new LazyStore(SETTINGS_FILE);
  const themeStore = new LazyStore(THEME_FILE);

  const load = async (): Promise<Settings> => {
    const persistedSettings = await settingsStore
      .get<unknown>(SETTINGS_KEY)
      .catch(() => undefined);
    const persistedColors = await themeStore
      .get<unknown>(THEME_COLORS_KEY)
      .catch(() => undefined);

    const base = mergeSettings(DEFAULT_SETTINGS, persistedSettings);
    return mergeSettings(base, {
      ...base,
      theme: { mode: base.theme.mode, colors: persistedColors },
    });
  };

  const save = async (settings: Settings): Promise<void> => {
    // Strip the color overrides out of settings.json (they live in theme.json),
    // mirroring purerequest's keymap split - a color scheme is device-syncable
    // on its own.
    const settingsPayload: Settings = {
      ...settings,
      theme: { mode: settings.theme.mode, colors: DEFAULT_SETTINGS.theme.colors },
    };
    await persist(settingsStore, SETTINGS_KEY, settingsPayload);
    await persist(themeStore, THEME_COLORS_KEY, settings.theme.colors);
  };

  return { load, save };
}

async function persist(
  store: LazyStore,
  key: string,
  value: unknown,
): Promise<void> {
  await store
    .set(key, value)
    .then(() => store.save())
    .catch((error) => {
      console.warn(`Failed to persist ${key}`, error);
    });
}
