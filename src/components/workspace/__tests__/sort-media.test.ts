import { describe, expect, it } from "vitest";
import type { MediaNode } from "@/components/workspace/mock-data";
import { sortMedia } from "@/components/workspace/sort-natural";

const make = (name: string, format: MediaNode["format"]): MediaNode => ({
  id: name,
  name,
  format,
  path: `/m/${name}`,
});

const names = (media: MediaNode[]) => media.map((m) => m.name);

// A mixed audio + video playlist. Formats compare alphabetically:
// FLAC < MP3 < MP4 < WEBM. Titles carry numeric prefixes so title order is 1,2,3,10.
const mixed: MediaNode[] = [
  make("3 - video clip.mp4", "MP4"),
  make("1 - song.mp3", "MP3"),
  make("10 - stream.webm", "WEBM"),
  make("2 - track.flac", "FLAC"),
];

describe("sortMedia", () => {
  // TC-019 (behavior): a mixed audio+video list orders by natural title value (AC-006).
  it("should order a mixed audio and video list by natural title value if keys is [title] asc", () => {
    const result = names(sortMedia(mixed, ["title"], "asc"));

    expect(result).toEqual([
      "1 - song.mp3",
      "2 - track.flac",
      "3 - video clip.mp4",
      "10 - stream.webm",
    ]);
  });

  // TC-019 (behavior): the same list orders by format string, audio and video
  // interleaved deterministically (FLAC < MP3 < MP4 < WEBM) (AC-006).
  it("should order a mixed audio and video list by format if keys is [type] asc", () => {
    const result = names(sortMedia(mixed, ["type"], "asc"));

    expect(result).toEqual([
      "2 - track.flac",
      "1 - song.mp3",
      "3 - video clip.mp4",
      "10 - stream.webm",
    ]);
  });
});
