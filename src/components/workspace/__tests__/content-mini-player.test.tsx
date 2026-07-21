import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaNode } from "@/components/workspace/mock-data";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { fixtureMedia } from "./fixtures";

vi.mock("@/lib/tauri", () => ({
  watchAudioReady: vi.fn(() => Promise.resolve(() => {})),
  logPlayback: vi.fn(() => Promise.resolve()),
  prepareMediaUrl: (path: string) =>
    Promise.resolve({ url: `asset://localhost${path}`, durationSec: null }),
  openMediaFiles: vi.fn(() => Promise.resolve([])),
  toggleFullscreen: vi.fn(() => Promise.resolve()),
}));

type Overrides = {
  contentHidden?: boolean;
  sidebarHidden?: boolean;
  media?: MediaNode[];
};

const renderLayout = ({
  contentHidden = false,
  sidebarHidden = false,
  media = fixtureMedia,
}: Overrides = {}) =>
  render(
    <SettingsProvider
      store={createInMemorySettingsStore({ ...DEFAULT_SETTINGS })}
    >
      <WorkspaceProvider
        media={media}
        initialActiveMediaId={media.length > 0 ? "v-3" : undefined}
        initialContentHidden={contentHidden}
        initialSidebarHidden={sidebarHidden}
      >
        <WorkspaceLayout />
      </WorkspaceProvider>
    </SettingsProvider>,
  );

describe("WorkspaceLayout content toggle (mini player)", () => {
  // behavior: with content visible the viewport region is shown; there is one
  // playlist (the sidebar) beside it, and the transport bar is present
  it("should show the viewport and the sidebar playlist if content is visible", async () => {
    renderLayout();

    const region = await screen.findByRole("region", {
      name: /media viewport/i,
    });
    expect(region).toBeVisible();
    expect(screen.getByRole("list", { name: /playlist/i })).toBeVisible();
  });

  // behavior: hiding content display:none's the whole content tree (so the
  // viewport is hidden) but keeps the <video> MOUNTED (playback survives), and
  // the sidebar reflows into the mini stack above the transport bar
  it("should hide the viewport but keep the video mounted if content is hidden", async () => {
    const { container } = renderLayout({ contentHidden: true });

    const region = await screen.findByRole("region", {
      name: /media viewport/i,
      hidden: true,
    });
    expect(region).not.toBeVisible();
    await waitFor(() =>
      expect(container.querySelector("video")).not.toBeNull(),
    );
  });

  // behavior: content hidden + sidebar visible -> the playlist (sidebar) still
  // renders (as the mini top bar) and the transport play/pause button shows
  it("should render the playlist and the transport bar if content is hidden and the sidebar is visible", async () => {
    renderLayout({ contentHidden: true });

    const list = await screen.findByRole("list", { name: /playlist/i });
    expect(list).toBeVisible();
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /play|pause/i }),
    ).toBeInTheDocument();
  });

  // behavior: content hidden + sidebar hidden -> no visible playlist, only the
  // transport bar (bar-only mini)
  it("should show only the transport bar if content and sidebar are both hidden", async () => {
    renderLayout({ contentHidden: true, sidebarHidden: true });

    expect(
      await screen.findByRole("button", { name: /play|pause/i }),
    ).toBeInTheDocument();
    const lists = screen.queryAllByRole("list", { name: /playlist/i });
    expect(lists.every((list) => !isVisible(list))).toBe(true);
  });

  // behavior: mini with an empty playlist still renders the "(no media)" empty
  // state (in the reflowed sidebar) and the transport bar
  it("should render the (no media) empty state and the transport bar if mini has no media", async () => {
    renderLayout({ contentHidden: true, media: [] });

    expect((await screen.findAllByText("(no media)")).length).toBeGreaterThan(
      0,
    );
    expect(
      await screen.findByRole("button", { name: /play|pause/i }),
    ).toBeInTheDocument();
  });
});

function isVisible(element: Element): boolean {
  return !element.closest("[hidden]");
}
