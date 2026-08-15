import { describe, expect, it, vi } from "vitest";

import { createNoopLogStream } from "@/lib/logging/log-stream";

vi.mock("@tauri-apps/plugin-log", () => ({
  attachLogger: vi.fn(),
}));

import { attachLogger } from "@tauri-apps/plugin-log";
import { createTauriLogStream } from "@/lib/logging/log-stream";

describe("createNoopLogStream", () => {
  // behavior: the noop stream never emits a line and resolves to a callable unsubscribe.
  it("should resolve an unsubscribe and never call the listener", async () => {
    const onLine = vi.fn();
    const unsubscribe = await createNoopLogStream().subscribe(onLine);

    expect(onLine).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe("createTauriLogStream", () => {
  // behavior: the tauri stream subscribes via the plugin's attachLogger and maps each
  // record's message + numeric level onto onLine (AC-002).
  it("should map plugin log records to onLine(message, level)", async () => {
    const onLine = vi.fn();
    const unlisten = vi.fn();
    vi.mocked(attachLogger).mockReturnValue(Promise.resolve(unlisten) as never);

    const unsubscribe = await createTauriLogStream().subscribe(onLine);

    expect(attachLogger).toHaveBeenCalledOnce();
    const listener = vi.mocked(attachLogger).mock.calls[0][0];
    listener({ message: "prepare_media path=/tmp/x.mkv", level: 4 });
    listener({ message: "pureplayer starting", level: 3 });

    expect(onLine).toHaveBeenNthCalledWith(
      1,
      "prepare_media path=/tmp/x.mkv",
      4,
    );
    expect(onLine).toHaveBeenNthCalledWith(2, "pureplayer starting", 3);
    expect(unsubscribe).toBe(unlisten);
  });
});
