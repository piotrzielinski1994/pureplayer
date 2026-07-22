import type { Hotkey } from "@tanstack/hotkeys";
import { type UseHotkeyDefinition, useHotkeys } from "@tanstack/react-hotkeys";
import { useSettings } from "@/lib/settings/settings-context";
import type { ShortcutActionId } from "@/lib/shortcuts/registry";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

export function useActionHotkeys(
  handlers: Partial<Record<ShortcutActionId, () => void>>,
): void {
  const { settings } = useSettings();
  const effective = resolveShortcuts(settings.shortcuts);

  const definitions: UseHotkeyDefinition[] = (
    Object.keys(handlers) as ShortcutActionId[]
  ).flatMap((id) =>
    effective[id].map((hotkey) => ({
      hotkey: hotkey as Hotkey,
      callback: () => {
        handlers[id]?.();
      },
    })),
  );

  useHotkeys(definitions, { ignoreInputs: true, preventDefault: true });
}
