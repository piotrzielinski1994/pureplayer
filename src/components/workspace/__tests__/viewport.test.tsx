import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Viewport } from "@/components/workspace/viewport";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { mpvSeek, mpvSetInvertColors } from "@/lib/mpv";
import { quitApp } from "@/lib/tauri";
import { fixtureMedia } from "./fixtures";

const prepareMediaUrl = vi.fn(
  (
    path: string,
  ): Promise<{
    url: string;
    durationSec: number | null;
    swapId: number | null;
  }> =>
    Promise.resolve({
      url: `asset://localhost${path}`,
      durationSec: null,
      swapId: null,
    }),
);

const toggleFullscreen = vi.fn(() => Promise.resolve());
const logPlayback = vi.fn((message: string) => {
  void message;
  return Promise.resolve();
});
const watchAudioReady = vi.fn(() => Promise.resolve(() => {}));

// MKV plays through the native mpv window, so the mpv surface is stubbed with a
// working player: init succeeds and `track-list` reports two audio tracks and
// one subtitle, like a disc rip. Everything else is a resolved no-op.
const mpvShowText = vi.fn((_message: string, _durationMs: number) =>
  Promise.resolve(),
);
const TRACK_FIXTURE = [
  { id: 1, type: "video", codec: "hevc" },
  {
    id: 2,
    type: "audio",
    codec: "truehd",
    lang: "eng",
    title: "Atmos 7.1",
    default: true,
  },
  { id: 3, type: "audio", codec: "ac3", lang: "eng", title: "AC-3 5.1" },
  {
    id: 4,
    type: "sub",
    codec: "hdmv_pgs_subtitle",
    lang: "eng",
    title: "SDH",
  },
];

const mpvGetProperty = vi.fn((name: string): Promise<unknown> => {
  if (name === "track-list/count") {
    return Promise.resolve(TRACK_FIXTURE.length);
  }
  const match = name.match(/^track-list\/(\d+)\/(.+)$/);
  if (match) {
    const entry = TRACK_FIXTURE[Number(match[1])] as
      | Record<string, unknown>
      | undefined;
    if (!entry) {
      return Promise.resolve(null);
    }
    const field = match[2];
    if (field === "id") return Promise.resolve(entry.id ?? null);
    if (field === "type") return Promise.resolve(entry.type ?? null);
    if (field === "codec") return Promise.resolve(entry.codec ?? null);
    if (field === "lang") return Promise.resolve(entry.lang ?? null);
    if (field === "title") return Promise.resolve(entry.title ?? null);
    if (field === "default") {
      return Promise.resolve(entry.default === true);
    }
    if (field === "forced") {
      return Promise.resolve(entry.forced === true);
    }
  }
  return Promise.resolve(null);
});

vi.mock("@/lib/mpv", () => ({
  ensureMpv: vi.fn(() => Promise.resolve(true)),
  mpvLoadFile: vi.fn(() => Promise.resolve()),
  mpvPlay: vi.fn(() => Promise.resolve()),
  mpvPause: vi.fn(() => Promise.resolve()),
  mpvSeek: vi.fn(() => Promise.resolve()),
  mpvSetVolume: vi.fn(() => Promise.resolve()),
  mpvSetMuted: vi.fn(() => Promise.resolve()),
  mpvSetSpeed: vi.fn(() => Promise.resolve()),
  mpvSetSubtitle: vi.fn(() => Promise.resolve()),
  mpvSetAudio: vi.fn(() => Promise.resolve()),
  mpvSetMargins: vi.fn(() => Promise.resolve()),
  mpvSetInvertColors: vi.fn(() => Promise.resolve()),
  mpvShowText: (message: string, durationMs: number) =>
    mpvShowText(message, durationMs),
  getProperty: (name: string) => mpvGetProperty(name),
  observeProperties: vi.fn(() => Promise.resolve(() => {})),
  mpvDestroyAndReset: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/tauri", () => ({
  quitApp: vi.fn(() => Promise.resolve()),
  takePendingOpenPaths: vi.fn(() => Promise.resolve([])),
  watchOpenPaths: vi.fn(() => Promise.resolve(() => {})),
  prepareMediaUrl: (path: string) => prepareMediaUrl(path),
  openMediaFiles: vi.fn(() => Promise.resolve([])),
  toggleFullscreen: () => toggleFullscreen(),
  logPlayback: (message: string) => logPlayback(message),
  watchAudioReady: () => watchAudioReady(),
}));

