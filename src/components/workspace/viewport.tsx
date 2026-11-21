import { Film, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  attachHlsJs,
  canPlayNativeHls,
  needsHlsJs,
  seekTarget,
} from "@/lib/hls";
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
  const [source, setSource] = useState<SourceState | null>(null);
  // Film time where the current HLS job started. An HLS playlist always begins at
  // 0, so after a seek-restart the element time is offset from the real position.
  const hlsBaseRef = useRef(0);
  // Latest seek-restart request, so a slow one cannot overwrite a newer one.
  const seekRestartTokenRef = useRef(0);
  const [titleHiddenForId, setTitleHiddenForId] = useState<string | null>(null);
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

  // A single click toggles play/pause instantly (no debounce, so it feels as
  // snappy as the transport button). A double click goes fullscreen: the DOM
  // fires `click` twice before `dblclick`, so the two toggles cancel out (net
  // no change) and fullscreen lands on top - no stray toggle, no delay.
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
    let cancelled = false;
    const forId = activeMedia.id;
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
    return () => {
      cancelled = true;
    };
  }, [activeMedia?.id, activeMedia]);

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
    const element = videoRef.current;
    if (!element) {
      return;
    }
    if (isPlaying) {
      void element.play().catch(logPlayError);
      return;
    }
    element.pause();
  }, [isPlaying]);

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
  }, [seekToSec, isPlaying, hlsUrl]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) {
      return;
    }
    element.volume = volume;
    element.muted = isMuted;
    element.playbackRate = playbackRate;
  }, [volume, isMuted, playbackRate, sourceUrl]);

  return (
    <div
      role="region"
      aria-label="Media viewport"
      onClick={handleClick}
      onDoubleClick={() => void toggleFullscreen()}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black"
    >
      {!activeMedia && (
        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Film className="size-10" />
          <p className="text-sm">No media selected</p>
        </div>
      )}
      {activeMedia && !sourceForActive && (
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
      {activeMedia && sourceForActive?.status === "ready" && (
        <>
          <video
            ref={videoRef}
            src={hlsUrl === null ? sourceForActive.url : undefined}
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
                  sourceForActive.durationSec,
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
                  sourceForActive.durationSec,
                ),
              );
            }}
            onEnded={() => reportEnded()}
          />
          {!isFullscreen && titleHiddenForId !== activeMedia.id && (
            <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-sm text-white">
              {activeMedia.name}
            </p>
          )}
        </>
      )}
    </div>
  );
}
