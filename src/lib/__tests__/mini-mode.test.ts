import { describe, it, expect } from "vitest";

import { nextMiniMode, type MiniMode, type MiniTarget } from "@/lib/mini-mode";

describe("nextMiniMode", () => {
  // behavior: the reducer returns the toggled target unless it is already the
  // current mode, in which case it collapses back to "off" (AC-001, AC-004)
  const cases: { current: MiniMode; target: MiniTarget; expected: MiniMode }[] =
    [
      { current: "off", target: "bar", expected: "bar" },
      { current: "off", target: "playlist", expected: "playlist" },
      { current: "bar", target: "bar", expected: "off" },
      { current: "playlist", target: "playlist", expected: "off" },
      { current: "bar", target: "playlist", expected: "playlist" },
      { current: "playlist", target: "bar", expected: "bar" },
    ];

  it.each(cases)(
    "should return $expected if current is $current and target is $target",
    ({ current, target, expected }) => {
      expect(nextMiniMode(current, target)).toBe(expected);
    },
  );
});
