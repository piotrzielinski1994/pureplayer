import { LazyStore } from "@tauri-apps/plugin-store";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";

const SETTINGS_FILE = "settings.json";
const SETTINGS_KEY = "settings";

export function createTauriSettingsStore(): SettingsStore {
  const store = new LazyStore(SETTINGS_FILE);

  const load = async (): Promise<Settings> => {
    const persisted = await store
      .get<unknown>(SETTINGS_KEY)
      .catch(() => undefined);
    return mergeSettings(DEFAULT_SETTINGS, persisted);
  };

  const save = async (settings: Settings): Promise<void> => {
    await store
      .set(SETTINGS_KEY, settings)
      .then(() => store.save())
      .catch((error) => {
        console.warn("Failed to persist settings", error);
      });
  };

  return { load, save };
}
