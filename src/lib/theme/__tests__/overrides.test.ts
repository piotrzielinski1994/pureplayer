import { describe, it, expect } from "vitest";

import { applyDefaults, diffOverrides } from "@/lib/theme/overrides";
import type { FullThemeColors, ThemeColors } from "@/lib/settings/settings";

// Stage 2 - Themes feature. overrides.ts is pure:
//  - applyDefaults(sparse, defaults) -> the FULL effective set (defaults with the
//    sparse overrides layered on top), used to seed the editor + apply to the DOM.
//  - diffOverrides(edited, defaults) -> the SPARSE diff (only entries differing
//    from the default; whitespace-insensitive oklch compare), so an un-customized
//    token tracks the built-in default and editing a token back to default drops
//    it (AC-007 / AC-008 sparse-store = per-token reset).
// Round-trip: diffOverrides(applyDefaults(x, d), d) deep-equals x.
// PP model is FLATTENED: a mode's overrides are a flat token->oklch map (no
// tokens/editor wrapper, no editor tokens).

// A small, self-contained defaults table (not the real one) so the test pins the
// pure layering/diff behavior, not the canonical values.
const DEFAULTS: FullThemeColors = {
  light: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: "oklch(0.205 0 0)",
  },
  dark: {
    background: "oklch(0.145 0 0)",
    foreground: "oklch(0.985 0 0)",
    primary: "oklch(0.922 0 0)",
  },
} as unknown as FullThemeColors;

const emptyColors = (): ThemeColors => ({ light: {}, dark: {} });

describe("applyDefaults", () => {
  // AC-005 - behavior: an overridden token wins; the others fall back to default.
  it("should layer a sparse override over the defaults", () => {
    const sparse: ThemeColors = {
      light: { primary: "oklch(0.55 0.22 27)" },
      dark: {},
    };

    const effective = applyDefaults(sparse, DEFAULTS);

    expect(effective.light.primary).toBe("oklch(0.55 0.22 27)");
    expect(effective.light.background).toBe(DEFAULTS.light.background);
    expect(effective.light.foreground).toBe(DEFAULTS.light.foreground);
  });

  // AC-007 - behavior: the full effective set carries EVERY default token (so all
  // tokens are discoverable in the seeded editor).
  it("should return the full set when no overrides are present", () => {
    const effective = applyDefaults(emptyColors(), DEFAULTS);

    expect(effective.light).toEqual(DEFAULTS.light);
    expect(effective.dark).toEqual(DEFAULTS.dark);
  });

  // AC-005 - behavior: overrides for the two modes are independent.
  it("should keep the two modes independent when only one is overridden", () => {
    const sparse: ThemeColors = {
      light: { primary: "oklch(0.55 0.22 27)" },
      dark: {},
    };

    const effective = applyDefaults(sparse, DEFAULTS);

    expect(effective.light.primary).toBe("oklch(0.55 0.22 27)");
    expect(effective.dark.primary).toBe(DEFAULTS.dark.primary);
  });
});

describe("diffOverrides", () => {
  // AC-007 - behavior: only entries differing from the default are kept.
  it("should keep only the tokens that differ from the default", () => {
    const edited = applyDefaults(
      { light: { primary: "oklch(0.55 0.22 27)" }, dark: {} },
      DEFAULTS,
    );

    const diff = diffOverrides(edited, DEFAULTS);

    expect(diff.light).toEqual({ primary: "oklch(0.55 0.22 27)" });
    expect(diff.light.background).toBeUndefined();
    expect(diff.dark).toEqual({});
  });

  // AC-008 - behavior: a token edited BACK to its default drops out (the reset).
  it("should drop a token whose value equals the built-in default", () => {
    const edited: ThemeColors = {
      // primary set BACK to the exact default => must not be stored.
      light: { primary: DEFAULTS.light.primary },
      dark: {},
    };

    const diff = diffOverrides(edited, DEFAULTS);

    expect(diff.light.primary).toBeUndefined();
    expect(diff.light).toEqual({});
  });

  // AC-008 - behavior: whitespace-insensitive compare treats spacing variants as
  // equal (so a re-formatted-but-equal value is treated as a reset, not a diff).
  it("should treat a whitespace-only variant of the default as equal and drop it", () => {
    const edited: ThemeColors = {
      // default is "oklch(1 0 0)"; same value with extra spaces must be dropped.
      light: { background: "oklch(1  0   0)" },
      dark: {},
    };

    const diff = diffOverrides(edited, DEFAULTS);

    expect(diff.light.background).toBeUndefined();
  });

  // AC-008 - behavior: a genuinely different value (despite shared prefix) stays.
  it("should keep a value that differs from the default after whitespace normalization", () => {
    const edited: ThemeColors = {
      light: { background: "oklch(0.99 0 0)" },
      dark: {},
    };

    const diff = diffOverrides(edited, DEFAULTS);

    expect(diff.light.background).toBe("oklch(0.99 0 0)");
  });
});

describe("diffOverrides / applyDefaults round-trip", () => {
  // AC-007, AC-008 - behavior: diff(apply(x, d), d) deep-equals x for a
  // representative sparse x spanning tokens in both modes.
  it("should round-trip a representative sparse override set", () => {
    const sparse: ThemeColors = {
      light: { primary: "oklch(0.55 0.22 27)" },
      dark: { background: "oklch(0.12 0 0)" },
    };

    const roundTripped = diffOverrides(applyDefaults(sparse, DEFAULTS), DEFAULTS);

    expect(roundTripped).toEqual(sparse);
  });

  // AC-007 - behavior: an empty sparse set survives the round-trip as empty (no
  // default leaks into the stored diff).
  it("should round-trip an empty sparse set to empty", () => {
    const roundTripped = diffOverrides(
      applyDefaults(emptyColors(), DEFAULTS),
      DEFAULTS,
    );

    expect(roundTripped).toEqual(emptyColors());
  });
});
