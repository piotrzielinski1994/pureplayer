import { describe, expect, it } from "vitest";

import {
  clampZoom,
  DEFAULT_TRANSFORM,
  FIT_MODES,
  formatTransform,
  isDefaultTransform,
  nextFitMode,
  nextRotation,
  ROTATIONS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from "@/components/workspace/viewport-transform";

describe("viewport-transform constants", () => {
  // behavior: the default transform is rotation 0 / contain / 1x (AC-008 / data model)
  it("should default to rotationDeg 0, fitMode contain and zoom 1 if read", () => {
    expect(DEFAULT_TRANSFORM).toEqual({
      rotationDeg: 0,
      fitMode: "contain",
      zoom: 1,
    });
  });

  // behavior: the zoom range is the documented [1, 4] with a 0.1 step (AC-003 / data model)
  it("should expose ZOOM_MIN 1, ZOOM_MAX 4 and ZOOM_STEP 0.1 if read", () => {
    expect(ZOOM_MIN).toBe(1);
    expect(ZOOM_MAX).toBe(4);
    expect(ZOOM_STEP).toBe(0.1);
  });

  // behavior: the rotation cycle lists the four quarter-turns in clockwise order (AC-001)
  it("should list ROTATIONS as 0, 90, 180, 270 if read", () => {
    expect(ROTATIONS).toEqual([0, 90, 180, 270]);
  });

  // behavior: the fit-mode cycle lists contain, cover, fill in order (AC-002)
  it("should list FIT_MODES as contain, cover, fill if read", () => {
    expect(FIT_MODES).toEqual(["contain", "cover", "fill"]);
  });
});

describe("nextRotation", () => {
  // behavior: rotation advances by one quarter-turn clockwise (AC-001 / TC-001)
  it("should return 90 if the current rotation is 0", () => {
    expect(nextRotation(0)).toBe(90);
  });

  // behavior: rotation advances 90 -> 180 (AC-001 / TC-001)
  it("should return 180 if the current rotation is 90", () => {
    expect(nextRotation(90)).toBe(180);
  });

  // behavior: rotation advances 180 -> 270 (AC-001 / TC-001)
  it("should return 270 if the current rotation is 180", () => {
    expect(nextRotation(180)).toBe(270);
  });

  // behavior: rotation wraps back to 0 after 270 (AC-001 / E-3 / TC-001)
  it("should wrap to 0 if the current rotation is 270", () => {
    expect(nextRotation(270)).toBe(0);
  });
});

describe("nextFitMode", () => {
  // behavior: fit mode advances contain -> cover (AC-002 / TC-002)
  it("should return cover if the current fit mode is contain", () => {
    expect(nextFitMode("contain")).toBe("cover");
  });

  // behavior: fit mode advances cover -> fill (AC-002 / TC-002)
  it("should return fill if the current fit mode is cover", () => {
    expect(nextFitMode("cover")).toBe("fill");
  });

  // behavior: fit mode wraps back to contain after fill (AC-002 / E-4 / TC-002)
  it("should wrap to contain if the current fit mode is fill", () => {
    expect(nextFitMode("fill")).toBe("contain");
  });
});

describe("clampZoom", () => {
  // behavior: a value already inside the band is returned unchanged (AC-003)
  it("should return the zoom unchanged if it is within [1, 4]", () => {
    expect(clampZoom(1.5)).toBe(1.5);
  });

  // behavior: the lower bound floors at 1.0 (AC-003 / E-2 / TC-003)
  it("should clamp to 1 if the zoom is below the lower bound", () => {
    expect(clampZoom(0.5)).toBe(1);
  });

  // behavior: the upper bound ceils at 4.0 (AC-003 / E-2 / TC-003)
  it("should clamp to 4 if the zoom is above the upper bound", () => {
    expect(clampZoom(5)).toBe(4);
  });

  // behavior: float drift from repeated +0.1 steps is removed by 1-decimal rounding (E-2)
  it("should round to 1 decimal if the zoom carries float drift", () => {
    expect(clampZoom(1.2000000003)).toBe(1.2);
  });

  // behavior: a value needing rounding up to 1 decimal is rounded, not truncated (E-2)
  it("should round 1.25 to 1.3 if the zoom needs 1-decimal rounding", () => {
    expect(clampZoom(1.25)).toBe(1.3);
  });

  // behavior: the exact lower bound is preserved (boundary, AC-003)
  it("should return 1 if the zoom is exactly the lower bound", () => {
    expect(clampZoom(1)).toBe(1);
  });

  // behavior: the exact upper bound is preserved (boundary, AC-003)
  it("should return 4 if the zoom is exactly the upper bound", () => {
    expect(clampZoom(4)).toBe(4);
  });
});

describe("isDefaultTransform", () => {
  // behavior: the canonical default is recognised as default (AC-007 / AC-008)
  it("should return true if the transform is the default", () => {
    expect(isDefaultTransform(DEFAULT_TRANSFORM)).toBe(true);
  });

  // behavior: a plain default-shaped object is recognised as default (AC-007)
  it("should return true if every facet equals the default", () => {
    expect(
      isDefaultTransform({ rotationDeg: 0, fitMode: "contain", zoom: 1 }),
    ).toBe(true);
  });

  // behavior: a non-default rotation makes it non-default (AC-007)
  it("should return false if the rotation is not 0", () => {
    expect(
      isDefaultTransform({ rotationDeg: 90, fitMode: "contain", zoom: 1 }),
    ).toBe(false);
  });

  // behavior: a non-default fit mode makes it non-default (AC-007)
  it("should return false if the fit mode is not contain", () => {
    expect(
      isDefaultTransform({ rotationDeg: 0, fitMode: "cover", zoom: 1 }),
    ).toBe(false);
  });

  // behavior: a non-default zoom makes it non-default (AC-007)
  it("should return false if the zoom is not 1", () => {
    expect(
      isDefaultTransform({ rotationDeg: 0, fitMode: "contain", zoom: 1.5 }),
    ).toBe(false);
  });
});

describe("formatTransform", () => {
  // behavior: the default transform formats to the empty string so no readout shows (AC-007 / TC-007)
  it("should return an empty string if the transform is the default", () => {
    expect(formatTransform(DEFAULT_TRANSFORM)).toBe("");
  });

  // behavior: only the rotation facet is named when only rotation is non-default (AC-007)
  it("should name only the rotation if only rotation is non-default", () => {
    expect(
      formatTransform({ rotationDeg: 90, fitMode: "contain", zoom: 1 }),
    ).toBe("90deg");
  });

  // behavior: only the fit-mode facet is named when only fit mode is non-default (AC-007)
  it("should name only the fit mode if only fit mode is non-default", () => {
    expect(formatTransform({ rotationDeg: 0, fitMode: "cover", zoom: 1 })).toBe(
      "cover",
    );
  });

  // behavior: only the zoom facet is named when only zoom is non-default (AC-007 / TC-007)
  it("should name only the zoom if only zoom is non-default", () => {
    expect(
      formatTransform({ rotationDeg: 0, fitMode: "contain", zoom: 1.5 }),
    ).toBe("1.5x");
  });

  // behavior: every non-default facet is named together in rotation/fit/zoom order (AC-007 / Combined state)
  it("should name each non-default facet if rotation, fit and zoom all differ", () => {
    expect(
      formatTransform({ rotationDeg: 90, fitMode: "cover", zoom: 1.5 }),
    ).toBe("90deg cover 1.5x");
  });
});
