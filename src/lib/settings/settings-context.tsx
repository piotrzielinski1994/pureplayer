import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_SETTINGS,
  type PanelLayout,
  type Settings,
  type SettingsStore,
  type SortDirection,
  type ThemeColors,
  type ThemeMode,
} from "@/lib/settings/settings";
import { log } from "@/lib/logging/log";
import type { ShortcutActionId } from "@/lib/shortcuts/registry";

type SettingsContextValue = {
  settings: Settings;
  saveShortcut: (id: ShortcutActionId, hotkey: string) => void;
  resetShortcut: (id: ShortcutActionId) => void;
  saveLayout: (layout: PanelLayout) => void;
  saveVolume: (volume: number) => void;
  saveMuted: (isMuted: boolean) => void;
  savePlaybackRate: (rate: number) => void;
  saveSidebarHidden: (hidden: boolean) => void;
  saveTransportHidden: (hidden: boolean) => void;
  saveRevealTransportOnHover: (reveal: boolean) => void;
  saveSortDirection: (direction: SortDirection) => void;
  saveThemeMode: (mode: ThemeMode) => void;
  saveThemeColors: (colors: ThemeColors) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

type SettingsProviderProps = {
  store: SettingsStore;
  children: ReactNode;
};

export function SettingsProvider({ store, children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let isMounted = true;
    log.info("settings: loading persisted settings");
    store.load().then((loaded) => {
      if (isMounted) {
        log.info("settings: loaded");
        setSettings(loaded);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [store]);

  const update = useCallback(
    (mutate: (base: Settings) => Settings) => {
      log.info("settings: saving");
      setSettings((current) => {
        const next = mutate(current ?? DEFAULT_SETTINGS);
        void store.save(next);
        return next;
      });
    },
    [store],
  );

  const saveShortcut = useCallback(
    (id: ShortcutActionId, hotkey: string) => {
      log.info(`settings: shortcut ${id}=${hotkey}`);
      update((base) => ({
        ...base,
        shortcuts: { ...base.shortcuts, [id]: [hotkey] },
      }));
    },
    [update],
  );

  const resetShortcut = useCallback(
    (id: ShortcutActionId) => {
      log.info(`settings: shortcut ${id} reset to default`);
      update((base) => ({
        ...base,
        shortcuts: Object.fromEntries(
          Object.entries(base.shortcuts).filter(([key]) => key !== id),
        ),
      }));
    },
    [update],
  );

  const saveLayout = useCallback(
    (layout: PanelLayout) => {
      log.debug("settings: panel layout changed");
      update((base) => ({ ...base, layout }));
    },
    [update],
  );

  const saveVolume = useCallback(
    (volume: number) => {
      log.debug(`settings: volume=${volume}`);
      update((base) => ({ ...base, volume }));
    },
    [update],
  );

  const saveMuted = useCallback(
    (isMuted: boolean) => {
      log.debug(`settings: muted=${isMuted}`);
      update((base) => ({ ...base, isMuted }));
    },
    [update],
  );

  const savePlaybackRate = useCallback(
    (playbackRate: number) => {
      log.debug(`settings: playback rate=${playbackRate}`);
      update((base) => ({ ...base, playbackRate }));
    },
    [update],
  );

  const saveSidebarHidden = useCallback(
    (sidebarHidden: boolean) => {
      log.debug(`settings: sidebar hidden=${sidebarHidden}`);
      update((base) => ({ ...base, sidebarHidden }));
    },
    [update],
  );

  const saveTransportHidden = useCallback(
    (transportHidden: boolean) => {
      log.debug(`settings: transport hidden=${transportHidden}`);
      update((base) => ({ ...base, transportHidden }));
    },
    [update],
  );

  const saveRevealTransportOnHover = useCallback(
    (revealTransportOnHover: boolean) => {
      log.info(`settings: reveal transport on hover=${revealTransportOnHover}`);
      update((base) => ({ ...base, revealTransportOnHover }));
    },
    [update],
  );

  const saveSortDirection = useCallback(
    (sortDirection: SortDirection) => {
      log.debug(`settings: sort direction=${sortDirection}`);
      update((base) => ({ ...base, sortDirection }));
    },
    [update],
  );

  const saveThemeMode = useCallback(
    (mode: ThemeMode) => {
      log.info(`settings: theme mode=${mode}`);
      update((base) => ({ ...base, theme: { ...base.theme, mode } }));
    },
    [update],
  );

  const saveThemeColors = useCallback(
    (colors: ThemeColors) => {
      log.info("settings: theme colors changed");
      update((base) => ({ ...base, theme: { ...base.theme, colors } }));
    },
    [update],
  );

  const value = useMemo<SettingsContextValue | null>(
    () =>
      settings === null
        ? null
        : {
            settings,
            saveShortcut,
            resetShortcut,
            saveLayout,
            saveVolume,
            saveMuted,
            savePlaybackRate,
            saveSidebarHidden,
            saveTransportHidden,
            saveRevealTransportOnHover,
            saveSortDirection,
            saveThemeMode,
            saveThemeColors,
          },
    [
      settings,
      saveShortcut,
      resetShortcut,
      saveLayout,
      saveVolume,
      saveMuted,
      savePlaybackRate,
      saveSidebarHidden,
      saveTransportHidden,
      saveRevealTransportOnHover,
      saveSortDirection,
      saveThemeMode,
      saveThemeColors,
    ],
  );

  if (value === null) {
    return null;
  }

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return value;
}
