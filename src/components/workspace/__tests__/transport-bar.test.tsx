import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { TransportBar } from "@/components/workspace/transport-bar";
import { Viewport } from "@/components/workspace/viewport";
import { Sidebar } from "@/components/workspace/sidebar";
import { fixtureMedia, singleMediaList } from "./fixtures";

// Viewport pulls in the Tauri IPC boundary; mock the seam, not the components.
vi.mock("@/lib/tauri", () => ({
  watchAudioReady: vi.fn(() => Promise.resolve(() => {})),
  logPlayback: vi.fn(() => Promise.resolve()),
  prepareMediaUrl: (path: string) =>
    Promise.resolve({ url: `asset://localhost${path}`, durationSec: null }),
  openMediaFiles: vi.fn(() => Promise.resolve([])),
}));

// A tiny probe button that pushes a live playback report into the context, the
// same way the real <video> element's timeupdate/loadedmetadata handlers would.
function ProgressProbe({ current, duration }: { current: number; duration: number }) {
  const { reportProgress, seekToSec } = useWorkspace();
  return (
    <>
      <button onClick={() => reportProgress(current, duration)}>
        report-progress
      </button>
      <output aria-label="seek-target">{String(seekToSec)}</output>
    </>
  );
}

const renderTransport = (initialActiveMediaId?: string) =>
  render(
    <WorkspaceProvider
      media={fixtureMedia}
      initialActiveMediaId={initialActiveMediaId}
    >
      <TransportBar />
      <Viewport />
      <ProgressProbe current={30} duration={60} />
    </WorkspaceProvider>,
  );

const viewportName = () =>
  within(screen.getByRole("region", { name: /media viewport/i }));

