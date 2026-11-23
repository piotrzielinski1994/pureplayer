import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MediaNode } from "@/components/workspace/mock-data";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { ProgressMap } from "@/lib/progress/progress";

const video: MediaNode = {
  id: "v1",
  name: "V1",
  format: "MP4",
  path: "/v/1.mp4",
};
const audio: MediaNode = {
  id: "a1",
  name: "A1",
  format: "MP3",
  path: "/a/1.mp3",
};

function Probe() {
  const ws = useWorkspace();
  return (
    <div>
      <output aria-label="current">{String(ws.playbackCurrentSec)}</output>
      <output aria-label="resume">
        {ws.resumeAtSec === null ? "none" : String(ws.resumeAtSec)}
      </output>
      <button type="button" onClick={() => ws.reportProgress(50, 100)}>
        report
      </button>
      <button type="button" onClick={() => ws.reportEnded()}>
        ended
      </button>
      <button type="button" onClick={() => ws.selectNode("a1")}>
        select audio
      </button>
    </div>
  );
}

function renderWorkspace(
  media: MediaNode[],
  initialActiveMediaId: string,
  initialProgress: ProgressMap,
) {
  const onProgressChange = vi.fn();
  render(
    <WorkspaceProvider
      media={media}
      initialActiveMediaId={initialActiveMediaId}
      initialProgress={initialProgress}
      onProgressChange={onProgressChange}
    >
      <Probe />
    </WorkspaceProvider>,
  );
  return { onProgressChange };
}

describe("video playback progress", () => {
  it("resumes a video at its saved position", () => {
    renderWorkspace([video, audio], "v1", {
      "/v/1.mp4": { positionSec: 42, durationSec: 100, updatedAtMs: 1 },
    });
    expect(screen.getByLabelText("current")).toHaveTextContent("42");
    expect(screen.getByLabelText("resume")).toHaveTextContent("42");
  });

  it("does not resume an audio item", () => {
    renderWorkspace([video, audio], "a1", {
      "/a/1.mp3": { positionSec: 42, durationSec: 100, updatedAtMs: 1 },
    });
    expect(screen.getByLabelText("current")).toHaveTextContent("0");
    expect(screen.getByLabelText("resume")).toHaveTextContent("none");
  });

  it("does not resume a finished video", () => {
    renderWorkspace([video, audio], "v1", {
      "/v/1.mp4": { positionSec: 97, durationSec: 100, updatedAtMs: 1 },
    });
    expect(screen.getByLabelText("current")).toHaveTextContent("0");
    expect(screen.getByLabelText("resume")).toHaveTextContent("none");
  });

  it("does not resume a near-start position", () => {
    renderWorkspace([video, audio], "v1", {
      "/v/1.mp4": { positionSec: 3, durationSec: 100, updatedAtMs: 1 },
    });
    expect(screen.getByLabelText("resume")).toHaveTextContent("none");
  });

  it("persists playback progress of a video", async () => {
    const { onProgressChange } = renderWorkspace([video, audio], "v1", {});
    await userEvent.click(screen.getByRole("button", { name: "report" }));
    expect(onProgressChange).toHaveBeenCalledWith("/v/1.mp4", {
      positionSec: 50,
      durationSec: 100,
      updatedAtMs: expect.any(Number),
    });
  });

  it("never persists progress of an audio item", async () => {
    const { onProgressChange } = renderWorkspace([video, audio], "a1", {});
    await userEvent.click(screen.getByRole("button", { name: "report" }));
    expect(onProgressChange).not.toHaveBeenCalled();
  });

  it("forgets the progress entry once a video ends", async () => {
    const { onProgressChange } = renderWorkspace([video, audio], "v1", {
      "/v/1.mp4": { positionSec: 42, durationSec: 100, updatedAtMs: 1 },
    });
    await userEvent.click(screen.getByRole("button", { name: "ended" }));
    expect(onProgressChange).toHaveBeenCalledWith("/v/1.mp4", null);
  });
});
