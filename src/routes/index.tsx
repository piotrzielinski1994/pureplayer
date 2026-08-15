import { createRoute } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { useState } from "react";
import { Workspace } from "@/components/workspace/workspace";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import {
  createNoopLogStream,
  createTauriLogStream,
} from "@/lib/logging/log-stream";
import { useSettings } from "@/lib/settings/settings-context";
import { rootRoute } from "@/routes/__root";

// Only the real Tauri host forwards backend log records to the webview; the dev-browser + jsdom
// get the noop (attachLogger would have no plugin to talk to).
function createLogStreamForEnv() {
  return isTauri() ? createTauriLogStream() : createNoopLogStream();
}

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
  const [logStream] = useState(createLogStreamForEnv);

  return (
    <WorkspaceProvider
      logStream={logStream}
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
