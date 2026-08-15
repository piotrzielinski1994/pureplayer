import { describe, expect, it } from "vitest";
import { parseLogLine } from "@/lib/logging/log-line";
// F2 - pure structured search over parsed LogLines. Tokenizes a `field:value` / bare query
// (double-quotes allow spaces in a value), matches case-insensitive substring per field, AND-combined.
import {
  filterLogLines,
  highlightLogSearch,
  KV_FIELDS,
} from "@/lib/logging/log-search";

// A small fixture spanning the shapes/levels the filter must discriminate, using pureplayer's OWN
// emitted kv keys (path/container/v/a/swap_id/source/code).
const prepareMkv = parseLogLine(
  "[2026-08-15T09:00:00Z][INFO] prepare_media path=/tmp/x.mkv container=matroska v=h264 a=aac",
  3,
);
const prepareMp4 = parseLogLine(
  "[2026-08-15T09:00:00Z][INFO] prepare_media path=/tmp/y.mp4 container=mp4 v=h264 a=aac",
  3,
);
const failWebm = parseLogLine(
  "[2026-08-15T09:00:00Z][ERROR] prepare_media failed: no audio or video stream (or bundled ffmpeg failed) path=/tmp/x.webm",
  5,
);
const bgFail = parseLogLine(
  "[2026-08-15T09:00:00Z][ERROR] bg audio re-encode failed swap_id=42 source=/tmp/swapped.m4a",
  5,
);
const remuxErr = parseLogLine(
  "[2026-08-15T09:00:00Z][ERROR] prepare_media remux failed code=Some(1) path=/tmp/z.avi",
  5,
);
const withUnknownField = parseLogLine(
  "[2026-08-15T09:00:00Z][INFO] prepare_media frob:bar path=/tmp/frob.mkv",
  3,
);

const lines = [
  prepareMkv,
  prepareMp4,
  failWebm,
  bgFail,
  remuxErr,
  withUnknownField,
];

describe("filterLogLines - field tokens (AC-005)", () => {
  // behavior: level:error returns only the error lines.
  it("should return only error lines for level:error", () => {
    expect(filterLogLines(lines, "level:error")).toEqual([
      failWebm,
      bgFail,
      remuxErr,
    ]);
  });

  // behavior: level:info returns only the info lines.
  it("should return only info lines for level:info", () => {
    expect(filterLogLines(lines, "level:info")).toEqual([
      prepareMkv,
      prepareMp4,
      withUnknownField,
    ]);
  });

  // behavior: path:/tmp/x.mkv matches the kv path by case-insensitive substring (TC-006).
  it("should match the path kv by case-insensitive substring", () => {
    expect(filterLogLines(lines, "path:/tmp/x.mkv")).toEqual([prepareMkv]);
    expect(filterLogLines(lines, "path:/TMP/X.MKV")).toEqual([prepareMkv]);
    expect(filterLogLines(lines, "path:/tmp")).toEqual([
      prepareMkv,
      prepareMp4,
      failWebm,
      remuxErr,
      withUnknownField,
    ]);
  });

  // behavior: single-letter kv fields (v/a) are queryable.
  it("should match the single-letter v and a kv fields", () => {
    expect(filterLogLines(lines, "v:h264")).toEqual([prepareMkv, prepareMp4]);
    expect(filterLogLines(lines, "a:aac")).toEqual([prepareMkv, prepareMp4]);
  });
});

describe("filterLogLines - quoted message term (AC-005)", () => {
  // behavior: message:"audio or video stream" (quoted, has a space) matches the error-tail text
  // that lives in `message`, returning only the webm failure line (TC-006).
  it("should match a quoted message term against a space-bearing error tail", () => {
    expect(filterLogLines(lines, 'message:"audio or video stream"')).toEqual([
      failWebm,
    ]);
  });

  // behavior: a quoted message term that appears nowhere matches nothing.
  it("should not match a quoted message term that appears nowhere in message", () => {
    expect(filterLogLines(lines, 'message:"totally absent phrase"')).toEqual(
      [],
    );
  });
});

