import { Button } from "@pziel/pureui";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { PlaybackSection } from "@/components/settings/playback-section";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import { ThemeSection } from "@/components/settings/theme-section";
import { UpdatesSection } from "@/components/settings/updates-section";
import { useActionHotkeys } from "@/lib/shortcuts/use-action-hotkeys";
import { useUpdater } from "@/lib/updater/updater-context";
import { rootRoute } from "@/routes/__root";

function SettingsPage() {
  const navigate = useNavigate();
  const { controller, getVersion } = useUpdater();

  useActionHotkeys({
    "close-settings": () => void navigate({ to: "/" }),
  });

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
        <UpdatesSection controller={controller} getVersion={getVersion} />
      </div>
    </div>
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
