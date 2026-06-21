import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createTauriSettingsStore } from "@/lib/settings/tauri-store";
import { installBrowserDefaultGuards } from "@/lib/browser-defaults";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
  );
  const [settingsStore] = useState(createTauriSettingsStore);

  useEffect(() => installBrowserDefaultGuards(window), []);

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider store={settingsStore}>
        <HotkeysProvider>{children}</HotkeysProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
