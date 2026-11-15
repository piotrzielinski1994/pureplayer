import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "@/components/workspace/workspace";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { SettingsProvider } from "@/lib/settings/settings-context";

// `takePendingOpenPaths` is a programmable queue (the Rust side's drained
// queue); `watchOpenPaths` captures the handler the Workspace registers, so the
// test can poke it the way a second launch / macOS open event does.
const takePendingOpenPaths = vi.fn<() => Promise<string[]>>();
let openPathsHandler: (() => void) | null = null;
const watchOpenPaths = vi.fn((handler: () => void) => {
  openPathsHandler = handler;
  return Promise.resolve(() => {
    openPathsHandler = null;
  });
});

vi.mock("@/lib/tauri", () => ({
  watchAudioReady: vi.fn(() => Promise.resolve(() => {})),
  logPlayback: vi.fn(() => Promise.resolve()),
  openMediaFiles: vi.fn(() => Promise.resolve([])),
  prepareMediaUrl: (path: string) =>
    Promise.resolve({ url: `asset://localhost${path}`, durationSec: null }),
  toggleFullscreen: vi.fn(() => Promise.resolve()),
  watchFullscreen: vi.fn(() => Promise.resolve(() => {})),
  watchWindowFocus: vi.fn(() => Promise.resolve(() => {})),
  focusWebview: vi.fn(() => Promise.resolve()),
  expandDroppedPaths: vi.fn(() => Promise.resolve([])),
  watchFileDrop: vi.fn(() => Promise.resolve(() => {})),
  takePendingOpenPaths: () => takePendingOpenPaths(),
  watchOpenPaths: (handler: () => void) => watchOpenPaths(handler),
}));

const renderWorkspace = () =>
  render(
    <HotkeysProvider>
      <SettingsProvider store={createInMemorySettingsStore()}>
        <WorkspaceProvider media={[]}>
          <Workspace />
        </WorkspaceProvider>
      </SettingsProvider>
    </HotkeysProvider>,
  );

const rows = () =>
  within(screen.getByRole("list", { name: /playlist/i })).queryAllByRole(
    "listitem",
  );

// Let the mount drain and the follow-up render settle.
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  takePendingOpenPaths.mockReset();
  takePendingOpenPaths.mockResolvedValue([]);
  watchOpenPaths.mockClear();
  openPathsHandler = null;
});

describe("workspace open-from-OS wiring", () => {
  it("loads the media paths queued at launch", async () => {
    takePendingOpenPaths.mockResolvedValue(["/v/boot.mkv"]);

    renderWorkspace();
    await flush();

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent("boot.mkv");
  });

  it("opens a file forwarded to the running instance", async () => {
    renderWorkspace();
    await flush();
    expect(rows()).toHaveLength(0);

    await waitFor(() => expect(watchOpenPaths).toHaveBeenCalled());
    takePendingOpenPaths.mockResolvedValue(["/v/forwarded.mp4"]);
    await act(async () => {
      openPathsHandler?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent("forwarded.mp4");
  });

  it("keeps the playlist when nothing was queued", async () => {
    renderWorkspace();
    await flush();

    expect(takePendingOpenPaths).toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
  });
});
