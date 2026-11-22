import { Film, Loader2, Pause } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  formatTrackListOsd,
  trackFromProperties,
} from "@/components/workspace/track-list";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  attachHlsJs,
  canPlayNativeHls,
  needsHlsJs,
  seekTarget,
} from "@/lib/hls";
import {
  ensureMpv,
  getProperty,
  mpvDestroyAndReset,
  mpvLoadFile,
  mpvPause,
  mpvPlay,
  mpvSeek,
  mpvSetMargins,
  mpvSetMuted,
  mpvSetSpeed,
  mpvSetVolume,
  mpvShowText,
  observeProperties,
} from "@/lib/mpv";
import {
  describeElementState,
  formatTimeline,
  resolveDuration,
} from "@/lib/playback-timing";
import {
  logPlayback,
  prepareMediaUrl,
  seekMediaUrl,
  toggleFullscreen,
  watchAudioReady,
} from "@/lib/tauri";

// mpv fills `track-list` asynchronously after `loadfile`, so the read is retried
// briefly before giving up on the listing.
const TRACK_LIST_ATTEMPTS = 10;
const TRACK_LIST_RETRY_MS = 300;
const TRACK_LIST_OSD_MS = 8000;

// Show the file's audio/subtitle tracks in mpv's OSD. Best-effort: an empty or
// failed read only means no listing, never a playback error.
async function readMpvProperty(
  name: string,
  format: "int64" | "string" | "flag",
): Promise<unknown> {
  try {
    return await getProperty(name, format);
  } catch {
    return null;
  }
}

async function showMpvTrackList() {
  for (let attempt = 0; attempt < TRACK_LIST_ATTEMPTS; attempt++) {
    try {
      const count = await readMpvProperty("track-list/count", "int64");
      if (typeof count !== "number" || count <= 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, TRACK_LIST_RETRY_MS),
        );
        continue;
      }
      const tracks = [];
      for (let index = 0; index < count; index++) {
        const [id, type, codec, lang, title, isDefault, isForced] =
          await Promise.all([
            readMpvProperty(`track-list/${index}/id`, "int64"),
            readMpvProperty(`track-list/${index}/type`, "string"),
            readMpvProperty(`track-list/${index}/codec`, "string"),
            readMpvProperty(`track-list/${index}/lang`, "string"),
            readMpvProperty(`track-list/${index}/title`, "string"),
            readMpvProperty(`track-list/${index}/default`, "flag"),
            readMpvProperty(`track-list/${index}/forced`, "flag"),
          ]);
        const track = trackFromProperties({
          id: typeof id === "number" ? id : null,
          type,
          codec,
          lang,
          title,
          isDefault,
          isForced,
        });
        if (track) {
          tracks.push(track);
        }
      }
      const osd = formatTrackListOsd(tracks);
      if (osd) {
        await mpvShowText(osd, TRACK_LIST_OSD_MS);
        return;
      }
    } catch (error) {
      void logPlayback(
        `viewport: mpv track-list read failed: ${String(error)}`,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, TRACK_LIST_RETRY_MS));
  }
  void logPlayback("viewport: mpv track-list: gave up, never got a list");
}

function logPlayError(error: unknown) {
  console.error("video play() rejected", error);
  void logPlayback(`video play() rejected: ${String(error)}`);
}

// The fields that explain a silent stall at 00:00: an element that buffered but
// stayed paused differs from one that never buffered at all.
function snapshotElement(element: HTMLVideoElement) {
  return {
    paused: element.paused,
    readyState: element.readyState,
    currentTime: element.currentTime,
    errorCode: element.error?.code ?? null,
    bufferedEnds: Array.from({ length: element.buffered.length }, (_, index) =>
      element.buffered.end(index),
    ),
  };
}

type TimelineMarks = {
  forId: string;
  name: string;
  activatedAtMs: number;
  prepareResolvedAtMs: number | null;
  firstFrameAtMs: number | null;
};

type SourceState =
  | {
      status: "ready";
      forId: string;
      url: string;
      durationSec: number | null;
      // Set while a silent (video-only) source is playing and its full-audio
      // file is still encoding; the matching audio-ready event swaps src in.
      swapId: number | null;
    }
  | { status: "error"; forId: string; message: string };

