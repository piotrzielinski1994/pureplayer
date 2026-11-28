import type { UpdateController } from "@pziel/pureui";
import { log, logError } from "@/lib/logging/log";

// Byte progress emitted by the Rust side (`update-progress` event). The total is
// null when the server sends no content-length, e.g. a chunked patch response.
export type UpdateProgress = {
  downloaded: number;
  total: number | null;
};

export type DeltaUpdateDeps = {
  /** `update_check` command: null when the running version is current. */
  check: () => Promise<{ version: string } | null>;
  /** `update_install` command: delta or full download, then install. */
  install: () => Promise<void>;
  /** Tauri process relaunch. */
  relaunch: () => Promise<void>;
  /** Subscribes to `update-progress`; resolves to the unsubscribe function. */
  listenProgress: (
    onProgress: (payload: UpdateProgress) => void,
  ) => Promise<() => void>;
};

// Whole percent, clamped, 0 while the total is unknown (no NaN in the label).
export function percentOf({ downloaded, total }: UpdateProgress): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

// The delta updater lives in Rust (patch apply + signing checks cannot happen in
// the WebView), so the app supplies an UpdateController that talks to two Tauri
// commands instead of the updater plugin. The port is unchanged, so pureui's
// UpdateChecker/UpdatesSection and the toast presentation stay as they are.
export function createDeltaUpdateController(
  deps: DeltaUpdateDeps,
): UpdateController {
  return {
    check: async () => {
      log.info("update: checking for a new version");
      const info = await deps.check();
      if (!info) {
        log.info("update: running the latest version");
        return null;
      }
      log.info(`update: version ${info.version} available`);
      return {
        version: info.version,
        downloadAndInstall: async (onProgress) => {
          log.info(`update: installing ${info.version}`);
          const unlisten = await deps.listenProgress((payload) =>
            onProgress(percentOf(payload)),
          );
          try {
            await deps.install();
            log.info(`update: ${info.version} installed`);
          } catch (error) {
            logError(`update: install of ${info.version} failed`, error);
            throw error;
          } finally {
            unlisten();
          }
        },
        relaunch: async () => {
          log.info("update: relaunch requested");
          await deps.relaunch();
        },
      };
    },
  };
}