function SelectButton({ id }: { id: string }) {
  const { selectNode } = useWorkspace();
  return <button onClick={() => selectNode(id)}>select-{id}</button>;
}

function PlayingProbe() {
  const { isPlaying } = useWorkspace();
  return <output aria-label="playing">{String(isPlaying)}</output>;
}

function CycleRepeatButton() {
  const { cycleRepeat } = useWorkspace();
  return <button onClick={() => cycleRepeat()}>cycle-repeat</button>;
}

function TogglePlayButton() {
  const { togglePlay } = useWorkspace();
  return <button onClick={() => togglePlay()}>toggle-play</button>;
}

function InvertColorsButton() {
  const { toggleInvertColors } = useWorkspace();
  return <button onClick={() => toggleInvertColors()}>invert-colors</button>;
}

function AcceptResumeButton() {
  const { acceptResume } = useWorkspace();
  return <button onClick={() => acceptResume()}>accept-resume</button>;
}

function VolumeButtons() {
  const { changeVolume, toggleMute } = useWorkspace();
  return (
    <>
      <button onClick={() => changeVolume(-0.1)}>volume-down</button>
      <button onClick={() => toggleMute()}>mute</button>
    </>
  );
}

function SidebarProbe() {
  const { isSidebarVisible } = useWorkspace();
  return <output aria-label="sidebar">{String(isSidebarVisible)}</output>;
}

function DurationProbe() {
  const { playbackDurationSec } = useWorkspace();
  return <output aria-label="duration">{playbackDurationSec}</output>;
}

