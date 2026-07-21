import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
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
    store.load().then((loaded) => {
      if (isMounted) {
        setSettings(loaded);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [store]);

  const update = useCallback(
    (mutate: (base: Settings) => Settings) => {
      setSettings((current) => {
        const next = mutate(current ?? DEFAULT_SETTINGS);
        store.save(next);
        return next;
      });
    },
    [store],
  );

  const saveShortcut = useCallback(
    (id: ShortcutActionId, hotkey: string) =>
      update((base) => ({
        ...base,
        shortcuts: { ...base.shortcuts, [id]: hotkey },
      })),
    [update],
  );

  const resetShortcut = useCallback(
    (id: ShortcutActionId) =>
      update((base) => ({
        ...base,
        shortcuts: Object.fromEntries(
          Object.entries(base.shortcuts).filter(([key]) => key !== id),
        ),
      })),
    [update],
  );

  const saveLayout = useCallback(
    (layout: PanelLayout) => update((base) => ({ ...base, layout })),
    [update],
  );

  const saveVolume = useCallback(
    (volume: number) => update((base) => ({ ...base, volume })),
    [update],
  );

  const saveMuted = useCallback(
    (isMuted: boolean) => update((base) => ({ ...base, isMuted })),
    [update],
  );

  const savePlaybackRate = useCallback(
    (playbackRate: number) => update((base) => ({ ...base, playbackRate })),
    [update],
  );

  const saveSidebarHidden = useCallback(
    (sidebarHidden: boolean) => update((base) => ({ ...base, sidebarHidden })),
    [update],
  );

  const saveTransportHidden = useCallback(
    (transportHidden: boolean) =>
      update((base) => ({ ...base, transportHidden })),
    [update],
  );

  const saveRevealTransportOnHover = useCallback(
    (revealTransportOnHover: boolean) =>
      update((base) => ({ ...base, revealTransportOnHover })),
    [update],
  );

  const saveSortDirection = useCallback(
    (sortDirection: SortDirection) =>
      update((base) => ({ ...base, sortDirection })),
    [update],
  );

  const saveThemeMode = useCallback(
    (mode: ThemeMode) =>
      update((base) => ({ ...base, theme: { ...base.theme, mode } })),
    [update],
  );

  const saveThemeColors = useCallback(
    (colors: ThemeColors) =>
      update((base) => ({ ...base, theme: { ...base.theme, colors } })),
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
