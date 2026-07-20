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
// The fixed mini width - constant across sidebar toggles (must match tauri.ts).
const MINI_WIDTH = 680;

const lastSetSizeArg = (): LogicalSize =>
  setSize.mock.calls.at(-1)![0] as unknown as LogicalSize;

// Layout shorthands: mini = content hidden. "barOnly" = sidebar also hidden,
// "withSidebar" = sidebar shown (reflows into a top bar). "normal" = content on.
const barOnly = { contentVisible: false, sidebarVisible: false };
const withSidebar = { contentVisible: false, sidebarVisible: true };
const normal = { contentVisible: true, sidebarVisible: true };

describe("setMiniWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDomInnerHeight(668);
  });

  afterEach(async () => {
    await setMiniWindow(normal);
    vi.clearAllMocks();
  });

  // behavior: hiding content with the sidebar also hidden shrinks the window to
  // the FIXED mini width (NOT the stashed inner width - so toggling the sidebar
  // later only changes height) by the transport-bar height PLUS the native
  // title-bar deficit; showing content again restores the stashed size
  it("should shrink to the fixed mini width by bar-plus-title-bar height on bar-only then restore when content shown", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));

    await setMiniWindow(barOnly);

    expect(setSize).toHaveBeenCalledTimes(1);
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(MINI_WIDTH, BAR_ONLY_HEIGHT));

    setSize.mockClear();
    await setMiniWindow(normal);

    expect(setSize).toHaveBeenCalledTimes(1);
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, 700));
  });

  // behavior: with no title bar (webview viewport == inner window) the bar-only
  // mini height is exactly the bar height, at the fixed mini width
  it("should use just the bar height for a bar-only mini if there is no title-bar deficit", async () => {
    setDomInnerHeight(700);
    innerSize.mockResolvedValueOnce(physical(1000, 700));

    await setMiniWindow(barOnly);

    expect(setSize).toHaveBeenCalledWith(new LogicalSize(MINI_WIDTH, BAR_HEIGHT));
  });

  // behavior: the mini width is CONSTANT across a sidebar toggle - only the height
  // changes (this is the bug that made the window jump wide when the sidebar was
  // hidden). Bar-only and sidebar-mini must share the exact same width.
  it("should keep the same width when the sidebar is toggled while mini", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));
    await setMiniWindow(withSidebar);
    const withSidebarWidth = lastSetSizeArg().width;

    setSize.mockClear();
    await setMiniWindow(barOnly);
    const barOnlyWidth = lastSetSizeArg().width;

    expect(barOnlyWidth).toBe(withSidebarWidth);
    expect(barOnlyWidth).toBe(MINI_WIDTH);
  });

  // behavior: showing content restores the exact pre-mini inner size captured on
  // the first entry
  it("should restore the remembered pre-mini size if content is shown again", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));
    await setMiniWindow(barOnly);
    setSize.mockClear();

    await setMiniWindow(normal);

    expect(setSize).toHaveBeenCalledTimes(1);
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, 700));
  });

  // behavior: a mini with the sidebar shown sizes to a FIXED width
  // (MINI_PLAYLIST_WIDTH, not the stashed width) and a height that stacks the
  // sidebar-top-bar above the transport bar, so it is strictly taller than the
  // bar-only mini. Exact sidebar-row constants are internal, so the height is
  // pinned relative to the bar-only height, not a guessed pixel total.
  it("should size a sidebar mini to a fixed width and a height taller than bar-only", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));

    await setMiniWindow(withSidebar);

    expect(setSize).toHaveBeenCalledTimes(1);
    const arg = lastSetSizeArg();
    expect(arg.width).toBeGreaterThan(0);
    expect(arg.width).not.toBe(1000);
    expect(arg.height).toBeGreaterThan(BAR_ONLY_HEIGHT);
    expect(arg.height - BAR_ONLY_HEIGHT).toBeGreaterThan(0);
  });

  // behavior: the sidebar-mini width is a constant, independent of the window
  // size stashed on entry - proving it is MINI_PLAYLIST_WIDTH, not the inner width
  it("should use the same sidebar-mini width regardless of the stashed window width", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));
    await setMiniWindow(withSidebar);
    const firstWidth = lastSetSizeArg().width;

    await setMiniWindow(normal);
    setSize.mockClear();

    innerSize.mockResolvedValueOnce(physical(1400, 900));
    await setMiniWindow(withSidebar);
    const secondWidth = lastSetSizeArg().width;

    expect(secondWidth).toBe(firstWidth);
  });

  // behavior: toggling the sidebar WHILE mini (content already hidden) must NOT
  // re-query innerSize/scaleFactor (no re-stash of the already-shrunk geometry) -
  // it just re-sizes to the new mini dims; a later content-show still restores
  // the ORIGINAL stashed size
  it("should not re-stash when the sidebar is toggled while mini and should restore the original size", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));
    await setMiniWindow(barOnly);
    innerSize.mockClear();
    scaleFactor.mockClear();
    setSize.mockClear();

    await setMiniWindow(withSidebar);

    expect(innerSize).not.toHaveBeenCalled();
    expect(scaleFactor).not.toHaveBeenCalled();
    expect(setSize).toHaveBeenCalledTimes(1);
    // resized into the sidebar-mini dims (fixed width, not the stashed 1000)
    expect(lastSetSizeArg().width).not.toBe(1000);

    setSize.mockClear();
    await setMiniWindow(normal);
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, 700));
  });

  // behavior: re-applying the SAME mini layout must NOT re-capture the geometry
  // (which would stash the already-shrunk height and break restore); it re-sizes
  // to the same dims and a later content-show still restores the original
  it("should not re-capture the size if the same mini layout is applied twice", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));
    await setMiniWindow(barOnly);
    innerSize.mockClear();

    await setMiniWindow(barOnly);

    expect(innerSize).not.toHaveBeenCalled();

    await setMiniWindow(normal);
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, 700));
  });

  // edge: showing content without any prior mini entry is a safe no-op
  it("should do nothing if content is shown without a stored size", async () => {
    await setMiniWindow(normal);

    expect(setSize).not.toHaveBeenCalled();
  });
});
