import { beforeEach, describe, expect, it, vi } from "vitest";

const { pluginInfo, pluginError } = vi.hoisted(() => ({
  pluginInfo: vi.fn((_message: string) => Promise.resolve()),
  pluginError: vi.fn((_message: string) => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  trace: vi.fn(() => Promise.resolve()),
  debug: vi.fn(() => Promise.resolve()),
  info: pluginInfo,
  warn: vi.fn(() => Promise.resolve()),
  error: pluginError,
}));

import { log } from "@/lib/logging/log";

function enableTauriIpc() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

function disableTauriIpc() {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
}

describe("log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disableTauriIpc();
  });

  // behavior: with the Tauri bridge present the line goes to the plugin (same file as Rust logs)
  it("should forward an info line to the plugin when the Tauri bridge exists", () => {
    enableTauriIpc();
    log.info("playback: play");

    expect(pluginInfo).toHaveBeenCalledWith("playback: play");
  });

  // behavior: the error level reaches the plugin's error writer
  it("should forward an error line to the plugin error writer", () => {
    enableTauriIpc();
    log.error("prepare_media failed path=/v/a.mkv");

    expect(pluginError).toHaveBeenCalledWith(
      "prepare_media failed path=/v/a.mkv",
    );
  });

  // behavior: outside Tauri (dev browser/jsdom) the same line goes to the console
  it("should write to the console when no Tauri bridge exists", () => {
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    log.info("playback: pause");

    expect(consoleInfo).toHaveBeenCalledWith("playback: pause");
    expect(pluginInfo).not.toHaveBeenCalled();
    consoleInfo.mockRestore();
  });
});
