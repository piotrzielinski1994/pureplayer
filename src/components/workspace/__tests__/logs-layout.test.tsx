import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { fixtureMedia } from "./fixtures";

vi.mock("@/lib/tauri", () => ({
  watchAudioReady: vi.fn(() => Promise.resolve(() => {})),
  logPlayback: vi.fn(() => Promise.resolve()),
  prepareMediaUrl: (path: string) =>
    Promise.resolve({ url: `asset://localhost${path}`, durationSec: null }),
  openMediaFiles: vi.fn(() => Promise.resolve([])),
}));

function Controls() {
  const { toggleLogs, setFullscreen, toggleContent } = useWorkspace();
  return (
    <div>
      <button onClick={() => toggleLogs()}>do-toggle-logs</button>
      <button onClick={() => setFullscreen(true)}>enter-fullscreen</button>
      <button onClick={() => setFullscreen(false)}>exit-fullscreen</button>
      <button onClick={() => toggleContent()}>toggle-content</button>
    </div>
  );
}

const renderLayout = async () => {
  const result = render(
    <SettingsProvider store={createInMemorySettingsStore()}>
      <WorkspaceProvider media={fixtureMedia} initialActiveMediaId="v-3">
        <WorkspaceLayout />
        <Controls />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
  // SettingsProvider renders null until its async load resolves; wait for it.
  await screen.findByRole("button", { name: "do-toggle-logs" });
  return result;
};

const logsRegion = () => screen.queryByRole("region", { name: "Logs" });
const viewportRegion = () =>
  screen.getByRole("region", { name: /media viewport/i });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Logs panel toggle and chrome (AC-008)", () => {
  // behavior: the Logs panel is hidden by default and its toggle shows then hides it
  it("should show then hide the Logs panel via its toggle", async () => {
    const user = userEvent.setup();
    await renderLayout();

    expect(logsRegion()).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "do-toggle-logs" }));
    await waitFor(() => expect(logsRegion()).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "do-toggle-logs" }));
    await waitFor(() => expect(logsRegion()).not.toBeInTheDocument());
  });

  // behavior: entering fullscreen hides the Logs panel and exiting restores it
  it("should hide then restore the Logs panel across a fullscreen round-trip", async () => {
    const user = userEvent.setup();
    await renderLayout();

    await user.click(screen.getByRole("button", { name: "do-toggle-logs" }));
    await waitFor(() => expect(logsRegion()).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "enter-fullscreen" }));
    await waitFor(() => expect(logsRegion()).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "exit-fullscreen" }));
    await waitFor(() => expect(logsRegion()).toBeInTheDocument());
  });

  // behavior: exiting fullscreen restores the PRE-fullscreen logs visibility
  it("should keep the Logs panel hidden after a fullscreen round-trip if it was hidden before", async () => {
    const user = userEvent.setup();
    await renderLayout();

    // logs hidden by default; enter then exit fullscreen
    await user.click(screen.getByRole("button", { name: "enter-fullscreen" }));
    await waitFor(() => expect(logsRegion()).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "exit-fullscreen" }));

    // logs stays hidden (its pre-fullscreen state)
    expect(logsRegion()).not.toBeInTheDocument();
  });

  // behavior: mini-player mode (content hidden) hides the Logs panel
  it("should hide the Logs panel if content is hidden", async () => {
    const user = userEvent.setup();
    await renderLayout();

    await user.click(screen.getByRole("button", { name: "do-toggle-logs" }));
    await waitFor(() => expect(logsRegion()).toBeVisible());
    const region = logsRegion();
    expect(region).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "toggle-content" }));

    await waitFor(() => expect(region).not.toBeVisible());
  });

  // behavior: the viewport region survives a logs toggle (no remount churn)
  it("should keep the viewport region mounted if the Logs panel is toggled", async () => {
    const user = userEvent.setup();
    await renderLayout();

    expect(viewportRegion()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "do-toggle-logs" }));

    expect(viewportRegion()).toBeInTheDocument();
  });
});
