/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { AppTokenName } from "@/lib/settings/settings";
import { APP_TOKENS, DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";

// Stage 2 - Themes feature. theme-defaults.ts is the single source of truth for
// the built-in (non-sparse) color values. Light values mirror the canonical
// `:root`, dark mirror `.dark`. Those tokens live in
// @pziel/pureui/styles/theme.css (imported by src/index.css); read it off disk
// to cross-check (vitest mocks css imports to empty, so a normal import returns
// nothing; the file-local node reference keeps node types out of the app's
// tsconfig). PP's model is FLATTENED: DEFAULT_THEME_COLORS.light is a flat
// token->oklch map (no tokens/editor wrapper, no editor tokens - editor theming
// is out of scope).
const nodeRequire = createRequire(import.meta.url);
const indexCss = readFileSync(
  nodeRequire.resolve("@pziel/pureui/styles/theme.css"),
  "utf8",
);

// All 18 app tokens (spec §5.1).
const EXPECTED_APP_TOKENS: AppTokenName[] = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
];

// Pull a `--token: value;` declaration out of the `:root {...}` or `.dark {...}`
// block in index.css, whitespace-normalized.
function cssVar(block: ":root" | ".dark", token: string): string {
  const start = indexCss.indexOf(`${block} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = indexCss.slice(start).split("}")[0];
  const match = body.match(new RegExp(`--${token}:\\s*([^;]+);`));
  expect(match).not.toBeNull();
  return (match![1] ?? "").trim();
}

const norm = (value: string): string => value.replace(/\s+/g, " ").trim();

describe("APP_TOKENS", () => {
  // behavior: the customizable set is exactly the 18 known app token names (AC-007, spec §5.1).
  it("should list exactly the 18 known app token names", () => {
    expect([...APP_TOKENS].sort()).toEqual([...EXPECTED_APP_TOKENS].sort());
    expect(APP_TOKENS).toHaveLength(18);
  });
});

describe("DEFAULT_THEME_COLORS app tokens", () => {
  // behavior: a full (non-sparse) default for every app token in the light mode,
  // so an un-overridden token always has a built-in target (AC-007).
  it("should have all 18 app tokens for the light mode", () => {
    for (const token of EXPECTED_APP_TOKENS) {
      expect(DEFAULT_THEME_COLORS.light[token]).toBeTypeOf("string");
    }
    expect(Object.keys(DEFAULT_THEME_COLORS.light).sort()).toEqual(
      [...EXPECTED_APP_TOKENS].sort(),
    );
  });

  // behavior: a full (non-sparse) default for every app token in the dark mode (AC-007).
  it("should have all 18 app tokens for the dark mode", () => {
    for (const token of EXPECTED_APP_TOKENS) {
      expect(DEFAULT_THEME_COLORS.dark[token]).toBeTypeOf("string");
    }
    expect(Object.keys(DEFAULT_THEME_COLORS.dark).sort()).toEqual(
      [...EXPECTED_APP_TOKENS].sort(),
    );
  });

  // behavior: the stored values are oklch(...) strings (spec §5.1).
  it("should give every light app token a valid oklch(...) string", () => {
    for (const token of EXPECTED_APP_TOKENS) {
      expect(DEFAULT_THEME_COLORS.light[token]).toMatch(/^oklch\(.+\)$/);
    }
  });

  it("should give every dark app token a valid oklch(...) string", () => {
    for (const token of EXPECTED_APP_TOKENS) {
      expect(DEFAULT_THEME_COLORS.dark[token]).toMatch(/^oklch\(.+\)$/);
    }
  });

  // side-effect-contract: light values mirror index.css `:root` (AC-007).
  it("should mirror the index.css :root --background for light background", () => {
    expect(norm(DEFAULT_THEME_COLORS.light.background)).toBe(
      norm(cssVar(":root", "background")),
    );
  });

  it("should mirror the index.css :root --primary for light primary", () => {
    expect(norm(DEFAULT_THEME_COLORS.light.primary)).toBe(
      norm(cssVar(":root", "primary")),
    );
  });

  // side-effect-contract: dark values mirror index.css `.dark` (AC-007).
  it("should mirror the index.css .dark --background for dark background", () => {
    expect(norm(DEFAULT_THEME_COLORS.dark.background)).toBe(
      norm(cssVar(".dark", "background")),
    );
  });

  // side-effect-contract: the dark border alpha (`oklch(1 0 0 / 10%)`) survives verbatim.
  it("should mirror the index.css .dark --border alpha value for dark border", () => {
    expect(norm(DEFAULT_THEME_COLORS.dark.border)).toBe(
      norm(cssVar(".dark", "border")),
    );
  });
});
