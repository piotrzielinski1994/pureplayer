import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PlaybackSection } from "@/components/settings/playback-section";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";

function renderSection(revealTransportOnHover = true) {
  const seeded: Settings = { ...DEFAULT_SETTINGS, revealTransportOnHover };
  const inner = createInMemorySettingsStore(seeded);
  const saveSpy = vi.fn(inner.save);
  const store: SettingsStore = { load: inner.load, save: saveSpy };

  const result = render(
    <SettingsProvider store={store}>
      <PlaybackSection />
    </SettingsProvider>,
  );
  return { ...result, saveSpy };
}

const toggle = () =>
  screen.getByRole("switch", { name: /reveal transport bar on hover/i });

describe("PlaybackSection", () => {
  // behavior: the toggle reflects the persisted reveal-on-hover flag (AC-014)
  it("should render the reveal-on-hover toggle in the on state if enabled", async () => {
    renderSection(true);

    await waitFor(() => expect(toggle()).toBeChecked());
  });

  // behavior: the toggle reflects an off flag (AC-014)
  it("should render the toggle in the off state if disabled", async () => {
    renderSection(false);

    await waitFor(() => expect(toggle()).not.toBeChecked());
  });

  // side-effect-contract: toggling persists the new flag via the store (AC-014)
  it("should persist the flipped flag if the toggle is clicked", async () => {
    const user = userEvent.setup();
    const { saveSpy } = renderSection(true);

    await waitFor(() => expect(toggle()).toBeChecked());
    await user.click(toggle());

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    expect(saveSpy.mock.calls.at(-1)![0].revealTransportOnHover).toBe(false);
  });
});
