import { Film, Loader2, Pause, Power } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  type MediaTrack,
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
  mpvSetAudio,
  mpvSetInvertColors,
  mpvSetMargins,
  mpvSetMuted,
  mpvSetSpeed,
  mpvSetSubtitle,
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
  quitApp,
  seekMediaUrl,
  toggleFullscreen,
  watchAudioReady,
} from "@/lib/tauri";

// mpv fills `track-list` asynchronously after `loadfile`, so the read is retried
// briefly before giving up on the listing.
const TRACK_LIST_ATTEMPTS = 10;
const TRACK_LIST_RETRY_MS = 300;

// Read the file's audio/subtitle tracks for the in-app pickers. Best-effort: an
// empty or failed read only means no tracks, never a playback error.
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

async function readMpvTrackList(): Promise<MediaTrack[]> {
  const collected: MediaTrack[] = [];
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
          collected.push(track);
        }
      }
      if (tracks.length > 0) {
        return collected;
      }
    } catch (error) {
      void logPlayback(
        `viewport: mpv track-list read failed: ${String(error)}`,
      );
      return collected;
    }
    await new Promise((resolve) => setTimeout(resolve, TRACK_LIST_RETRY_MS));
  }
  void logPlayback("viewport: mpv track-list: gave up, never got a list");
  return collected;
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
    resumeAtSec,
    clearResume,
    seek,
    volume,
    isMuted,
    playbackRate,
    isFullscreen,
    viewportTransform,
    togglePlay,
    reportProgress,
    reportEnded,
    setMpvSubtitleTracks,
    mpvSubtitleTracks,
    setMpvAudioTracks,
    mpvAudioTracks,
    subtitlePickerOpen,
    setSubtitlePickerOpen,
    audioPickerOpen,
    setAudioPickerOpen,
  } = useWorkspace();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<SourceState | null>(null);
  const [mpvActive, setMpvActive] = useState(false);
  // True once `loadfile` resolved: mpv can only seek a file that is queued.
  const [mpvLoaded, setMpvLoaded] = useState(false);
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
  const [cornerText, setCornerText] = useState<string | null>(null);
  const [pauseOverlayVisible, setPauseOverlayVisible] = useState(false);
  const prevRateRef = useRef(playbackRate);
  const prevVolumeRef = useRef({ volume, isMuted });
  const prevPlayingRef = useRef(isPlaying);
  const cornerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Briefly surface the newly set speed or volume in the top-right corner; one
  // slot, so the latest change replaces the previous text.
  const CORNER_OVERLAY_MS = 1000;
  const flashCorner = useCallback((text: string) => {
    setCornerText(text);
    if (cornerTimerRef.current !== null) {
      clearTimeout(cornerTimerRef.current);
    }
    cornerTimerRef.current = setTimeout(
      () => setCornerText(null),
      CORNER_OVERLAY_MS,
    );
  }, []);
  useEffect(
    () => () => {
      if (cornerTimerRef.current !== null) {
        clearTimeout(cornerTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (playbackRate === prevRateRef.current) {
      return;
    }
    prevRateRef.current = playbackRate;
    flashCorner(`${playbackRate}x`);
  }, [playbackRate, flashCorner]);

  useEffect(() => {
    const previous = prevVolumeRef.current;
    if (previous.volume === volume && previous.isMuted === isMuted) {
      return;
    }
    prevVolumeRef.current = { volume, isMuted };
    const text = isMuted ? "Muted" : `Volume: ${Math.round(volume * 100)}%`;
    flashCorner(text);
    if (mpvActive) {
      // The HTML overlay is hidden under the mpv window; {\an9} aligns the
      // OSD message top-right.
      void mpvShowText(`\${osd-ass-cc/0}{\\an9}${text}`, CORNER_OVERLAY_MS);
    }
  }, [volume, isMuted, mpvActive, flashCorner]);

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
    setSubtitlePickerOpen(false);
    setAudioPickerOpen(false);
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
      setMpvLoaded(false);
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
          // A resume chosen while the file was still loading is applied by the
          // resume effect once this flag flips (the same path a click uses).
          setMpvLoaded(true);
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
          void readMpvTrackList().then((tracks) => {
            setMpvSubtitleTracks(tracks.filter((t) => t.kind === "subtitle"));
            setMpvAudioTracks(tracks.filter((t) => t.kind === "audio"));
          });
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

    // non-mpv path: no selectable tracks; clear any stale list from a previous MKV.
    setMpvSubtitleTracks([]);
    setMpvAudioTracks([]);
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

  // A resume accepted AFTER the media loaded still has to land: the one-shot
  // load handlers have already run by then. mpv needs a queued file, and the
  // <video> needs metadata (otherwise its loadedmetadata handler applies it).
  useEffect(() => {
    if (resumeAtSec === null) {
      return;
    }
    if (mpvActive) {
      if (!mpvLoaded) {
        return;
      }
      void mpvSeek(resumeAtSec)
        .catch(() => {})
        .finally(() => clearResume());
      return;
    }
    const element = videoRef.current;
    if (
      !element ||
      sourceUrl === null ||
      element.readyState < HTMLMediaElement.HAVE_METADATA
    ) {
      return;
    }
    seek(resumeAtSec);
    clearResume();
  }, [resumeAtSec, mpvActive, mpvLoaded, sourceUrl, seek, clearResume]);

  // mpv draws its own window above the webview, so the <video> CSS filter cannot
  // reach the picture: invert through mpv's `negate` filter instead. Re-applied
  // whenever mpv (re)starts, because a fresh mpv instance has no filters. The
  // toggle is confirmed with mpv's OSD (no React overlay shows over the native
  // window) and only when the user actually flipped it, not on every load.
  const prevInvertRef = useRef(viewportTransform.invertColors === true);
  useEffect(() => {
    const inverted = viewportTransform.invertColors === true;
    const toggled = prevInvertRef.current !== inverted;
    prevInvertRef.current = inverted;
    if (toggled) {
      void logPlayback(
        `viewport: invert=${inverted} path=${mpvActive ? "mpv" : "html"}`,
      );
    }
    if (!mpvActive) {
      return;
    }
    void ensureMpv().then((ok) => {
      if (!ok) {
        return;
      }
      void mpvSetInvertColors(inverted)
        .then(() => {
          if (toggled) {
            void mpvShowText(`Invert: ${inverted ? "on" : "off"}`, 1500);
          }
        })
        .catch((error) => {
          void logPlayback(`viewport: mpv invert failed: ${String(error)}`);
          void mpvShowText(`Invert failed: ${String(error)}`, 3000);
        });
    });
  }, [mpvActive, viewportTransform.invertColors]);

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
    <ContextMenu>
      <ContextMenuTrigger asChild>
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
          {activeMedia &&
            (mpvActive || sourceForActive?.status === "ready") && (
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
                      filter: viewportTransform.invertColors
                        ? "invert(1)"
                        : undefined,
                    }}
                    onCanPlay={(event) => {
                      if (hlsUrl !== null) {
                        void logPlayback(
                          describeElementState(
                            snapshotElement(event.currentTarget),
                          ),
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
                        event.currentTarget.currentTime =
                          resumeAfterSwapRef.current;
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
                      // Resume a saved position only once the element has metadata;
                      // the regular seek effect then handles native vs HLS restart.
                      if (resumeAtSec !== null) {
                        seek(resumeAtSec);
                        clearResume();
                      }
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
          {activeMedia && cornerText !== null && (
            <div
              data-testid="corner-overlay"
              className="pointer-events-none absolute right-3 top-3 z-10 px-3 py-1.5 font-mono text-lg font-bold text-white"
            >
              {cornerText}
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
          {subtitlePickerOpen &&
            createPortal(
              <div
                data-testid="subtitle-picker"
                className="fixed right-3 top-3 z-[9999] max-h-80 w-72 overflow-auto border border-border bg-background p-2 text-sm text-foreground shadow-lg"
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium">Subtitles</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setSubtitlePickerOpen(false)}
                  >
                    ✕
                  </button>
                </div>
                <button
                  type="button"
                  className="block w-full px-2 py-1 text-left hover:bg-muted"
                  onClick={() => {
                    void mpvSetSubtitle(null)
                      .then(() => {
                        void mpvShowText("Subtitles: none", 2000);
                      })
                      .catch((e) => {
                        void mpvShowText(
                          `Subtitle change failed: ${String(e)}`,
                          3000,
                        );
                      });
                    setSubtitlePickerOpen(false);
                  }}
                >
                  None
                </button>
                {mpvSubtitleTracks.length === 0 && (
                  <p className="px-2 py-1 text-muted-foreground">
                    No subtitles
                  </p>
                )}
                {mpvSubtitleTracks.map((track) => (
                  <button
                    key={track.id ?? track.title}
                    type="button"
                    className="block w-full px-2 py-1 text-left hover:bg-muted"
                    onClick={() => {
                      if (track.id !== null) {
                        void mpvSetSubtitle(track.id)
                          .then(() => {
                            void mpvShowText(
                              `Subtitles: ${track.lang ?? track.title ?? track.id}`,
                              2000,
                            );
                          })
                          .catch((e) => {
                            void mpvShowText(
                              `Subtitle change failed: ${String(e)}`,
                              3000,
                            );
                          });
                      }
                      setSubtitlePickerOpen(false);
                    }}
                  >
                    {track.id !== null ? `${track.id}: ` : ""}
                    {track.codec}/{track.lang}
                    {track.title ? ` "${track.title}"` : ""}
                    {track.isDefault ? " [default]" : ""}
                    {track.isForced ? " [forced]" : ""}
                  </button>
                ))}
              </div>,
              document.body,
            )}
          {audioPickerOpen &&
            createPortal(
              <div
                data-testid="audio-picker"
                className="fixed right-3 top-3 z-[9999] max-h-80 w-72 overflow-auto border border-border bg-background p-2 text-sm text-foreground shadow-lg"
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium">Audio</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setAudioPickerOpen(false)}
                  >
                    ✕
                  </button>
                </div>
                <button
                  type="button"
                  className="block w-full px-2 py-1 text-left hover:bg-muted"
                  onClick={() => {
                    void mpvSetAudio(null)
                      .then(() => {
                        void mpvShowText("Audio: none", 2000);
                      })
                      .catch((e) => {
                        void mpvShowText(
                          `Audio change failed: ${String(e)}`,
                          3000,
                        );
                      });
                    setAudioPickerOpen(false);
                  }}
                >
                  None
                </button>
                {mpvAudioTracks.length === 0 && (
                  <p className="px-2 py-1 text-muted-foreground">No audio</p>
                )}
                {mpvAudioTracks.map((track) => (
                  <button
                    key={track.id ?? track.title}
                    type="button"
                    className="block w-full px-2 py-1 text-left hover:bg-muted"
                    onClick={() => {
                      if (track.id !== null) {
                        void mpvSetAudio(track.id)
                          .then(() => {
                            void mpvShowText(
                              `Audio: ${track.lang ?? track.title ?? track.id}`,
                              2000,
                            );
                          })
                          .catch((e) => {
                            void mpvShowText(
                              `Audio change failed: ${String(e)}`,
                              3000,
                            );
                          });
                      }
                      setAudioPickerOpen(false);
                    }}
                  >
                    {track.id !== null ? `${track.id}: ` : ""}
                    {track.codec}/{track.lang}
                    {track.title ? ` "${track.title}"` : ""}
                    {track.isDefault ? " [default]" : ""}
                    {track.isForced ? " [forced]" : ""}
                  </button>
                ))}
              </div>,
              document.body,
            )}
        </div>
      </ContextMenuTrigger>
      {/* Always offered, loaded video or empty state: when the window chrome is
          hidden this menu is the only way out of the app. */}
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void quitApp()}>
          <Power className="size-3.5" />
          Quit
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
