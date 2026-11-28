import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { exit } from "@tauri-apps/plugin-process";
import { log } from "@/lib/logging/log";

const VIDEO_EXTENSIONS = ["mp4", "mkv", "mov", "webm", "avi"];
const AUDIO_EXTENSIONS = [
  "mp3",
  "m4a",
  "aac",
  "flac",
  "wav",
  "ogg",
  "opus",
  "wma",
];

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

// Probe the file. A remuxed MP4 comes back as a file path fed through the asset
// protocol, so the `<video>` gets a finite duration and native instant seeking. A
// passthrough original and an HLS stream both come back as an http://127.0.0.1 URL
// (the loopback server holds the passthrough file open, so deleting it mid-playback
// doesn't end playback) - we branch on the URL scheme. A `swapId`
// marks the two-phase path (silent video now, audio swapped in later).
// `durationSec` is the real source length: an HLS stream's own duration reads
// Infinity until it ends, so the FE falls back to this for the transport readout.
export async function prepareMediaUrl(path: string): Promise<PreparedSource> {
  const prepared = await invoke<PreparedMedia>("prepare_media", { path });
  return {
    url: toPlayableUrl(prepared.path),
    durationSec: prepared.durationSec,
    swapId: prepared.swapId ?? null,
  };
}

// A 127.0.0.1 URL is served by the loopback server; a path goes through the asset
// protocol, since the webview cannot read arbitrary paths itself.
function toPlayableUrl(path: string): string {
  const isUrl = path.startsWith("http://") || path.startsWith("https://");
  return isUrl ? path : convertFileSrc(path);
}

// Restart the running HLS encode at `offsetSec` and return the new playlist: a seek
// past the segments already written cannot be served from disk, so the backend
// re-encodes from the target keyframe (the VLC model).
export async function seekMediaUrl(offsetSec: number): Promise<string> {
  const prepared = await invoke<PreparedMedia>("seek_media", { offsetSec });
  return toPlayableUrl(prepared.path);
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

// Close the whole app (not just the window) - the viewport context menu's quit
// action. Guarded so the dev browser and jsdom, which have no process plugin,
// are a no-op instead of a rejected promise.
export async function quitApp(): Promise<void> {
  log.info("app: quit requested");
  if (!isTauri()) {
    return;
  }
  try {
    await exit(0);
  } catch {
    // no-op outside a Tauri host
  }
}

// Make the WKWebView the window's first responder again. macOS drops this after
// a fullscreen transition, killing keyboard input until a click - see the Rust
// focus_webview command (tao#208). No-op outside a Tauri host.
export async function focusWebview(): Promise<void> {
  try {
    log.debug("window: re-arm webview focus");
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

// Files the OS asked us to open (double-clicked via a file association, or a
// second launch forwarded by the single-instance plugin). The Rust side queues
// them and emits `app://open-paths`; both the cold start (queue drained on
// mount) and the warm start (event -> drain) end up calling this one drain.
export function takePendingOpenPaths(): Promise<string[]> {
  return invoke<string[]>("take_pending_open_paths").catch(() => []);
}

export function watchOpenPaths(handler: () => void): Promise<() => void> {
  return listen("app://open-paths", () => handler()).catch(() => NO_UNLISTEN);
}

export type FileDropEvent =
  | { type: "enter"; paths: string[] }
  | { type: "leave" }
  | { type: "drop"; paths: string[] };

type FileDropHandler = (event: FileDropEvent) => void;

// ONE native drag-drop subscription for the whole session, started as early as
// possible (main.tsx, before React renders). It must exist before the React tree
// subscribes: the webview throws away a drop with no JS listener registered, and
// the Workspace only mounts after the settings store has loaded - so a file
// dropped right after launch was silently lost.
const fileDropHandlers = new Set<FileDropHandler>();
// Drops that landed while nobody was listening (app still booting). Replayed to
// the first handler that attaches. Only `drop` is kept: replaying a stale
// `enter` would pin the drop overlay on.
const pendingFileDrops: FileDropEvent[] = [];
const MAX_PENDING_FILE_DROPS = 8;
let fileDropSubscription: Promise<void> | null = null;

function dispatchFileDrop(event: FileDropEvent): void {
  if (fileDropHandlers.size === 0) {
    if (event.type === "drop") {
      pendingFileDrops.push(event);
      if (pendingFileDrops.length > MAX_PENDING_FILE_DROPS) {
        pendingFileDrops.shift();
      }
    }
    return;
  }
  for (const handler of fileDropHandlers) {
    handler(event);
  }
}

// Native drag-drop subscription, flattened to a FileDropEvent (the `over` phase
// is ignored). Idempotent. No-op outside a Tauri host, so plain browser dev and
// jsdom tests don't crash - same guard as watchFullscreen.
export function startFileDropSubscription(): void {
  if (fileDropSubscription) {
    return;
  }
  try {
    fileDropSubscription = getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "leave") {
          void logPlayback("drag: leave");
          dispatchFileDrop({ type: "leave" });
          return;
        }
        if (payload.type === "over") {
          return;
        }
        void logPlayback(`drag: ${payload.type} paths=${payload.paths.length}`);
        if (payload.type === "enter") {
          dispatchFileDrop({ type: "enter", paths: payload.paths });
          return;
        }
        if (payload.type === "drop") {
          dispatchFileDrop({ type: "drop", paths: payload.paths });
        }
      })
      .then(() => undefined)
      .catch(() => undefined);
  } catch {
    fileDropSubscription = Promise.resolve();
  }
}

