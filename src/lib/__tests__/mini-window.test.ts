import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const setSize = vi.fn<(size: LogicalSize) => Promise<void>>(() =>
  Promise.resolve(),
);
const innerSize = vi.fn();
const scaleFactor = vi.fn(() => Promise.resolve(1));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setSize, innerSize, scaleFactor }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));

import { setMiniWindow } from "@/lib/tauri";
import { LogicalSize } from "@tauri-apps/api/dpi";

const physical = (width: number, height: number) => ({
  toLogical: () => new LogicalSize(width, height),
});

const setDomInnerHeight = (height: number) => {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
};

// The jsdom DOM reports no transport-bar element, so the module falls back to
// its intrinsic bar-height constant (48). With a 700-tall inner window whose
// webview viewport is 668, the native title bar is 700 - 668 = 32.
const BAR_HEIGHT = 48;
const TITLE_BAR = 32;
const BAR_ONLY_HEIGHT = BAR_HEIGHT + TITLE_BAR;

const lastSetSizeArg = (): LogicalSize =>
  setSize.mock.calls.at(-1)![0] as unknown as LogicalSize;

describe("setMiniWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDomInnerHeight(668);
  });

  afterEach(async () => {
    await setMiniWindow("off");
    vi.clearAllMocks();
  });

  // behavior: entering bar-mini shrinks the window to the transport-bar height
  // PLUS the native title-bar deficit at the stashed inner width, and a
  // subsequent "off" restores the stashed size (round-trip proves "off" is a
  // real exit, not just another truthy enter) (AC-009 / TC-009)
  it("should shrink to the stashed width by bar-plus-title-bar height on bar then restore on off", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));

    await setMiniWindow("bar");

    expect(setSize).toHaveBeenCalledTimes(1);
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, BAR_ONLY_HEIGHT));

    setSize.mockClear();
    await setMiniWindow("off");

    expect(setSize).toHaveBeenCalledTimes(1);
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, 700));
  });

  // behavior: with no title bar (webview viewport == inner window) the bar-mini
  // height is exactly the bar height (AC-009)
  it("should use just the bar height for bar-mini if there is no title-bar deficit", async () => {
    setDomInnerHeight(700);
    innerSize.mockResolvedValueOnce(physical(1000, 700));

    await setMiniWindow("bar");

    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, BAR_HEIGHT));
  });

  // behavior: exiting to "off" restores the exact pre-mini inner size captured
  // on the first entry (AC-009)
  it("should restore the remembered pre-mini size if exiting to off", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));
    await setMiniWindow("bar");
    setSize.mockClear();

    await setMiniWindow("off");

    expect(setSize).toHaveBeenCalledTimes(1);
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, 700));
  });

  // TC-009 (mini-window): playlist-mini sizes to a FIXED width (MINI_PLAYLIST_WIDTH,
  // not the stashed width) and a height that stacks the sidebar on top of the bar,
  // so it is strictly taller than the bar-only mini. Exact sidebar-row constants
  // are internal, so the height is pinned relative to the bar-only height rather
  // than to a guessed pixel total. (AC-009)
  it("should size playlist-mini to a fixed width and a height taller than bar-only if entering playlist", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));

    await setMiniWindow("playlist");

    expect(setSize).toHaveBeenCalledTimes(1);
    const arg = lastSetSizeArg();
    // fixed MINI_PLAYLIST_WIDTH, independent of the stashed 1000 width
    expect(arg.width).toBeGreaterThan(0);
    expect(arg.width).not.toBe(1000);
    // sidebar stacked above the bar (+ title bar) => strictly taller than bar-only
    expect(arg.height).toBeGreaterThan(BAR_ONLY_HEIGHT);
    // the extra beyond bar + title bar is the sidebar block (positive)
    expect(arg.height - BAR_ONLY_HEIGHT).toBeGreaterThan(0);
  });

  // TC-009 (mini-window): the playlist width is a constant, independent of the
  // window size stashed on entry - proving it is MINI_PLAYLIST_WIDTH and not the
  // remembered inner width (AC-009)
  it("should use the same playlist width regardless of the stashed window width", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));
    await setMiniWindow("playlist");
    const firstWidth = lastSetSizeArg().width;

    await setMiniWindow("off");
    setSize.mockClear();

    innerSize.mockResolvedValueOnce(physical(1400, 900));
    await setMiniWindow("playlist");
    const secondWidth = lastSetSizeArg().width;

    expect(secondWidth).toBe(firstWidth);
  });

  // TC-010 (mini-window, direct switch): after entering bar-mini, switching
  // straight to playlist-mini must NOT re-query innerSize/scaleFactor (no
  // re-stash of the already-shrunk geometry); a later "off" still restores the
  // ORIGINAL stashed size (AC-009, AC-004)
  it("should not re-stash on a direct bar-to-playlist switch and restore the original size on off", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));
    await setMiniWindow("bar");
    innerSize.mockClear();
    scaleFactor.mockClear();
    setSize.mockClear();

    await setMiniWindow("playlist");

    expect(innerSize).not.toHaveBeenCalled();
    expect(scaleFactor).not.toHaveBeenCalled();
    // still resized into playlist dims (fixed width, not the stashed 1000)
    expect(setSize).toHaveBeenCalledTimes(1);
    expect(lastSetSizeArg().width).not.toBe(1000);

    setSize.mockClear();
    await setMiniWindow("off");
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, 700));
  });

  // behavior: re-entering the SAME mini mode is a no-op - it must NOT re-capture
  // (which would stash the already-shrunk height and break restore) (AC-009)
  it("should not re-capture the size if entering bar twice in a row", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));
    await setMiniWindow("bar");
    setSize.mockClear();
    innerSize.mockClear();

    await setMiniWindow("bar");

    expect(innerSize).not.toHaveBeenCalled();
    expect(setSize).not.toHaveBeenCalled();

    await setMiniWindow("off");
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, 700));
  });

  // TC-011 (mini-window, edge): "off" without a prior enter is a safe no-op
  it("should do nothing if exiting to off without a stored size", async () => {
    await setMiniWindow("off");

    expect(setSize).not.toHaveBeenCalled();
  });
});