describe("filterLogLines - combining and empties (AC-005)", () => {
  // behavior: two field tokens are AND-combined - only the mkv line matches both level:info AND
  // path:/tmp/x.mkv (TC-006).
  it("should AND-combine multiple field tokens", () => {
    expect(filterLogLines(lines, "level:info path:/tmp/x.mkv")).toEqual([
      prepareMkv,
    ]);
  });

  // behavior: AND of a field token and a bare term.
  it("should AND-combine a field token with a bare term", () => {
    expect(filterLogLines(lines, "level:error swap")).toEqual([bgFail]);
  });

  // behavior: an empty query returns every line.
  it("should return all lines for an empty query", () => {
    expect(filterLogLines(lines, "")).toEqual(lines);
  });

  // behavior: a whitespace-only query returns every line.
  it("should return all lines for a whitespace-only query", () => {
    expect(filterLogLines(lines, "   ")).toEqual(lines);
  });
});

describe("filterLogLines - bare terms and unknown fields (AC-005)", () => {
  // behavior: a bare term is a case-insensitive substring match on the whole raw line (TC-006).
  it("should match a bare term as a case-insensitive substring of raw", () => {
    expect(filterLogLines(lines, "swap_id")).toEqual([bgFail]);
    expect(filterLogLines(lines, "MATROSKA")).toEqual([prepareMkv]);
  });

  // behavior: an unknown field prefix makes the WHOLE token a bare term matched on raw, so a
  // `frob:bar` query matches the line whose raw contains the literal "frob:bar" (TC-007).
  it("should treat an unknown field prefix as a bare term on raw", () => {
    expect(filterLogLines(lines, "frob:bar")).toEqual([withUnknownField]);
    expect(filterLogLines(lines, "nope:whatever")).toEqual([]);
  });

  // behavior: a leading quote before the colon is not parsed as a field term (the bare fallback).
  it("should treat a leading quote before the colon as a bare term, not a field", () => {
    expect(filterLogLines(lines, '"level:"error')).not.toBe(
      filterLogLines(lines, "level:error"),
    );
  });

  // behavior: matching is case-insensitive for a field value too.
  it("should match a field value case-insensitively", () => {
    expect(filterLogLines(lines, "path:/TMP/X.WEBM")).toEqual([failWebm]);
  });
});

describe("filterLogLines - KV_FIELDS (AC-005)", () => {
  // behavior: the known kv fields are pureplayer's OWN emitted keys only.
  it("should expose pureplayer's emitted kv keys as the known field set", () => {
    expect(KV_FIELDS).toEqual([
      "path",
      "container",
      "v",
      "a",
      "plan",
      "pid",
      "out",
      "code",
      "swap_id",
      "source",
      "url",
      "root",
    ]);
  });

  // behavior: a known kv key prefix matches its field directly (code / swap_id / source).
  it("should match swap_id/source/code kv fields directly", () => {
    expect(filterLogLines(lines, "swap_id:42")).toEqual([bgFail]);
    expect(filterLogLines(lines, "source:/tmp/swapped")).toEqual([bgFail]);
    expect(filterLogLines(lines, "code:Some(1)")).toEqual([remuxErr]);
  });
});

describe("highlightLogSearch (AC-005)", () => {
  // behavior: an empty query yields no segments.
  it("should return no segments for an empty query", () => {
    expect(highlightLogSearch("")).toEqual([]);
  });

  // behavior: a field token splits into key (with colon) + value segments.
  it("should split a field:value token into key and value segments", () => {
    expect(highlightLogSearch("level:error")).toEqual([
      { text: "level:", kind: "key" },
      { text: "error", kind: "value" },
    ]);
  });

  // behavior: whitespace between terms is preserved verbatim as a plain segment (overlay aligns).
  it("should preserve whitespace verbatim and tag bare terms as plain", () => {
    expect(highlightLogSearch("path:/tmp/x.mkv mkv")).toEqual([
      { text: "path:", kind: "key" },
      { text: "/tmp/x.mkv", kind: "value" },
      { text: " ", kind: "plain" },
      { text: "mkv", kind: "plain" },
    ]);
  });
});
