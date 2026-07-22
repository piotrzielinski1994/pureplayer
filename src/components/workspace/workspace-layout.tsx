import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@pziel/pureui";
import { Content } from "@/components/workspace/content";
import { Sidebar } from "@/components/workspace/sidebar";
import { TransportBar } from "@/components/workspace/transport-bar";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useSettings } from "@/lib/settings/settings-context";

export function WorkspaceLayout() {
  const { isSidebarVisible, isContentVisible, isTransportVisible } =
    useWorkspace();
  const { settings, saveLayout } = useSettings();

  // The normal resizable tree stays MOUNTED even when content is hidden - it is
  // only display:none'd (the `hidden` attr) so the <video> inside Content keeps
  // playing (unmounting it restarts from 0; same rule as the sidebar-toggle
  // stable-tree learning). When content is hidden the shell collapses to the
  // mini stack below: the sidebar (if visible) reflows into a "top bar" above
  // the transport bar, and the transport bar docks at the bottom.
  return (
    <div className="flex h-full w-full flex-col">
      <div hidden={!isContentVisible} className="min-h-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full w-full"
          defaultLayout={settings.layout}
          onLayoutChanged={saveLayout}
        >
          {isSidebarVisible && (
            <ResizablePanel
              key="sidebar"
              id="sidebar"
              defaultSize="20%"
              minSize="12%"
              maxSize="40%"
            >
              <Sidebar />
            </ResizablePanel>
          )}
          {isSidebarVisible && <ResizableHandle key="handle" />}
          <ResizablePanel key="content" id="content" defaultSize="80%">
            <Content />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      {!isContentVisible && isSidebarVisible && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-border">
          <Sidebar />
        </div>
      )}
      {!isContentVisible && isTransportVisible && <TransportBar />}
    </div>
  );
}
