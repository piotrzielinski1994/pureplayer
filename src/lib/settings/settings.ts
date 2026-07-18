import {
  SHORTCUT_ACTIONS,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";
import { safeNormalize } from "@/lib/shortcuts/resolve";

export type SortDirection = "asc" | "desc";

export type PanelLayout = Record<string, number>;

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
};

export type SettingsStore = {
  load: () => Promise<Settings>;
  save: (settings: Settings) => Promise<void>;
};

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

function mergeShortcuts(partial: unknown): ShortcutOverrides {
  if (!isRecord(partial)) {
    return {};
  }
  return Object.entries(partial).reduce<ShortcutOverrides>(
    (acc, [rawId, value]) => {
      const id = RENAMED_ACTION_IDS[rawId] ?? rawId;
      if (!ACTION_IDS.has(id) || typeof value !== "string") {
        return acc;
      }
      const normalized = safeNormalize(value);
      return normalized === null ? acc : { ...acc, [id]: normalized };
    },
    {},
  );
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
  };
}
