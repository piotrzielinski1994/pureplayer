import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { Content } from "@/components/workspace/content";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { fixtureMedia } from "./fixtures";

vi.mock("@/lib/tauri", () => ({
  watchAudioReady: vi.fn(() => Promise.resolve(() => {})),
  logPlayback: vi.fn(() => Promise.resolve()),
  prepareMediaUrl: (path: string) =>
    Promise.resolve({ url: `asset://localhost${path}`, durationSec: null }),
  openMediaFiles: vi.fn(() => Promise.resolve([])),
  toggleFullscreen: vi.fn(() => Promise.resolve()),
}));

const renderContent = (initialMiniPlayer: boolean) =>
  render(
    <SettingsProvider store={createInMemorySettingsStore({ ...DEFAULT_SETTINGS })}>
      <WorkspaceProvider
        media={fixtureMedia}
        initialActiveMediaId="v-3"
        initialMiniPlayer={initialMiniPlayer}
      >
        <Content />
      </WorkspaceProvider>
    </SettingsProvider>,
  );

describe("Content mini-player", () => {
  // behavior: outside mini-player the viewport region is visible (not hidden)
  it("should show the viewport region if not in mini-player mode", async () => {
    renderContent(false);

    const region = await screen.findByRole("region", {
      name: /media viewport/i,
    });
    expect(region).toBeVisible();
  });

  // behavior: in mini-player the viewport is HIDDEN (display:none via `hidden`
  // attr) so only the transport bar shows - but it is NOT unmounted, so the
  // inner <video> keeps playing (no restart-from-0)
  it("should hide the viewport but keep it mounted if in mini-player mode", async () => {
    const { container } = renderContent(true);

    // SettingsProvider null-gates on its async load, so the first query must await
    const region = await screen.findByRole("region", {
      name: /media viewport/i,
      hidden: true,
    });
    expect(region).not.toBeVisible();
    // the <video> element mounts (once prepareMediaUrl resolves) and survives -
    // playback is uninterrupted because Content hides, not unmounts, the viewport
    await waitFor(() =>
      expect(container.querySelector("video")).not.toBeNull(),
    );
  });

  // behavior: the transport bar stays visible in mini-player mode (it is the
  // whole point - the shell collapses to just the bar)
  it("should keep the transport bar visible if in mini-player mode", async () => {
    renderContent(true);

    expect(
      await screen.findByRole("button", { name: /play|pause/i }),
    ).toBeInTheDocument();
  });
});
