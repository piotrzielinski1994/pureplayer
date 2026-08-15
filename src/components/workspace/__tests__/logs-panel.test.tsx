import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LogsPanel } from "@/components/workspace/logs-panel";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import type { LogStream } from "@/lib/logging/log-stream";

const INFO =
  "[2026-08-15T09:00:00Z][INFO] prepare_media path=/tmp/x.mkv container=matroska v=h264 a=aac";
const ERROR =
  "[2026-08-15T09:00:00Z][ERROR] prepare_media failed: no audio or video stream (or bundled ffmpeg failed) path=/tmp/x.webm";
const WARN = "[2026-08-15T09:00:00Z][WARN] prepare_media slow path=/tmp/y.mkv";
const DEBUG =
  "[2026-08-15T09:00:00Z][DEBUG] prepare_media transcode progress pid=123 out=/tmp/fifo";
const TS = "2026-08-15T09:00:00Z";

const renderLogs = (records: { raw: string; level: number }[]) => {
  const stream: LogStream = {
    subscribe: (onLine) => {
      for (const record of records) {
        onLine(record.raw, record.level);
      }
      return Promise.resolve(() => {});
    },
  };
  return render(
    <WorkspaceProvider logStream={stream}>
      <LogsPanel />
    </WorkspaceProvider>,
  );
};

const seed = (lines: string[]) =>
  lines.map((raw) => ({
    raw,
    level: raw.includes("[ERROR]")
      ? 5
      : raw.includes("[WARN]")
        ? 4
        : raw.includes("[DEBUG]")
          ? 2
          : 3,
  }));

// A log line's message is split into per-part spans, so phrases never match getByText; match on a
// listitem's textContent instead (the aria-hidden scroll sentinel is excluded from role queries).
const findRow = (text: string) =>
  screen
    .getAllByRole("listitem")
    .find((row) => (row.textContent ?? "").includes(text));

const clearButton = () => screen.queryByRole("button", { name: "Clear logs" });
const searchInput = () =>
  screen.queryByRole("searchbox", { name: "Search logs" });

describe("LogsPanel - empty state (AC-006)", () => {
  // behavior: a panel with no lines shows the empty state and hides Clear (AC-006).
  it("should show the empty state with Clear hidden when no lines exist", () => {
    renderLogs([]);

    expect(
      screen.getByText("No application logs yet this session."),
    ).toBeInTheDocument();
    expect(clearButton()).not.toBeInTheDocument();
    expect(searchInput()).toBeInTheDocument();
  });
});

describe("LogsPanel - rendering (AC-004)", () => {
  // behavior: seeded lines render newest-last with a muted timestamp, badge and kv (TC-003).
  it("should render seeded lines newest-last with timestamp, badge and kv parts", async () => {
    renderLogs(seed([INFO, ERROR]));

    await waitFor(() =>
      expect(findRow("prepare_media path=/tmp/x.mkv")).toBeDefined(),
    );

    const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows[0]).toContain("prepare_media path=/tmp/x.mkv");
    expect(rows[1]).toContain("failed: no audio or video stream");
    expect(rows[1]).toContain("path=/tmp/x.webm");
    // newest-last
    expect(rows.at(-1)).toContain("failed: no audio or video stream");

    const ts = within(findRow("prepare_media path=/tmp/x.mkv")!).getByText(TS);
    expect(ts.className).toContain("text-muted-foreground");
  });

  // behavior: each level renders a DISTINCT badge color, error red, warn amber, info blue,
  // debug muted (TC-005).
  it("should give per-level badges their distinct colors", async () => {
    renderLogs(seed([INFO, WARN, DEBUG, ERROR]));

    await waitFor(() =>
      expect(screen.getAllByText("error").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("info")[0].className).toContain("text-blue-600");
    expect(screen.getByText("warn").className).toContain("text-amber-600");
    expect(screen.getByText("debug").className).toContain(
      "text-muted-foreground",
    );
    expect(screen.getByText("error").className).toContain("text-red-600");
    expect(screen.getAllByText("info")[0].className).toContain("uppercase");
  });

  // behavior: key=value parts render with dimmed keys and accented values (TC-005).
  it("should tint kv keys orange and kv values foreground", async () => {
    renderLogs(seed([INFO]));

    await waitFor(() => expect(findRow("prepare_media path=")).toBeDefined());
    const row = findRow("prepare_media path=")!;
    const keySpan = within(row).getByText("path=");
    const valueSpan = within(row).getByText("/tmp/x.mkv");
    expect(keySpan.className).toContain("text-orange-600");
    expect(valueSpan.className).toContain("text-foreground");
  });
});