const region = () => screen.getByRole("region", { name: /media viewport/i });
const findVideo = async () => {
  await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
  return document.querySelector("video") as HTMLVideoElement;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Viewport", () => {
  // behavior: active video renders inside an accessible region (AC-004)
  it("should expose an accessible video-viewport region if mounted", () => {
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
      </WorkspaceProvider>,
    );

    expect(region()).toBeInTheDocument();
  });

  // behavior: active video renders a real <video> element once prepared (AC-004)
  it("should render a video element if a video is active", async () => {
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
      </WorkspaceProvider>,
    );

    await findVideo();
  });

  // behavior: the file is prepared (probe/transcode) and its result is the <video> src (AC-003/AC-004)
  it("should source the video from the prepared url of the active path if a video is active", async () => {
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
      </WorkspaceProvider>,
    );

    await waitFor(() =>
      expect(prepareMediaUrl).toHaveBeenCalledWith("/media/3 - Intro.mov"),
    );
    const video = await findVideo();
    expect(video.getAttribute("src")).toContain(
      "asset://localhost/media/3 - Intro.mov",
    );
  });

  // behavior: switching the active video prepares + sources the NEW file (AC-005)
  it("should source the newly selected file if selection switches", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
        <SelectButton id="v-9" />
      </WorkspaceProvider>,
    );

    await findVideo();
    await user.click(screen.getByRole("button", { name: "select-v-9" }));

    await waitFor(() => {
      const video = document.querySelector("video");
      expect(video?.getAttribute("src")).toContain("9 - Interlude.webm");
    });
  });

  // behavior: a preparing state shows while the file is probed/transcoded (AC-004)
  it("should show a preparing state before the source is ready", async () => {
    let resolvePrepare: (source: {
      url: string;
      durationSec: number | null;
      swapId: number | null;
    }) => void = () => {};
    prepareMediaUrl.mockReturnValueOnce(
      new Promise<{
        url: string;
        durationSec: number | null;
        swapId: number | null;
      }>((resolve) => {
        resolvePrepare = resolve;
      }),
    );
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
      </WorkspaceProvider>,
    );

    expect(within(region()).getByText(/preparing/i)).toBeInTheDocument();

    resolvePrepare({
      url: "asset://localhost/media/3 - Intro.mov",
      durationSec: null,
      swapId: null,
    });
    await findVideo();
  });

  // behavior: HLS streams report element.duration as Infinity, so the probed
  // duration is used for the readout instead of the bogus element value
  it("should report the probed duration if the element duration is not finite", async () => {
    prepareMediaUrl.mockResolvedValueOnce({
      url: "http://localhost:5000/0/index.m3u8",
      durationSec: 1922.581,
      swapId: null,
    });
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
        <DurationProbe />
      </WorkspaceProvider>,
    );

    const video = await findVideo();
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: Infinity,
    });
    fireEvent(video, new Event("loadedmetadata"));

    await waitFor(() =>
      expect(screen.getByLabelText("duration").textContent).toBe("1922.581"),
    );
  });

  // behavior: a prepare failure surfaces an error, never a silent black screen (AC-004)
  it("should show an error message if preparing the file fails", async () => {
    prepareMediaUrl.mockRejectedValueOnce(new Error("ffmpeg transcode failed"));
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
      </WorkspaceProvider>,
    );

    await waitFor(() =>
      expect(within(region()).getByText(/could not play/i)).toBeInTheDocument(),
    );
  });

  // behavior: one playback-timeline line is logged on first frame, and only once
  // even if canplay re-fires (AC-010/AC-012)
  it("should log a single playback timeline on the first canplay if the video becomes ready", async () => {
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
      </WorkspaceProvider>,
    );

    const video = await findVideo();
    fireEvent(video, new Event("canplay"));
    fireEvent(video, new Event("canplay"));

    await waitFor(() => expect(logPlayback).toHaveBeenCalledTimes(1));
    expect(logPlayback.mock.calls[0][0]).toContain('playback "3 - Intro"');
    expect(logPlayback.mock.calls[0][0]).toContain("total");
  });

  // behavior: a prepare failure logs a failure marker, not a timeline (AC-012)
  it("should log a prepare-failure marker if preparing the file fails", async () => {
    prepareMediaUrl.mockRejectedValueOnce(new Error("ffmpeg transcode failed"));
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
      </WorkspaceProvider>,
    );

    await waitFor(() =>
      expect(logPlayback).toHaveBeenCalledWith(
        'playback "3 - Intro": prepare FAILED',
      ),
    );
  });

  // behavior: switching while playing plays the new source once its data loads
  it("should play the new source on loadeddata if switched while playing", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
        <SelectButton id="v-9" />
      </WorkspaceProvider>,
    );

    await findVideo();
    await user.click(screen.getByRole("button", { name: "select-v-9" }));

    const video = await findVideo();
    fireEvent.loadedData(video);

    expect(video.paused).toBe(false);
  });

  // behavior: a volume change shows the new level in the top-right corner (F3)
  it("should show the volume level in the corner overlay if the volume changes", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
        <VolumeButtons />
      </WorkspaceProvider>,
    );
    await findVideo();
    expect(screen.queryByTestId("corner-overlay")).toBeNull();

    await user.click(screen.getByRole("button", { name: "volume-down" }));

    expect(screen.getByTestId("corner-overlay")).toHaveTextContent(
      "Volume: 90%",
    );
  });

  // behavior: muting shows "Muted" in the same corner slot (F3)
  it("should show Muted in the corner overlay if the volume is muted", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
        <VolumeButtons />
      </WorkspaceProvider>,
    );
    await findVideo();

    await user.click(screen.getByRole("button", { name: "mute" }));

    expect(screen.getByTestId("corner-overlay")).toHaveTextContent("Muted");
  });

  // behavior: the native mpv window hides HTML overlays, so the level goes to
  // the mpv OSD, aligned top-right (F3)
  it("should show the volume level through the mpv osd if an mkv is active", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-12">
        <Viewport />
        <VolumeButtons />
      </WorkspaceProvider>,
    );
    await waitFor(() =>
      expect(mpvGetProperty).toHaveBeenCalledWith("track-list/0/id"),
    );

    await user.click(screen.getByRole("button", { name: "volume-down" }));

    await waitFor(() =>
      expect(mpvShowText).toHaveBeenCalledWith(
        expect.stringMatching(/\\an9.*Volume: 90%$/),
        expect.any(Number),
      ),
    );
  });

  // behavior: repeat-one replays the finished video - on ended the same element seeks
  // to 0 AND resumes playback even though isPlaying was already true (FR-4 repeat-one).
  it("should resume playback from 0 on ended if repeat is one", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
        <CycleRepeatButton />
        <TogglePlayButton />
      </WorkspaceProvider>,
    );

    const video = await findVideo();
    await user.click(screen.getByRole("button", { name: "cycle-repeat" }));
    await user.click(screen.getByRole("button", { name: "cycle-repeat" }));
    // Start playback so isPlaying is ALREADY true when the video ends - the real
    // repeat-one path (the bug: flipping isPlaying true->true won't re-fire play).
    await user.click(screen.getByRole("button", { name: "toggle-play" }));

    fireEvent.loadedData(video);
    // A real browser PAUSES the element when it fires `ended`; jsdom doesn't, so
    // pause it explicitly to reproduce the post-end paused state before replaying.
    video.pause();
    fireEvent.ended(video);

    await waitFor(() => expect(video.currentTime).toBe(0));
    expect(video.paused).toBe(false);
  });

  // behavior: the resume prompt does not touch playback until it is accepted,
  // and an acceptance that arrives after the media loaded still seeks (the
  // chosen position goes through the normal seek path)
  it("should seek a loaded video to the accepted resume position", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        media={fixtureMedia}
        initialActiveMediaId="v-3"
        initialProgress={{
          "/media/3 - Intro.mov": {
            positionSec: 42,
            durationSec: 100,
            updatedAtMs: 1,
          },
        }}
      >
        <Viewport />
        <AcceptResumeButton />
      </WorkspaceProvider>,
    );

    const video = await findVideo();
    expect(video.currentTime).toBe(0);
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: HTMLMediaElement.HAVE_METADATA,
    });
    await user.click(screen.getByRole("button", { name: "accept-resume" }));

    await waitFor(() => expect(video.currentTime).toBe(42));
  });

  // behavior: mpv can only seek a queued file, so an acceptance that arrives
  // after loadfile resolved seeks the live mpv instance
  it("should seek mpv to the accepted resume position if an mkv is active", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        media={fixtureMedia}
        initialActiveMediaId="v-12"
        initialProgress={{
          "/media/12 - Bridge.mkv": {
            positionSec: 42,
            durationSec: 100,
            updatedAtMs: 1,
          },
        }}
      >
        <Viewport />
        <AcceptResumeButton />
      </WorkspaceProvider>,
    );

    await waitFor(() =>
      expect(mpvGetProperty).toHaveBeenCalledWith("track-list/0/id"),
    );
    await user.click(screen.getByRole("button", { name: "accept-resume" }));

    await waitFor(() => expect(mpvSeek).toHaveBeenCalledWith(42));
  });

  // behavior: loading an mkv reads the track list for the track pickers, but
  // never dumps it into mpv's OSD (the listing covered the video on every load)
  it("should keep the mkv track list out of the osd if an mkv loads in mpv", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
        <SelectButton id="v-12" />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "select-v-12" }));

    await waitFor(() =>
      expect(mpvGetProperty).toHaveBeenCalledWith("track-list/0/id"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mpvShowText).not.toHaveBeenCalled();
  });

  // behavior: the mpv path inverts via mpv's own filter, since an HTML overlay
  // (CSS filter) is hidden behind the native mpv window (CLAUDE.md playback rule)
  it("should invert colors through mpv's negate filter if an mkv is active", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
        <SelectButton id="v-12" />
        <InvertColorsButton />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "select-v-12" }));
    await waitFor(() =>
      expect(mpvGetProperty).toHaveBeenCalledWith("track-list/0/id"),
    );

    await user.click(screen.getByRole("button", { name: "invert-colors" }));

    await waitFor(() => expect(mpvSetInvertColors).toHaveBeenCalledWith(true));
  });

  // behavior: the active video's name is shown in the viewport once ready (AC-004)
  it("should show the active video's name if a video is active", async () => {
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
      </WorkspaceProvider>,
    );

    await waitFor(() =>
      expect(within(region()).getByText(/3 - Intro/i)).toBeInTheDocument(),
    );
  });

  // behavior: the title overlay auto-hides after 5s of playback (AC-018)
  it("should hide the active video's name after 5 seconds", async () => {
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
      </WorkspaceProvider>,
    );

    await waitFor(() =>
      expect(within(region()).getByText(/3 - Intro/i)).toBeInTheDocument(),
    );

    await waitFor(
      () =>
        expect(
          within(region()).queryByText(/3 - Intro/i),
        ).not.toBeInTheDocument(),
      { timeout: 6000 },
    );
  }, 8000);

  // behavior: switching the active video re-shows the title for the new file (AC-018)
  it("should re-show the title if the active video switches after the timeout", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
        <SelectButton id="v-9" />
      </WorkspaceProvider>,
    );

    await waitFor(() =>
      expect(within(region()).getByText(/3 - Intro/i)).toBeInTheDocument(),
    );
    await waitFor(
      () =>
        expect(
          within(region()).queryByText(/3 - Intro/i),
        ).not.toBeInTheDocument(),
      { timeout: 6000 },
    );

    await user.click(screen.getByRole("button", { name: "select-v-9" }));

    await waitFor(() =>
      expect(within(region()).getByText(/9 - Interlude/i)).toBeInTheDocument(),
    );
  }, 8000);

  // side-effect-contract: double-clicking the viewport toggles native fullscreen (AC-006)
  it("should call toggleFullscreen once if the viewport is double-clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
      </WorkspaceProvider>,
    );

    await user.dblClick(region());

    expect(toggleFullscreen).toHaveBeenCalledTimes(1);
  });

  // side-effect-contract: a single click on the viewport toggles play/pause
  it("should toggle play to pause if the viewport is single-clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
        <PlayingProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByLabelText("playing")).toHaveTextContent("false");

    await user.click(region());

    await waitFor(() =>
      expect(screen.getByLabelText("playing")).toHaveTextContent("true"),
    );
  });

  // side-effect-contract: a double-click must NOT leave a stray single-click toggle behind
  it("should not toggle play if the viewport is double-clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
        <PlayingProbe />
      </WorkspaceProvider>,
    );

    await user.dblClick(region());

    expect(screen.getByLabelText("playing")).toHaveTextContent("false");
  });

  // behavior: a single click with no active video is a safe no-op
  it("should not throw and stay paused if the viewport is single-clicked with no active video", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia}>
        <Viewport />
        <PlayingProbe />
      </WorkspaceProvider>,
    );

    await user.click(region());

    expect(screen.getByLabelText("playing")).toHaveTextContent("false");
  });

  // behavior: right-clicking the video opens a context menu with a quit option
  // (there is no other way out when the window chrome is hidden)
  it("should show a quit option on right-click if a video is active", async () => {
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
      </WorkspaceProvider>,
    );

    fireEvent.contextMenu(region());

    expect(
      await screen.findByRole("menuitem", { name: /quit/i }),
    ).toBeInTheDocument();
  });

  // behavior: the context menu toggles the sidebar, so a hidden sidebar has a
  // mouse path back (F5)
  it.each([
    [false, /hide sidebar/i, "false"],
    [true, /show sidebar/i, "true"],
  ])(
    "should toggle the sidebar from the context menu if it starts hidden=%s",
    async (hidden, label, expected) => {
      const user = userEvent.setup();
      render(
        <WorkspaceProvider
          media={fixtureMedia}
          initialActiveMediaId="v-3"
          initialSidebarHidden={hidden}
        >
          <Viewport />
          <SidebarProbe />
        </WorkspaceProvider>,
      );

      fireEvent.contextMenu(region());
      await user.click(await screen.findByRole("menuitem", { name: label }));

      expect(screen.getByLabelText("sidebar")).toHaveTextContent(expected);
    },
  );

  // side-effect-contract: choosing the quit option closes the app
  it("should quit the app if the context menu quit option is chosen", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <Viewport />
      </WorkspaceProvider>,
    );

    fireEvent.contextMenu(region());
    await user.click(await screen.findByRole("menuitem", { name: /quit/i }));

    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  // behavior: the quit option must stay reachable even with nothing loaded -
  // the empty viewport is exactly where no video chrome exists to escape from
  it("should show a quit option on right-click if no media is active", async () => {
    render(
      <WorkspaceProvider media={fixtureMedia}>
        <Viewport />
      </WorkspaceProvider>,
    );

    fireEvent.contextMenu(region());

    expect(
      await screen.findByRole("menuitem", { name: /quit/i }),
    ).toBeInTheDocument();
  });

  // behavior: empty state placeholder + no <video> when nothing is active (Empty)
  it("should render a no-video placeholder and no media element if no media is active", () => {
    const { container } = render(
      <WorkspaceProvider media={fixtureMedia}>
        <Viewport />
      </WorkspaceProvider>,
    );

    expect(within(region()).getByText(/no media/i)).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
  });
});
