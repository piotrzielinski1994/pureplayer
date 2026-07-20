import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { DropOverlay } from "@/components/workspace/drop-overlay";
import {
  CommandPalette,
  type PaletteCommand,
} from "@/components/workspace/command-palette";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { mediaFromPaths } from "@/components/workspace/media-from-paths";
import {
  expandDroppedPaths,
  openMediaFiles,
  setMiniWindow,
  toggleFullscreen,
  watchFileDrop,
  watchFullscreen,
  watchWindowFocus,
} from "@/lib/tauri";
import { useSettings } from "@/lib/settings/settings-context";
import { useActionHotkeys } from "@/lib/shortcuts/use-action-hotkeys";
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";

export function Workspace() {
  const {
    loadMedia,
    addMedia,
    togglePlay,
    nextMedia,
    prevMedia,
    seekBy,
    stepFrame,
    changeVolume,
    toggleMute,
    changeRate,
    cycleRepeat,
    toggleShuffle,
    toggleSortDirection,
    toggleSidebar,
    isSidebarVisible,
    toggleContent,
    isContentVisible,
    toggleTransport,
    setFullscreen,
    rotateClockwise,
    cycleFitMode,
    zoomBy,
    resetViewportTransform,
  } = useWorkspace();
  const { settings, saveRevealTransportOnHover } = useSettings();
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const navigate = useNavigate();

  // Drive isFullscreen from the REAL window state (every path: native F11, green
  // button, double-click) and re-arm the WKWebView first responder on each
  // transition + focus gain so keyboard input survives fullscreen (tao#208).
  useEffect(() => {
    const fsPromise = watchFullscreen(setFullscreen);
    const focusPromise = watchWindowFocus();
    return () => {
      void fsPromise.then((unlisten) => unlisten());
      void focusPromise.then((unlisten) => unlisten());
    };
  }, [setFullscreen]);

  // Drop files/folders onto the window -> expand (recurse folders + filter) in
  // Rust, then APPEND. The overlay tracks the live drag state.
  useEffect(() => {
    const dropPromise = watchFileDrop(async (event) => {
      if (event.type === "enter") {
        setIsDragging(true);
        return;
      }
      if (event.type === "leave") {
        setIsDragging(false);
        return;
      }
      setIsDragging(false);
      const paths = await expandDroppedPaths(event.paths);
      addMedia(mediaFromPaths(paths));
    });
    return () => {
      void dropPromise.then((unlisten) => unlisten());
    };
  }, [addMedia]);

  const openFiles = async () => {
    const paths = await openMediaFiles();
    if (paths.length === 0) {
      return;
    }
    loadMedia(mediaFromPaths(paths));
  };

  const handlers: Partial<Record<ShortcutActionId, () => void>> = {
    "open-files": () => void openFiles(),
    "toggle-play": togglePlay,
    "next-media": nextMedia,
    "prev-media": prevMedia,
    "seek-forward": () => seekBy(5),
    "seek-back": () => seekBy(-5),
    "seek-forward-fine": () => seekBy(1),
    "seek-back-fine": () => seekBy(-1),
    "frame-step-forward": () => stepFrame(1),
    "frame-step-back": () => stepFrame(-1),
    "volume-up": () => changeVolume(0.05),
    "volume-down": () => changeVolume(-0.05),
    "toggle-mute": toggleMute,
    "speed-up": () => changeRate(0.1),
    "speed-down": () => changeRate(-0.1),
    "toggle-shuffle": toggleShuffle,
    "cycle-repeat": cycleRepeat,
    "toggle-sort-direction": toggleSortDirection,
    "toggle-sidebar": () => {
      toggleSidebar();
      // In mini (content hidden) the sidebar reflows into a top bar, so flipping
      // it changes the mini window height - resize to match the new layout.
      if (!isContentVisible) {
        void setMiniWindow({
          contentVisible: false,
          sidebarVisible: !isSidebarVisible,
        });
      }
    },
    "toggle-transport": toggleTransport,
    "toggle-mini-player": () => {
      toggleContent();
      void setMiniWindow({
        contentVisible: !isContentVisible,
        sidebarVisible: isSidebarVisible,
      });
    },
    "toggle-fullscreen": () => void toggleFullscreen(),
    "toggle-reveal-transport": () =>
      saveRevealTransportOnHover(!settings.revealTransportOnHover),
    "open-settings": () => void navigate({ to: "/settings" }),
    "rotate-cw": rotateClockwise,
    "cycle-fit-mode": cycleFitMode,
    "zoom-in": () => zoomBy(0.1),
    "zoom-out": () => zoomBy(-0.1),
    "reset-viewport": resetViewportTransform,
  };

  useActionHotkeys({
    ...handlers,
    "open-command-palette": () => setIsPaletteOpen(true),
  });

  const commands: PaletteCommand[] = SHORTCUT_ACTIONS.filter(
    (action) => action.id !== "open-command-palette",
  )
    .map((action) => {
      const run = handlers[action.id];
      if (!run) {
        return null;
      }
      return {
        action,
        binding: action.defaultHotkey,
        keywords: action.keywords ?? [],
        run,
      };
    })
    .filter((command): command is PaletteCommand => command !== null);

  return (
    <div className="relative h-full w-full">
      <WorkspaceLayout />
      {isDragging && <DropOverlay />}
      <CommandPalette
        open={isPaletteOpen}
        onOpenChange={setIsPaletteOpen}
        commands={commands}
      />
    </div>
  );
}
