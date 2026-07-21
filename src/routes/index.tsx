import { createRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/workspace/workspace";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { useSettings } from "@/lib/settings/settings-context";
import { rootRoute } from "@/routes/__root";

function HomePage() {
  const {
    settings,
    saveVolume,
    saveMuted,
    savePlaybackRate,
    saveSidebarHidden,
    saveTransportHidden,
    saveSortDirection,
  } = useSettings();

  return (
    <WorkspaceProvider
      initialSortKeys={["title"]}
      initialSortDirection={settings.sortDirection}
      initialVolume={settings.volume}
      initialMuted={settings.isMuted}
      initialPlaybackRate={settings.playbackRate}
      initialSidebarHidden={settings.sidebarHidden}
      initialTransportHidden={settings.transportHidden}
      onVolumeChange={saveVolume}
      onMutedChange={saveMuted}
      onPlaybackRateChange={savePlaybackRate}
      onSidebarHiddenChange={saveSidebarHidden}
      onTransportHiddenChange={saveTransportHidden}
      onSortDirectionChange={saveSortDirection}
    >
      <Workspace />
    </WorkspaceProvider>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
