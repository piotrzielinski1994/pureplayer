import { beforeEach, describe, expect, it, vi } from "vitest";

const setProperty = vi.fn((_name: string, _value: unknown) =>
  Promise.resolve(),
);

vi.mock("tauri-plugin-libmpv-api", () => ({
  command: vi.fn(() => Promise.resolve()),
  getProperty: vi.fn(() => Promise.resolve(null)),
  init: vi.fn(() => Promise.resolve()),
  observeProperties: vi.fn(() => Promise.resolve(() => {})),
  setProperty: (name: string, value: unknown) => setProperty(name, value),
  setVideoMarginRatio: vi.fn(() => Promise.resolve()),
  destroy: vi.fn(() => Promise.resolve()),
}));

import { mpvSetTransform } from "@/lib/mpv";

describe("mpvSetTransform", () => {
  beforeEach(() => {
    setProperty.mockClear();
  });

  it("crops to cover with panscan and zooms in log2 steps", async () => {
    await mpvSetTransform({ rotationDeg: 90, fitMode: "cover", zoom: 2 });

    expect(setProperty.mock.calls).toEqual([
      ["video-rotate", 90],
      ["keepaspect", true],
      ["panscan", 1],
      ["video-zoom", 1],
    ]);
  });

  it("stretches to fill by dropping the aspect ratio", async () => {
    await mpvSetTransform({ rotationDeg: 0, fitMode: "fill", zoom: 1 });

    expect(setProperty.mock.calls).toEqual([
      ["video-rotate", 0],
      ["keepaspect", false],
      ["panscan", 0],
      ["video-zoom", 0],
    ]);
  });
});
