import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { clampRate } from "@/components/workspace/clamp-rate";
import {
  clampSeekTarget,
  FRAME_STEP_SEC,
} from "@/components/workspace/frame-step";
import type { MediaNode } from "@/components/workspace/mock-data";
import {
  decideOnEnded,
  nextRepeatMode,
  type RepeatMode,
  reconcileOrder,
  shuffleIds,
} from "@/components/workspace/queue";
import { type SortField, sortMedia } from "@/components/workspace/sort-natural";
import type { MediaTrack } from "@/components/workspace/track-list";
import {
  clampZoom,
  DEFAULT_TRANSFORM,
  nextFitMode,
  nextRotation,
  type ViewportTransform,
} from "@/components/workspace/viewport-transform";
import { log } from "@/lib/logging/log";
import { type LogLine, parseLogLine } from "@/lib/logging/log-line";
import { createNoopLogStream, type LogStream } from "@/lib/logging/log-stream";
import {
  clearProgress,
  END_TOLERANCE_SEC,
  isVideoFormat,
  type ProgressEntry,
  type ProgressMap,
  recordProgress,
  resumePosition,
} from "@/lib/progress/progress";

type SortDirection = "asc" | "desc";

// A saved position worth offering to the user (video, mid-file, past the
// near-start threshold).
type ResumePrompt = {
  name: string;
  positionSec: number;
};

function resumePromptFor(
  node: MediaNode,
  progress: ProgressMap,
): ResumePrompt | null {
  if (!isVideoFormat(node.format)) {
    return null;
  }
  const positionSec = resumePosition(progress[node.path]);
  return positionSec > 0 ? { name: node.name, positionSec } : null;
}

const clampVolume = (value: number) =>
  Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;

