import {
  debug as pluginDebug,
  error as pluginError,
  info as pluginInfo,
  trace as pluginTrace,
  warn as pluginWarn,
} from "@tauri-apps/plugin-log";

// Frontend half of the application log. Every user-visible action goes through
// here so it lands in the same per-launch file as the Rust `log::` records and
// shows up in the in-app Logs panel (the plugin's Webview target). Outside a
// Tauri host (dev browser, jsdom) the same line goes to the browser console so
// no call site needs an environment check.

export type AppLogLevel = "trace" | "debug" | "info" | "warn" | "error";

const PLUGIN_WRITER: Record<AppLogLevel, (message: string) => Promise<void>> = {
  trace: pluginTrace,
  debug: pluginDebug,
  info: pluginInfo,
  warn: pluginWarn,
  error: pluginError,
};

// Detecting the IPC bridge directly (instead of importing isTauri) keeps this
// module free of extra Tauri imports, so every mock that stubs the plugin still
// works.
function hasTauriIpc(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function writeToConsole(level: AppLogLevel, message: string): void {
  // console.trace prints a stack; a trace-level app line is still just a line.
  if (level === "trace") {
    console.debug(message);
    return;
  }
  console[level](message);
}

export function writeLog(level: AppLogLevel, message: string): void {
  if (hasTauriIpc()) {
    try {
      void PLUGIN_WRITER[level](message).catch(() => {
        // Logging is a side channel: a failed write must never break the action.
      });
    } catch {
      // Same rule if the plugin throws before returning its promise.
    }
    return;
  }
  writeToConsole(level, message);
}

// Short call sites: log.info("playback: play"), log.error("..."), ...
export const log = {
  trace: (message: string) => writeLog("trace", message),
  debug: (message: string) => writeLog("debug", message),
  info: (message: string) => writeLog("info", message),
  warn: (message: string) => writeLog("warn", message),
  error: (message: string) => writeLog("error", message),
};

// Error variant that folds the thrown value into the line without losing it.
export function logError(message: string, error: unknown): void {
  writeLog("error", `${message}: ${String(error)}`);
}
