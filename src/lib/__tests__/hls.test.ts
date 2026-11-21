import { describe, expect, it } from "vitest";
import {
  describeHlsError,
  isHlsPlaylistUrl,
  isNativeHlsPlayable,
  needsHlsJs,
  seekTarget,
} from "@/lib/hls";

describe("seekTarget", () => {
  // behavior: a target inside the written segments is a normal element seek
  it("should seek natively when the target is within the encoded region", () => {
    expect(seekTarget(30, 90)).toBe("native");
    expect(seekTarget(90, 90)).toBe("native");
  });

  // behavior: past the encoded region there is nothing to read, so the encode restarts
  it("should restart the encode when the target is beyond the encoded region", () => {
    expect(seekTarget(3600, 90)).toBe("restart");
  });

  // behavior: a target before the current base (negative relative) also restarts
  it("should restart when the target is before the current base offset", () => {
    expect(seekTarget(-5, 90)).toBe("restart");
  });
});

describe("isNativeHlsPlayable", () => {
  // behavior: WebView2 answers "maybe" for the m3u8 MIME but has no MPEG-TS
  // demuxer, so a Chromium webview must never take the native path
  it("should reject native playback in a Chromium webview even when canPlayType says maybe", () => {
    expect(isNativeHlsPlayable(true, "maybe")).toBe(false);
    expect(isNativeHlsPlayable(true, "probably")).toBe(false);
  });

  // behavior: WKWebView plays HLS itself and reports a non-empty type
  it("should accept native playback when WebKit reports support", () => {
    expect(isNativeHlsPlayable(false, "maybe")).toBe(true);
  });

  // behavior: an empty canPlayType answer means no native HLS anywhere
  it("should reject native playback when canPlayType is empty", () => {
    expect(isNativeHlsPlayable(false, "")).toBe(false);
  });
});

describe("isHlsPlaylistUrl", () => {
  // behavior: the backend's HLS prepare returns a loopback .m3u8 URL
  it("should recognize a loopback playlist url", () => {
    expect(isHlsPlaylistUrl("http://localhost:61012/3/index.m3u8")).toBe(true);
  });

  // behavior: query strings/hashes don't hide the extension
  it("should recognize a playlist url with a query string", () => {
    expect(isHlsPlaylistUrl("http://localhost:61012/3/index.m3u8?t=1")).toBe(
      true,
    );
  });

  // behavior: complete files (asset protocol) are never playlists
  it("should reject complete file urls", () => {
    expect(isHlsPlaylistUrl("asset://localhost/C%3A%2Ftmp%2F3.mp4")).toBe(
      false,
    );
    expect(isHlsPlaylistUrl("http://localhost:61012/3/seg00001.ts")).toBe(
      false,
    );
  });
});

describe("describeHlsError", () => {
  // behavior: a fatal network error is one line naming type, details and HTTP code
  it("should format type, details and http code for a fatal error", () => {
    expect(
      describeHlsError({
        fatal: true,
        type: "networkError",
        details: "manifestLoadError",
        response: { code: 404 },
      }),
    ).toBe("type=networkError details=manifestLoadError http=404");
  });

  // behavior: a fatal media error carries a reason instead of an HTTP code
  it("should include the reason when a fatal error carries one", () => {
    expect(
      describeHlsError({
        fatal: true,
        type: "mediaError",
        details: "bufferAppendError",
        reason: "SourceBuffer error",
      }),
    ).toBe(
      "type=mediaError details=bufferAppendError reason=SourceBuffer error",
    );
  });

  // behavior: non-fatal errors are retried by hls.js and must not spam the log
  it("should return null for a non-fatal error", () => {
    expect(describeHlsError({ fatal: false, type: "networkError" })).toBeNull();
  });
});

describe("needsHlsJs", () => {
  // behavior: Chromium (WebView2/WebKitGTK) has no native HLS -> hls.js must drive it
  it("should need hls.js when the playlist cannot be played natively", () => {
    expect(needsHlsJs("http://localhost:61012/3/index.m3u8", false)).toBe(true);
  });

  // behavior: WKWebView plays HLS itself -> attaching hls.js would fight the element
  it("should not need hls.js when native HLS is supported", () => {
    expect(needsHlsJs("http://localhost:61012/3/index.m3u8", true)).toBe(false);
  });

  // behavior: a complete file never needs hls.js
  it("should not need hls.js for a complete file", () => {
    expect(needsHlsJs("http://localhost:61012/3.mp4", false)).toBe(false);
  });
});
