import type { SettingsStore as GenericSettingsStore } from "@pziel/pureui";

import {
  SHORTCUT_ACTIONS,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";
import { safeNormalize } from "@/lib/shortcuts/resolve";

export type SortDirection = "asc" | "desc";

export type PanelLayout = Record<string, number>;

export type ThemeMode = "light" | "dark" | "system";

export type AppTokenName =
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "popover"
  | "popover-foreground"
  | "primary"
  | "primary-foreground"
  | "secondary"
  | "secondary-foreground"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "destructive"
  | "border"
  | "input"
  | "ring";

// Sparse per-mode override map. An absent key means "use the built-in default
// for that token in that mode" (defaults live in src/lib/theme/theme-defaults).
export type ThemeColorOverrides = Partial<Record<AppTokenName, string>>;

export type ThemeColors = {
  light: ThemeColorOverrides;
  dark: ThemeColorOverrides;
};

// The complete (non-sparse) built-in default set: every token present in both
// modes. Assignable to ThemeColors, so it flows into applyDefaults/diffOverrides.
export type FullThemeColors = {
  light: Record<AppTokenName, string>;
  dark: Record<AppTokenName, string>;
};

export type ThemeSettings = {
  mode: ThemeMode;
  colors: ThemeColors;
};

export type Settings = {
  version: 1;
  shortcuts: ShortcutOverrides;
  layout: PanelLayout;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  sidebarHidden: boolean;
  transportHidden: boolean;
  revealTransportOnHover: boolean;
  sortDirection: SortDirection;
  theme: ThemeSettings;
};

export type SettingsStore = GenericSettingsStore<Settings>;

const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];

function emptyThemeColors(): ThemeColors {
  return { light: {}, dark: {} };
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  shortcuts: {},
  layout: {},
  volume: 1,
  isMuted: false,
  playbackRate: 1,
  sidebarHidden: false,
  transportHidden: false,
  revealTransportOnHover: true,
  sortDirection: "asc",
  theme: { mode: "system", colors: emptyThemeColors() },
};

const ACTION_IDS = new Set<string>(SHORTCUT_ACTIONS.map((action) => action.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeLayout(partial: unknown): PanelLayout {
  if (!isRecord(partial)) {
    return {};
  }
  const allNumbers = Object.values(partial).every(
    (size) => typeof size === "number",
  );
  return allNumbers ? (partial as PanelLayout) : {};
}

// Legacy action ids renamed in the audio-player rename (video -> media). A
// persisted override under the old id is migrated to the new one so a user's
// saved rebind survives the upgrade instead of silently reverting to default.
const RENAMED_ACTION_IDS: Record<string, string> = {
  "next-video": "next-media",
  "prev-video": "prev-media",
};

// A legacy single stored hotkey migrates to a one-element list; a list keeps only
// the entries that normalize. An empty list is preserved - the action was
// deliberately disabled. A value that is neither a string nor an array is dropped.
function mergeShortcutValue(value: unknown): string[] | null {
  if (typeof value === "string") {
    const normalized = safeNormalize(value);
    return normalized === null ? null : [normalized];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .map((entry) => (typeof entry === "string" ? safeNormalize(entry) : null))
    .filter((entry): entry is string => entry !== null);
}

function mergeShortcuts(partial: unknown): ShortcutOverrides {
  if (!isRecord(partial)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(partial).flatMap(([rawId, value]) => {
      const id = RENAMED_ACTION_IDS[rawId] ?? rawId;
      if (!ACTION_IDS.has(id)) {
        return [];
      }
      const bindings = mergeShortcutValue(value);
      return bindings === null ? [] : [[id, bindings] as const];
    }),
  );
}

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.includes(value as ThemeMode);
}

const APP_TOKEN_NAMES = new Set<string>([
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
]);

function mergeTokenMap(value: unknown): ThemeColorOverrides {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [AppTokenName, string] =>
        APP_TOKEN_NAMES.has(entry[0]) && typeof entry[1] === "string",
    ),
  );
}

function mergeThemeColors(value: unknown): ThemeColors {
  if (!isRecord(value)) {
    return emptyThemeColors();
  }
  return {
    light: mergeTokenMap(value.light),
    dark: mergeTokenMap(value.dark),
  };
}

function mergeTheme(defaults: ThemeSettings, partial: unknown): ThemeSettings {
  if (!isRecord(partial)) {
    return defaults;
  }
  return {
    mode: isThemeMode(partial.mode) ? partial.mode : defaults.mode,
    colors: mergeThemeColors(partial.colors),
  };
}

export function mergeSettings(defaults: Settings, partial: unknown): Settings {
  if (!isRecord(partial)) {
    return defaults;
  }
  if (partial.version !== undefined && partial.version !== defaults.version) {
    return defaults;
  }
  return {
    version: defaults.version,
    shortcuts: mergeShortcuts(partial.shortcuts),
    layout: mergeLayout(partial.layout),
    volume:
      typeof partial.volume === "number" ? partial.volume : defaults.volume,
    isMuted:
      typeof partial.isMuted === "boolean" ? partial.isMuted : defaults.isMuted,
    playbackRate:
      typeof partial.playbackRate === "number"
        ? partial.playbackRate
        : defaults.playbackRate,
    sidebarHidden:
      typeof partial.sidebarHidden === "boolean"
        ? partial.sidebarHidden
        : defaults.sidebarHidden,
    transportHidden:
      typeof partial.transportHidden === "boolean"
        ? partial.transportHidden
        : defaults.transportHidden,
    revealTransportOnHover:
      typeof partial.revealTransportOnHover === "boolean"
        ? partial.revealTransportOnHover
        : defaults.revealTransportOnHover,
    sortDirection:
      partial.sortDirection === "asc" || partial.sortDirection === "desc"
        ? partial.sortDirection
        : defaults.sortDirection,
    theme: mergeTheme(defaults.theme, partial.theme),
  };
}