export function Viewport() {
  const {
    activeMedia,
    isPlaying,
    seekToSec,
    volume,
    isMuted,
    playbackRate,
    isFullscreen,
    viewportTransform,
    togglePlay,
    reportProgress,
    reportEnded,
  } = useWorkspace();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<SourceState | null>(null);
  const [mpvActive, setMpvActive] = useState(false);
  const [mpvAvailable, setMpvAvailable] = useState<boolean | null>(null);
  const mpvUnlistenRef = useRef<(() => void) | null>(null);
  const wasMpvRef = useRef(false);
  const mpvTimeRef = useRef<number | null>(null);
  const mpvDurationRef = useRef<number | null>(null);
  // Film time where the current HLS job started. An HLS playlist always begins at
  // 0, so after a seek-restart the element time is offset from the real position.
  const hlsBaseRef = useRef(0);
  // Latest seek-restart request, so a slow one cannot overwrite a newer one.
  const seekRestartTokenRef = useRef(0);
  const [titleHiddenForId, setTitleHiddenForId] = useState<string | null>(null);
  const [speedOverlayVisible, setSpeedOverlayVisible] = useState(false);
  const [pauseOverlayVisible, setPauseOverlayVisible] = useState(false);
  const prevRateRef = useRef(playbackRate);
  const prevPlayingRef = useRef(isPlaying);
  const speedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Drop->first-frame timeline marks for the active video. Best-effort timing for
  // the log file; never gates render. Emitted once all three marks land.
  const timelineRef = useRef<TimelineMarks | null>(null);

  const emitTimelineOnFirstFrame = () => {
    const marks = timelineRef.current;
    if (!marks || marks.prepareResolvedAtMs === null) {
      return;
    }
    if (marks.firstFrameAtMs !== null) {
      return;
    }
    marks.firstFrameAtMs = performance.now();
    void logPlayback(
      formatTimeline(marks.name, {
        activatedAtMs: marks.activatedAtMs,
        prepareResolvedAtMs: marks.prepareResolvedAtMs,
        firstFrameAtMs: marks.firstFrameAtMs,
      }),
    );
  };

  // The title is a brief intro card, not a permanent watermark: visible for 5s
  // whenever the active video changes, then the timer marks THIS id as hidden.
  // Switching files changes the id, so the title re-shows for the new one.
  const TITLE_VISIBLE_MS = 5000;
  useEffect(() => {
    const id = activeMedia?.id;
    if (id === undefined) {
      return;
    }
    const timer = setTimeout(() => setTitleHiddenForId(id), TITLE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [activeMedia?.id]);

  // Briefly surface the newly set playback speed in the top-right corner.
  const SPEED_OVERLAY_MS = 1000;
  useEffect(() => {
    if (playbackRate === prevRateRef.current) {
      return;
    }
    prevRateRef.current = playbackRate;
    setSpeedOverlayVisible(true);
    if (speedTimerRef.current !== null) {
      clearTimeout(speedTimerRef.current);
    }
    speedTimerRef.current = setTimeout(
      () => setSpeedOverlayVisible(false),
      SPEED_OVERLAY_MS,
    );
    return () => {
      if (speedTimerRef.current !== null) {
        clearTimeout(speedTimerRef.current);
        speedTimerRef.current = null;
      }
    };
  }, [playbackRate]);

  // Briefly show a pause icon in the center when playback pauses.
  const PAUSE_OVERLAY_MS = 1000;
  useEffect(() => {
    if (prevPlayingRef.current && !isPlaying) {
      setPauseOverlayVisible(true);
      if (pauseTimerRef.current !== null) {
        clearTimeout(pauseTimerRef.current);
      }
      pauseTimerRef.current = setTimeout(
        () => setPauseOverlayVisible(false),
        PAUSE_OVERLAY_MS,
      );
    } else if (!prevPlayingRef.current || isPlaying) {
      setPauseOverlayVisible(false);
      if (pauseTimerRef.current !== null) {
        clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = null;
      }
    }
    prevPlayingRef.current = isPlaying;
    return () => {
      if (pauseTimerRef.current !== null) {
        clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = null;
      }
    };
  }, [isPlaying]);

  // A single click toggles play/pause instantly (no debounce, so it feels as
  // snappy as the transport button). A double click goes fullscreen: the DOM
  // fires `click` twice before `dblclick`, so the two toggles cancel out (net
  // no change) and fullscreen lands on top - no stray toggle, no delay.
  // Check mpv availability once.
  useEffect(() => {
    void ensureMpv().then((ok) => setMpvAvailable(ok));
  }, []);

  // mpv renders its native video over the whole window. Constrain it to this
  // viewport's box via margins so it never draws over the sidebar (or logs /
  // transport regions) - otherwise the video is centered in the whole window and
  // the sidebar visually overlaps it.
  useEffect(() => {
    if (!mpvActive) {
      return;
    }
    const compute = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const left = Math.max(0, Math.min(1, rect.left / w));
      const right = Math.max(0, Math.min(1, (w - rect.right) / w));
      const top = Math.max(0, Math.min(1, rect.top / h));
      const bottom = Math.max(0, Math.min(1, (h - rect.bottom) / h));
      void mpvSetMargins({ left, right, top, bottom }).catch(() => {});
    };
    // Defer to next frame so layout (resizable panels) has settled.
    const raf = requestAnimationFrame(compute);
    const ro = new ResizeObserver(() => requestAnimationFrame(compute));
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", compute);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", compute);
      void mpvSetMargins({ left: 0, right: 0, top: 0, bottom: 0 }).catch(
        () => {},
      );
    };
  }, [mpvActive]);

  const handleClick = () => {
    if (!activeMedia) {
      return;
    }
    togglePlay();
  };

  // Resolve the playable source for the active file. The Rust side probes it and
  // transcodes unsupported codecs (AV1/VP9/Opus/...) to H.264/AAC, which can take
  // a few seconds. While the resolved source is not (yet) for the active video,
  // we render the "preparing" state - no synchronous reset needed.
  useEffect(() => {
    if (!activeMedia) {
      return;
    }
    const isMkv = activeMedia.path.toLowerCase().endsWith(".mkv");
    // Wait for the mpv availability check before choosing a path: starting ffmpeg
    // for an MKV that mpv can play wastes CPU transcoding the whole file.
    if (mpvAvailable === null) {
      return;
    }
    const useMpv = isMkv && mpvAvailable === true;
    let cancelled = false;
    const forId = activeMedia.id;

    const cleanup = () => {
      cancelled = true;
      mpvUnlistenRef.current?.();
      mpvUnlistenRef.current = null;
    };

    const prepareFfmpeg = () => {
      setMpvActive(false);
      timelineRef.current = {
        forId,
        name: activeMedia.name,
        activatedAtMs: performance.now(),
        prepareResolvedAtMs: null,
        firstFrameAtMs: null,
      };
      prepareMediaUrl(activeMedia.path)
        .then(({ url, durationSec, swapId }) => {
          const marks = timelineRef.current;
          if (marks && marks.forId === forId) {
            marks.prepareResolvedAtMs = performance.now();
          }
          hlsBaseRef.current = 0;
          if (!cancelled) {
            setSource({ status: "ready", forId, url, durationSec, swapId });
          }
        })
        .catch((error) => {
          console.error("prepare_media failed", error);
          void logPlayback(`playback "${activeMedia.name}": prepare FAILED`);
          if (!cancelled) {
            setSource({ status: "error", forId, message: String(error) });
          }
        });
    };

    if (useMpv) {
      wasMpvRef.current = true;
      setMpvActive(true);
      setSource(null);
      void (async () => {
        const ok = await ensureMpv();
        if (cancelled) return;
        if (!ok) {
          setMpvActive(false);
          prepareFfmpeg();
          return;
        }
        try {
          await mpvLoadFile(activeMedia.path);
          if (cancelled) return;
          const unlisten = await observeProperties(
            [
              ["time-pos", "double", "none"],
              ["duration", "double", "none"],
              ["eof-reached", "flag"],
            ],
            ({ name, data }) => {
              if (name === "time-pos" && typeof data === "number") {
                mpvTimeRef.current = data;
                reportProgress(data, mpvDurationRef.current ?? 0);
              }
              if (name === "duration" && typeof data === "number") {
                mpvDurationRef.current = data;
                reportProgress(mpvTimeRef.current ?? 0, data);
              }
              if (name === "eof-reached" && data === true) {
                reportEnded();
              }
            },
          );
          if (cancelled) {
            unlisten?.();
            return;
          }
          mpvUnlistenRef.current = unlisten;
          // The track listing is a readout only: it never blocks the load.
          void showMpvTrackList();
        } catch (e) {
          void logPlayback(
            `viewport: mpv load failed, falling back to ffmpeg: ${String(e)}`,
          );
          console.error("mpv load failed, falling back to ffmpeg", e);
          if (!cancelled) {
            setMpvActive(false);
            prepareFfmpeg();
          }
        }
      })();
      return cleanup;
    }

    // non-mpv path: tear down mpv if it was active
    if (wasMpvRef.current) {
      wasMpvRef.current = false;
      void mpvDestroyAndReset().then(() => {
        if (cancelled) return;
        prepareFfmpeg();
      });
    } else {
      prepareFfmpeg();
    }
    return cleanup;
  }, [activeMedia?.id, activeMedia, mpvAvailable]);

  // Two-phase swap: when the background audio re-encode finishes, the backend
  // emits audio-ready with the matching swapId. We point the <video> at the
  // full-audio file by updating state (React sets the src prop); the new file
  // reloads from 0, so we stash the play position in resumeAfterSwapRef and the
  // loadedmetadata handler restores it - the only user-visible change is sound.
  const resumeAfterSwapRef = useRef<number | null>(null);
  useEffect(() => {
    let unlisten = () => {};
    void watchAudioReady(({ swapId, url }) => {
      setSource((current) => {
        if (current?.status !== "ready" || current.swapId !== swapId) {
          return current;
        }
        resumeAfterSwapRef.current = videoRef.current?.currentTime ?? 0;
        return { ...current, url, swapId: null };
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten();
  }, []);

  const sourceForActive =
    activeMedia && source?.forId === activeMedia.id ? source : null;
  // Read inside the seek effect, which must not re-run (and re-seek) whenever a
  // new source object appears.
  const sourceRef = useRef(sourceForActive);
  sourceRef.current = sourceForActive;

  useEffect(() => {
    if (mpvActive) {
      if (isPlaying) {
        void mpvPlay().catch(() => {});
      } else {
        void mpvPause().catch(() => {});
      }
      return;
    }
    const element = videoRef.current;
    if (!element) {
      return;
    }
    if (isPlaying) {
      void element.play().catch(logPlayError);
      return;
    }
    element.pause();
  }, [isPlaying, mpvActive]);

  // The <video> only mounts once the source resolves (and remounts when an
  // audio swap points it at a new url), so the url is a dependency: without it
  // an element that appears after boot would keep the browser defaults instead
  // of the seeded volume/mute/rate.
  const sourceUrl =
    sourceForActive?.status === "ready" ? sourceForActive.url : null;

  // An HLS playlist on a webview without native HLS (Chromium: WebView2, WebKitGTK)
  // is fed by hls.js over MSE, so the element must NOT get a src - hls.js owns it.
  // WKWebView plays the playlist itself, and complete files never take this path.
  const hlsUrl =
    sourceUrl !== null && needsHlsJs(sourceUrl, canPlayNativeHls())
      ? sourceUrl
      : null;

  // hls.js keeps network/buffer timers and a MediaSource alive; destroy it on every
  // url change and on unmount. The import is async, so a teardown that arrives after
  // the effect was already cleaned up is applied immediately.
  useEffect(() => {
    const element = videoRef.current;
    if (!element || hlsUrl === null) {
      return;
    }
    let cancelled = false;
    let teardown: (() => void) | null = null;
    void logPlayback(`hls attach url=${hlsUrl}`);
    void attachHlsJs(element, hlsUrl, (message) => {
      void logPlayback(`hls fatal: ${message}`);
    }).then((destroy) => {
      if (cancelled) {
        destroy?.();
        return;
      }
      if (destroy === null) {
        void logPlayback("hls unsupported: no MediaSource in this webview");
      }
      teardown = destroy;
    });
    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [hlsUrl]);

  // A seek splits two ways on the HLS path: inside the segments ffmpeg already wrote
  // the element seeks itself, past them the backend restarts the encode at the target
  // and the new playlist begins there - hlsBaseRef maps element time back to film
  // time, so the transport keeps showing the real position. Complete files keep the
  // plain element seek they always had.
  useEffect(() => {
    if (mpvActive) {
      if (seekToSec !== null) {
        void mpvSeek(seekToSec).catch(() => {});
      }
      return;
    }
    const element = videoRef.current;
    if (!element || seekToSec === null) {
      return;
    }
    if (hlsUrl !== null) {
      const base = hlsBaseRef.current;
      const encoded = Number.isFinite(element.duration) ? element.duration : 0;
      if (seekTarget(seekToSec - base, encoded) === "native") {
        element.currentTime = seekToSec - base;
        if (isPlaying && element.paused) {
          void element.play().catch(logPlayError);
        }
        return;
      }
      const current = sourceRef.current;
      if (current?.status !== "ready") {
        return;
      }
      const token = ++seekRestartTokenRef.current;
      void logPlayback(`hls seek restart at ${seekToSec.toFixed(2)}s`);
      void seekMediaUrl(seekToSec)
        .then((url) => {
          if (token !== seekRestartTokenRef.current) {
            return;
          }
          hlsBaseRef.current = seekToSec;
          setSource({
            status: "ready",
            forId: current.forId,
            url,
            durationSec: current.durationSec,
            swapId: null,
          });
        })
        .catch((error) => {
          void logPlayback(`hls seek failed: ${String(error)}`);
        });
      return;
    }
    element.currentTime = seekToSec;
    // A seek issued while isPlaying must resume the element. The play-effect
    // only re-fires when isPlaying flips, so a replay-in-place (repeat-one: ended
    // pauses the element, isPlaying stays true) would otherwise stay paused.
    if (isPlaying && element.paused) {
      void element.play().catch(logPlayError);
    }
  }, [seekToSec, isPlaying, hlsUrl, mpvActive]);

  useEffect(() => {
    if (mpvActive) {
      void mpvSetVolume(volume).catch(() => {});
      void mpvSetMuted(isMuted).catch(() => {});
      void mpvSetSpeed(playbackRate).catch(() => {});
      return;
    }
    const element = videoRef.current;
    if (!element) {
      return;
    }
    element.volume = volume;
    element.muted = isMuted;
    element.playbackRate = playbackRate;
  }, [volume, isMuted, playbackRate, sourceUrl, mpvActive]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Media viewport"
      onClick={handleClick}
      onDoubleClick={() => void toggleFullscreen()}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden ${mpvActive ? "bg-transparent" : "bg-black"}`}
    >
      {!activeMedia && (
        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Film className="size-10" />
          <p className="text-sm">No media selected</p>
        </div>
      )}
      {activeMedia && !mpvActive && !sourceForActive && (
        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="size-10 animate-spin" />
          <p className="text-sm">Preparing {activeMedia.name}…</p>
        </div>
      )}
      {activeMedia && sourceForActive?.status === "error" && (
        <div className="flex max-w-md flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
          <Film className="size-10" />
          <p className="text-sm font-medium text-white">
            Could not play this file
          </p>
          <p className="text-xs">{sourceForActive.message}</p>
        </div>
      )}
      {activeMedia && (mpvActive || sourceForActive?.status === "ready") && (
        <>
          {!mpvActive && (
            <video
              ref={videoRef}
              src={
                hlsUrl === null
                  ? sourceForActive?.status === "ready"
                    ? sourceForActive.url
                    : undefined
                  : undefined
              }
              className="h-full w-full"
              style={{
                objectFit: viewportTransform.fitMode,
                transform: `rotate(${viewportTransform.rotationDeg}deg) scale(${viewportTransform.zoom})`,
                transformOrigin: "center",
              }}
              onCanPlay={(event) => {
                if (hlsUrl !== null) {
                  void logPlayback(
                    describeElementState(snapshotElement(event.currentTarget)),
                  );
                }
                emitTimelineOnFirstFrame();
              }}
              onLoadedData={(event) => {
                if (isPlaying) {
                  void event.currentTarget.play().catch(logPlayError);
                }
              }}
              onTimeUpdate={(event) =>
                reportProgress(
                  hlsBaseRef.current + event.currentTarget.currentTime,
                  resolveDuration(
                    event.currentTarget.duration,
                    sourceForActive?.status === "ready"
                      ? sourceForActive.durationSec
                      : null,
                  ),
                )
              }
              onLoadedMetadata={(event) => {
                if (resumeAfterSwapRef.current !== null) {
                  event.currentTarget.currentTime = resumeAfterSwapRef.current;
                  resumeAfterSwapRef.current = null;
                }
                reportProgress(
                  hlsBaseRef.current + event.currentTarget.currentTime,
                  resolveDuration(
                    event.currentTarget.duration,
                    sourceForActive?.status === "ready"
                      ? sourceForActive.durationSec
                      : null,
                  ),
                );
              }}
              onEnded={() => reportEnded()}
            />
          )}
          {!isFullscreen && titleHiddenForId !== activeMedia.id && (
            <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-sm text-white">
              {activeMedia.name}
            </p>
          )}
        </>
      )}
      {activeMedia && speedOverlayVisible && (
        <div
          data-testid="speed-overlay"
          className="pointer-events-none absolute right-3 top-3 z-10 px-3 py-1.5 font-mono text-lg font-bold text-white"
        >
          {playbackRate}x
        </div>
      )}
      {activeMedia && pauseOverlayVisible && (
        <div
          data-testid="pause-overlay"
          role="img"
          aria-label="Pause"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
        >
          <Pause className="size-24 text-white drop-shadow-lg" />
        </div>
      )}
    </div>
  );
}
