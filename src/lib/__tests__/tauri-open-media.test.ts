import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the underlying Tauri dialog primitive; tauri.ts is the SUT.
const open = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => open(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

import { openMediaFiles } from "@/lib/tauri";

type OpenOptions = {
  filters?: { name: string; extensions: string[] }[];
};

describe("openMediaFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // TC-015 (side-effect-contract): the picker opens with a filter set whose
  // extensions include the audio family, not just the video set (AC-001).
  it("should open the dialog with a filter whose extensions include audio types", async () => {
    open.mockResolvedValue([]);

    await openMediaFiles();

    expect(open).toHaveBeenCalledTimes(1);
    const options = open.mock.calls[0][0] as OpenOptions;
    const allExtensions = (options.filters ?? []).flatMap((f) => f.extensions);

    expect(allExtensions).toEqual(expect.arrayContaining(["mp3", "flac"]));
  });

  // TC-015 (side-effect-contract): the existing video extensions remain in the
  // filter alongside audio, so video import is not regressed (AC-001).
  it("should still include the video extensions in the picker filter", async () => {
    open.mockResolvedValue([]);

    await openMediaFiles();

    const options = open.mock.calls[0][0] as OpenOptions;
    const allExtensions = (options.filters ?? []).flatMap((f) => f.extensions);

    expect(allExtensions).toEqual(expect.arrayContaining(["mp4", "mkv"]));
  });
});
