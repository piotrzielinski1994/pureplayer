import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CommandPalette,
  type PaletteCommand,
} from "@/components/workspace/command-palette";
import type { ShortcutAction } from "@/lib/shortcuts/registry";

const action = (id: string, name: string): ShortcutAction => ({
  id: id as ShortcutAction["id"],
  name,
  description: name,
  defaultHotkey: "Space",
});

const cmd = (id: string, name: string): PaletteCommand => ({
  action: action(id, name),
  binding: "Space",
  keywords: [],
  run: vi.fn(),
});

const commands: PaletteCommand[] = [
  cmd("toggle-play", "Play / pause"),
  cmd("next-video", "Next video"),
  cmd("prev-video", "Previous video"),
  cmd("seek-forward", "Seek forward 5s"),
];

const selectedName = () =>
  document
    .querySelector('[cmdk-item=""][aria-selected="true"] span')
    ?.textContent?.trim();

describe("command palette pointer stability", () => {
  // side-effect-contract: when the list scrolls under a stationary cursor, the row
  // that slides beneath it fires pointermove; selection must NOT be hijacked to it.
  // Reproduces the on-device "ArrowDown -> selection snaps to the row under the mouse".
  it("should keep the keyboard selection if a row receives a pointermove from a scroll", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette open onOpenChange={vi.fn()} commands={commands} />,
    );

    // cmdk auto-highlights the first row.
    expect(selectedName()).toBe("Play / pause");

    // A scroll slides "Seek forward 5s" under the resting cursor -> pointermove.
    const laterRow = screen.getByRole("option", { name: /seek forward 5s/i });
    fireEvent.pointerMove(laterRow);

    // Selection must stay where the keyboard put it, not jump to the hovered row.
    expect(selectedName()).toBe("Play / pause");

    // Keyboard navigation still advances normally.
    await user.keyboard("{ArrowDown}");
    expect(selectedName()).toBe("Next video");
  });

  // side-effect-contract: ArrowUp on the first row wraps to the last row (loop nav)
  it("should select the last row if ArrowUp is pressed on the first row", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette open onOpenChange={vi.fn()} commands={commands} />,
    );

    expect(selectedName()).toBe("Play / pause");

    await user.keyboard("{ArrowUp}");

    expect(selectedName()).toBe("Seek forward 5s");
  });

  // side-effect-contract: ArrowDown on the last row wraps to the first row (loop nav)
  it("should select the first row if ArrowDown is pressed on the last row", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette open onOpenChange={vi.fn()} commands={commands} />,
    );

    await user.keyboard("{ArrowUp}");
    expect(selectedName()).toBe("Seek forward 5s");

    await user.keyboard("{ArrowDown}");
    expect(selectedName()).toBe("Play / pause");
  });
});
