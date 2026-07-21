import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import type {
  ThemeColorOverrides,
  ThemeColors,
  ThemeMode,
} from "@/lib/settings/settings";
import { jsonEditorExtensions } from "@/lib/theme/editor-theme";
import { applyDefaults, diffOverrides } from "@/lib/theme/overrides";
import { useTheme } from "@/lib/theme/theme-context";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

function isOverridesShape(value: unknown): value is ThemeColorOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

function parseThemeColors(text: string): ThemeColors | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as { light?: unknown; dark?: unknown };
    if (!isOverridesShape(record.light) || !isOverridesShape(record.dark)) {
      return null;
    }
    return parsed as ThemeColors;
  } catch {
    return null;
  }
}

function ColorEditor() {
  const { colors, effectiveMode, setColors } = useTheme();
  const effective = applyDefaults(colors, DEFAULT_THEME_COLORS);
  const [text, setText] = useState(() => JSON.stringify(effective, null, 2));

  const parsed = parseThemeColors(text);
  const extensions = useMemo(
    () => jsonEditorExtensions(effectiveMode === "dark"),
    [effectiveMode],
  );

  return (
    <div className="mt-2 flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">
        Customize colors per mode. Each token shows its current value; edit a
        value to override it, or set it back to the default to clear the
        override.
      </span>
      <div className="h-64 border border-border">
        <CodeEditor
          value={text}
          onChange={setText}
          extensions={extensions}
          ariaLabel="Theme colors JSON"
        />
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={parsed === null}
          onClick={() =>
            parsed !== null &&
            setColors(diffOverrides(parsed, DEFAULT_THEME_COLORS))
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}

export function ThemeSection() {
  const { mode, setMode } = useTheme();

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-medium">Theme</h2>
      <span className="text-xs text-muted-foreground">
        Choose the app appearance, or follow your OS preference.
      </span>
      <div className="mt-2 flex">
        {MODES.map((option) => {
          const isActive = mode === option.id;
          return (
            <Button
              key={option.id}
              type="button"
              variant={isActive ? "default" : "outline"}
              aria-pressed={isActive}
              className="border-0 border-l border-l-border first:border-l-0"
              onClick={() => setMode(option.id)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
      <ColorEditor />
    </section>
  );
}
