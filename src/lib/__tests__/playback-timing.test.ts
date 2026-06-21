import { describe, it, expect } from "vitest";

import { formatTimeline, type PlaybackMarks } from "@/lib/playback-timing";

describe("formatTimeline", () => {
  // behavior: AC-011 - the captured marks format to the exact one-line timeline naming prepare/element-load/total ms
  it("should format the exact timeline string if marks are known", () => {
    const marks: PlaybackMarks = {
      activatedAtMs: 1000,
      prepareResolvedAtMs: 3100,
      firstFrameAtMs: 8900,
    };

    expect(formatTimeline("clip.mkv", marks)).toBe(
      'playback "clip.mkv": prepare 2100ms | element-load 5800ms | total 7900ms',
    );
  });

  // behavior: AC-011 - sub-millisecond marks are rounded to integer ms (Math.round) before formatting
  it("should round sub-millisecond marks to integer ms if marks are fractional", () => {
    const marks: PlaybackMarks = {
      activatedAtMs: 1000.4,
      prepareResolvedAtMs: 3100.9,
      firstFrameAtMs: 8900.1,
    };

    // prepare = 3100.9 - 1000.4 = 2100.5 -> 2101
    // element-load = 8900.1 - 3100.9 = 5799.2 -> 5799
    // total = 8900.1 - 1000.4 = 7899.7 -> 7900
    expect(formatTimeline("clip.mkv", marks)).toBe(
      'playback "clip.mkv": prepare 2101ms | element-load 5799ms | total 7900ms',
    );
  });

  // behavior: AC-011 - two equal marks yield a zero-duration phase, not a missing one
  it("should report a zero-duration phase if two marks are equal", () => {
    const marks: PlaybackMarks = {
      activatedAtMs: 1000,
      prepareResolvedAtMs: 3100,
      firstFrameAtMs: 3100,
    };

    expect(formatTimeline("clip.mkv", marks)).toBe(
      'playback "clip.mkv": prepare 2100ms | element-load 0ms | total 2100ms',
    );
  });

  // behavior: AC-011 - monotonic marks never produce a negative duration
  it("should never produce a negative duration if marks are monotonic", () => {
    const marks: PlaybackMarks = {
      activatedAtMs: 500,
      prepareResolvedAtMs: 500,
      firstFrameAtMs: 500,
    };

    const line = formatTimeline("clip.mkv", marks);

    expect(line).not.toMatch(/-\d/);

    const phases = [...line.matchAll(/(\d+)ms/g)].map((m) => Number(m[1]));
    expect(phases).toHaveLength(3);
    phases.forEach((ms) => expect(ms).toBeGreaterThanOrEqual(0));
  });

  // behavior: AC-010/AC-013 - the provided video name is named verbatim in the line
  it("should include the provided video name if a name is given", () => {
    const marks: PlaybackMarks = {
      activatedAtMs: 0,
      prepareResolvedAtMs: 100,
      firstFrameAtMs: 300,
    };

    expect(formatTimeline("some weird name.mov", marks)).toContain(
      '"some weird name.mov"',
    );
  });
});
