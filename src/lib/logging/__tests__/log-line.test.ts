import { describe, expect, it } from "vitest";

// F2 - pure parser for the Logs panel. Turns a pre-formatted plugin message
// (`[ts][LEVEL] msg`) + an optional numeric plugin level into a structured LogLine.
import { parseLogLine } from "@/lib/logging/log-line";

// Real shapes the pureplayer backend emits (media.rs prepare_media / bg audio / remux),
// exactly as tauri-plugin-log delivers them in the `message` field.
const PREPARE_OK =
  "[2026-08-15T09:00:00Z][INFO] prepare_media path=/tmp/x.mkv container=matroska v=h264 a=aac";
const PREPARE_FAIL =
  "[2026-08-15T09:00:00Z][ERROR] prepare_media failed: no audio or video stream (or bundled ffmpeg failed) path=/tmp/x.webm";
const BG_FAIL =
  "[2026-08-15T09:00:00Z][ERROR] bg audio re-encode failed swap_id=42 source=/tmp/swapped.m4a";
const PLAN =
  "[2026-08-15T09:00:00Z][INFO] prepare_media plan=VideoCopyAudioReencode";

const TS = "2026-08-15T09:00:00Z";

describe("parseLogLine - pureplayer media shapes (AC-003)", () => {
  // behavior: a prepare_media line splits into timestamp/level/message + the pureplayer kv
  // keys (TC-003).
  it("should parse a prepare-ok line into timestamp, info level, message and kv", () => {
    const line = parseLogLine(PREPARE_OK, 3);

    expect(line.raw).toBe(PREPARE_OK);
    expect(line.timestamp).toBe(TS);
    expect(line.level).toBe("info");
    expect(line.message).toBe(
      "prepare_media path=/tmp/x.mkv container=matroska v=h264 a=aac",
    );
    expect(line.kv).toEqual({
      path: "/tmp/x.mkv",
      container: "matroska",
      v: "h264",
      a: "aac",
    });
  });

  // behavior: a space-bearing error tail stays in `message` while `kv.path` still parses (TC-004).
  it("should parse an error line keeping the failure tail in message, not kv, with path still parsed", () => {
    const line = parseLogLine(PREPARE_FAIL, 5);

    expect(line.timestamp).toBe(TS);
    expect(line.level).toBe("error");
    expect(line.message).toContain("no audio or video stream");
    expect(line.message).toContain("path=/tmp/x.webm");
    expect(line.kv).toEqual({ path: "/tmp/x.webm" });
    expect(line.kv).not.toHaveProperty("audio");
    expect(line.kv).not.toHaveProperty("stream");
    expect(line.kv).not.toHaveProperty("failed");
  });

  // behavior: a bg-audio failure line carries swap_id + source kv.
  it("should parse a bg-audio failure line into swap_id + source kv", () => {
    const line = parseLogLine(BG_FAIL, 5);

    expect(line.level).toBe("error");
    expect(line.message).toBe(
      "bg audio re-encode failed swap_id=42 source=/tmp/swapped.m4a",
    );
    expect(line.kv).toEqual({
      swap_id: "42",
      source: "/tmp/swapped.m4a",
    });
  });

  // behavior: a plan line captures the kv (colon-bearing Rust Debug value is one token).
  it("should parse a plan line with a Rust Debug enum value as one kv token", () => {
    const line = parseLogLine(PLAN, 3);

    expect(line.level).toBe("info");
    expect(line.kv).toEqual({ plan: "VideoCopyAudioReencode" });
  });
});

describe("parseLogLine - unparseable fallback (AC-006)", () => {
  // behavior: a line not matching the `[ts][LEVEL] msg` shape falls back to an info line whose
  // message is the raw text, empty timestamp, empty kv (TC-009).
  it("should fall back to an info line with raw message and empty kv when the shape does not match", () => {
    const raw = "raw noise without prefix";
    const line = parseLogLine(raw);

    expect(line).toEqual({
      raw,
      timestamp: "",
      level: "info",
      message: raw,
      kv: {},
    });
  });

  // side-effect-contract: the parser NEVER throws, on any input.
  it("should never throw on empty or malformed input", () => {
    expect(() => parseLogLine("")).not.toThrow();
    expect(() => parseLogLine("[unterminated bracket")).not.toThrow();
    expect(() => parseLogLine("][")).not.toThrow();

    const empty = parseLogLine("");
    expect(empty.level).toBe("info");
    expect(empty.timestamp).toBe("");
    expect(empty.kv).toEqual({});
  });
});

describe("parseLogLine - level source precedence (AC-003)", () => {
  // behavior: the numeric plugin level wins over the [LEVEL] token (INFO token + numeric 5 -> error).
  it("should take the level from the numeric plugin level over the token", () => {
    expect(parseLogLine(PREPARE_OK, 5).level).toBe("error");
  });

  // behavior: with no numeric level, the [LEVEL] token is used.
  it("should take the level from the [LEVEL] token when no numeric level is given", () => {
    expect(parseLogLine(PREPARE_FAIL).level).toBe("error");
    expect(
      parseLogLine(
        "[2026-08-15T09:00:00Z][WARN] prepare_media slow path=/tmp/x.mkv",
      ).level,
    ).toBe("warn");
  });

  // behavior: the full numeric mapping 1=trace, 2=debug, 3=info, 4=warn, 5=error.
  it("should map each numeric plugin level to its LogLevel", () => {
    const base = "[2026-08-15T09:00:00Z][INFO] prepare_media path=/tmp/x.mkv";
    expect(parseLogLine(base, 1).level).toBe("trace");
    expect(parseLogLine(base, 2).level).toBe("debug");
    expect(parseLogLine(base, 3).level).toBe("info");
    expect(parseLogLine(base, 4).level).toBe("warn");
    expect(parseLogLine(base, 5).level).toBe("error");
  });
});
