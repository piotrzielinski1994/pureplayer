import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "@/components/workspace/workspace";
import type { MediaNode } from "@/components/workspace/mock-data";
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

const renderWorkspace = (media: MediaNode[] = []) =>
  render(
    <HotkeysProvider>
      <SettingsProvider store={createInMemorySettingsStore()}>
        <WorkspaceProvider media={media}>
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

const listed: MediaNode[] = [
  {
    id: "/v/listed.mp4",
    name: "listed.mp4",
    format: "MP4",
    path: "/v/listed.mp4",
  },
];
const more: MediaNode[] = [
  { id: "/v/more.mp4", name: "more.mp4", format: "MP4", path: "/v/more.mp4" },
];

const viewport = () =>
  within(screen.getByRole("region", { name: /media viewport/i }));

const forward = async (paths: string[]) => {
  await waitFor(() => expect(watchOpenPaths).toHaveBeenCalled());
  takePendingOpenPaths.mockResolvedValue(paths);
  await act(async () => {
    openPathsHandler?.();
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

  it("appends a forwarded file to the playlist and plays it", async () => {
    renderWorkspace(listed);
    await flush();

    await forward(["/v/forwarded.mp4"]);

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().map((li) => li.getAttribute("aria-label"))).toEqual([
      "listed.mp4",
      "forwarded.mp4",
    ]);
    expect(viewport().getByText(/forwarded\.mp4/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
  });

  it("plays a forwarded file that is already in the playlist", async () => {
    renderWorkspace([...listed, ...more]);
    await flush();

    await forward(["/v/listed.mp4"]);

    await waitFor(() =>
      expect(viewport().getByText(/listed\.mp4/i)).toBeInTheDocument(),
    );
    expect(rows()).toHaveLength(2);
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
  });

  it("keeps the playlist when nothing was queued", async () => {
    renderWorkspace();
    await flush();

    expect(takePendingOpenPaths).toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
  });
});
