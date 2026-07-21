import { describe, expect, it } from "vitest";

import { resolveEffectiveMode } from "@/lib/theme/effective-mode";

// Stage 1 - Themes. Pure resolution of the chosen mode -> the concrete effective
// mode actually applied to the DOM (.dark or not): equal to the chosen mode
// unless the mode is "system", in which case it follows the OS prefers-color-scheme
// flag.

describe("resolveEffectiveMode", () => {
  // behavior: light resolves to light no matter what the OS prefers (AC-001)
  it("should resolve light to light if the OS prefers dark", () => {
    expect(resolveEffectiveMode("light", true)).toBe("light");
  });

  // behavior: light stays light when the OS prefers light too (AC-001)
  it("should resolve light to light if the OS prefers light", () => {
    expect(resolveEffectiveMode("light", false)).toBe("light");
  });

  // behavior: dark resolves to dark no matter what the OS prefers (AC-002)
  it("should resolve dark to dark if the OS prefers light", () => {
    expect(resolveEffectiveMode("dark", false)).toBe("dark");
  });

  // behavior: dark stays dark when the OS prefers dark too (AC-002)
  it("should resolve dark to dark if the OS prefers dark", () => {
    expect(resolveEffectiveMode("dark", true)).toBe("dark");
  });

  // behavior: system follows the OS preference - dark when it prefers dark (AC-003)
  it("should resolve system to dark if the OS prefers dark", () => {
    expect(resolveEffectiveMode("system", true)).toBe("dark");
  });

  // behavior: system follows the OS preference - light otherwise (AC-003)
  it("should resolve system to light if the OS does not prefer dark", () => {
    expect(resolveEffectiveMode("system", false)).toBe("light");
  });
});
