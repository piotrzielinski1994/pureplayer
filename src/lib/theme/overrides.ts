import type {
  AppTokenName,
  FullThemeColors,
  ThemeColorOverrides,
  ThemeColors,
} from "@/lib/settings/settings";

// Whitespace-insensitive compare so a re-formatted-but-equal oklch string is
// treated as equal (and therefore dropped from the diff = a per-token reset).
function sameColor(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}

function mergeSection(
  overrides: ThemeColorOverrides,
  defaults: Record<AppTokenName, string>,
): ThemeColorOverrides {
  return { ...defaults, ...overrides };
}

// The full effective set: every default token, with the sparse overrides layered
// on top. Used to seed the editor and to apply to the DOM.
export function applyDefaults(
  overrides: ThemeColors,
  defaults: FullThemeColors,
): ThemeColors {
  return {
    light: mergeSection(overrides.light, defaults.light),
    dark: mergeSection(overrides.dark, defaults.dark),
  };
}

function diffSection(
  edited: ThemeColorOverrides,
  defaults: Record<AppTokenName, string>,
): ThemeColorOverrides {
  return Object.fromEntries(
    Object.entries(edited).filter(
      (entry): entry is [AppTokenName, string] =>
        entry[1] !== undefined &&
        !sameColor(entry[1], defaults[entry[0] as AppTokenName]),
    ),
  );
}

// The sparse diff: only entries differing from the built-in default survive, so
// an un-customized token tracks the default and a token edited back to default
// drops out (AC-007 / AC-008).
export function diffOverrides(
  edited: ThemeColors,
  defaults: FullThemeColors,
): ThemeColors {
  return {
    light: diffSection(edited.light, defaults.light),
    dark: diffSection(edited.dark, defaults.dark),
  };
}
