import { describe, expect, it } from "vitest";

import {
  describeElementState,
  formatTimeline,
  type PlaybackMarks,
  resolveDuration,
} from "@/lib/playback-timing";

describe("resolveDuration", () => {
  // behavior: the probed source length wins over a growing HLS playlist duration
  it("should prefer the probed duration if one was reported", () => {
    expect(resolveDuration(52, 13699)).toBe(13699);
  });

  // behavior: no probe duration -> the element's own finite length
  it("should fall back to the element duration if no probe duration exists", () => {
    expect(resolveDuration(52, null)).toBe(52);
  });

  // behavior: neither value usable -> 0 rather than NaN/Infinity in the transport
  it("should return 0 if neither duration is usable", () => {
    expect(resolveDuration(Number.POSITIVE_INFINITY, null)).toBe(0);
  });
});

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
    phases.forEach((ms) => {
      expect(ms).toBeGreaterThanOrEqual(0);
    });
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

describe("describeElementState", () => {
  // behavior: a stalled-but-buffered element is distinguishable from an empty one
  it("should report paused, readyState, time, error and buffered ends", () => {
    expect(
      describeElementState({
        paused: true,
        readyState: 4,
        currentTime: 0,
        errorCode: null,
        bufferedEnds: [4, 8.25],
      }),
    ).toBe(
      "element: paused=true readyState=4 t=0.00s error=none buffered=[4.00,8.25]",
    );
  });

  // behavior: no buffer and a media error code are reported as-is
  it("should report an empty buffer and the media error code", () => {
    expect(
      describeElementState({
        paused: false,
        readyState: 0,
        currentTime: 12.5,
        errorCode: 3,
        bufferedEnds: [],
      }),
    ).toBe("element: paused=false readyState=0 t=12.50s error=3 buffered=[]");
  });
});
