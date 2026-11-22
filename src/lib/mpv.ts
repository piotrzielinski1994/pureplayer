import {
  command,
  getProperty,
  init as mpvInit,
  observeProperties,
  setProperty,
  setVideoMarginRatio,
  destroy as mpvDestroy,
} from "tauri-plugin-libmpv-api";

export type MpvHandle = {
  available: boolean;
};

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
            hwdec: "auto-safe",
            "keep-open": "yes",
            "force-window": "yes",
            "osc": "no",
            "osd-level": 0,
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
      return true;
    } catch (e) {
      console.error("mpv init failed", e);
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
  await command("loadfile", [path, "replace"]);
}

export async function mpvPlay(): Promise<void> {
  await setProperty("pause", false);
}

export async function mpvPause(): Promise<void> {
  await setProperty("pause", true);
}

export async function mpvSeek(timeSec: number): Promise<void> {
  await command("seek", [timeSec, "absolute"]);
}

export async function mpvSetVolume(volume: number): Promise<void> {
  await setProperty("volume", Math.round(volume * 100));
}

export async function mpvSetMuted(muted: boolean): Promise<void> {
  await setProperty("mute", muted);
}

export async function mpvSetSpeed(speed: number): Promise<void> {
  await setProperty("speed", speed);
}

// Draw a message with mpv's own OSD. The native mpv window covers the webview,
// so a React overlay never shows over MKV video - OSD is the only way to put
// text on screen there (CLAUDE.md playback rules).
export async function mpvShowText(
  message: string,
  durationMs: number,
): Promise<void> {
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
