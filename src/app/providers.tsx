import {
  createAppVersionGetter,
  createNoopUpdateController,
  installBrowserDefaultGuards,
  UpdateChecker,
  UpdaterProvider,
} from "@pziel/pureui";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { type ReactNode, useEffect, useState } from "react";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { log } from "@/lib/logging/log";
import { demoSettings } from "@/lib/playlist/demo-seed";
import { ProgressProvider } from "@/lib/progress/progress-context";
import {
  createInMemoryProgressStore,
  createTauriProgressStore,
} from "@/lib/progress/progress-store";
import { isDevBrowser } from "@/lib/runtime/environment";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createTauriSettingsStore } from "@/lib/settings/tauri-store";
import { ThemeProvider } from "@/lib/theme/theme-context";
import {
  createDeltaUpdateController,
  type UpdateProgress,
} from "@/lib/updater/delta-controller";
import { createPlayerUpdateToastSink } from "@/lib/updater/update-toast-sink";

// Only the real Tauri host talks to the updater/process plugins; the dev-browser
// and jsdom (both non-Tauri) get the noop - no network, no plugin calls. The
// Tauri bindings are injected here because pureui declares no @tauri-apps dep.
// The Tauri path goes through the app's own delta updater (patch-first, full
// download as fallback), which owns install and progress; the port is unchanged.
function createUpdateControllerForEnv() {
  if (!isTauri()) {
    log.info("update: noop controller (not a Tauri host)");
    return createNoopUpdateController();
  }
  log.info("update: delta controller installed");
  return createDeltaUpdateController({
    check: () => invoke<{ version: string } | null>("update_check"),
    install: () => invoke<void>("update_install"),
    relaunch,
    listenProgress: async (onProgress) =>
      listen<UpdateProgress>("update-progress", (event) =>
        onProgress(event.payload),
      ),
  });
}

const getAppVersion = createAppVersionGetter({ isTauri, getVersion });

// Bridges the injected controller into the ToastProvider's `show`, so the
// startup checker drives pureplayer's own toast presentation (the sink is the
// app-owned half of the DI seam; pureui owns the flow).
function UpdateCheckerBridge({
  controller,
}: {
  controller: ReturnType<typeof createUpdateControllerForEnv>;
}) {
  const { show } = useToast();
  const [sink] = useState(() => createPlayerUpdateToastSink(show));
  return <UpdateChecker controller={controller} sink={sink} />;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
  );
  // The dev-browser build seeds the in-memory store with the demo settings;
  // the Tauri build and jsdom keep the Tauri-backed adapter.
  const [settingsStore] = useState(() => {
    log.info(`app: settings store=${isDevBrowser() ? "in-memory" : "tauri"}`);
    return isDevBrowser()
      ? createInMemorySettingsStore(demoSettings())
      : createTauriSettingsStore();
  });
  // Same split as settings: the dev browser has no Tauri store plugin.
  const [progressStore] = useState(() => {
    log.info(`app: progress store=${isDevBrowser() ? "in-memory" : "tauri"}`);
    return isDevBrowser()
      ? createInMemoryProgressStore()
      : createTauriProgressStore();
  });
  const [updateController] = useState(createUpdateControllerForEnv);

  useEffect(() => {
    log.debug("app: installing browser default guards");
    installBrowserDefaultGuards(window);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider store={settingsStore}>
        <ProgressProvider store={progressStore}>
          <ThemeProvider>
            <HotkeysProvider>
              <ToastProvider>
                <UpdaterProvider
                  controller={updateController}
                  getVersion={getAppVersion}
                >
                  <UpdateCheckerBridge controller={updateController} />
                  {children}
                </UpdaterProvider>
              </ToastProvider>
            </HotkeysProvider>
          </ThemeProvider>
        </ProgressProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
