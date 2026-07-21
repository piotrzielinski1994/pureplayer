import {
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useRef } from "react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/components/workspace/format-time";
import {
  fractionFromPointer,
  seekSecondsFromPointer,
} from "@/components/workspace/seek-position";
import {
  formatTransform,
  isDefaultTransform,
} from "@/components/workspace/viewport-transform";
import { useWorkspace } from "@/components/workspace/workspace-context";

const EMPTY_TIME = "--:-- / --:--";

// Bar buttons fill the bar's full height, square, no rounding - read as 1px-
// divided cells, not floating chips (docs/design.md Layout rule).
const BAR_BUTTON = "h-full w-12 rounded-none";

export function TransportBar() {
  const {
    activeMedia,
    isPlaying,
    playbackCurrentSec,
    playbackDurationSec,
    volume,
    isMuted,
    playbackRate,
    viewportTransform,
    repeatMode,
    isShuffling,
    togglePlay,
    nextMedia,
    prevMedia,
    seek,
    setVolume,
    toggleMute,
    cycleRepeat,
    toggleShuffle,
  } = useWorkspace();
  const seekBarRef = useRef<HTMLDivElement>(null);
  const isScrubbing = useRef(false);
  const volumeBarRef = useRef<HTMLDivElement>(null);
  const isVolumeScrubbing = useRef(false);

  const timeReadout = activeMedia
    ? `${formatTime(playbackCurrentSec)} / ${formatTime(playbackDurationSec)}`
    : EMPTY_TIME;

  const progressFraction =
    playbackDurationSec > 0 ? playbackCurrentSec / playbackDurationSec : 0;

  const volumePercent = Math.round(volume * 100);

  const seekFromEvent = (clientX: number) => {
    const bar = seekBarRef.current;
    if (!bar) {
      return;
    }
    seek(
      seekSecondsFromPointer(
        clientX,
        bar.getBoundingClientRect(),
        playbackDurationSec,
      ),
    );
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activeMedia) {
      return;
    }
    isScrubbing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromEvent(event.clientX);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isScrubbing.current) {
      return;
    }
    seekFromEvent(event.clientX);
  };

  const stopScrubbing = () => {
    isScrubbing.current = false;
  };

  const volumeFromEvent = (clientX: number) => {
    const bar = volumeBarRef.current;
    if (!bar) {
      return;
    }
    setVolume(fractionFromPointer(clientX, bar.getBoundingClientRect()));
  };

  const handleVolumePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    isVolumeScrubbing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    volumeFromEvent(event.clientX);
  };

  const handleVolumePointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!isVolumeScrubbing.current) {
      return;
    }
    volumeFromEvent(event.clientX);
  };

  const stopVolumeScrubbing = () => {
    isVolumeScrubbing.current = false;
  };

  return (
    <div data-transport-bar className="@container relative shrink-0">
      <div
        ref={seekBarRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={playbackDurationSec}
        aria-valuenow={playbackCurrentSec}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopScrubbing}
        onPointerCancel={stopScrubbing}
        className="absolute inset-x-0 top-0 z-10 flex h-2 -translate-y-1/2 cursor-pointer items-center"
      >
        <div className="h-px w-full bg-border">
          <div
            className="h-full bg-primary"
            style={{ width: `${progressFraction * 100}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] [grid-template-areas:'left_playback_meta'_'controls_controls_controls'] @2xl:h-12 @2xl:items-center @2xl:[grid-template-areas:'controls_playback_meta']">
        {/* left zone (1fr) - mute toggle + volume slider + shuffle + repeat.
          Narrow: its own centered row below playback/meta. Wide: left column. */}
        <div
          data-transport-zone="controls"
          className="flex h-12 items-center justify-center border-t border-border [grid-area:controls] @2xl:h-full @2xl:justify-start @2xl:border-t-0"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={isMuted ? "Unmute" : "Mute"}
            onClick={() => toggleMute()}
            className={`${BAR_BUTTON} border-r border-border`}
          >
            {isMuted ? (
              <VolumeX className="size-4" />
            ) : (
              <Volume2 className="size-4" />
            )}
          </Button>
          <div
            ref={volumeBarRef}
            role="slider"
            aria-label="Volume"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={volumePercent}
            onPointerDown={handleVolumePointerDown}
            onPointerMove={handleVolumePointerMove}
            onPointerUp={stopVolumeScrubbing}
            onPointerCancel={stopVolumeScrubbing}
            className="mx-3 flex h-2 w-24 cursor-pointer items-center"
          >
            <div className="h-px w-full bg-border">
              <div
                className="h-full bg-primary"
                style={{ width: `${volumePercent}%` }}
              />
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Shuffle"
            aria-pressed={isShuffling}
            onClick={() => toggleShuffle()}
            className={`${BAR_BUTTON} border-l border-border ${
              isShuffling ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <Shuffle className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Repeat: ${repeatMode}`}
            onClick={() => cycleRepeat()}
            className={`${BAR_BUTTON} border-l border-border ${
              repeatMode === "off" ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {repeatMode === "one" ? (
              <Repeat1 className="size-4" />
            ) : (
              <Repeat className="size-4" />
            )}
          </Button>
        </div>
        <div
          data-transport-zone="playback"
          className="flex h-12 items-center justify-center [grid-area:playback] @2xl:h-full"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous"
            onClick={() => prevMedia()}
            className={`${BAR_BUTTON} border-l border-border`}
          >
            <SkipBack className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={() => togglePlay()}
            className={`${BAR_BUTTON} border-l border-border`}
          >
            {isPlaying ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next"
            onClick={() => nextMedia()}
            className={`${BAR_BUTTON} border-x border-border`}
          >
            <SkipForward className="size-4" />
          </Button>
        </div>
        {/* right zone (1fr) - transform readout (only != default) + rate readout (only off 1x) + time readout.
          Shares the top row with playback (narrow) / right column (wide). */}
        <div
          data-transport-zone="meta"
          className="flex h-12 items-center justify-end gap-3 pr-4 [grid-area:meta] @2xl:h-full"
        >
          {activeMedia && !isDefaultTransform(viewportTransform) && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
              {formatTransform(viewportTransform)}
            </span>
          )}
          {playbackRate !== 1 && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
              {playbackRate}x
            </span>
          )}
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {timeReadout}
          </span>
        </div>
      </div>
    </div>
  );
}
