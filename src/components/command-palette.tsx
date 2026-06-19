import { useState } from "react";
import { useHotkeys } from "@tanstack/react-hotkeys";

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useHotkeys([{ hotkey: "Mod+K", callback: () => setIsOpen((open) => !open) }], {
    ignoreInputs: true,
  });

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-32"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm text-muted-foreground">
          Command palette (placeholder)
        </p>
      </div>
    </div>
  );
}
