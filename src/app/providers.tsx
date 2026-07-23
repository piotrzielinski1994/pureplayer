import {
  createAppVersionGetter,
  createNoopUpdateController,
  createUpdateController,
  UpdateChecker,
  UpdaterProvider,
} from "@pziel/pureui";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { type ReactNode, useEffect, useState } from "react";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { installBrowserDefaultGuards } from "@/lib/browser-defaults";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createTauriSettingsStore } from "@/lib/settings/tauri-store";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { createPlayerUpdateToastSink } from "@/lib/updater/update-toast-sink";

// Only the real Tauri host talks to the updater/process plugins; the dev-browser
// and jsdom (both non-Tauri) get the noop - no network, no plugin calls. The
// Tauri bindings are injected here because pureui declares no @tauri-apps dep.
function createUpdateControllerForEnv() {
  return isTauri()
    ? createUpdateController({ check, relaunch })
    : createNoopUpdateController();
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
  const [settingsStore] = useState(createTauriSettingsStore);
  const [updateController] = useState(createUpdateControllerForEnv);

  useEffect(() => installBrowserDefaultGuards(window), []);

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider store={settingsStore}>
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
      </SettingsProvider>
    </QueryClientProvider>
  );
}