const reportProgress = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "report-progress" }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TransportBar", () => {
  // behavior: renders prev / play / next buttons + a single seek slider (AC-005/AC-007)
  it("should render prev, play-pause and next controls plus a seek slider if mounted", () => {
    renderTransport("v-1");

    expect(
      screen.getByRole("button", { name: /previous/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
    expect(screen.getAllByRole("slider", { name: /seek/i })).toHaveLength(1);
  });

  // behavior: before any report the active readout shows 00:00 / 00:00 (E-3, duration unknown)
  it("should read 00:00 / 00:00 if a video is active but no progress has been reported", () => {
    renderTransport("v-1");

    expect(screen.getByText("00:00 / 00:00")).toBeInTheDocument();
  });

  // behavior: a live progress report of (30,60) drives the readout to 00:30 / 01:00 (AC-006 / TC-004)
  it("should read 00:30 / 01:00 if progress of 30s of 60s is reported", async () => {
    const user = userEvent.setup();
    renderTransport("v-1");

    await reportProgress(user);

    expect(screen.getByText("00:30 / 01:00")).toBeInTheDocument();
  });

  // behavior: empty readout when nothing is active (E-2 / AC-006)
  it("should read --:-- / --:-- if no media is active", () => {
    renderTransport();

    expect(screen.getByText("--:-- / --:--")).toBeInTheDocument();
  });

  // behavior: the seek slider starts at valuenow 0 / valuemax 0 before any report (E-3 / AC-007)
  it("should expose aria-valuenow 0 and aria-valuemax 0 if no progress has been reported", () => {
    renderTransport("v-1");

    const bar = screen.getByRole("slider", { name: /seek/i });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "0");
  });

  // behavior: a (30,60) report sets aria-valuenow=30 and aria-valuemax=60 (AC-007 / TC-004)
  it("should expose aria-valuenow 30 and aria-valuemax 60 if progress of 30s of 60s is reported", async () => {
    const user = userEvent.setup();
    renderTransport("v-1");

    await reportProgress(user);

    const bar = screen.getByRole("slider", { name: /seek/i });
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    expect(bar).toHaveAttribute("aria-valuemax", "60");
  });

  // behavior: the play button toggles to a pause affordance and back (AC-005 / TC-003)
  it("should switch the play button to pause and back if it is clicked twice", async () => {
    const user = userEvent.setup();
    renderTransport("v-1");

    await user.click(screen.getByRole("button", { name: /play/i }));
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /pause/i }));
    expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
  });

  // behavior: next advances the active video to the next list entry (AC-008 / TC-005)
  it("should advance the active video to the next entry if next is clicked", async () => {
    const user = userEvent.setup();
    renderTransport("v-1");

    expect(viewportName().getByText(/1 - Opening/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next/i }));

    // open order: next from "1 - Opening" is "21 - Finale"
    expect(viewportName().getByText(/21 - Finale/i)).toBeInTheDocument();
  });

  // behavior: next wraps from the last entry to the first (E-4)
  it("should wrap to the first entry if next is clicked on the last video", async () => {
    const user = userEvent.setup();
    renderTransport("v-12");

    await user.click(screen.getByRole("button", { name: /next/i }));

    // "12 - Bridge" is last in open order; wraps to first "1 - Opening"
    expect(viewportName().getByText(/1 - Opening/i)).toBeInTheDocument();
  });

  // behavior: prev wraps from the first entry to the last (E-4)
  it("should wrap to the last entry if prev is clicked on the first video", async () => {
    const user = userEvent.setup();
    renderTransport("v-1");

    await user.click(screen.getByRole("button", { name: /previous/i }));

    expect(viewportName().getByText(/12 - Bridge/i)).toBeInTheDocument();
  });

  // behavior: a single-video playlist keeps that video active on next (E-4)
  it("should keep the only video active if next is clicked with a single-video playlist", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={singleMediaList} initialActiveMediaId="solo">
        <TransportBar />
        <Viewport />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(viewportName().getByText(/5 - Lonely/i)).toBeInTheDocument();
  });

  // behavior: clicking the progress bar requests a seek to that position (the
  // viewport then issues mpv seekTo; here we assert the store's seek target)
  it("should request a seek to the clicked position if the progress bar is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-1">
        <TransportBar />
        <Viewport />
        <ProgressProbe current={0} duration={60} />
      </WorkspaceProvider>,
    );

    // load the duration into context so the bar knows the scale
    await user.click(screen.getByRole("button", { name: "report-progress" }));

    const bar = screen.getByRole("slider", { name: /seek/i });
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 100,
      top: 0,
      bottom: 0,
      right: 100,
      height: 4,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    await user.pointer({ target: bar, coords: { clientX: 50, clientY: 0 } });
    await user.pointer({
      keys: "[MouseLeft]",
      target: bar,
      coords: { clientX: 50, clientY: 0 },
    });

    // click at mid-point of a 60s bar -> seek target 30s
    expect(screen.getByLabelText("seek-target")).toHaveTextContent("30");
  });

  // behavior: the bar shows shuffle + repeat controls reflecting state (TC-013 / AC-008)
  it("should render an unpressed shuffle control and a 'Repeat: off' control if mounted", () => {
    renderTransport("v-1");

    const shuffle = screen.getByRole("button", { name: /shuffle/i });
    expect(shuffle).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Repeat: off" }),
    ).toBeInTheDocument();
  });

  // side-effect-contract: clicking shuffle presses it; cycling repeat twice -> name "one" (TC-013 / AC-008)
  it("should press the shuffle control and read 'Repeat: one' if shuffle is clicked and repeat cycled twice", async () => {
    const user = userEvent.setup();
    renderTransport("v-1");

    await user.click(screen.getByRole("button", { name: /shuffle/i }));
    expect(screen.getByRole("button", { name: /shuffle/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const repeat = screen.getByRole("button", { name: "Repeat: off" });
    await user.click(repeat);
    await user.click(screen.getByRole("button", { name: "Repeat: all" }));

    expect(
      screen.getByRole("button", { name: "Repeat: one" }),
    ).toBeInTheDocument();
  });

  // behavior: the bar is a container-query context exposing three labelled zones
  // (playback / controls / meta) so it can reflow by its OWN width, not the
  // viewport's (works regardless of the sidebar's width)
  it("should expose the three transport zones inside a container-query context if mounted", () => {
    renderTransport("v-1");

    const bar = document.querySelector("[data-transport-bar]");
    expect(bar?.className).toContain("@container");
    expect(
      document.querySelector('[data-transport-zone="playback"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-transport-zone="controls"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-transport-zone="meta"]'),
    ).toBeInTheDocument();
  });

  // behavior: the `@2xl:` responsive layout classes MUST live on a DESCENDANT of
  // the `@container` element, never the same node - a container-query variant
  // queries its ANCESTOR container, so a self-container never matches its own
  // width and the wide grid layout would never apply (the bug that flattened the
  // bar to a permanent vertical stack at every width). Assert the container node
  // carries no `@2xl:` class and the grid layout lives on a descendant.
  it("should put the @2xl responsive layout on a descendant of the container, not the container itself", () => {
    renderTransport("v-1");

    const bar = document.querySelector("[data-transport-bar]");
    expect(bar?.className).toContain("@container");
    expect(bar?.className).not.toMatch(/@2xl:/);

    const layout = bar?.querySelector(".grid");
    expect(layout).not.toBeNull();
    expect(layout).not.toBe(bar);
    expect(layout?.className).toMatch(/@2xl:/);
  });

  // behavior: the narrow layout is a two-row grid via grid-template-areas -
  // playback and meta SHARE the top row, the controls (volume) get their own
  // centered row below; the wide layout collapses to one row
  // 'controls playback meta'. Each zone is placed by name, not source order.
  it("should place playback+meta on the top row and controls on a centered row below when narrow", () => {
    renderTransport("v-1");

    const layout = document
      .querySelector("[data-transport-bar]")
      ?.querySelector(".grid");
    const playback = document.querySelector('[data-transport-zone="playback"]');
    const controls = document.querySelector('[data-transport-zone="controls"]');
    const meta = document.querySelector('[data-transport-zone="meta"]');

    // narrow: two rows, controls spans its own row; wide: single row
    expect(layout?.className).toContain(
      "[grid-template-areas:'left_playback_meta'_'controls_controls_controls']",
    );
    expect(layout?.className).toContain(
      "@2xl:[grid-template-areas:'controls_playback_meta']",
    );

    // zones are placed by name
    expect(playback?.className).toContain("[grid-area:playback]");
    expect(meta?.className).toContain("[grid-area:meta]");
    expect(controls?.className).toContain("[grid-area:controls]");
    // the controls row centers its content when narrow, left-aligns when wide
    expect(controls?.className).toContain("justify-center");
    expect(controls?.className).toContain("@2xl:justify-start");
  });

  // behavior: prev/next follow the CURRENT sorted order when a sort key is active (AC-008)
  it("should step to the natural-next video if next is clicked with the title sort key active", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        media={fixtureMedia}
        initialActiveMediaId="v-1"
        initialSortKeys={["title"]}
      >
        <Sidebar />
        <TransportBar />
        <Viewport />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /next/i }));

    // asc order is 1,3,9...; next from "1" is "3 - Intro" (NOT open-order "21")
    expect(viewportName().getByText(/3 - Intro/i)).toBeInTheDocument();
  });
});
