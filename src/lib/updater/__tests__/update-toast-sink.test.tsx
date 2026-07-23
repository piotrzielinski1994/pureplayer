import {
  UpdateChecker,
  type UpdateController,
  type UpdateInfo,
} from "@pziel/pureui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "@/components/ui/toast";
import { createPlayerUpdateToastSink } from "@/lib/updater/update-toast-sink";

// AC-009 parity: pureplayer wires the hoisted pureui updater flow to its OWN
// ToastProvider via createPlayerUpdateToastSink. This test drives the real
// UpdateChecker (from pureui) through the real ToastProvider + the app sink, so
// the assertions prove the app's toast presentation is preserved: a persistent
// toast that survives the 2500ms auto-dismiss, the "Update now" button replaced
// by the Downloading… label once download starts, and × dismiss without install.
// The controller is a hand-written fake (the injected port), NOT mocked.

type UpdateInfoOverrides = Partial<UpdateInfo>;

function fakeUpdateInfo(overrides: UpdateInfoOverrides = {}): UpdateInfo {
  return {
    version: "v0.2.0",
    downloadAndInstall: () => Promise.resolve(),
    relaunch: () => Promise.resolve(),
    ...overrides,
  };
}

function controllerWith(info: UpdateInfo | null): UpdateController {
  return { check: () => Promise.resolve(info) };
}

// Mounts the pureui UpdateChecker with the app sink built from the surrounding
// ToastProvider's `show` - the same wiring AppProviders uses.
function CheckerHarness({ controller }: { controller: UpdateController }) {
  const { show } = useToast();
  const sink = createPlayerUpdateToastSink(show);
  return <UpdateChecker controller={controller} sink={sink} />;
}

function renderChecker(controller: UpdateController) {
  return render(
    <ToastProvider>
      <CheckerHarness controller={controller} />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pureplayer update toast sink parity", () => {
  // TC-016 behavior: an available update shows a persistent toast with the
  // version text + an "Update now" button.
  it("should show an update toast with the version and an Update now button if an update is available", async () => {
    renderChecker(controllerWith(fakeUpdateInfo({ version: "v0.2.0" })));

    expect(await screen.findByText(/v0\.2\.0/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /update now/i }),
    ).toBeInTheDocument();
  });

  // behavior: no update -> no toast.
  it("should not show any toast if no update is available", async () => {
    renderChecker(controllerWith(null));

    await Promise.resolve();
    await Promise.resolve();
    expect(
      screen.queryByRole("button", { name: /update now/i }),
    ).not.toBeInTheDocument();
  });

  // behavior: check rejects -> error swallowed, no toast, no throw.
  it("should swallow a rejected check without a toast or a throw", async () => {
    const controller: UpdateController = {
      check: () => Promise.reject(new Error("network down")),
    };

    expect(() => renderChecker(controller)).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();
    expect(
      screen.queryByRole("button", { name: /update now/i }),
    ).not.toBeInTheDocument();
  });

  // TC-016 side-effect-contract: clicking Update now invokes downloadAndInstall,
  // progress drives the label, and relaunch is invoked after it resolves.
  it("should download+install then relaunch when Update now is clicked", async () => {
    const relaunch = vi.fn(() => Promise.resolve());
    const downloadAndInstall = vi.fn((onProgress: (pct: number) => void) => {
      onProgress(50);
      return Promise.resolve();
    });
    const controller = controllerWith(
      fakeUpdateInfo({ downloadAndInstall, relaunch }),
    );

    const user = userEvent.setup();
    renderChecker(controller);

    const button = await screen.findByRole("button", { name: /update now/i });
    await user.click(button);

    await waitFor(() => {
      expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    await waitFor(() => {
      expect(relaunch).toHaveBeenCalledTimes(1);
    });
  });

  // TC-016 behavior: once download starts, the Update now button is replaced by
  // the progress label so it can't be re-fired mid-download.
  it("should replace the Update now button with progress once download starts", async () => {
    const downloadAndInstall = vi.fn((onProgress: (pct: number) => void) => {
      onProgress(50);
      return new Promise<void>(() => {});
    });
    const controller = controllerWith(fakeUpdateInfo({ downloadAndInstall }));

    const user = userEvent.setup();
    renderChecker(controller);

    await user.click(
      await screen.findByRole("button", { name: /update now/i }),
    );

    expect(await screen.findByText(/50%/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /update now/i }),
    ).not.toBeInTheDocument();
  });

  // TC-014 behavior: the available toast is persistent - it survives past the
  // 2500ms auto-dismiss window.
  it("should keep the update toast past the 2500ms auto-dismiss", async () => {
    vi.useFakeTimers();
    renderChecker(controllerWith(fakeUpdateInfo({ version: "v0.2.0" })));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/v0\.2\.0/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.getByText(/v0\.2\.0/)).toBeInTheDocument();
  });

  // TC-014 behavior/side-effect-contract: clicking × removes the toast and does
  // NOT invoke the install path.
  it("should remove the toast and not install when dismiss is clicked", async () => {
    const downloadAndInstall = vi.fn(() => Promise.resolve());
    const controller = controllerWith(fakeUpdateInfo({ downloadAndInstall }));

    const user = userEvent.setup();
    renderChecker(controller);

    await screen.findByText(/v0\.2\.0/);
    await user.click(screen.getByRole("button", { name: /dismiss|close/i }));

    expect(screen.queryByText(/v0\.2\.0/)).not.toBeInTheDocument();
    expect(downloadAndInstall).not.toHaveBeenCalled();
  });
});
