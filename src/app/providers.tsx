import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { isTauri } from "@tauri-apps/api/core";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createTauriSettingsStore } from "@/lib/settings/tauri-store";
import { installBrowserDefaultGuards } from "@/lib/browser-defaults";
import { ToastProvider } from "@/components/ui/toast";
import {
  createNoopUpdateController,
  createUpdateController,
  getAppVersion,
} from "@/lib/updater/update-controller";
import { UpdateChecker } from "@/lib/updater/update-checker";
import { UpdaterProvider } from "@/lib/updater/updater-context";

// Only the real Tauri host talks to the updater/process plugins; the dev-browser
// and jsdom (both non-Tauri) get the noop - no network, no plugin calls.
function createUpdateControllerForEnv() {
  return isTauri() ? createUpdateController() : createNoopUpdateController();
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
        <HotkeysProvider>
          <ToastProvider>
            <UpdaterProvider
              controller={updateController}
              getVersion={getAppVersion}
            >
              <UpdateChecker controller={updateController} />
              {children}
            </UpdaterProvider>
          </ToastProvider>
        </HotkeysProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
