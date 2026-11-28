// Chromium webviews (WebView2, WebKitGTK) have no native HLS, so a `.m3u8`
// playlist must be driven by hls.js over MediaSource Extensions. WKWebView plays
// HLS itself (AVFoundation), and attaching hls.js there would fight the element.
// This module is the only place that knows the difference.

import { log } from "@/lib/logging/log";

const HLS_MIME = "application/vnd.apple.mpegurl";

// True for the backend's loopback HLS playlist URL (`http://localhost:<port>/<job>/index.m3u8`).
// Complete files (asset protocol, remuxed/transcoded MP4) are never playlists.
export function isHlsPlaylistUrl(url: string): boolean {
  return /\.m3u8($|[?#])/i.test(url);
}

// Whether this source needs hls.js: an HLS playlist on a webview without native
// HLS support.
export function needsHlsJs(url: string, nativeHls: boolean): boolean {
  return isHlsPlaylistUrl(url) && !nativeHls;
}

// Pure: can the engine play a playlist by itself? A Chromium webview never can,
// whatever its `canPlayType` answer says: WebView2 replies "maybe" for the m3u8
// MIME but has no MPEG-TS demuxer, so the element takes the playlist as its src
// and stays black at 00:00 with no error on screen.
export function isNativeHlsPlayable(
  chromium: boolean,
  canPlayTypeResult: string,
): boolean {
  return !chromium && canPlayTypeResult !== "";
}

// Where a seek lands. Inside the region ffmpeg already wrote, the element seeks in
// its own buffer; past it there is no data at all, so the backend has to restart the
// encode at the target (HLS cannot look ahead of what exists).
export function seekTarget(
  relativeSec: number,
  encodedSec: number,
): "native" | "restart" {
  return relativeSec >= 0 && relativeSec <= encodedSec ? "native" : "restart";
}

// Whether this is a Chromium webview (WebView2, WebKitGTK's Chromium siblings,
// Electron). WebKit keeps "AppleWebKit" without a "Chrome/" token.
function isChromiumEngine(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  return ua.includes("Chrome/") || ua.includes("Chromium/");
}

// Whether the current webview can play an HLS playlist by itself. Computed once:
// it's a static capability of the engine, and the probe builds a throwaway element.
let nativeHlsCache: boolean | null = null;
export function canPlayNativeHls(): boolean {
  if (nativeHlsCache === null) {
    nativeHlsCache =
      typeof document !== "undefined" &&
      isNativeHlsPlayable(
        isChromiumEngine(),
        document.createElement("video").canPlayType(HLS_MIME),
      );
    log.info(`hls: native support=${nativeHlsCache}`);
  }
  return nativeHlsCache;
}

// What hls.js reports on `Hls.Events.ERROR`. Only `fatal` entries are worth a
// log line: the non-fatal ones are retried internally (a segment not written yet
// is normal on an EVENT playlist).
type HlsErrorData = {
  fatal?: boolean;
  type?: string;
  details?: string;
  reason?: string;
  response?: { code?: number };
};

// One log line for a fatal hls.js error, or null when it is not fatal. A packaged
// webview has no devtools, so without this a failed stream is silent: the element
// just stays at 00:00 with no message on screen.
export function describeHlsError(data: HlsErrorData): string | null {
  if (data.fatal !== true) {
    return null;
  }
  const parts = [`type=${data.type ?? "?"}`, `details=${data.details ?? "?"}`];
  if (data.reason !== undefined) {
    parts.push(`reason=${data.reason}`);
  }
  const httpCode = data.response?.code;
  if (httpCode !== undefined) {
    parts.push(`http=${httpCode}`);
  }
  return parts.join(" ");
}

// Drive `element` from an HLS playlist with hls.js. Resolves to a teardown that
// destroys the instance (hls.js keeps network/buffer timers alive otherwise), or
// null when MSE is unavailable - then the playlist is left to the element itself.
// Fatal errors go to `onError`, since the app log is the only place a packaged
// webview can tell us why the picture never appears.
export async function attachHlsJs(
  element: HTMLVideoElement,
  url: string,
  onError?: (message: string) => void,
): Promise<(() => void) | null> {
  const { default: Hls } = await import("hls.js");
  if (!Hls.isSupported()) {
    log.warn("hls: MediaSource unsupported in this webview");
    return null;
  }
  log.info(`hls: attach hls.js url=${url}`);
  const hls = new Hls();
  hls.on(Hls.Events.ERROR, (_event, data: HlsErrorData) => {
    const message = describeHlsError(data);
    if (message !== null) {
      onError?.(message);
    }
  });
  hls.loadSource(url);
  hls.attachMedia(element);
  return () => {
    log.debug("hls: detach hls.js");
    hls.destroy();
  };
}
