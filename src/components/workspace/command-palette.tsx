import { formatForDisplay } from "@tanstack/hotkeys";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import type { ShortcutAction } from "@/lib/shortcuts/registry";

export type PaletteCommand = {
  action: ShortcutAction;
  binding: string;
  keywords: string[];
  run: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly PaletteCommand[];
};

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: CommandPaletteProps) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No matching commands</CommandEmpty>
        {commands.map(({ action, binding, keywords, run }) => (
          <CommandItem
            key={action.id}
            value={action.name}
            keywords={keywords}
            onSelect={() => {
              run();
              onOpenChange(false);
            }}
          >
            <span>{action.name}</span>
            <CommandShortcut>{formatForDisplay(binding)}</CommandShortcut>
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
