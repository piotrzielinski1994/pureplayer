import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { type ReactNode, useEffect, useState } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { installBrowserDefaultGuards } from "@/lib/browser-defaults";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createTauriSettingsStore } from "@/lib/settings/tauri-store";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { UpdateChecker } from "@/lib/updater/update-checker";
import {
  createNoopUpdateController,
  createUpdateController,
  getAppVersion,
} from "@/lib/updater/update-controller";
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
        <ThemeProvider>
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
        </ThemeProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
