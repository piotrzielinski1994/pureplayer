import {
  Button,
  UpdatesSection,
  useActionHotkeys,
  useUpdater,
} from "@pziel/pureui";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PlaybackSection } from "@/components/settings/playback-section";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import { ThemeSection } from "@/components/settings/theme-section";
import { useToast } from "@/components/ui/toast";
import { log } from "@/lib/logging/log";
import { useEffectiveShortcuts } from "@/lib/shortcuts/use-effective-shortcuts";
import { createPlayerUpdateToastSink } from "@/lib/updater/update-toast-sink";
import { rootRoute } from "@/routes/__root";

function SettingsPage() {
  const navigate = useNavigate();
  const { controller, getVersion } = useUpdater();
  const { show } = useToast();
  const [sink] = useState(() => createPlayerUpdateToastSink(show));

  useEffect(() => {
    log.info("navigation: settings page entered");
    return () => log.info("navigation: settings page left");
  }, []);

  useActionHotkeys(
    {
      "close-settings": () => {
        log.info("navigation: close settings");
        void navigate({ to: "/" });
      },
    },
    useEffectiveShortcuts(),
    { ignoreInputs: true, preventDefault: true },
  );

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/">Back</Link>
        </Button>
      </header>
      <div className="flex flex-1 flex-col gap-6 overflow-auto p-4">
        <PlaybackSection />
        <ThemeSection />
        <ShortcutsSection />
        <UpdatesSection
          controller={controller}
          getVersion={getVersion}
          sink={sink}
          notify={{ info: show, error: show }}
        />
      </div>
    </div>
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
