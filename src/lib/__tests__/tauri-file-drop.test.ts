import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the native drag-drop handler tauri.ts registers, so a test can fire
// OS drag events at will. tauri.ts is the SUT.
type NativeDropPayload =
  | { type: "enter" | "over"; paths: string[]; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

const { onDragDropEvent, getCurrentWebview, invoke } = vi.hoisted(() => {
  const onDragDropEvent = vi.fn(
    (_handler: (event: { payload: NativeDropPayload }) => void) =>
      Promise.resolve(() => {}),
  );
  const getCurrentWebview = vi.fn(() => ({ onDragDropEvent }));
  return { onDragDropEvent, getCurrentWebview, invoke: vi.fn() };
});

vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: vi.fn() }));

const POSITION = { x: 1, y: 2 };

async function loadModule() {
  vi.resetModules();
  return await import("@/lib/tauri");
}

// Fire an OS event at the handler the module registered natively.
function fireNative(payload: NativeDropPayload) {
  const handler = onDragDropEvent.mock.calls.at(-1)?.[0];
  if (!handler) {
    throw new Error("no native drag-drop handler registered");
  }
  handler({ payload });
}

describe("watchFileDrop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onDragDropEvent.mockImplementation(
      (_handler: (event: { payload: NativeDropPayload }) => void) =>
        Promise.resolve(() => {}),
    );
  });

  // behavior: a drop that lands before the React tree has mounted its handler
  // (the window is up, the settings store is still loading) is not lost - it is
  // buffered and replayed to the first handler that attaches.
  it("should replay a drop that arrived before any handler attached", async () => {
    const { startFileDropSubscription, watchFileDrop } = await loadModule();
    startFileDropSubscription();

    fireNative({ type: "drop", paths: ["/videos/a.mp4"], position: POSITION });

    const handler = vi.fn();
    await watchFileDrop(handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ type: "drop", paths: ["/videos/a.mp4"] });
  });

  // behavior: once subscribed, an event goes straight through (no buffering, no
  // waiting on the promise) and is flattened to the FileDropEvent shape.
  it("should deliver events straight to an attached handler", async () => {
    const { startFileDropSubscription, watchFileDrop } = await loadModule();
    startFileDropSubscription();
    const handler = vi.fn();
    await watchFileDrop(handler);

    fireNative({ type: "enter", paths: ["/videos/a.mp4"], position: POSITION });
    fireNative({ type: "over", paths: ["/videos/a.mp4"], position: POSITION });
    fireNative({ type: "drop", paths: ["/videos/a.mp4"], position: POSITION });
    fireNative({ type: "leave" });

    expect(handler.mock.calls.map((call) => call[0])).toEqual([
      { type: "enter", paths: ["/videos/a.mp4"] },
      { type: "drop", paths: ["/videos/a.mp4"] },
      { type: "leave" },
    ]);
  });

  // behavior: only drops are buffered - a stale `enter` must not leave the drop
  // overlay stuck on once the handler attaches.
  it("should not replay an enter that arrived before a handler attached", async () => {
    const { startFileDropSubscription, watchFileDrop } = await loadModule();
    startFileDropSubscription();

    fireNative({ type: "enter", paths: ["/videos/a.mp4"], position: POSITION });

    const handler = vi.fn();
    await watchFileDrop(handler);

    expect(handler).not.toHaveBeenCalled();
  });

  // behavior: unlisten detaches only that handler.
  it("should stop delivering after unlisten", async () => {
    const { startFileDropSubscription, watchFileDrop } = await loadModule();
    startFileDropSubscription();
    const handler = vi.fn();
    const unlisten = await watchFileDrop(handler);
    unlisten();

    fireNative({ type: "drop", paths: ["/videos/a.mp4"], position: POSITION });

    expect(handler).not.toHaveBeenCalled();
  });

  // behavior: one native subscription for the whole session, however many times
  // the early start or a component subscription runs.
  it("should register the native listener only once", async () => {
    const { startFileDropSubscription, watchFileDrop } = await loadModule();

    startFileDropSubscription();
    startFileDropSubscription();
    await watchFileDrop(vi.fn());
    await watchFileDrop(vi.fn());

    expect(onDragDropEvent).toHaveBeenCalledTimes(1);
    expect(getCurrentWebview).toHaveBeenCalledTimes(1);
  });

  // E-9: outside a Tauri host the native call throws; the subscription must be a
  // no-op that still lets a handler attach.
  it("should not throw and still accept a handler when the host has no webview", async () => {
    getCurrentWebview.mockImplementationOnce(() => {
      throw new Error("no tauri host");
    });
    const { startFileDropSubscription, watchFileDrop } = await loadModule();

    expect(() => startFileDropSubscription()).not.toThrow();
    await expect(watchFileDrop(vi.fn())).resolves.toBeTypeOf("function");
  });
});
