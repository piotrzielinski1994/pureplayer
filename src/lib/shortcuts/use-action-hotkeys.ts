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
  )
    .filter((id) => handlers[id] !== undefined)
    .map((id) => ({
      hotkey: effective[id] as Hotkey,
      callback: () => {
        handlers[id]?.();
      },
    }));

  useHotkeys(definitions, { ignoreInputs: true, preventDefault: true });
}
