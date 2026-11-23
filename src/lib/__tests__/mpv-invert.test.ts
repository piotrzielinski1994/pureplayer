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

import { mpvSetInvertColors } from "@/lib/mpv";

describe("mpvSetInvertColors", () => {
  beforeEach(() => {
    setProperty.mockClear();
  });

  it("switches to copy hwdec before adding the negate filter", async () => {
    await mpvSetInvertColors(true);

    expect(setProperty.mock.calls).toEqual([
      ["hwdec", "auto-copy"],
      ["vf", "negate"],
    ]);
  });

  it("restores zero-copy hwdec after clearing the filter", async () => {
    await mpvSetInvertColors(false);

    expect(setProperty.mock.calls).toEqual([
      ["vf", ""],
      ["hwdec", "auto-safe"],
    ]);
  });
});
