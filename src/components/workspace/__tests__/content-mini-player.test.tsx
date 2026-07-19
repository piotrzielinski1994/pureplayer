import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

import { Content } from "@/components/workspace/content";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { fixtureMedia } from "./fixtures";
import type { MiniMode } from "@/lib/mini-mode";
import type { MediaNode } from "@/components/workspace/mock-data";

vi.mock("@/lib/tauri", () => ({
  watchAudioReady: vi.fn(() => Promise.resolve(() => {})),
  logPlayback: vi.fn(() => Promise.resolve()),
  prepareMediaUrl: (path: string) =>
    Promise.resolve({ url: `asset://localhost${path}`, durationSec: null }),
  openMediaFiles: vi.fn(() => Promise.resolve([])),
  toggleFullscreen: vi.fn(() => Promise.resolve()),
}));

const renderContent = (initialMiniMode: MiniMode, media: MediaNode[] = fixtureMedia) =>
  render(
    <SettingsProvider store={createInMemorySettingsStore({ ...DEFAULT_SETTINGS })}>
      <WorkspaceProvider
        media={media}
        initialActiveMediaId={media.length > 0 ? "v-3" : undefined}
        initialMiniMode={initialMiniMode}
      >
        <Content />
      </WorkspaceProvider>
    </SettingsProvider>,
  );

describe("Content mini-player", () => {
  // behavior: outside any mini mode the viewport region is visible and Content
  // renders no playlist list of its own (TC-007 / AC-005)
  it("should show the viewport region and render no playlist inside Content if miniMode is off", async () => {
    renderContent("off");

    const region = await screen.findByRole("region", {
      name: /media viewport/i,
    });
    expect(region).toBeVisible();
    expect(
      screen.queryByRole("list", { name: /playlist/i }),
    ).not.toBeInTheDocument();
  });

  // behavior: in bar-mini the viewport is HIDDEN (display:none via `hidden`
  // attr) but NOT unmounted, Content renders no playlist list, and the
  // transport bar (its play/pause button) stays - the shell collapses to just
  // the bar (TC-006 / AC-002, AC-006)
  it("should hide the viewport, keep it mounted, render no playlist and keep the transport bar if miniMode is bar", async () => {
    const { container } = renderContent("bar");

    const region = await screen.findByRole("region", {
      name: /media viewport/i,
      hidden: true,
    });
    expect(region).not.toBeVisible();
    expect(
      screen.queryByRole("list", { name: /playlist/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /play|pause/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector("video")).not.toBeNull(),
    );
  });

  // behavior: in playlist-mini Content renders the scrollable playlist list
  // ABOVE the transport bar, the viewport is HIDDEN, the transport play/pause
  // button is rendered below the list, and the <video> still mounts + survives
  // (no restart-from-0) (TC-005 / AC-005, AC-006)
  it("should render the playlist above a hidden-but-mounted viewport with the transport bar if miniMode is playlist", async () => {
    const { container } = renderContent("playlist");

    const list = await screen.findByRole("list", { name: /playlist/i });
    expect(list).toBeVisible();
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(0);

    const region = screen.getByRole("region", {
      name: /media viewport/i,
      hidden: true,
    });
    expect(region).not.toBeVisible();

    expect(
      screen.getByRole("button", { name: /play|pause/i }),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(container.querySelector("video")).not.toBeNull(),
    );
  });

  // behavior: playlist-mini with an empty playlist renders the "(no media)"
  // empty state and still shows the transport bar (TC-012 / AC-005)
  it("should render the (no media) empty state and the transport bar if playlist-mini has no media", async () => {
    renderContent("playlist", []);

    expect(await screen.findByText("(no media)")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /play|pause/i }),
    ).toBeInTheDocument();
  });
});
