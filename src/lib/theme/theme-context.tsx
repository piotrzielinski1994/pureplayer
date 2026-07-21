import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSettings } from "@/lib/settings/settings-context";
import type { ThemeColors, ThemeMode } from "@/lib/settings/settings";
import {
  resolveEffectiveMode,
  type EffectiveMode,
} from "@/lib/theme/effective-mode";
import { applyDefaults } from "@/lib/theme/overrides";
import { applyThemeVars } from "@/lib/theme/apply-vars";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";

type ThemeContextValue = {
  mode: ThemeMode;
  effectiveMode: EffectiveMode;
  setMode: (mode: ThemeMode) => void;
  colors: ThemeColors;
  effectiveColors: ThemeColors;
  setColors: (colors: ThemeColors) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

function getPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia(MEDIA_QUERY).matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, saveThemeMode, saveThemeColors } = useSettings();
  const mode = settings.theme.mode;
  const colors = settings.theme.colors;

  const [prefersDark, setPrefersDark] = useState(getPrefersDark);

  useLayoutEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const mql = window.matchMedia(MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent) =>
      setPrefersDark(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const effectiveMode = resolveEffectiveMode(mode, prefersDark);

  const effectiveColors = useMemo(
    () => applyDefaults(colors, DEFAULT_THEME_COLORS),
    [colors],
  );

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", effectiveMode === "dark");
    applyThemeVars(
      document.documentElement,
      effectiveMode,
      colors[effectiveMode],
    );
  }, [effectiveMode, colors]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      effectiveMode,
      setMode: saveThemeMode,
      colors,
      effectiveColors,
      setColors: saveThemeColors,
    }),
    [mode, effectiveMode, saveThemeMode, colors, effectiveColors, saveThemeColors],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return value;
}

export function useThemeOptional(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
