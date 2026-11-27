import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaNode } from "@/components/workspace/mock-data";
import { ResumePrompt } from "@/components/workspace/resume-prompt";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import type { ProgressMap } from "@/lib/progress/progress";

const video: MediaNode = {
  id: "v1",
  name: "1 - Long film",
  format: "MP4",
  path: "/v/1.mp4",
};
const audio: MediaNode = {
  id: "a1",
  name: "1 - Song",
  format: "MP3",
  path: "/a/1.mp3",
};
const saved: ProgressMap = {
  "/v/1.mp4": { positionSec: 3725, durationSec: 7200, updatedAtMs: 1 },
};

function renderPrompt(
  media: MediaNode[],
  activeId: string,
  progress: ProgressMap,
) {
  render(
    <WorkspaceProvider
      media={media}
      initialActiveMediaId={activeId}
      initialProgress={progress}
    >
      <ResumePrompt />
    </WorkspaceProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("resume prompt", () => {
  it("offers the saved position of the file that just started", () => {
    renderPrompt([video], "v1", saved);
    expect(
      screen.getByRole("group", { name: /resume playback/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 - Long film")).toBeInTheDocument();
    expect(screen.getByText("01:02:05")).toBeInTheDocument();
  });

  it("keeps starting from the beginning as the default action", () => {
    renderPrompt([video], "v1", saved);
    expect(screen.getByRole("button", { name: "From start" })).toHaveFocus();
  });

  it("hides itself without an answer", () => {
    vi.useFakeTimers();
    renderPrompt([video], "v1", saved);
    act(() => vi.advanceTimersByTime(10_000));
    expect(
      screen.queryByRole("group", { name: /resume playback/i }),
    ).not.toBeInTheDocument();
  });

  it("hides itself once the user starts from the beginning", async () => {
    renderPrompt([video], "v1", saved);
    await userEvent.click(screen.getByRole("button", { name: "From start" }));
    expect(
      screen.queryByRole("group", { name: /resume playback/i }),
    ).not.toBeInTheDocument();
  });

  it("stays out of the way for audio", () => {
    renderPrompt([audio], "a1", {
      "/a/1.mp3": { positionSec: 42, durationSec: 100, updatedAtMs: 1 },
    });
    expect(
      screen.queryByRole("group", { name: /resume playback/i }),
    ).not.toBeInTheDocument();
  });
});
