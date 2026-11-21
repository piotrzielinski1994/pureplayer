import { Button } from "@pziel/pureui";
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
// divided cells, not floating chips (docs/design.md Layout rule). The width is
// 7% of the bar (`7cqw`, capped at `w-12`): the cells scale DOWN continuously
// with the bar instead of wrapping or overlapping, so every control stays
// visible even at a tiny window. The bar itself is the `@container` that these
// units measure, so the class sits on the outer bar element.
const BAR_BUTTON = "h-full w-[7cqw] max-w-12 shrink-0 rounded-none";
// Icons shrink with the cells too; they never exceed the text icon size.
const BAR_ICON = "size-[min(1rem,4cqw)]";
// The playback trio is the primary control, so it reads one step stronger than
// the rest of the bar with slightly larger icons - no separate background, and
// the size scales with the `cqw` bar width. The stroke is thinned in proportion
// (2 * 16/20 = 1.6) so a larger icon keeps the SAME rendered line weight as the
// other cells instead of looking bold.
const BAR_PLAY_ICON = "size-[min(1.25rem,5cqw)] stroke-[1.6]";

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
      <div className="grid h-12 grid-rows-1 grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] items-center [grid-template-areas:'controls_playback_meta']">
        {/* left zone (1fr) - mute toggle + volume slider + shuffle + repeat.
          Stays on the same row as the playback/meta zones at every width; its
          cells scale down with the bar (`7cqw`) and the slider shrinks to
          `min-w-0` instead of wrapping to a second row or overlapping. */}
        <div
          data-transport-zone="controls"
          className="flex h-full min-w-0 items-center justify-start overflow-hidden [grid-area:controls]"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={isMuted ? "Unmute" : "Mute"}
            onClick={() => toggleMute()}
            className={`${BAR_BUTTON} border-r border-border`}
          >
            {isMuted ? (
              <VolumeX className={BAR_ICON} />
            ) : (
              <Volume2 className={BAR_ICON} />
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
            className="mx-2 flex h-2 min-w-0 max-w-24 flex-1 cursor-pointer items-center"
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
            <Shuffle className={BAR_ICON} />
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
              <Repeat1 className={BAR_ICON} />
            ) : (
              <Repeat className={BAR_ICON} />
            )}
          </Button>
        </div>
        <div
          data-transport-zone="playback"
          className="flex h-full min-w-0 items-center justify-center overflow-hidden [grid-area:playback]"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous"
            onClick={() => prevMedia()}
            className={`${BAR_BUTTON} border-l border-border`}
          >
            <SkipBack className={BAR_PLAY_ICON} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={() => togglePlay()}
            className={`${BAR_BUTTON} border-l border-border`}
          >
            {isPlaying ? (
              <Pause className={BAR_PLAY_ICON} />
            ) : (
              <Play className={BAR_PLAY_ICON} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next"
            onClick={() => nextMedia()}
            className={`${BAR_BUTTON} border-x border-border`}
          >
            <SkipForward className={BAR_PLAY_ICON} />
          </Button>
        </div>
        {/* right zone (1fr) - transform readout (only != default) + rate readout (only off 1x) + time readout.
          Truncates rather than pushing the other zones when the bar is narrow. */}
        <div
          data-transport-zone="meta"
          className="flex h-full min-w-0 items-center justify-end gap-3 overflow-hidden pl-2 pr-4 [grid-area:meta]"
        >
          {activeMedia && !isDefaultTransform(viewportTransform) && (
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground tabular-nums">
              {formatTransform(viewportTransform)}
            </span>
          )}
          {playbackRate !== 1 && (
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground tabular-nums">
              {playbackRate}x
            </span>
          )}
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground tabular-nums">
            {timeReadout}
          </span>
        </div>
      </div>
    </div>
  );
}
