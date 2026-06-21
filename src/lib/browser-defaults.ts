type ShortcutModifiers = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

type GuardTarget = {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
};

// Browser-reserved combos to swallow so the WKWebView doesn't reload, zoom,
// open find, print, save the page, or show source inside the app. OS-level
// combos (quit/close/minimize) and text editing (copy/paste/cut/select-all/
// undo/redo) are deliberately absent so they keep working.
const RESERVED_KEYS = new Set([
  "r",
  "=",
  "+",
  "-",
  "_",
  "0",
  "f",
  "g",
  "p",
  "s",
  "u",
]);

export function isReservedBrowserShortcut(
  event: Pick<ShortcutModifiers, "key" | "metaKey" | "ctrlKey">,
): boolean {
  const hasPrimaryModifier = event.metaKey || event.ctrlKey;
  if (!hasPrimaryModifier) {
    return false;
  }
  return RESERVED_KEYS.has(event.key.toLowerCase());
}

export function installBrowserDefaultGuards(target: GuardTarget): () => void {
  const onContextMenu = (event: Event) => event.preventDefault();
  const onKeyDown = (event: Event) => {
    if (isReservedBrowserShortcut(event as KeyboardEvent)) {
      event.preventDefault();
    }
  };

  target.addEventListener("contextmenu", onContextMenu);
  target.addEventListener("keydown", onKeyDown);

  return () => {
    target.removeEventListener("contextmenu", onContextMenu);
    target.removeEventListener("keydown", onKeyDown);
  };
}
