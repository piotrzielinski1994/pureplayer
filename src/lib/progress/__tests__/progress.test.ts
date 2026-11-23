import { describe, expect, it } from "vitest";
import {
  clearProgress,
  isVideoFormat,
  type ProgressMap,
  parseProgressFile,
  recordProgress,
  resumePosition,
} from "@/lib/progress/progress";

const entry = (
  positionSec: number,
  durationSec: number,
  updatedAtMs = 1000,
) => ({ positionSec, durationSec, updatedAtMs });

describe("isVideoFormat", () => {
  it("accepts every video format", () => {
    for (const format of ["MP4", "MKV", "MOV", "WEBM", "AVI"] as const) {
      expect(isVideoFormat(format)).toBe(true);
    }
  });

  it("rejects every audio format", () => {
    for (const format of [
      "MP3",
      "M4A",
      "AAC",
      "FLAC",
      "WAV",
      "OGG",
      "OPUS",
      "WMA",
    ] as const) {
      expect(isVideoFormat(format)).toBe(false);
    }
  });
});

describe("recordProgress", () => {
  it("records the first position for a file", () => {
    const map = recordProgress({}, "/v/a.mp4", 42, 100, 1000);
    expect(map).toEqual({ "/v/a.mp4": entry(42, 100, 1000) });
  });

  it("skips a write when the position moved less than the save interval", () => {
    const base: ProgressMap = { "/v/a.mp4": entry(42, 100, 1000) };
    expect(recordProgress(base, "/v/a.mp4", 44, 100, 2000)).toBeNull();
  });

  it("writes once the position moved by the save interval", () => {
    const base: ProgressMap = { "/v/a.mp4": entry(42, 100, 1000) };
    const map = recordProgress(base, "/v/a.mp4", 47.5, 100, 2000);
    expect(map?.["/v/a.mp4"]).toEqual(entry(47.5, 100, 2000));
  });

  it("skips a write before the duration is known", () => {
    expect(recordProgress({}, "/v/a.mp4", 10, 0, 1000)).toBeNull();
    expect(recordProgress({}, "/v/a.mp4", 10, Number.NaN, 1000)).toBeNull();
  });

  it("clamps a position past the duration", () => {
    const map = recordProgress({}, "/v/a.mp4", 120, 100, 1000);
    expect(map?.["/v/a.mp4"]?.positionSec).toBe(100);
  });

  it("keeps the existing entries untouched", () => {
    const base: ProgressMap = { "/v/b.mp4": entry(10, 100) };
    const map = recordProgress(base, "/v/a.mp4", 42, 100, 1000);
    expect(map?.["/v/b.mp4"]).toEqual(entry(10, 100));
  });
});

describe("resumePosition", () => {
  it("returns 0 without an entry", () => {
    expect(resumePosition(undefined)).toBe(0);
  });

  it("returns the saved position mid-file", () => {
    expect(resumePosition(entry(42, 100))).toBe(42);
  });

  it("returns 0 below the minimum resume position", () => {
    expect(resumePosition(entry(3, 100))).toBe(0);
  });

  it("returns 0 within the end tolerance", () => {
    expect(resumePosition(entry(97, 100))).toBe(0);
  });

  it("returns 0 for a malformed position", () => {
    expect(resumePosition(entry(Number.NaN, 100))).toBe(0);
  });
});

describe("clearProgress", () => {
  it("drops the entry", () => {
    const base: ProgressMap = {
      "/v/a.mp4": entry(42, 100),
      "/v/b.mp4": entry(10, 100),
    };
    const map = clearProgress(base, "/v/a.mp4");
    expect(map).toEqual({ "/v/b.mp4": entry(10, 100) });
  });

  it("returns the same map when the path is absent", () => {
    const base: ProgressMap = { "/v/b.mp4": entry(10, 100) };
    expect(clearProgress(base, "/v/a.mp4")).toBe(base);
  });
});

describe("parseProgressFile", () => {
  it("loads a valid payload", () => {
    const raw = {
      version: 1,
      entries: {
        "/v/a.mp4": { positionSec: 42, durationSec: 100, updatedAtMs: 1 },
      },
    };
    expect(parseProgressFile(raw)).toEqual({ "/v/a.mp4": entry(42, 100, 1) });
  });

  it("drops entries with invalid numbers", () => {
    const raw = {
      version: 1,
      entries: {
        "/v/a.mp4": { positionSec: "42", durationSec: 100, updatedAtMs: 1 },
        "/v/b.mp4": { positionSec: 42, durationSec: 100, updatedAtMs: 1 },
      },
    };
    expect(parseProgressFile(raw)).toEqual({ "/v/b.mp4": entry(42, 100, 1) });
  });

  it("discards a payload from another version", () => {
    const raw = { version: 2, entries: { "/v/a.mp4": entry(42, 100) } };
    expect(parseProgressFile(raw)).toEqual({});
  });

  it("discards a malformed payload", () => {
    expect(parseProgressFile(null)).toEqual({});
    expect(parseProgressFile("nope")).toEqual({});
    expect(parseProgressFile({ version: 1, entries: [] })).toEqual({});
  });
});
