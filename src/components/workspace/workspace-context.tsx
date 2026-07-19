import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { type MediaNode } from "@/components/workspace/mock-data";
import { sortMedia, type SortField } from "@/components/workspace/sort-natural";
import { clampRate } from "@/components/workspace/clamp-rate";
import {
  clampSeekTarget,
  FRAME_STEP_SEC,
} from "@/components/workspace/frame-step";
import {
  decideOnEnded,
  nextRepeatMode,
  reconcileOrder,
  shuffleIds,
  type RepeatMode,
} from "@/components/workspace/queue";
import {
  clampZoom,
  DEFAULT_TRANSFORM,
  nextFitMode,
  nextRotation,
  type ViewportTransform,
} from "@/components/workspace/viewport-transform";
import { nextMiniMode, type MiniMode, type MiniTarget } from "@/lib/mini-mode";

type SortDirection = "asc" | "desc";

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
  isTransportVisible: boolean;
  miniMode: MiniMode;
  selectNode: (id: string) => void;
  loadMedia: (media: MediaNode[]) => void;
  addMedia: (media: MediaNode[]) => void;
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
  resetViewportTransform: () => void;
  toggleSortKey: (field: SortField) => void;
  toggleSortDirection: () => void;
  toggleSidebar: () => void;
  toggleTransport: () => void;
  toggleMiniMode: (target: MiniTarget) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

