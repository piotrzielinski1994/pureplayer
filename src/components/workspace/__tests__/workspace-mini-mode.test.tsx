import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "@/components/workspace/workspace";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { setMiniWindow } from "@/lib/tauri";
import { fixtureMedia } from "./fixtures";

vi.mock("@/lib/tauri", () => ({
  watchAudioReady: vi.fn(() => Promise.resolve(() => {})),
  logPlayback: vi.fn(() => Promise.resolve()),
  prepareMediaUrl: (path: string) =>
    Promise.resolve({ url: `asset://localhost${path}`, durationSec: null }),
  openMediaFiles: vi.fn(() => Promise.resolve([])),
  toggleFullscreen: vi.fn(() => Promise.resolve()),
  watchFullscreen: vi.fn(() => Promise.resolve(() => {})),
  watchWindowFocus: vi.fn(() => Promise.resolve(() => {})),
  focusWebview: vi.fn(() => Promise.resolve()),
  expandDroppedPaths: vi.fn(() => Promise.resolve([])),
  watchFileDrop: vi.fn(() => Promise.resolve(() => {})),
  setMiniWindow: vi.fn(() => Promise.resolve()),
}));

const setMiniWindowMock = vi.mocked(setMiniWindow);

const renderWorkspace = () =>
  render(
    <HotkeysProvider>
      <SettingsProvider store={createInMemorySettingsStore()}>
        <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-1">
          <Workspace />
        </WorkspaceProvider>
      </SettingsProvider>
    </HotkeysProvider>,
  );

const searchInput = () => screen.queryByPlaceholderText(/type a command/i);

const runPaletteAction = async (
  user: ReturnType<typeof userEvent.setup>,
  optionName: RegExp,
) => {
  await user.keyboard("{Control>}k{/Control}");
  await waitFor(() => expect(searchInput()).toBeInTheDocument());
  await user.click(screen.getByRole("option", { name: optionName }));
  await waitFor(() => expect(searchInput()).not.toBeInTheDocument());
};

const viewportRegion = () =>
  screen.getByRole("region", { name: /media viewport/i, hidden: true });

describe("Workspace mini-mode handlers", () => {
  beforeEach(() => {
    setMiniWindowMock.mockClear();
  });

  // side-effect-contract: the mini-player action hides content (viewport hidden)
  // AND resizes the OS window with the new layout - content hidden, sidebar shown
  // (the default), so the window becomes the sidebar+bar mini
  it("should hide content and call setMiniWindow with content hidden if 'Toggle mini player' is run", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("button", { name: /play|pause/i });
    expect(viewportRegion()).toBeVisible();

    await runPaletteAction(user, /toggle mini player/i);

    expect(setMiniWindowMock).toHaveBeenCalledWith({
      contentVisible: false,
      sidebarVisible: true,
    });
    expect(viewportRegion()).not.toBeVisible();
  });

  // side-effect-contract: toggling the sidebar WHILE mini (content hidden)
  // re-sizes the window to the new layout (content still hidden, sidebar now off)
  // - i.e. cmd+b in mini flips between the sidebar+bar and bar-only mini
  it("should re-size with the sidebar hidden if the sidebar is toggled while mini", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("button", { name: /play|pause/i });

    await runPaletteAction(user, /toggle mini player/i);
    setMiniWindowMock.mockClear();

    await runPaletteAction(user, /toggle sidebar/i);

    expect(setMiniWindowMock).toHaveBeenCalledWith({
      contentVisible: false,
      sidebarVisible: false,
    });
  });

  // side-effect-contract: toggling the sidebar while content is VISIBLE must NOT
  // resize the window (no mini) - setMiniWindow is not called
  it("should not resize the window if the sidebar is toggled while content is visible", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("button", { name: /play|pause/i });

    await runPaletteAction(user, /toggle sidebar/i);

    expect(setMiniWindowMock).not.toHaveBeenCalled();
  });

  // side-effect-contract: running the mini-player action twice shows content
  // again and the second call restores the window (content visible)
  it("should show content again and restore the window if the mini-player action is run twice", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("button", { name: /play|pause/i });

    await runPaletteAction(user, /toggle mini player/i);
    await runPaletteAction(user, /toggle mini player/i);

    expect(setMiniWindowMock).toHaveBeenLastCalledWith({
      contentVisible: true,
      sidebarVisible: true,
    });
    expect(viewportRegion()).toBeVisible();
  });
});
