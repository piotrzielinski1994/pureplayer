import { isTauri } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDevBrowser } from "@/lib/runtime/environment";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(),
}));

const mockedIsTauri = vi.mocked(isTauri);

describe("isDevBrowser (AC-008 / TC-008)", () => {
  beforeEach(() => {
    mockedIsTauri.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should return true if MODE is development and there is no Tauri host", () => {
    vi.stubEnv("MODE", "development");
    mockedIsTauri.mockReturnValue(false);

    expect(isDevBrowser()).toBe(true);
  });

  it("should return false if MODE is development but a Tauri host is present", () => {
    vi.stubEnv("MODE", "development");
    mockedIsTauri.mockReturnValue(true);

    expect(isDevBrowser()).toBe(false);
  });

  it("should return false if MODE is test regardless of the Tauri host", () => {
    vi.stubEnv("MODE", "test");
    mockedIsTauri.mockReturnValue(false);

    expect(isDevBrowser()).toBe(false);
  });

  it("should return false if MODE is production", () => {
    vi.stubEnv("MODE", "production");
    mockedIsTauri.mockReturnValue(false);

    expect(isDevBrowser()).toBe(false);
  });
});
