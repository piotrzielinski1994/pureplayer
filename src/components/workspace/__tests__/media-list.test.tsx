import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { MediaList } from "@/components/workspace/media-list";
import { Viewport } from "@/components/workspace/viewport";
import { fixtureMedia } from "./fixtures";

// Viewport pulls in the Tauri IPC boundary; mock the seam, not the components.
vi.mock("@/lib/tauri", () => ({
  watchAudioReady: vi.fn(() => Promise.resolve(() => {})),
  logPlayback: vi.fn(() => Promise.resolve()),
  prepareMediaUrl: (path: string) =>
    Promise.resolve({ url: `asset://localhost${path}`, durationSec: null }),
  openMediaFiles: vi.fn(() => Promise.resolve([])),
}));

const renderList = (initialActiveMediaId?: string) =>
  render(
    <WorkspaceProvider
      media={fixtureMedia}
      initialActiveMediaId={initialActiveMediaId}
    >
      <MediaList />
    </WorkspaceProvider>,
  );

const getList = () => screen.getByRole("list", { name: /playlist/i });

describe("MediaList", () => {
  // behavior: a flat list of all open media renders as listitems (AC-003)
  it("should render every open video as a flat list item if mounted", () => {
    renderList();

    const items = within(getList()).getAllByRole("listitem");

    expect(items).toHaveLength(fixtureMedia.length);
    fixtureMedia.forEach((v) => {
      expect(
        within(getList()).getByRole("listitem", {
          name: new RegExp(v.name.replace(/[-]/g, "\\-"), "i"),
        }),
      ).toBeInTheDocument();
    });
  });

  // behavior: no folder/tree affordances - nothing carries aria-expanded (AC-003)
  it("should not render any expandable/folder affordance if the playlist is flat", () => {
    const { container } = renderList();

    expect(container.querySelector("[aria-expanded]")).toBeNull();
    expect(screen.queryByRole("treeitem")).not.toBeInTheDocument();
  });

  // behavior: each row's name uses `truncate` and the ScrollArea viewport clamps
  // its inner wrapper to block/full-width - Radix otherwise wraps children in a
  // `display:table; min-width:100%` box that grows to the widest name, defeating
  // truncation and overflowing the panel edge. jsdom has no layout engine, so we
  // assert the invariant (the classes that make truncation work) not the pixels.
  it("should truncate long row names by clamping the scroll viewport wrapper", () => {
    const { container } = renderList();

    const nameSpans = within(getList())
      .getAllByRole("listitem")
      .map((row) => row.querySelector("span"));
    nameSpans.forEach((span) => {
      expect(span?.className).toContain("truncate");
    });

    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]',
    );
    expect(viewport?.className).toContain("[&>div]:!block");
    expect(viewport?.className).toContain("[&>div]:w-full");
  });

  // behavior: each row shows its format badge text (AC-009)
  it("should show the format text in each row if a video has a format", () => {
    renderList();

    fixtureMedia.forEach((v) => {
      const row = within(getList()).getByRole("listitem", {
        name: new RegExp(v.name.replace(/[-]/g, "\\-"), "i"),
      });
      expect(within(row).getByText(v.format)).toBeInTheDocument();
    });
  });

  // behavior: clicking a row flips aria-selected on it (AC-004/TC-002)
  it("should mark a row aria-selected if it is clicked", async () => {
    const user = userEvent.setup();
    renderList();

    const row = within(getList()).getByRole("listitem", {
      name: /3 - Intro/i,
    });
    expect(row).toHaveAttribute("aria-selected", "false");

    await user.click(row);

    expect(row).toHaveAttribute("aria-selected", "true");
  });

  // behavior: clicking a row activates it - the viewport reflects it (AC-004/TC-002)
  it("should make the clicked video active so the viewport shows it if a row is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia}>
        <MediaList />
        <Viewport />
      </WorkspaceProvider>,
    );

    const region = screen.getByRole("region", { name: /media viewport/i });
    expect(within(region).queryByText(/9 - Interlude/i)).not.toBeInTheDocument();

    await user.click(
      within(getList()).getByRole("listitem", { name: /9 - Interlude/i }),
    );

    expect(within(region).getByText(/9 - Interlude/i)).toBeInTheDocument();
  });
});
