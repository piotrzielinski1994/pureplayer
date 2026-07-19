import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";

const VIDEO_EXTENSIONS = ["mp4", "mkv", "mov", "webm", "avi"];
const AUDIO_EXTENSIONS = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma"];

export function greet(name: string): Promise<string> {
  return invoke<string>("greet", { name });
}

export async function openMediaFiles(): Promise<string[]> {
  const selection = await open({
    multiple: true,
    directory: false,
    filters: [
      { name: "Video", extensions: VIDEO_EXTENSIONS },
      { name: "Audio", extensions: AUDIO_EXTENSIONS },
    ],
  });
  if (selection === null) {
    return [];
  }
  return Array.isArray(selection) ? selection : [selection];
}

export type PreparedMedia = {
  path: string;
  transcoded: boolean;
  durationSec: number | null;
  // Present on the two-phase path: the silent video plays now and a later
  // `media://audio-ready` event with this id delivers the full-audio file.
  swapId: number | null;
};

export type PreparedSource = {
  url: string;
  durationSec: number | null;
  swapId: number | null;
};

// Probe the file. Most files come back as a complete file path (a passthrough
// original, or a freshly remuxed MP4) fed through the asset protocol, so the
// `<video>` gets a finite duration and native instant seeking. Files whose video
// can't be copied (AV1/VP9) stream as HLS and return an http://localhost playlist
// URL the native player loads directly - we branch on the URL scheme. A `swapId`
// marks the two-phase path (silent video now, audio swapped in later).
// `durationSec` is the real source length: an HLS stream's own duration reads
// Infinity until it ends, so the FE falls back to this for the transport readout.
export async function prepareMediaUrl(path: string): Promise<PreparedSource> {
  const prepared = await invoke<PreparedMedia>("prepare_media", { path });
  const isUrl =
    prepared.path.startsWith("http://") || prepared.path.startsWith("https://");
  return {
    url: isUrl ? prepared.path : convertFileSrc(prepared.path),
    durationSec: prepared.durationSec,
    swapId: prepared.swapId ?? null,
  };
}

export type AudioReady = { swapId: number; url: string };

// Subscribe to the backend's `media://audio-ready` event: the two-phase path's
// silent video has a full-audio file ready to swap to. The raw payload carries a
// file path; we route it through the asset protocol like any other complete file.
// No-op (NO_UNLISTEN) outside a Tauri host, mirroring the other watch* helpers.
export function watchAudioReady(
  handler: (ready: AudioReady) => void,
): Promise<() => void> {
  // listen() rejects asynchronously outside a Tauri host (no IPC bridge), so we
  // swallow the rejection here too, not just a synchronous throw.
  return listen<{ swapId: number; path: string }>(
    "media://audio-ready",
    ({ payload }) => {
      handler({ swapId: payload.swapId, url: convertFileSrc(payload.path) });
    },
  ).catch(() => NO_UNLISTEN);
}

// Send a preformatted playback-timeline line to the Rust log file (same file as
// the backend prepare_media diagnostics). Best-effort: a no-op outside a Tauri
// host and never throws, so instrumentation can't break playback.
export async function logPlayback(message: string): Promise<void> {
  try {
    await invoke("log_playback", { message });
  } catch {
    // no-op outside a Tauri host
  }
}

// Make the WKWebView the window's first responder again. macOS drops this after
// a fullscreen transition, killing keyboard input until a click - see the Rust
// focus_webview command (tao#208). No-op outside a Tauri host.
export async function focusWebview(): Promise<void> {
  try {
    await invoke("focus_webview");
  } catch {
    // no-op outside a Tauri host
  }
}

const NO_UNLISTEN = () => {};

// Subscribe to REAL window fullscreen transitions. We query isFullscreen() on
// every resize, so EVERY entry/exit path - our toggle, F11, the green button,
// OS Esc - keeps the flag correct (single source of truth). On each transition
// we also re-arm the WKWebView first responder, because macOS drops it across
// native fullscreen and keyboard input dies until a click (tao#208).
export function watchFullscreen(
  onChange: (isFullscreen: boolean) => void,
): Promise<() => void> {
  try {
    const appWindow = getCurrentWindow();
    void appWindow.isFullscreen().then(onChange);
    return appWindow.onResized(async () => {
      onChange(await appWindow.isFullscreen());
      void focusWebview();
    });
  } catch {
    return Promise.resolve(NO_UNLISTEN);
  }
}

// Re-arm first responder whenever the window (re)gains focus - catch-all for the
// native-fullscreen / green-button focus loss (tao#208).
export function watchWindowFocus(): Promise<() => void> {
  try {
    return getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        void focusWebview();
      }
    });
  } catch {
    return Promise.resolve(NO_UNLISTEN);
  }
}

// Expand dropped paths: the Rust side walks each path (recursing folders), keeps
// only video-extension files, dedupes, and sorts. Returns a flat path list.
export function expandDroppedPaths(paths: string[]): Promise<string[]> {
  return invoke<string[]>("expand_dropped_paths", { paths });
}

export type FileDropEvent =
  | { type: "enter"; paths: string[] }
  | { type: "leave" }
  | { type: "drop"; paths: string[] };

// Subscribe to the webview drag-drop event, flattened to a FileDropEvent (the
// `over` phase is ignored). No-op (NO_UNLISTEN) outside a Tauri host, so plain
// browser dev and jsdom tests don't crash - same guard as watchFullscreen.
export function watchFileDrop(
  handler: (event: FileDropEvent) => void,
): Promise<() => void> {
  try {
    return getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter") {
        handler({ type: "enter", paths: payload.paths });
        return;
      }
      if (payload.type === "leave") {
        handler({ type: "leave" });
        return;
      }
      if (payload.type === "drop") {
        handler({ type: "drop", paths: payload.paths });
      }
    });
  } catch {
    return Promise.resolve(NO_UNLISTEN);
  }
}

export async function toggleFullscreen(): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    const next = !(await appWindow.isFullscreen());
    await appWindow.setFullscreen(next);
  } catch {
    // no-op outside a Tauri host
  }
}

const MINI_PLAYER_FALLBACK_HEIGHT = 48;
let preMiniSize: LogicalSize | null = null;

function transportBarHeight(): number {
  const bar = document.querySelector("[data-transport-bar]");
  const measured = bar?.getBoundingClientRect().height ?? 0;
  return measured > 0 ? Math.ceil(measured) : MINI_PLAYER_FALLBACK_HEIGHT;
}

export async function setMiniWindow(enter: boolean): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    if (enter) {
      if (preMiniSize !== null) {
        return;
      }
      const scale = await appWindow.scaleFactor();
      const inner = (await appWindow.innerSize()).toLogical(scale);
      const titleBarHeight = Math.max(0, Math.round(inner.height - window.innerHeight));
      preMiniSize = new LogicalSize(inner.width, inner.height);
      await appWindow.setSize(
        new LogicalSize(inner.width, transportBarHeight() + titleBarHeight),
      );
      return;
    }
    if (preMiniSize !== null) {
      await appWindow.setSize(preMiniSize);
      preMiniSize = null;
    }
  } catch {
    // no-op outside a Tauri host
  }
}
