import {
  type UpdateController,
  type UpdateInfo,
  UpdatesSection,
} from "@pziel/pureui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { createPlayerUpdateToastSink } from "@/lib/updater/update-toast-sink";

// R18 consume-integration: pureplayer no longer owns UpdatesSection - it renders
// the hoisted pureui section wired with its REAL toast seam (the untouched
// createPlayerUpdateToastSink over the ToastProvider's `show`, and both one-shot
// messages routed through `show`). pureplayer renders toasts to the DOM, so the
// observable contract is asserted on rendered text, proving its styling is
// preserved end-to-end.

function fakeUpdateInfo(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    version: "v0.2.0",
    downloadAndInstall: () => Promise.resolve(),
    relaunch: () => Promise.resolve(),
    ...overrides,
  };
}

function Harness({
  controller,
  getVersion,
}: {
  controller: UpdateController;
  getVersion: () => Promise<string>;
}) {
  const { show } = useToast();
  const [sink] = useState(() => createPlayerUpdateToastSink(show));
  return (
    <UpdatesSection
      controller={controller}
      getVersion={getVersion}
      sink={sink}
      notify={{ info: show, error: show }}
    />
  );
}

function withToasts(node: ReactNode) {
  return <ToastProvider>{node}</ToastProvider>;
}

function renderSection(
  controller: UpdateController,
  getVersion: () => Promise<string> = () => Promise.resolve("0.1.0"),
) {
  return render(
    withToasts(<Harness controller={controller} getVersion={getVersion} />),
  );
}

describe("UpdatesSection (pureplayer consume)", () => {
  // TC-010 behavior: renders the current version string from the injected source
  it("should render the current version from the injected version source", async () => {
    renderSection({ check: () => Promise.resolve(null) }, () =>
      Promise.resolve("1.2.3"),
    );

    expect(await screen.findByText(/1\.2\.3/)).toBeInTheDocument();
  });

  // TC-010 behavior: check reports no update -> "latest" toast via `show` + button idle
  it("should show an up-to-date toast and re-enable the button if no update is found", async () => {
    const user = userEvent.setup();
    renderSection({ check: () => Promise.resolve(null) });

    const button = await screen.findByRole("button", {
      name: /check for updates/i,
    });
    await user.click(button);

    expect(
      await screen.findByText(/latest version|up to date/i),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /check for updates/i }),
      ).toBeEnabled();
    });
  });

  // TC-010 behavior: update found -> update toast (version + Update now) via the sink
  it("should show the update toast if an update is found", async () => {
    const user = userEvent.setup();
    renderSection({
      check: () => Promise.resolve(fakeUpdateInfo({ version: "v0.2.0" })),
    });

    await user.click(
      await screen.findByRole("button", { name: /check for updates/i }),
    );

    expect(await screen.findByText(/v0\.2\.0/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /update now/i }),
    ).toBeInTheDocument();
  });

  // TC-010 behavior: check rejects -> "check failed" toast via `show` + button not stuck
  it("should show a check-failed toast and re-enable the button if the check rejects", async () => {
    const user = userEvent.setup();
    renderSection({
      check: () => Promise.reject(new Error("network down")),
    });

    await user.click(
      await screen.findByRole("button", { name: /check for updates/i }),
    );

    expect(await screen.findByText(/failed/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /check for updates/i }),
      ).toBeEnabled();
    });
  });

  // TC-010 side-effect-contract: in-flight guard - the button is disabled while a
  // check is pending and a second click does not start a second check
  it("should disable the button while checking and ignore a second click", async () => {
    let resolveCheck: (info: UpdateInfo | null) => void = () => {};
    const check = vi.fn(
      () =>
        new Promise<UpdateInfo | null>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const user = userEvent.setup();
    renderSection({ check });

    const button = await screen.findByRole("button", {
      name: /check for updates|checking/i,
    });
    await user.click(button);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /check for updates|checking/i }),
      ).toBeDisabled();
    });

    await user.click(
      screen.getByRole("button", { name: /check for updates|checking/i }),
    );

    expect(check).toHaveBeenCalledTimes(1);

    resolveCheck(null);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /check for updates/i }),
      ).toBeEnabled();
    });
  });
});
