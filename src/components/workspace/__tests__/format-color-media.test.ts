import { describe, expect, it } from "vitest";

import { FORMAT_COLOR } from "@/components/workspace/format-color";
import type { MediaFormat } from "@/components/workspace/mock-data";

// Every MediaFormat value, video + audio, enumerated at runtime so the badge-color
// map can be checked exhaustively (a `type` union can't be iterated directly).
const ALL_MEDIA_FORMATS: MediaFormat[] = [
  "MP4",
  "MKV",
  "MOV",
  "WEBM",
  "AVI",
  "MP3",
  "M4A",
  "AAC",
  "FLAC",
  "WAV",
  "OGG",
  "OPUS",
  "WMA",
];

describe("FORMAT_COLOR", () => {
  // TC-018 (behavior): every MediaFormat - audio included - has a defined,
  // non-empty color class; none resolves to undefined (AC-006).
  it("should define a non-empty color class for every MediaFormat value", () => {
    ALL_MEDIA_FORMATS.forEach((format) => {
      const color = FORMAT_COLOR[format];
      expect(color, `missing FORMAT_COLOR entry for ${format}`).toBeDefined();
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    });
  });
});
