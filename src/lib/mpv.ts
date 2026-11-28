import {
  command,
  getProperty,
  init as mpvInit,
  observeProperties,
  setProperty,
  setVideoMarginRatio,
  destroy as mpvDestroy,
} from "tauri-plugin-libmpv-api";
import { log, logError } from "@/lib/logging/log";

export type MpvHandle = {
  available: boolean;
};

const HWDEC = "auto-safe";
const HWDEC_COPY = "auto-copy";

let initialized = false;
let initPromise: Promise<boolean> | null = null;

export async function ensureMpv(): Promise<boolean> {
  if (initialized) return true;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      await mpvInit(
        {
          initialOptions: {
            vo: "gpu-next",
            hwdec: HWDEC,
            "keep-open": "yes",
            "force-window": "yes",
            "osc": "no",
            "osd-level": 0,
            // Keep text (SRT) subtitles on the video area only; with our
            // UI margins (sidebar/logs) mpv would otherwise render them in
            // the black borders, overlapping panels.
            "sub-use-margins": "no",
            "sub-ass-force-margins": "no",
            // The only OSD drawn is the track list: several long lines, which
            // the default 55px font would overflow the window with.
            "osd-font-size": 24,
          },
          observedProperties: [
            ["pause", "flag"],
            ["time-pos", "double", "none"],
            ["duration", "double", "none"],
            ["eof-reached", "flag"],
            ["speed", "double"],
          ],
        },
        undefined,
      );
      initialized = true;
      log.info("mpv: initialized");
      return true;
    } catch (e) {
      logError("mpv: init failed", e);
      initialized = false;
      initPromise = null;
      return false;
    }
  })();
  return initPromise;
}

export function isMpvInitialized(): boolean {
  return initialized;
}

export async function mpvLoadFile(path: string): Promise<void> {
  log.info(`mpv: loadfile path=${path}`);
  await command("loadfile", [path, "replace"]);
}

export async function mpvPlay(): Promise<void> {
  log.info("mpv: play");
  await setProperty("pause", false);
}

export async function mpvPause(): Promise<void> {
  log.info("mpv: pause");
  await setProperty("pause", true);
}

export async function mpvSeek(timeSec: number): Promise<void> {
  log.info(`mpv: seek ${timeSec.toFixed(2)}s`);
  await command("seek", [timeSec, "absolute"]);
}

export async function mpvSetVolume(volume: number): Promise<void> {
  const percent = Math.round(volume * 100);
  log.debug(`mpv: volume=${percent}`);
  await setProperty("volume", percent);
}

export async function mpvSetMuted(muted: boolean): Promise<void> {
  log.debug(`mpv: muted=${muted}`);
  await setProperty("mute", muted);
}

export async function mpvSetSpeed(speed: number): Promise<void> {
  log.debug(`mpv: speed=${speed}`);
  await setProperty("speed", speed);
}

// Select a subtitle track by its mpv track id, or "no" to disable subtitles.
// Only meaningful in mpv mode; the ffmpeg fallback has no selectable tracks.
export async function mpvSetSubtitle(trackId: number | null): Promise<void> {
  log.info(`mpv: subtitle track=${trackId ?? "off"}`);
  // Make sure subtitles are actually rendered (mpv may have them disabled).
  await setProperty("sub-visibility", true);
  if (trackId === null) {
    try {
      await setProperty("sid", "no");
    } catch {
      await command("set", ["sid", "no"]);
    }
  } else {
    try {
      await setProperty("sid", trackId);
    } catch {
      await command("set", ["sid", String(trackId)]);
    }
  }
}

// Select an audio track by its mpv track id, or "no" to disable audio.
// Only meaningful in mpv mode; the ffmpeg fallback has no selectable tracks.
export async function mpvSetAudio(trackId: number | null): Promise<void> {
  log.info(`mpv: audio track=${trackId ?? "off"}`);
  if (trackId === null) {
    try {
      await setProperty("aid", "no");
    } catch {
      await command("set", ["aid", "no"]);
    }
  } else {
    try {
      await setProperty("aid", trackId);
    } catch {
      await command("set", ["aid", String(trackId)]);
    }
  }
}

// Invert the picture through mpv's own filter chain. The native mpv window is
// drawn above the webview, so a CSS filter on the <video> never reaches it.
// Setting the `vf` property (rather than the `vf` command) replaces the whole
// chain in one step, which is the same proven setProperty path as volume/speed.
//
// `negate` is a software filter: with zero-copy hwdec (d3d11va) mpv cannot
// configure the graph ("Impossible to convert between the formats", then
// "Disabling filter negate.00 because it has failed") and the picture stays
// untouched. Switching hwdec to the copy variant keeps hardware decoding - the
// frames are only copied out of the GPU - so the filter works.

export async function mpvSetInvertColors(inverted: boolean): Promise<void> {
  log.info(`mpv: invert colors=${inverted}`);
  if (inverted) {
    await setProperty("hwdec", HWDEC_COPY);
    await setProperty("vf", "negate");
    return;
  }
  await setProperty("vf", "");
  await setProperty("hwdec", HWDEC);
}

// The <video> CSS transform cannot reach the mpv picture either. Cover crops
// with full panscan, fill drops the aspect ratio; mpv takes zoom as log2.
export async function mpvSetTransform(transform: {
  rotationDeg: number;
  fitMode: "contain" | "cover" | "fill";
  zoom: number;
}): Promise<void> {
  log.info(
    `mpv: transform rotation=${transform.rotationDeg} fit=${transform.fitMode} zoom=${transform.zoom}`,
  );
  await setProperty("video-rotate", transform.rotationDeg);
  await setProperty("keepaspect", transform.fitMode !== "fill");
  await setProperty("panscan", transform.fitMode === "cover" ? 1 : 0);
  await setProperty("video-zoom", Math.log2(transform.zoom));
}

// Draw a message with mpv's own OSD. The native mpv window covers the webview,
// so a React overlay never shows over MKV video - OSD is the only way to put
// text on screen there (CLAUDE.md playback rules).
export async function mpvShowText(
  message: string,
  durationMs: number,
): Promise<void> {
  log.debug(`mpv: osd text=${message}`);
  await command("show-text", [message, durationMs]);
}

export async function mpvSetMargins(ratio: {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}): Promise<void> {
  try {
    await setVideoMarginRatio(ratio);
  } catch {
    // ignore
  }
}

export async function mpvDestroyAndReset(): Promise<void> {
  log.info("mpv: destroy and reset");
  try {
    await setProperty("force-window", "no");
  } catch {
    // ignore
  }
  try {
    await setProperty("keep-open", "no");
  } catch {
    // ignore
  }
  try {
    await command("quit");
  } catch {
    // ignore
  }
  try {
    await mpvDestroy();
  } catch {
    // ignore
  }
  initialized = false;
  initPromise = null;
}

export { observeProperties, getProperty, mpvDestroy };
export { command as mpvCommand };
