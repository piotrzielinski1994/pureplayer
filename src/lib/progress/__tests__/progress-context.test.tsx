import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ProgressProvider, useProgress } from "@/lib/progress/progress-context";
import { createInMemoryProgressStore } from "@/lib/progress/progress-store";

function Probe() {
  const { progress, recordProgress, forgetProgress } = useProgress();
  return (
    <div>
      <span data-testid="loaded">loaded</span>
      <span data-testid="entry">
        {progress["/v/a.mp4"]?.positionSec ?? "none"}
      </span>
      <button
        type="button"
        onClick={() =>
          recordProgress("/v/a.mp4", {
            positionSec: 42,
            durationSec: 100,
            updatedAtMs: 1000,
          })
        }
      >
        record
      </button>
      <button type="button" onClick={() => forgetProgress("/v/a.mp4")}>
        forget
      </button>
    </div>
  );
}

describe("ProgressProvider", () => {
  it("renders the loaded entries", async () => {
    const store = createInMemoryProgressStore({
      "/v/a.mp4": { positionSec: 12, durationSec: 100, updatedAtMs: 1 },
    });
    render(
      <ProgressProvider store={store}>
        <Probe />
      </ProgressProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("entry")).toHaveTextContent("12"),
    );
  });

  it("persists a recorded entry through the store", async () => {
    const store = createInMemoryProgressStore();
    render(
      <ProgressProvider store={store}>
        <Probe />
      </ProgressProvider>,
    );
    await screen.findByTestId("loaded");
    await userEvent.click(screen.getByRole("button", { name: "record" }));
    expect(screen.getByTestId("entry")).toHaveTextContent("42");
    await waitFor(async () => {
      const loaded = await store.load();
      expect(loaded["/v/a.mp4"]?.positionSec).toBe(42);
    });
  });

  it("removes an entry through the store when forgotten", async () => {
    const store = createInMemoryProgressStore({
      "/v/a.mp4": { positionSec: 12, durationSec: 100, updatedAtMs: 1 },
    });
    render(
      <ProgressProvider store={store}>
        <Probe />
      </ProgressProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("entry")).toHaveTextContent("12"),
    );
    await userEvent.click(screen.getByRole("button", { name: "forget" }));
    expect(screen.getByTestId("entry")).toHaveTextContent("none");
    await waitFor(async () => {
      const loaded = await store.load();
      expect(loaded["/v/a.mp4"]).toBeUndefined();
    });
  });
});
