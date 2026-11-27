import { describe, expect, it } from "vitest";
import { hasFfmpegFallbackFor } from "@/lib/platform";

describe("hasFfmpegFallbackFor", () => {
  // behavior: the Windows build ships no ffmpeg sidecars, so there is no fallback (AC-004)
  it("should report no ffmpeg fallback if the user agent is Windows", () => {
    expect(
      hasFfmpegFallbackFor(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      ),
    ).toBe(false);
  });

  // behavior: macOS and Linux keep the bundled ffmpeg fallback (AC-002)
  it("should report the ffmpeg fallback if the user agent is macOS or Linux", () => {
    expect(
      hasFfmpegFallbackFor(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      ),
    ).toBe(true);
    expect(
      hasFfmpegFallbackFor(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      ),
    ).toBe(true);
  });
});