type WorkspaceProviderProps = {
  children: ReactNode;
  media?: MediaNode[];
  initialActiveMediaId?: string;
  initialSortKeys?: SortField[];
  initialSortDirection?: SortDirection;
  initialVolume?: number;
  initialMuted?: boolean;
  initialPlaybackRate?: number;
  initialSidebarHidden?: boolean;
  initialTransportHidden?: boolean;
  initialMiniMode?: MiniMode;
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
  initialActiveMediaId,
  initialSortKeys = [],
  initialSortDirection = "asc",
  initialVolume = 1,
  initialMuted = false,
  initialPlaybackRate = 1,
  initialSidebarHidden = false,
  initialTransportHidden = false,
  initialMiniMode = "off",
  onVolumeChange,
  onMutedChange,
  onPlaybackRateChange,
  onSidebarHiddenChange,
  onTransportHiddenChange,
  onSortDirectionChange,
  rng = Math.random,
}: WorkspaceProviderProps) {
  const [sourceMedia, setSourceMedia] = useState<MediaNode[]>(media);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialActiveMediaId ?? null,
  );
  const [activeMediaId, setActiveMediaId] = useState<string | null>(
    initialActiveMediaId ?? null,
  );
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
  const [isSidebarVisible, setIsSidebarVisible] = useState(!initialSidebarHidden);
  const [isTransportVisible, setIsTransportVisible] = useState(
    !initialTransportHidden,
  );
  const [miniMode, setMiniMode] = useState<MiniMode>(initialMiniMode);
  const preMiniChrome = useRef({
    sidebar: !initialSidebarHidden,
    transport: !initialTransportHidden,
  });
  const wasFullscreen = useRef(false);
  const initialChrome = {
    sidebar: !initialSidebarHidden,
    transport: !initialTransportHidden,
  };
  const chromeRef = useRef(initialChrome);
  const preFullscreenChrome = useRef(initialChrome);
  const sourceMediaRef = useRef(sourceMedia);
  const activeMediaIdRef = useRef(activeMediaId);

  // Mirror durable state into refs so the reference-stable verbs below
  // (addMedia) can read CURRENT values without going stale - which lets the
  // drop-subscription effect keep one stable handler instead of re-subscribing.
  useEffect(() => {
    sourceMediaRef.current = sourceMedia;
    activeMediaIdRef.current = activeMediaId;
  }, [sourceMedia, activeMediaId]);

  // Stable identity ([]-deps). Activates a video and starts playback from 0.
  const activateMedia = useCallback((id: string) => {
    setActiveMediaId(id);
    setSelectedNodeId(id);
    setIsPlaying(true);
    setPlaybackCurrentSec(0);
    setPlaybackDurationSec(0);
    setSeekToSec(null);
  }, []);

  // Stable identity so the Workspace drop effect subscribes once. Appends the
  // imported media, deduping by id against the current list; activates the
  // first NEW one only when nothing is active yet (empty-playlist parity).
  const addMedia = useCallback(
    (incoming: MediaNode[]) => {
      const current = sourceMediaRef.current;
      const fresh = incoming.filter(
        (video) => !current.some((existing) => existing.id === video.id),
      );
      if (fresh.length === 0) {
        return;
      }
      setSourceMedia((media) => [...media, ...fresh]);
      if (activeMediaIdRef.current === null) {
        activateMedia(fresh[0].id);
      }
    },
    [activateMedia],
  );

  // Mirror the live visibility into a ref so setFullscreen (stable, []-deps) can
  // read the CURRENT windowed values without going stale.
  useEffect(() => {
    chromeRef.current = {
      sidebar: isSidebarVisible,
      transport: isTransportVisible,
    };
  }, [isSidebarVisible, isTransportVisible]);

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
    if (value) {
      preFullscreenChrome.current = chromeRef.current;
      setIsSidebarVisible(false);
      setIsTransportVisible(false);
      return;
    }
    setIsSidebarVisible(preFullscreenChrome.current.sidebar);
    setIsTransportVisible(preFullscreenChrome.current.transport);
  }, []);

  const playlist = useMemo(
    () => sortMedia(sourceMedia, sortKeys, sortDirection),
    [sourceMedia, sortKeys, sortDirection],
  );

  // The order Next/Prev/auto-advance walk: the live sorted ids, or - when
  // shuffling - the frozen shuffle order reconciled against the current ids
  // (so appended media slot in at the end and removed ones drop out).
  const effectiveOrder = useMemo(() => {
    const playlistIds = playlist.map((video) => video.id);
    return isShuffling ? reconcileOrder(shuffleOrder, playlistIds) : playlistIds;
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
      activate(nextId);
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
      isTransportVisible,
      miniMode,
      selectNode: (id) => activate(id),
      loadMedia: (next) => {
        setSourceMedia(next);
        if (next.length === 0) {
          setActiveMediaId(null);
          setSelectedNodeId(null);
          setIsPlaying(false);
          setPlaybackCurrentSec(0);
          setPlaybackDurationSec(0);
          return;
        }
        activate(next[0].id);
      },
      addMedia,
      togglePlay: () => setIsPlaying((playing) => !playing),
      nextMedia: () => stepMedia(1),
      prevMedia: () => stepMedia(-1),
      seek: (sec) => {
        setPlaybackCurrentSec(sec);
        setSeekToSec(sec);
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
        setPlaybackCurrentSec(clamped);
        setSeekToSec(clamped);
      },
      stepFrame: (direction) => {
        if (activeMediaId === null) {
          return;
        }
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
        setVolumeState(clamped);
        onVolumeChange?.(clamped);
      },
      changeVolume: (delta) => {
        if (activeMediaId === null) {
          return;
        }
        const clamped = clampVolume(volume + delta);
        setVolumeState(clamped);
        onVolumeChange?.(clamped);
      },
      toggleMute: () => {
        if (activeMediaId === null) {
          return;
        }
        const next = !isMuted;
        setIsMuted(next);
        onMutedChange?.(next);
      },
      changeRate: (delta) => {
        if (activeMediaId === null) {
          return;
        }
        const clamped = clampRate(playbackRate + delta);
        setPlaybackRate(clamped);
        onPlaybackRateChange?.(clamped);
      },
      reportProgress: (currentSec, durationSec) => {
        setPlaybackCurrentSec(currentSec);
        setPlaybackDurationSec(durationSec);
        setSeekToSec(null);
      },
      reportEnded: () => {
        if (activeMediaId === null) {
          return;
        }
        const decision = decideOnEnded(
          effectiveOrder,
          activeMediaId,
          repeatMode,
        );
        if (decision.kind === "advance") {
          activate(decision.id);
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
        setRepeatMode(nextRepeatMode);
      },
      toggleShuffle: () => {
        if (activeMediaId === null) {
          return;
        }
        setIsShuffling((shuffling) => {
          if (!shuffling) {
            setShuffleOrder(shuffleIds(playlist.map((v) => v.id), rng));
          }
          return !shuffling;
        });
      },
      setFullscreen,
      rotateClockwise: () => {
        if (activeMediaId === null) {
          return;
        }
        setViewportTransform((transform) => ({
          ...transform,
          rotationDeg: nextRotation(transform.rotationDeg),
        }));
      },
      cycleFitMode: () => {
        if (activeMediaId === null) {
          return;
        }
        setViewportTransform((transform) => ({
          ...transform,
          fitMode: nextFitMode(transform.fitMode),
        }));
      },
      zoomBy: (delta) => {
        if (activeMediaId === null) {
          return;
        }
        setViewportTransform((transform) => ({
          ...transform,
          zoom: clampZoom(transform.zoom + delta),
        }));
      },
      resetViewportTransform: () => {
        if (activeMediaId === null) {
          return;
        }
        setViewportTransform(DEFAULT_TRANSFORM);
      },
      toggleSortKey: (field) =>
        setSortKeys((current) =>
          current.includes(field)
            ? current.filter((key) => key !== field)
            : [...current, field],
        ),
      toggleSortDirection: () => {
        const next = sortDirection === "asc" ? "desc" : "asc";
        setSortDirection(next);
        onSortDirectionChange?.(next);
      },
      toggleSidebar: () => {
        const next = !isSidebarVisible;
        setIsSidebarVisible(next);
        onSidebarHiddenChange?.(!next);
      },
      toggleTransport: () => {
        const next = !isTransportVisible;
        setIsTransportVisible(next);
        onTransportHiddenChange?.(!next);
      },
      toggleMiniMode: (target) => {
        const next = nextMiniMode(miniMode, target);
        if (next === "off") {
          setMiniMode("off");
          setIsSidebarVisible(preMiniChrome.current.sidebar);
          setIsTransportVisible(preMiniChrome.current.transport);
          return;
        }
        if (miniMode === "off") {
          preMiniChrome.current = {
            sidebar: isSidebarVisible,
            transport: isTransportVisible,
          };
        }
        setMiniMode(next);
        setIsSidebarVisible(false);
        setIsTransportVisible(true);
      },
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
    sortKeys,
    sortDirection,
    isSidebarVisible,
    isTransportVisible,
    miniMode,
    onVolumeChange,
    onMutedChange,
    onPlaybackRateChange,
    onSidebarHiddenChange,
    onTransportHiddenChange,
    onSortDirectionChange,
  ]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
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
