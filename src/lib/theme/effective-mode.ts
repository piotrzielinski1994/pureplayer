import type { ThemeMode } from "@/lib/settings/settings";

export type EffectiveMode = "light" | "dark";

export function resolveEffectiveMode(
  mode: ThemeMode,
  prefersDark: boolean,
): EffectiveMode {
  if (mode === "system") {
    return prefersDark ? "dark" : "light";
  }
  return mode;
}
