import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime/environment", () => ({
  isDevBrowser: vi.fn(),
}));

import { AppProviders } from "@/app/providers";
import { isDevBrowser } from "@/lib/runtime/environment";
import { rootRoute } from "@/routes/__root";
import { indexRoute } from "@/routes/index";

const mockedIsDevBrowser = vi.mocked(isDevBrowser);

function renderApp() {
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <AppProviders>
      <RouterProvider router={testRouter} />
    </AppProviders>,
  );
}

afterEach(() => {
  cleanup();
  mockedIsDevBrowser.mockReset();
});

describe("dev-browser wiring (AC-010 / TC-010)", () => {
  it("should seed the demo playlist when isDevBrowser is true", async () => {
    mockedIsDevBrowser.mockReturnValue(true);
    renderApp();

    expect(await screen.findByText("Big Buck Bunny")).toBeInTheDocument();
    expect(screen.getByText("Sintel Trailer")).toBeInTheDocument();
    expect(screen.getByText("Jazz Loop")).toBeInTheDocument();
  });

  it("should keep the empty-state adapter when isDevBrowser is false", async () => {
    mockedIsDevBrowser.mockReturnValue(false);
    renderApp();

    expect(await screen.findByText("(no media)")).toBeInTheDocument();
    expect(screen.queryByText("Big Buck Bunny")).not.toBeInTheDocument();
    expect(screen.queryByText("Sintel Trailer")).not.toBeInTheDocument();
  });
});