describe("LogsPanel - search + clear (AC-005, AC-006)", () => {
  // behavior: a zero-hit filter shows the no-match state while Clear stays visible (TC-008).
  it("should show 'No matching log lines.' for a zero-hit filter with Clear visible", async () => {
    const user = userEvent.setup();
    renderLogs(seed([INFO, ERROR]));

    await waitFor(() => expect(screen.getByText("error")).toBeInTheDocument());

    await user.type(searchInput()!, "level:warn");

    expect(screen.getByText("No matching log lines.")).toBeInTheDocument();
    expect(clearButton()).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  // behavior: clearing the filter restores the lines (TC-008).
  it("should restore all lines when the filter is cleared", async () => {
    const user = userEvent.setup();
    renderLogs(seed([INFO, ERROR]));

    await waitFor(() => expect(screen.getByText("error")).toBeInTheDocument());

    await user.type(searchInput()!, "level:error");
    await waitFor(() =>
      expect(findRow("prepare_media path=/tmp/x.mkv")).toBeUndefined(),
    );

    await user.clear(searchInput()!);

    await waitFor(() =>
      expect(findRow("prepare_media path=/tmp/x.mkv")).toBeDefined(),
    );
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  // behavior: a field:value query filters live; quoted phrases match as one token (TC-006).
  it("should filter by a quoted message phrase and an AND-combined field pair", async () => {
    const user = userEvent.setup();
    renderLogs(seed([INFO, ERROR]));

    await waitFor(() => expect(screen.getByText("error")).toBeInTheDocument());

    await user.type(searchInput()!, 'message:"audio or video stream"');
    await waitFor(() =>
      expect(findRow("failed: no audio or video stream")).toBeDefined(),
    );
    expect(findRow("prepare_media path=/tmp/x.mkv")).toBeUndefined();

    await user.clear(searchInput()!);
    await user.type(searchInput()!, "level:info path:/tmp/x.mkv");
    await waitFor(() =>
      expect(findRow("prepare_media path=/tmp/x.mkv")).toBeDefined(),
    );
    expect(findRow("failed: no audio")).toBeUndefined();
  });

  // behavior: Clear wipes the panel back to the empty state and hides itself (TC-008).
  it("should clear all lines and hide Clear again", async () => {
    const user = userEvent.setup();
    renderLogs(seed([INFO]));

    await waitFor(() =>
      expect(findRow("prepare_media path=/tmp/x.mkv")).toBeDefined(),
    );

    await user.click(clearButton()!);

    await waitFor(() =>
      expect(
        screen.getByText("No application logs yet this session."),
      ).toBeInTheDocument(),
    );
    expect(clearButton()).not.toBeInTheDocument();
  });
});

describe("LogsPanel - unparseable (AC-006)", () => {
  // behavior: an unparseable record renders its raw text verbatim as info without crashing (TC-009).
  it("should render the raw text verbatim with an info badge", async () => {
    const user = userEvent.setup();
    renderLogs(seed(["raw noise without prefix"]));

    await waitFor(() =>
      expect(findRow("raw noise without prefix")).toBeDefined(),
    );
    expect(screen.getByText("info")).toBeInTheDocument();
    expect(clearButton()).toBeInTheDocument();

    // filter still works over the raw text
    await user.type(searchInput()!, "noise");
    await waitFor(() =>
      expect(findRow("raw noise without prefix")).toBeDefined(),
    );
  });
});
