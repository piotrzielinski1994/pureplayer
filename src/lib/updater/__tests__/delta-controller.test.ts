import type { UpdateController } from "@pziel/pureui";
import { describe, expect, it, vi } from "vitest";

import {
  createDeltaUpdateController,
  percentOf,
  type UpdateProgress,
} from "@/lib/updater/delta-controller";

// AC-007 / AC-003: the delta path is invisible to the UI - it plugs into the
// same UpdateController port pureui drives (UpdateChecker + UpdatesSection), so
// these tests exercise the port contract itself, not Tauri.

function deps(overrides: {
  check?: () => Promise<{ version: string } | null>;
  install?: () => Promise<void>;
  relaunch?: () => Promise<void>;
  listenProgress?: (onProgress: (payload: UpdateProgress) => void) => Promise<() => void>;
} = {}) {
  return {
    check: vi.fn(overrides.check ?? (() => Promise.resolve({ version: "0.4.0" }))),
    install: vi.fn(overrides.install ?? (() => Promise.resolve())),
    relaunch: vi.fn(overrides.relaunch ?? (() => Promise.resolve())),
    listenProgress: vi.fn(
      overrides.listenProgress ?? (() => Promise.resolve(() => {})),
    ),
  };
}

describe("delta update controller", () => {
  // behavior: no update -> null, so the checker shows no toast.
  it("should return null if there is no update", async () => {
    const controller = createDeltaUpdateController(
      deps({ check: () => Promise.resolve(null) }),
    );

    await expect(controller.check()).resolves.toBeNull();
  });

  // behavior: an update is exposed with the version the Rust side reported.
  it("should expose the version of an available update", async () => {
    const controller = createDeltaUpdateController(deps());

    const info = await controller.check();

    expect(info?.version).toBe("0.4.0");
  });

  // side-effect-contract: install runs inside downloadAndInstall, after the
  // progress listener is attached, and the listener is released afterwards.
  it("should listen for progress, install, then unsubscribe", async () => {
    const order: string[] = [];
    const unlisten = vi.fn(() => {
      order.push("unlisten");
    });
    const d = deps({
      install: () => {
        order.push("install");
        return Promise.resolve();
      },
      listenProgress: () => {
        order.push("listen");
        return Promise.resolve(unlisten);
      },
    });
    const controller = createDeltaUpdateController(d);

    const info = await controller.check();
    await info?.downloadAndInstall(() => {});

    expect(order).toEqual(["listen", "install", "unlisten"]);
    expect(d.install).toHaveBeenCalledTimes(1);
  });

  // behavior: byte progress from Rust reaches the caller as a percentage.
  it("should report percentage progress from downloaded/total bytes", async () => {
    let push: ((payload: UpdateProgress) => void) | undefined;
    const controller = createDeltaUpdateController(
      deps({
        listenProgress: (onProgress) => {
          push = onProgress;
          return Promise.resolve(() => {});
        },
      }),
    );
    const seen: number[] = [];

    const info = await controller.check();
    await info?.downloadAndInstall((pct) => seen.push(pct));

    push?.({ downloaded: 50, total: 200 });
    expect(seen).toEqual([25]);
  });

  // behavior: a failed install still releases the listener (no leak on retry).
  it("should unsubscribe even if the install fails", async () => {
    const unlisten = vi.fn();
    const controller = createDeltaUpdateController(
      deps({
        install: () => Promise.reject(new Error("install failed")),
        listenProgress: () => Promise.resolve(unlisten),
      }),
    );

    const info = await controller.check();
    await expect(info?.downloadAndInstall(() => {})).rejects.toThrow(
      "install failed",
    );
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  // behavior: relaunch is the injected Tauri process relaunch.
  it("should relaunch through the injected dependency", async () => {
    const d = deps();
    const controller = createDeltaUpdateController(d);

    const info = await controller.check();
    await info?.relaunch();

    expect(d.relaunch).toHaveBeenCalledTimes(1);
  });

  // behavior: unknown total keeps the label at 0% instead of NaN.
  it("should report 0 percent if the total is unknown", () => {
    expect(percentOf({ downloaded: 1024, total: null })).toBe(0);
    expect(percentOf({ downloaded: 0, total: 0 })).toBe(0);
  });

  // behavior: the percentage is whole and clamped to 100.
  it("should round and clamp the percentage", () => {
    expect(percentOf({ downloaded: 1, total: 3 })).toBe(33);
    expect(percentOf({ downloaded: 300, total: 200 })).toBe(100);
  });

  // type-level: the controller satisfies pureui's port.
  it("should satisfy the UpdateController port", async () => {
    const controller: UpdateController = createDeltaUpdateController(deps());
    const info = await controller.check();
    expect(typeof info?.downloadAndInstall).toBe("function");
  });
});