type WorkspaceContextValue = {
  playlist: MediaNode[];
  selectedNodeId: string | null;
  activeMediaId: string | null;
  activeMedia: MediaNode | null;
  isPlaying: boolean;
  playbackCurrentSec: number;
  playbackDurationSec: number;
  seekToSec: number | null;
  // Saved position a freshly-activated video must seek to once it has loaded.
  // Consumed (cleared) by the viewport after it issues that seek.
  resumeAtSec: number | null;
  clearResume: () => void;
  // Saved position of the file that just started from 0, offered as a choice.
  // Playback never waits for an answer - "from the beginning" is the default.
  resumePrompt: ResumePrompt | null;
  acceptResume: () => void;
  dismissResume: () => void;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  isFullscreen: boolean;
  viewportTransform: ViewportTransform;
  repeatMode: RepeatMode;
  isShuffling: boolean;
  sortKeys: SortField[];
  sortDirection: SortDirection;
  isSidebarVisible: boolean;
  isContentVisible: boolean;
  isTransportVisible: boolean;
  isLogsVisible: boolean;
  // Tracks read from the native mpv instance for the active file, so a picker
  // can offer subtitle (and audio) selection. Empty outside mpv mode.
  mpvSubtitleTracks: MediaTrack[];
  setMpvSubtitleTracks: (tracks: MediaTrack[]) => void;
  mpvAudioTracks: MediaTrack[];
  setMpvAudioTracks: (tracks: MediaTrack[]) => void;
  subtitlePickerOpen: boolean;
  setSubtitlePickerOpen: (open: boolean) => void;
  audioPickerOpen: boolean;
  setAudioPickerOpen: (open: boolean) => void;
  selectNode: (id: string) => void;
  loadMedia: (media: MediaNode[]) => void;
  addMedia: (media: MediaNode[]) => void;
  openMedia: (media: MediaNode[]) => void;
  removeMedia: (id: string) => void;
  togglePlay: () => void;
  nextMedia: () => void;
  prevMedia: () => void;
  seek: (sec: number) => void;
  seekBy: (delta: number) => void;
  stepFrame: (direction: 1 | -1) => void;
  setVolume: (value: number) => void;
  changeVolume: (delta: number) => void;
  toggleMute: () => void;
  changeRate: (delta: number) => void;
  reportProgress: (currentSec: number, durationSec: number) => void;
  reportEnded: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  setFullscreen: (value: boolean) => void;
  rotateClockwise: () => void;
  cycleFitMode: () => void;
  zoomBy: (delta: number) => void;
  toggleInvertColors: () => void;
  resetViewportTransform: () => void;
  toggleSortKey: (field: SortField) => void;
  toggleSortDirection: () => void;
  toggleSidebar: () => void;
  toggleContent: () => void;
  toggleTransport: () => void;
  toggleLogs: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

type LogLinesContextValue = {
  logLines: LogLine[];
  appendLogLine: (raw: string, level?: number) => void;
  clearLogLines: () => void;
};

const LogLinesContext = createContext<LogLinesContextValue | null>(null);

type WorkspaceProviderProps = {
  children: ReactNode;
  media?: MediaNode[];
  logStream?: LogStream;
  initialActiveMediaId?: string;
  initialSortKeys?: SortField[];
  initialSortDirection?: SortDirection;
  initialProgress?: ProgressMap;
  initialVolume?: number;
  initialMuted?: boolean;
  initialPlaybackRate?: number;
  initialSidebarHidden?: boolean;
  initialContentHidden?: boolean;
  initialTransportHidden?: boolean;
  onProgressChange?: (path: string, entry: ProgressEntry | null) => void;
  onVolumeChange?: (volume: number) => void;
  onMutedChange?: (isMuted: boolean) => void;
  onPlaybackRateChange?: (rate: number) => void;
  onSidebarHiddenChange?: (hidden: boolean) => void;
  onTransportHiddenChange?: (hidden: boolean) => void;
  onSortDirectionChange?: (direction: SortDirection) => void;
  rng?: () => number;
};

export function WorkspaceProvider({
  children,
  media = [],
  logStream,
  initialActiveMediaId,
  initialSortKeys = [],
  initialSortDirection = "asc",
  initialProgress = {},
  initialVolume = 1,
  initialMuted = false,
  initialPlaybackRate = 1,
  initialSidebarHidden = false,
  initialContentHidden = false,
  initialTransportHidden = false,
  onProgressChange,
  onVolumeChange,
  onMutedChange,
  onPlaybackRateChange,
  onSidebarHiddenChange,
  onTransportHiddenChange,
  onSortDirectionChange,
  rng = Math.random,
}: WorkspaceProviderProps) {
  // Saved positions live here; the workspace is the only writer during a session
  // (it persists through onProgressChange and keeps the map current for resumes).
  const progressRef = useRef<ProgressMap>(initialProgress);
  const [sourceMedia, setSourceMedia] = useState<MediaNode[]>(media);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialActiveMediaId ?? null,
  );
  const [activeMediaId, setActiveMediaId] = useState<string | null>(
    initialActiveMediaId ?? null,
  );
  // The position a resumed file still has to reach. While set, reports below it
  // are ignored - the 0 an element (or a fresh mpv instance) reports before the
  // seek lands must never overwrite saved progress.
  const pendingResumeRef = useRef<number | null>(null);
  const [resumeAtSec, setResumeAtSec] = useState<number | null>(null);
  const [resumePrompt, setResumePrompt] = useState<ResumePrompt | null>(() => {
    const node = media.find((item) => item.id === initialActiveMediaId);
    return node ? resumePromptFor(node, progressRef.current) : null;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackCurrentSec, setPlaybackCurrentSec] = useState(0);
  const [playbackDurationSec, setPlaybackDurationSec] = useState(0);
  const [seekToSec, setSeekToSec] = useState<number | null>(null);
  const [volume, setVolumeState] = useState(initialVolume);
  const [isMuted, setIsMuted] = useState(initialMuted);
  const [playbackRate, setPlaybackRate] = useState(initialPlaybackRate);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewportTransform, setViewportTransform] =
    useState<ViewportTransform>(DEFAULT_TRANSFORM);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [isShuffling, setIsShuffling] = useState(false);
  const [shuffleOrder, setShuffleOrder] = useState<string[]>([]);
  const [sortKeys, setSortKeys] = useState<SortField[]>(initialSortKeys);
  const [sortDirection, setSortDirection] =
    useState<SortDirection>(initialSortDirection);
  const [isSidebarVisible, setIsSidebarVisible] = useState(
    !initialSidebarHidden,
  );
  const [isContentVisible, setIsContentVisible] = useState(
    !initialContentHidden,
  );
  const [isTransportVisible, setIsTransportVisible] = useState(
    !initialTransportHidden,
  );
  const [isLogsVisible, setIsLogsVisible] = useState(false);
  const [mpvSubtitleTracks, setMpvSubtitleTracks] = useState<MediaTrack[]>([]);
  const [mpvAudioTracks, setMpvAudioTracks] = useState<MediaTrack[]>([]);
  const [subtitlePickerOpen, setSubtitlePickerOpen] = useState(false);
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const wasFullscreen = useRef(false);
  const initialChrome = {
    sidebar: !initialSidebarHidden,
    transport: !initialTransportHidden,
    logs: false,
  };
  const chromeRef = useRef(initialChrome);
  const preFullscreenChrome = useRef(initialChrome);
  const sourceMediaRef = useRef(sourceMedia);
  const activeMediaIdRef = useRef(activeMediaId);
  const activeMediaRef = useRef<MediaNode | null>(null);

  // Mirror durable state into refs so the reference-stable verbs below
  // (addMedia) can read CURRENT values without going stale - which lets the
  // drop-subscription effect keep one stable handler instead of re-subscribing.
  useEffect(() => {
    sourceMediaRef.current = sourceMedia;
    activeMediaIdRef.current = activeMediaId;
  }, [sourceMedia, activeMediaId]);

  // Stable identity ([]-deps). Activates a node and starts playback from the
  // beginning; a saved position is only OFFERED, never applied on its own.
  const activateMedia = useCallback((node: MediaNode) => {
    const prompt = resumePromptFor(node, progressRef.current);
    log.info(
      `playback: activate name=${node.name} path=${node.path} resume=${prompt ? prompt.positionSec.toFixed(2) : "none"}`,
    );
    pendingResumeRef.current = null;
    setResumePrompt(prompt);
    setActiveMediaId(node.id);
    setSelectedNodeId(node.id);
    setIsPlaying(true);
    setPlaybackCurrentSec(0);
    setPlaybackDurationSec(0);
    setSeekToSec(null);
    setResumeAtSec(null);
  }, []);

  const dismissResume = useCallback(() => {
    log.info("playback: resume prompt dismissed");
    setResumePrompt(null);
  }, []);

  // Jumping back to the offered position goes through the normal seek path; the
  // pending resume covers media that is still loading (mpv load / HLS prepare).
  const acceptResume = useCallback(() => {
    if (resumePrompt === null) {
      return;
    }
    const position = resumePrompt.positionSec;
    log.info(`playback: resume accepted at ${position.toFixed(2)}s`);
    pendingResumeRef.current = position;
    setPlaybackCurrentSec(position);
    setSeekToSec(null);
    setResumeAtSec(position);
    setResumePrompt(null);
  }, [resumePrompt]);

  // Clears the seek request only; the pending-position guard stays until the
  // player actually reports a position at (or past) the resume point.
  const clearResume = useCallback(() => {
    log.debug("playback: resume seek consumed");
    setResumeAtSec(null);
  }, []);

  // Video-only, throttled in the pure layer; a finished position is never
  // written (the entry is dropped on end instead).
  const persistProgress = useCallback(
    (currentSec: number, durationSec: number) => {
      const node = activeMediaRef.current;
      if (!node || !isVideoFormat(node.format)) {
        return;
      }
      const pending = pendingResumeRef.current;
      if (pending !== null) {
        if (currentSec < pending - 1) {
          return;
        }
        pendingResumeRef.current = null;
      }
      if (durationSec > 0 && currentSec >= durationSec - END_TOLERANCE_SEC) {
        return;
      }
      const next = recordProgress(
        progressRef.current,
        node.path,
        currentSec,
        durationSec,
        Date.now(),
      );
      if (next === null) {
        return;
      }
      progressRef.current = next;
      log.info(
        `progress: saved path=${node.path} pos=${currentSec.toFixed(2)}s duration=${durationSec.toFixed(2)}s`,
      );
      onProgressChange?.(node.path, next[node.path]);
    },
    [onProgressChange],
  );

  // A pause is the best moment to persist: playback can end here, and the
  // throttled timeupdate save may be up to SAVE_INTERVAL_SEC stale.
  useEffect(() => {
    if (!isPlaying) {
      persistProgress(playbackCurrentSec, playbackDurationSec);
    }
  }, [isPlaying, persistProgress, playbackCurrentSec, playbackDurationSec]);

  // Stable identity so the Workspace drop effect subscribes once. Appends the
  // imported media, deduping by id against the current list; activates the
  // first NEW one only when nothing is active yet (empty-playlist parity).
  const addMedia = useCallback(
    (incoming: MediaNode[]) => {
      const current = sourceMediaRef.current;
      const fresh = incoming.filter(
        (video) => !current.some((existing) => existing.id === video.id),
      );
      log.info(
        `playlist: add incoming=${incoming.length} new=${fresh.length} total=${current.length + fresh.length}`,
      );
      if (fresh.length === 0) {
        log.warn("playlist: add ignored (every file was already listed)");
        return;
      }
      setSourceMedia((media) => [...media, ...fresh]);
      // A drop is an explicit "play this" gesture: the first newly-added
      // file becomes active and starts playing, even when something was
      // already playing (the appended rows stay queued behind it).
      activateMedia(fresh[0]);
    },
    [activateMedia],
  );

  // Stable identity, like addMedia. An OS open (Explorer double-click) appends
  // the new files and plays the first opened one, even when it is already listed.
  const openMedia = useCallback(
    (incoming: MediaNode[]) => {
      log.info(`open-files: incoming=${incoming.length}`);
      if (incoming.length === 0) {
        log.warn("open-files: ignored (no paths)");
        return;
      }
      const current = sourceMediaRef.current;
      const fresh = incoming.filter(
        (video) => !current.some((existing) => existing.id === video.id),
      );
      if (fresh.length > 0) {
        setSourceMedia((media) => [...media, ...fresh]);
      }
      activateMedia(
        current.find((existing) => existing.id === incoming[0].id) ??
          incoming[0],
      );
    },
    [activateMedia],
  );

  // Mirror the live visibility into a ref so setFullscreen (stable, []-deps) can
  // read the CURRENT windowed values without going stale.
  useEffect(() => {
    chromeRef.current = {
      sidebar: isSidebarVisible,
      transport: isTransportVisible,
      logs: isLogsVisible,
    };
  }, [isSidebarVisible, isTransportVisible, isLogsVisible]);

  // Stable identity (the Workspace subscribes with this in a dep array, so it
  // must not change every render). On a real fullscreen TRANSITION it hides
  // chrome on enter (saving the windowed visibility first) and restores that
  // saved state on exit - so a sidebar hidden before going fullscreen stays
  // hidden after. Between transitions the panel toggles work freely.
  const setFullscreen = useCallback((value: boolean) => {
    setIsFullscreen(value);
    if (wasFullscreen.current === value) {
      return;
    }
    wasFullscreen.current = value;
    log.info(`window: fullscreen=${value}`);
    if (value) {
      preFullscreenChrome.current = chromeRef.current;
      setIsSidebarVisible(false);
      setIsTransportVisible(false);
      setIsLogsVisible(false);
      return;
    }
    setIsSidebarVisible(preFullscreenChrome.current.sidebar);
    setIsTransportVisible(preFullscreenChrome.current.transport);
    setIsLogsVisible(preFullscreenChrome.current.logs);
  }, []);

  // Stable identity so the stream-subscribe effect below subscribes once per stream. Lines parse
  // via parseLogLine (numeric plugin level first, [LEVEL] token fallback, never throws).
  const appendLogLine = useCallback(
    (raw: string, level?: number) =>
      setLogLines((current) => [...current, parseLogLine(raw, level)]),
    [],
  );
  const clearLogLines = useCallback(() => {
    setLogLines([]);
    log.info("logs: panel cleared");
  }, []);
  const toggleLogs = useCallback(() => {
    log.info("layout: logs panel toggled");
    setIsLogsVisible((visible) => !visible);
  }, []);

  const playlist = useMemo(
    () => sortMedia(sourceMedia, sortKeys, sortDirection),
    [sourceMedia, sortKeys, sortDirection],
  );

  // Read by the stable verbs above (activateMedia, persistProgress) so they
  // never go stale.
  useEffect(() => {
    activeMediaRef.current =
      playlist.find((node) => node.id === activeMediaId) ?? null;
  }, [playlist, activeMediaId]);

  // The order Next/Prev/auto-advance walk: the live sorted ids, or - when
  // shuffling - the frozen shuffle order reconciled against the current ids
  // (so appended media slot in at the end and removed ones drop out).
  const effectiveOrder = useMemo(() => {
    const playlistIds = playlist.map((video) => video.id);
    return isShuffling
      ? reconcileOrder(shuffleOrder, playlistIds)
      : playlistIds;
  }, [playlist, isShuffling, shuffleOrder]);

  const value = useMemo<WorkspaceContextValue>(() => {
    const activate = activateMedia;

    const stepMedia = (delta: number) => {
      if (effectiveOrder.length === 0 || activeMediaId === null) {
        return;
      }
      const index = effectiveOrder.indexOf(activeMediaId);
      if (index === -1) {
        return;
      }
      const nextId =
        effectiveOrder[
          (index + delta + effectiveOrder.length) % effectiveOrder.length
        ];
      const next = playlist.find((node) => node.id === nextId);
      if (next) {
        log.info(
          `playback: ${delta > 0 ? "next" : "previous"} -> ${next.name}`,
        );
        activate(next);
      }
    };

    return {
      playlist,
      selectedNodeId,
      activeMediaId,
      activeMedia:
        activeMediaId !== null
          ? (playlist.find((video) => video.id === activeMediaId) ?? null)
          : null,
      isPlaying,
      playbackCurrentSec,
      playbackDurationSec,
      seekToSec,
      resumeAtSec,
      clearResume,
      resumePrompt,
      acceptResume,
      dismissResume,
      volume,
      isMuted,
      playbackRate,
      isFullscreen,
      viewportTransform,
      repeatMode,
      isShuffling,
      sortKeys,
      sortDirection,
      isSidebarVisible,
      isContentVisible,
      isTransportVisible,
      isLogsVisible,
      mpvSubtitleTracks,
      setMpvSubtitleTracks,
      mpvAudioTracks,
      setMpvAudioTracks,
      subtitlePickerOpen,
      setSubtitlePickerOpen,
      audioPickerOpen,
      setAudioPickerOpen,
      selectNode: (id) => {
        const node = playlist.find((item) => item.id === id);
        if (node) {
          log.info(`playlist: select name=${node.name}`);
          activate(node);
        }
      },
      loadMedia: (next) => {
        log.info(`playlist: load count=${next.length}`);
        setSourceMedia(next);
        if (next.length === 0) {
          setActiveMediaId(null);
          setSelectedNodeId(null);
          setIsPlaying(false);
          setPlaybackCurrentSec(0);
          setPlaybackDurationSec(0);
          setResumeAtSec(null);
          return;
        }
        activate(next[0]);
      },
      addMedia,
      openMedia,
      // Dropping the row would otherwise leave an active/selected id pointing at
      // a node nobody can reach: hand playback to the item that followed it in
      // the play order (wrapping), or stop on an empty list.
      removeMedia: (id) => {
        if (!playlist.some((video) => video.id === id)) {
          log.warn(`playlist: remove ignored, unknown id=${id}`);
          return;
        }
        log.info(`playlist: remove id=${id} active=${activeMediaId === id}`);
        setSourceMedia((current) => current.filter((video) => video.id !== id));
        if (activeMediaId !== id) {
          if (selectedNodeId === id) {
            setSelectedNodeId(activeMediaId);
          }
          return;
        }
        const order = effectiveOrder.includes(id)
          ? effectiveOrder
          : playlist.map((video) => video.id);
        const remaining = order.filter((item) => item !== id);
        const nextId =
          remaining.length === 0
            ? null
            : remaining[order.indexOf(id) % remaining.length];
        const next =
          nextId === null
            ? undefined
            : playlist.find((video) => video.id === nextId);
        if (next) {
          activate(next);
          return;
        }
        pendingResumeRef.current = null;
        setActiveMediaId(null);
        setSelectedNodeId(null);
        setIsPlaying(false);
        setPlaybackCurrentSec(0);
        setPlaybackDurationSec(0);
        setSeekToSec(null);
        setResumeAtSec(null);
      },
      togglePlay: () => {
        log.info(`playback: ${isPlaying ? "pause" : "play"}`);
        setIsPlaying((playing) => !playing);
      },
      nextMedia: () => stepMedia(1),
      prevMedia: () => stepMedia(-1),
      seek: (sec) => {
        log.info(`playback: seek to ${sec.toFixed(2)}s`);
        setPlaybackCurrentSec(sec);
        setSeekToSec(sec);
        // Scrubbing while paused produces no timeupdate, so persist here too.
        persistProgress(sec, playbackDurationSec);
      },
      seekBy: (delta) => {
        if (activeMediaId === null) {
          return;
        }
        const clamped = clampSeekTarget(
          playbackCurrentSec,
          delta,
          playbackDurationSec,
        );
        log.info(`playback: seek by ${delta.toFixed(2)}s -> ${clamped.toFixed(2)}s`);
        setPlaybackCurrentSec(clamped);
        setSeekToSec(clamped);
      },
      stepFrame: (direction) => {
        if (activeMediaId === null) {
          return;
        }
        log.info(`playback: frame step ${direction > 0 ? "forward" : "back"}`);
        setIsPlaying(false);
        const clamped = clampSeekTarget(
          playbackCurrentSec,
          direction * FRAME_STEP_SEC,
          playbackDurationSec,
        );
        setPlaybackCurrentSec(clamped);
        setSeekToSec(clamped);
      },
      setVolume: (next) => {
        if (activeMediaId === null) {
          return;
        }
        const clamped = clampVolume(next);
        log.info(`audio: volume=${clamped}`);
        setVolumeState(clamped);
        onVolumeChange?.(clamped);
      },
      changeVolume: (delta) => {
        if (activeMediaId === null) {
          return;
        }
        const clamped = clampVolume(volume + delta);
        log.info(`audio: volume=${clamped} (${delta > 0 ? "+" : ""}${delta})`);
        setVolumeState(clamped);
        onVolumeChange?.(clamped);
      },
      toggleMute: () => {
        if (activeMediaId === null) {
          return;
        }
        const next = !isMuted;
        log.info(`audio: muted=${next}`);
        setIsMuted(next);
        onMutedChange?.(next);
      },
      changeRate: (delta) => {
        if (activeMediaId === null) {
          return;
        }
        const clamped = clampRate(playbackRate + delta);
        log.info(`playback: rate=${clamped}x`);
        setPlaybackRate(clamped);
        onPlaybackRateChange?.(clamped);
      },
      reportProgress: (currentSec, durationSec) => {
        setPlaybackCurrentSec(currentSec);
        setPlaybackDurationSec(durationSec);
        setSeekToSec(null);
        persistProgress(currentSec, durationSec);
      },
      reportEnded: () => {
        if (activeMediaId === null) {
          return;
        }
        setResumePrompt(null);
        // A finished video is not resumable: drop its entry so the next play
        // starts from 0.
        const endedNode = activeMediaRef.current;
        if (endedNode && isVideoFormat(endedNode.format)) {
          const cleared = clearProgress(progressRef.current, endedNode.path);
          if (cleared !== progressRef.current) {
            progressRef.current = cleared;
            onProgressChange?.(endedNode.path, null);
          }
        }
        const decision = decideOnEnded(
          effectiveOrder,
          activeMediaId,
          repeatMode,
        );
        log.info(`playback: ended decision=${decision.kind}`);
        if (decision.kind === "advance") {
          const next = playlist.find((node) => node.id === decision.id);
          if (next) {
            activate(next);
          }
          return;
        }
        if (decision.kind === "replay") {
          setPlaybackCurrentSec(0);
          setSeekToSec(0);
          setIsPlaying(true);
          return;
        }
        setIsPlaying(false);
      },
      cycleRepeat: () => {
        if (activeMediaId === null) {
          return;
        }
        log.info(`playback: repeat ${repeatMode} -> ${nextRepeatMode(repeatMode)}`);
        setRepeatMode(nextRepeatMode);
      },
      toggleShuffle: () => {
        if (activeMediaId === null) {
          return;
        }
        log.info(`playback: shuffle=${!isShuffling}`);
        setIsShuffling((shuffling) => {
          if (!shuffling) {
            setShuffleOrder(
              shuffleIds(
                playlist.map((v) => v.id),
                rng,
              ),
            );
          }
          return !shuffling;
        });
      },
      setFullscreen,
      rotateClockwise: () => {
        if (activeMediaId === null) {
          return;
        }
        log.info("viewport: rotate clockwise");
        setViewportTransform((transform) => ({
          ...transform,
          rotationDeg: nextRotation(transform.rotationDeg),
        }));
      },
      cycleFitMode: () => {
        if (activeMediaId === null) {
          return;
        }
        log.info("viewport: cycle fit mode");
        setViewportTransform((transform) => ({
          ...transform,
          fitMode: nextFitMode(transform.fitMode),
        }));
      },
      zoomBy: (delta) => {
        if (activeMediaId === null) {
          return;
        }
        log.info(`viewport: zoom ${delta > 0 ? "in" : "out"} by ${delta}`);
        setViewportTransform((transform) => ({
          ...transform,
          zoom: clampZoom(transform.zoom + delta),
        }));
      },
      toggleInvertColors: () => {
        if (activeMediaId === null) {
          return;
        }
        log.info(`viewport: invert=${!viewportTransform.invertColors}`);
        setViewportTransform((transform) => ({
          ...transform,
          invertColors: transform.invertColors !== true,
        }));
      },
      resetViewportTransform: () => {
        if (activeMediaId === null) {
          return;
        }
        log.info("viewport: transform reset");
        setViewportTransform(DEFAULT_TRANSFORM);
      },
      toggleSortKey: (field) => {
        log.info(`playlist: sort key toggled field=${field}`);
        setSortKeys((current) =>
          current.includes(field)
            ? current.filter((key) => key !== field)
            : [...current, field],
        );
      },
      toggleSortDirection: () => {
        const next = sortDirection === "asc" ? "desc" : "asc";
        log.info(`playlist: sort direction=${next}`);
        setSortDirection(next);
        onSortDirectionChange?.(next);
      },
      toggleSidebar: () => {
        const next = !isSidebarVisible;
        log.info(`layout: sidebar visible=${next}`);
        setIsSidebarVisible(next);
        onSidebarHiddenChange?.(!next);
      },
      toggleContent: () => {
        log.info(`layout: content visible=${!isContentVisible}`);
        setIsContentVisible((visible) => !visible);
      },
      toggleTransport: () => {
        const next = !isTransportVisible;
        log.info(`layout: transport visible=${next}`);
        setIsTransportVisible(next);
        onTransportHiddenChange?.(!next);
      },
      toggleLogs,
    };
  }, [
    playlist,
    effectiveOrder,
    selectedNodeId,
    activeMediaId,
    isPlaying,
    playbackCurrentSec,
    playbackDurationSec,
    seekToSec,
    resumeAtSec,
    clearResume,
    resumePrompt,
    acceptResume,
    dismissResume,
    persistProgress,
    volume,
    isMuted,
    playbackRate,
    isFullscreen,
    viewportTransform,
    repeatMode,
    isShuffling,
    rng,
    setFullscreen,
    activateMedia,
    addMedia,
    openMedia,
    sortKeys,
    sortDirection,
    isSidebarVisible,
    isContentVisible,
    isTransportVisible,
    isLogsVisible,
    mpvSubtitleTracks,
    mpvAudioTracks,
    subtitlePickerOpen,
    audioPickerOpen,
    toggleLogs,
    onProgressChange,
    onVolumeChange,
    onMutedChange,
    onPlaybackRateChange,
    onSidebarHiddenChange,
    onTransportHiddenChange,
    onSortDirectionChange,
  ]);

  const logLinesValue = useMemo<LogLinesContextValue>(
    () => ({ logLines, appendLogLine, clearLogLines }),
    [logLines, appendLogLine, clearLogLines],
  );

  // Subscribe the injected log stream to appendLogLine once on mount (appendLogLine has stable
  // identity). The subscribe resolves async, so an unsubscribe that lands after unmount is called
  // immediately via the disposed flag. Defaults to the noop stream (browser/test).
  useEffect(() => {
    const stream = logStream ?? createNoopLogStream();
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    stream.subscribe(appendLogLine).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unsubscribe = fn;
    });
    return () => {
      disposed = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [logStream, appendLogLine]);

  return (
    <WorkspaceContext.Provider value={value}>
      <LogLinesContext.Provider value={logLinesValue}>
        {children}
      </LogLinesContext.Provider>
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return value;
}

// Optional (like the other isolated hooks) so a component rendered outside the provider still
// works; the application log stream is only meaningful inside the workspace.
export function useLogLines(): LogLinesContextValue {
  return (
    useContext(LogLinesContext) ?? {
      logLines: [],
      appendLogLine: () => {},
      clearLogLines: () => {},
    }
  );
}
