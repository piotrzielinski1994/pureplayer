import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HotkeysProvider } from "@tanstack/react-hotkeys";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { Workspace } from "@/components/workspace/workspace";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
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
  // side-effect-contract: the mini-playlist action enters playlist-mini (viewport
  // hidden) AND resizes the OS window with the next mode "playlist" (AC-008)
  it("should call setMiniWindow('playlist') and enter playlist-mini if 'Toggle mini playlist' is run", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("button", { name: /play|pause/i });
    expect(viewportRegion()).toBeVisible();

    await runPaletteAction(user, /toggle mini playlist/i);

    expect(setMiniWindowMock).toHaveBeenCalledWith("playlist");
    expect(viewportRegion()).not.toBeVisible();
  });

  // side-effect-contract: the bar-mini action enters bar-mini (viewport hidden,
  // no playlist rendered) AND resizes the OS window with the next mode "bar" (AC-008)
  it("should call setMiniWindow('bar') if 'Toggle mini player' is run", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("button", { name: /play|pause/i });

    await runPaletteAction(user, /toggle mini player/i);

    expect(setMiniWindowMock).toHaveBeenCalledWith("bar");
    expect(viewportRegion()).not.toBeVisible();
    expect(
      screen.queryByRole("list", { name: /playlist/i }),
    ).not.toBeInTheDocument();
  });

  // side-effect-contract: running the SAME mini action twice toggles back to
  // "off" - the second call passes "off" so the window restores and the viewport
  // is shown again (AC-008)
  it("should call setMiniWindow('off') and leave mini if the mini-playlist action is run twice", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("button", { name: /play|pause/i });

    await runPaletteAction(user, /toggle mini playlist/i);
    await runPaletteAction(user, /toggle mini playlist/i);

    expect(setMiniWindowMock).toHaveBeenLastCalledWith("off");
    expect(viewportRegion()).toBeVisible();
  });
});
