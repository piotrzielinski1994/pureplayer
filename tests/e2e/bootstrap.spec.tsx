import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";

import { AppProviders } from "@/app/providers";
import { rootRoute } from "@/routes/__root";
import { indexRoute } from "@/routes/index";
import { settingsRoute } from "@/routes/settings";
import { invoke } from "@tauri-apps/api/core";

// Mock the IPC boundary only (no Tauri host under jsdom). The SUT - routes,
// providers, the greet() wrapper, and the command palette - stay real.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

const GREETING = "Hello, World! Greetings from Tauri.";

function renderApp(initialPath = "/") {
  const routeTree = rootRoute.addChildren([indexRoute, settingsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  const result = render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...result, router };
}

describe("bootstrap scaffold", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(GREETING);
  });

  // TC-001 / AC-006 — behavior
  it("should render the home route with a heading and a button if the app launches", async () => {
    renderApp("/");

    expect(
      await screen.findByRole("heading", { name: /home/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  // TC-002 / AC-003 — behavior
  it("should switch to settings content if the settings nav link is clicked", async () => {
    const user = userEvent.setup();
    renderApp("/");

    await screen.findByRole("heading", { name: /home/i });

    await user.click(screen.getByRole("link", { name: /settings/i }));

    expect(
      await screen.findByRole("heading", { name: /settings/i }),
    ).toBeInTheDocument();
  });

  // TC-002 / AC-003 — behavior
  it("should return to the home route if the home nav link is clicked from settings", async () => {
    const user = userEvent.setup();
    renderApp("/settings");

    await screen.findByRole("heading", { name: /settings/i });

    await user.click(screen.getByRole("link", { name: /^home$/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /home/i }),
      ).toBeInTheDocument();
    });
  });

  // TC-002 / AC-003 edge case — behavior
  it("should render a not-found view if an unknown route is navigated", async () => {
    renderApp("/this-route-does-not-exist");

    expect(await screen.findByText(/404/i)).toBeInTheDocument();
    expect(screen.getByText(/does not exist/i)).toBeInTheDocument();
  });

  // TC-003 / AC-004, AC-007 — side-effect-contract: greet() invokes the "greet" command
  it("should resolve the greeting query and render the greeting text if greet succeeds", async () => {
    renderApp("/");

    expect(await screen.findByText(GREETING)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("greet", { name: "World" });
  });

  // UI state Loading -> Success (spec section 6) — behavior
  it("should show a loading placeholder then the greeting if the greet query is pending then resolves", async () => {
    let resolveGreet: ((value: string) => void) | undefined;
    invokeMock.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveGreet = resolve;
      }),
    );

    renderApp("/");

    expect(await screen.findByText(/loading/i)).toBeInTheDocument();

    resolveGreet?.(GREETING);

    expect(await screen.findByText(GREETING)).toBeInTheDocument();
  });

  // Edge case "greet rejects" / spec section 6 Error — behavior: inline error, no crash
  it("should show an inline error and keep the app alive if the greet command rejects", async () => {
    invokeMock.mockRejectedValue(new Error("IPC failed"));
    renderApp("/");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // app stays alive: home heading still present, no white screen
    expect(screen.getByRole("heading", { name: /home/i })).toBeInTheDocument();
  });

  // TC-004 / AC-005 — behavior: jsdom resolves Mod -> Control (requi learnings)
  it("should toggle the command palette dialog if the Mod+K hotkey is pressed", async () => {
    const user = userEvent.setup();
    renderApp("/");

    await screen.findByRole("heading", { name: /home/i });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