// Subscribe a handler to the (already running) drag-drop stream. A drop buffered
// before the app finished booting is delivered immediately on attach.
export function watchFileDrop(handler: FileDropHandler): Promise<() => void> {
  startFileDropSubscription();
  fileDropHandlers.add(handler);
  for (const event of pendingFileDrops.splice(0, pendingFileDrops.length)) {
    handler(event);
  }
  return Promise.resolve(() => {
    fileDropHandlers.delete(handler);
  });
}

export async function toggleFullscreen(): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    const next = !(await appWindow.isFullscreen());
    log.info(`window: fullscreen -> ${next}`);
    await appWindow.setFullscreen(next);
  } catch {
    // no-op outside a Tauri host
  }
}

const MINI_PLAYER_FALLBACK_HEIGHT = 48;
const MINI_WIDTH = 680;
const SIDEBAR_HEADER_HEIGHT = 36;
const MEDIA_ROW_HEIGHT = 28;
const MINI_PLAYLIST_ROWS = 5;
const MINI_PLAYLIST_SIDEBAR_HEIGHT =
  SIDEBAR_HEADER_HEIGHT + MINI_PLAYLIST_ROWS * MEDIA_ROW_HEIGHT;

// The visibility of the two collapsible panels that drive the mini window size.
// Mini = content hidden; the transport bar is always shown in mini.
export type MiniLayout = { contentVisible: boolean; sidebarVisible: boolean };

type PreMiniGeometry = {
  width: number;
  height: number;
  titleBarHeight: number;
};
let preMini: PreMiniGeometry | null = null;

function transportBarHeight(): number {
  const bar = document.querySelector("[data-transport-bar]");
  const measured = bar?.getBoundingClientRect().height ?? 0;
  return measured > 0 ? Math.ceil(measured) : MINI_PLAYER_FALLBACK_HEIGHT;
}

// Mini window size for a content-hidden layout: a fixed narrow width (constant,
// so toggling the sidebar only changes HEIGHT, never width) and a bar height
// (+ title bar), plus the sidebar block when the sidebar is shown (it reflows
// into a top bar).
function miniSize(
  sidebarVisible: boolean,
  geometry: PreMiniGeometry,
): LogicalSize {
  const barHeight = transportBarHeight() + geometry.titleBarHeight;
  const sidebarHeight = sidebarVisible ? MINI_PLAYLIST_SIDEBAR_HEIGHT : 0;
  return new LogicalSize(MINI_WIDTH, sidebarHeight + barHeight);
}

// Resize the OS window to match the panel layout. When content becomes hidden we
// stash the pre-mini geometry once (width/height/title-bar delta) and shrink to
// the mini size; toggling the sidebar WHILE mini re-sizes without re-stashing;
// when content is shown again we restore the stashed size and clear it.
export async function setMiniWindow(layout: MiniLayout): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    if (layout.contentVisible) {
      if (preMini !== null) {
        log.info(
          `window: mini-player off, restoring ${preMini.width}x${preMini.height}`,
        );
        await appWindow.setSize(new LogicalSize(preMini.width, preMini.height));
        preMini = null;
      }
      return;
    }
    if (preMini === null) {
      const scale = await appWindow.scaleFactor();
      const inner = (await appWindow.innerSize()).toLogical(scale);
      const titleBarHeight = Math.max(
        0,
        Math.round(inner.height - window.innerHeight),
      );
      preMini = { width: inner.width, height: inner.height, titleBarHeight };
    }
    const size = miniSize(layout.sidebarVisible, preMini);
    log.info(
      `window: mini-player size=${size.width}x${size.height} sidebar=${layout.sidebarVisible}`,
    );
    await appWindow.setSize(size);
  } catch {
    // no-op outside a Tauri host
  }
}
