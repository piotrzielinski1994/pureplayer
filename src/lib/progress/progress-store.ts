import { LazyStore } from "@tauri-apps/plugin-store";
import { log } from "@/lib/logging/log";
import {
  type ProgressMap,
  parseProgressFile,
  toProgressFile,
} from "@/lib/progress/progress";

const PROGRESS_FILE = "progress.json";
const PROGRESS_KEY = "progress";

export type ProgressStore = {
  load: () => Promise<ProgressMap>;
  save: (map: ProgressMap) => Promise<void>;
};

export function createTauriProgressStore(): ProgressStore {
  const store = new LazyStore(PROGRESS_FILE);

  return {
    load: async () => {
      const raw = await store.get<unknown>(PROGRESS_KEY).catch(() => undefined);
      const parsed = parseProgressFile(raw);
      log.info(`progress-store: loaded entries=${Object.keys(parsed).length}`);
      return parsed;
    },
    save: async (map) => {
      await store
        .set(PROGRESS_KEY, toProgressFile(map))
        .then(() => store.save())
        .then(() => {
          log.debug(
            `progress-store: saved entries=${Object.keys(map).length}`,
          );
        })
        .catch((error) => {
          log.warn(
            `progress-store: failed to persist playback progress: ${String(error)}`,
          );
        });
    },
  };
}

export function createInMemoryProgressStore(
  initial: ProgressMap = {},
): ProgressStore {
  let current = initial;
  return {
    load: async () => current,
    save: async (map) => {
      current = map;
    },
  };
}
