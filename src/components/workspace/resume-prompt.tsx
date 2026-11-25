import { Button } from "@pziel/pureui";
import { useEffect } from "react";
import { formatTime } from "@/components/workspace/format-time";
import { useWorkspace } from "@/components/workspace/workspace-context";

// A short offer, not a permanent bar: it hides itself after this long, and any
// answer hides it at once. Playback never waits for an answer.
const PROMPT_VISIBLE_MS = 10_000;

export function ResumePrompt() {
  const { resumePrompt, acceptResume, dismissResume } = useWorkspace();

  useEffect(() => {
    if (resumePrompt === null) {
      return;
    }
    const timer = setTimeout(dismissResume, PROMPT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [resumePrompt, dismissResume]);

  if (resumePrompt === null) {
    return null;
  }

  return (
    <div
      data-resume-prompt
      role="group"
      aria-label="Resume playback"
      // Outside the viewport box on purpose: the native mpv window (MKV) covers
      // the viewport, so an overlay inside it would never be seen. Buttons fill
      // the bar height, square, divided by 1px borders (docs/design.md).
      className="flex h-7 shrink-0 items-center bg-muted"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          dismissResume();
        }
      }}
    >
      <p className="min-w-0 flex-1 truncate px-3 text-[10px]">
        Continue <span className="font-medium">{resumePrompt.name}</span> from{" "}
        <span className="font-mono tabular-nums">
          {formatTime(resumePrompt.positionSec)}
        </span>
        ?
      </p>
      <Button
        variant="ghost"
        size="sm"
        autoFocus
        onClick={dismissResume}
        className="h-full rounded-none border-0 px-2 text-[10px] outline-none focus:outline-none focus-visible:outline-none"
      >
        From start
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={acceptResume}
        className="h-full rounded-none border-0 px-2 text-[10px] outline-none focus:outline-none focus-visible:outline-none"
      >
        Resume
      </Button>
    </div>
  );
}
