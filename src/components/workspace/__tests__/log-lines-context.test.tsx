import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  useLogLines,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { LogStream } from "@/lib/logging/log-stream";

function LogProbe() {
  const { logLines, clearLogLines } = useLogLines();
  return (
    <div>
      <span data-testid="count">{logLines.length}</span>
      <p data-testid="lines">
        {logLines.map((line) => `${line.level}:${line.message}`).join("|")}
      </p>
      <button onClick={clearLogLines}>clear</button>
    </div>
  );
}

const capture = () => {
  const listeners: ((raw: string, level: number) => void)[] = [];
  const stream: LogStream = {
    subscribe: (onLine) => {
      listeners.push(onLine);
      return Promise.resolve(() => {});
    },
  };
  return { listeners, stream };
};

describe("LogLinesContext subscription (AC-003)", () => {
  // behavior: an injected stream drives parsed log lines into the context (TC-003).
  it("should append a parsed log line for each injected stream record", () => {
    const { listeners, stream } = capture();
    render(
      <WorkspaceProvider logStream={stream}>
        <LogProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("count")).toHaveTextContent("0");

    act(() =>
      listeners[0](
        "[2026-08-15T09:00:00Z][INFO] prepare_media path=/tmp/x.mkv container=matroska",
        3,
      ),
    );
    act(() =>
      listeners[0](
        "[2026-08-15T09:00:00Z][ERROR] bg audio re-encode failed swap_id=42 source=/tmp/swapped.m4a",
        5,
      ),
    );

    expect(screen.getByTestId("count")).toHaveTextContent("2");
    // level comes from the numeric plugin level; the [ts][LEVEL] prefix is stripped from message.
    expect(
      screen.getByText(/info:prepare_media path=\/tmp\/x.mkv/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/error:bg audio re-encode failed swap_id=42/),
    ).toBeInTheDocument();
  });

  // behavior: with no stream injected (browser/jsdom), the default noop leaves the list empty (TC-002).
  it("should leave logLines empty with no logStream injected", () => {
    render(
      <WorkspaceProvider>
        <LogProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  // behavior: an unparseable record still lands as an info-level line without failing (TC-009).
  it("should append an unparseable record verbatim with the plugin level as info", () => {
    const { listeners, stream } = capture();
    render(
      <WorkspaceProvider logStream={stream}>
        <LogProbe />
      </WorkspaceProvider>,
    );

    act(() => listeners[0]("raw noise without prefix", 3));

    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(
      screen.getByText(/info:raw noise without prefix/),
    ).toBeInTheDocument();
  });

  // behavior: clearLogLines wipes the accumulated lines (TC-008).
  it("should clear all lines via clearLogLines", async () => {
    const user = userEvent.setup();
    const { listeners, stream } = capture();
    render(
      <WorkspaceProvider logStream={stream}>
        <LogProbe />
      </WorkspaceProvider>,
    );

    act(() =>
      listeners[0](
        "[2026-08-15T09:00:00Z][INFO] prepare_media path=/tmp/x.mkv",
        3,
      ),
    );
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "clear" }));

    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  // side-effect-contract: a subscribe that resolves AFTER unmount disposes via its unsubscribe.
  it("should call the unsubscribe when the subscribe resolves after unmount", async () => {
    const unsub = vi.fn();
    let resolveSubscribe: (fn: () => void) => void = () => {};
    const stream: LogStream = {
      subscribe: () =>
        new Promise<() => void>((resolve) => {
          resolveSubscribe = resolve;
        }),
    };

    const { unmount } = render(
      <WorkspaceProvider logStream={stream}>
        <LogProbe />
      </WorkspaceProvider>,
    );
    unmount();

    await act(async () => {
      resolveSubscribe(unsub);
    });
    expect(unsub).toHaveBeenCalledOnce();
  });
});
