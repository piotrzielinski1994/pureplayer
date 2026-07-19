import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const setSize = vi.fn(() => Promise.resolve());
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

describe("setMiniWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDomInnerHeight(668);
  });

  afterEach(async () => {
    await setMiniWindow(false);
    vi.clearAllMocks();
  });

  // behavior: entering shrinks the window to the transport-bar height PLUS the
  // native title-bar height (tauri innerSize - webview window.innerHeight). jsdom
  // reports no bar element, so the fallback 48 is the bar height (MP-4). With a
  // 700 inner window whose webview viewport is 668, the title bar is 32 -> 80.
  it("should shrink the window to the bar height plus the title-bar deficit if entering", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));

    await setMiniWindow(true);

    expect(setSize).toHaveBeenCalledTimes(1);
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, 48 + 32));
  });

  // behavior: with no title bar (webview viewport == inner window) the mini height
  // is exactly the bar height (MP-4)
  it("should use just the bar height if there is no title-bar deficit", async () => {
    setDomInnerHeight(700);
    innerSize.mockResolvedValueOnce(physical(1000, 700));

    await setMiniWindow(true);

    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, 48));
  });

  // behavior: exiting restores the exact pre-mini INNER size captured on enter (MP-4)
  it("should restore the remembered pre-mini size if exiting", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));
    await setMiniWindow(true);
    setSize.mockClear();

    await setMiniWindow(false);

    expect(setSize).toHaveBeenCalledTimes(1);
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, 700));
  });

  // behavior: a second enter while already mini is a no-op - it must NOT
  // re-capture (which would save the already-shrunk height and break restore)
  it("should not re-capture the size if entering twice in a row", async () => {
    innerSize.mockResolvedValueOnce(physical(1000, 700));
    await setMiniWindow(true);
    setSize.mockClear();
    innerSize.mockClear();

    await setMiniWindow(true);

    expect(innerSize).not.toHaveBeenCalled();
    expect(setSize).not.toHaveBeenCalled();

    await setMiniWindow(false);
    expect(setSize).toHaveBeenCalledWith(new LogicalSize(1000, 700));
  });

  // behavior: exiting when never entered is a safe no-op
  it("should do nothing if exiting without a stored size", async () => {
    await setMiniWindow(false);

    expect(setSize).not.toHaveBeenCalled();
  });
});
