import { describe, it, expect } from "vitest";

import { mediaFromPaths } from "@/components/workspace/media-from-paths";

describe("mediaFromPaths", () => {
  // behavior: name is the file basename (filename incl. extension) of the path (spec §5)
  it("should use the file basename as the node name if given an absolute path", () => {
    const [node] = mediaFromPaths(["/home/user/clips/myclip.mp4"]);

    expect(node.name).toBe("myclip.mp4");
  });

  // behavior: id and path both equal the absolute input path (data model §5)
  it("should set both id and path to the input path if given a path", () => {
    const path = "/home/user/clips/myclip.mp4";

    const [node] = mediaFromPaths([path]);

    expect(node.id).toBe(path);
    expect(node.path).toBe(path);
  });

  // behavior: each known video extension upcases to its VideoFormat (data model §5)
  it("should derive MP4 from a .mp4 extension if mapping a path", () => {
    expect(mediaFromPaths(["/v/a.mp4"])[0].format).toBe("MP4");
  });

  it("should derive MKV from a .mkv extension if mapping a path", () => {
    expect(mediaFromPaths(["/v/a.mkv"])[0].format).toBe("MKV");
  });

  it("should derive MOV from a .mov extension if mapping a path", () => {
    expect(mediaFromPaths(["/v/a.mov"])[0].format).toBe("MOV");
  });

  it("should derive WEBM from a .webm extension if mapping a path", () => {
    expect(mediaFromPaths(["/v/a.webm"])[0].format).toBe("WEBM");
  });

  it("should derive AVI from a .avi extension if mapping a path", () => {
    expect(mediaFromPaths(["/v/a.avi"])[0].format).toBe("AVI");
  });

  // behavior: each known audio extension upcases to its AudioFormat (AC-001)
  it("should derive MP3 from a .mp3 extension if mapping a path", () => {
    expect(mediaFromPaths(["/m/a.mp3"])[0].format).toBe("MP3");
  });

  it("should derive M4A from a .m4a extension if mapping a path", () => {
    expect(mediaFromPaths(["/m/a.m4a"])[0].format).toBe("M4A");
  });

  it("should derive AAC from a .aac extension if mapping a path", () => {
    expect(mediaFromPaths(["/m/a.aac"])[0].format).toBe("AAC");
  });

  it("should derive FLAC from a .flac extension if mapping a path", () => {
    expect(mediaFromPaths(["/m/a.flac"])[0].format).toBe("FLAC");
  });

  it("should derive WAV from a .wav extension if mapping a path", () => {
    expect(mediaFromPaths(["/m/a.wav"])[0].format).toBe("WAV");
  });

  it("should derive OGG from a .ogg extension if mapping a path", () => {
    expect(mediaFromPaths(["/m/a.ogg"])[0].format).toBe("OGG");
  });

  it("should derive OPUS from a .opus extension if mapping a path", () => {
    expect(mediaFromPaths(["/m/a.opus"])[0].format).toBe("OPUS");
  });

  it("should derive WMA from a .wma extension if mapping a path", () => {
    expect(mediaFromPaths(["/m/a.wma"])[0].format).toBe("WMA");
  });

  // TC-016 (behavior): a mixed audio+video list maps 1:1 to MediaNodes carrying the
  // right format, name (basename) and path (AC-001, AC-006).
  it("should map an audio path and a video path to MediaNodes with MP3 and MP4 formats", () => {
    const result = mediaFromPaths(["/m/song.mp3", "/m/clip.mp4"]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "song.mp3",
      path: "/m/song.mp3",
      format: "MP3",
    });
    expect(result[1]).toMatchObject({
      name: "clip.mp4",
      path: "/m/clip.mp4",
      format: "MP4",
    });
  });

  // behavior: extension casing is normalised before mapping (video)
  it("should map an uppercase .MP4 extension to MP4 if the case differs", () => {
    expect(mediaFromPaths(["/v/A.MP4"])[0].format).toBe("MP4");
  });

  // TC-017 (behavior): audio extension mapping is case-insensitive (AC-001).
  it("should derive FLAC from an uppercase .FLAC extension", () => {
    expect(mediaFromPaths(["/m/SONG.FLAC"])[0].format).toBe("FLAC");
  });

  // behavior: unknown/unrecognised extension defaults to MP4 (E-5/E-8)
  it("should default the format to MP4 if the extension is unrecognised", () => {
    expect(mediaFromPaths(["/v/weird.xyz"])[0].format).toBe("MP4");
  });

  // behavior: a path with no extension at all still defaults to MP4 (E-5/E-8)
  it("should default the format to MP4 if the path has no extension", () => {
    expect(mediaFromPaths(["/v/noext"])[0].format).toBe("MP4");
  });

  // behavior: multiple paths map 1:1 preserving the input order (AC-001)
  it("should preserve the input order if given multiple paths", () => {
    const result = mediaFromPaths([
      "/v/2 - second.mp4",
      "/v/1 - first.mkv",
      "/v/3 - third.mov",
    ]);

    expect(result.map((n) => n.name)).toEqual([
      "2 - second.mp4",
      "1 - first.mkv",
      "3 - third.mov",
    ]);
  });

  // behavior: empty input yields an empty array (E-1 supporting)
  it("should return an empty array if given no paths", () => {
    expect(mediaFromPaths([])).toEqual([]);
  });
});
