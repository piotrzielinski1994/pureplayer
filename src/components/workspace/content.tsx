import { useCallback, useEffect, useRef, useState } from "react";
import { TransportBar } from "@/components/workspace/transport-bar";
import { Viewport } from "@/components/workspace/viewport";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useSettings } from "@/lib/settings/settings-context";

const IDLE_HIDE_MS = 3000;

export function Content() {
  const { isTransportVisible } = useWorkspace();
  const { settings } = useSettings();
  const [isPeeking, setIsPeeking] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOverBar = useRef(false);

  const canPeek = !isTransportVisible && settings.revealTransportOnHover;

  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current !== null) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);

  // Each move reveals the bar and restarts the idle countdown; after IDLE_HIDE_MS
  // without movement it hides itself again. Leaving the video hides immediately.
  const startIdleTimer = useCallback(() => {
    clearIdleTimer();
    idleTimer.current = setTimeout(() => setIsPeeking(false), IDLE_HIDE_MS);
  }, [clearIdleTimer]);

  const handleMouseMove = () => {
    if (!canPeek) {
      return;
    }
    setIsPeeking(true);
    // A move bubbling up FROM the bar must not arm the hide timer - the cursor is
    // resting on the controls and the bar must stay open until it leaves.
    if (isOverBar.current) {
      return;
    }
    startIdleTimer();
  };

  const handleMouseLeave = () => {
    clearIdleTimer();
    setIsPeeking(false);
  };

  const handleBarEnter = () => {
    isOverBar.current = true;
    clearIdleTimer();
  };

  const handleBarLeave = () => {
    isOverBar.current = false;
    startIdleTimer();
  };

  useEffect(() => clearIdleTimer, [clearIdleTimer]);

  const isRevealed = canPeek && isPeeking;

  return (
    <div className="flex h-full flex-col">
      <div
        className="relative flex-1 overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <Viewport />
        {isRevealed && (
          <div
            data-testid="transport-overlay"
            // Pointer resting ON the bar must keep it open: freeze the idle timer
            // while hovered, restart the countdown when the cursor returns to video.
            onMouseEnter={handleBarEnter}
            onMouseLeave={handleBarLeave}
            className="absolute inset-x-0 bottom-0 bg-background/80 backdrop-blur-sm"
          >
            <TransportBar />
          </div>
        )}
      </div>
      {isTransportVisible && <TransportBar />}
    </div>
  );
}
