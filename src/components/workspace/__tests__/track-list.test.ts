import { describe, expect, it } from "vitest";
import {
  formatTrackListOsd,
  parseMpvTrackList,
} from "@/components/workspace/track-list";

// A slice of mpv's `track-list` property for the LOTR extended MKV: one video
// track (must be ignored), two audio tracks and three subtitles.
const mpvTrackList = [
  { id: 1, type: "video", codec: "hevc", lang: "und", image: false },
  {
    id: 2,
    type: "audio",
    codec: "truehd",
    lang: "eng",
    title: "Atmos 7.1",
    default: true,
  },
  { id: 3, type: "audio", codec: "ac3", lang: "eng", title: "AC-3 5.1" },
  {
    id: 4,
    type: "sub",
    codec: "hdmv_pgs_subtitle",
    lang: "eng",
    title: "SDH",
    default: true,
  },
  { id: 5, type: "sub", codec: "hdmv_pgs_subtitle", lang: "fre", title: "fre" },
  {
    id: 6,
    type: "sub",
    codec: "hdmv_pgs_subtitle",
    lang: "pol",
    title: "SDL",
    forced: true,
  },
];

describe("parseMpvTrackList", () => {
  // behavior: audio and subtitle entries are kept, the video track is dropped
  it("should keep only audio and subtitle tracks if the list has a video track", () => {
    const tracks = parseMpvTrackList(mpvTrackList);

    expect(tracks.map((track) => track.kind)).toEqual([
      "audio",
      "audio",
      "subtitle",
      "subtitle",
      "subtitle",
    ]);
  });

  // behavior: each entry carries the id, codec, language, title and flags the
  // OSD line needs
  it("should map the mpv fields onto a track if the entry has them", () => {
    const [first] = parseMpvTrackList(mpvTrackList);

    expect(first).toEqual({
      id: 2,
      kind: "audio",
      codec: "truehd",
      lang: "eng",
      title: "Atmos 7.1",
      isDefault: true,
      isForced: false,
    });
  });

  // behavior: a missing language reads as "und" rather than blank
  it("should label the language as und if the entry has none", () => {
    const [track] = parseMpvTrackList([{ id: 1, type: "audio", codec: "aac" }]);

    expect(track.lang).toBe("und");
  });

  // behavior: junk payloads (no list yet, wrong shape, malformed entries) are
  // an empty list, never a throw
  it("should return an empty list if the payload is not a track list", () => {
    expect(parseMpvTrackList(null)).toEqual([]);
    expect(parseMpvTrackList({})).toEqual([]);
    expect(parseMpvTrackList("nope")).toEqual([]);
    expect(parseMpvTrackList([null, 7, { type: "video" }])).toEqual([]);
  });
});

describe("formatTrackListOsd", () => {
  // behavior: one line per group, audio first, each track numbered so a future
  // selector can reference mpv's track ids
  it("should format one OSD line per group if tracks exist", () => {
    const osd = formatTrackListOsd(parseMpvTrackList(mpvTrackList));

    expect(osd).toBe(
      [
        'Audio tracks (2): 2: truehd/eng "Atmos 7.1" [default]; 3: ac3/eng "AC-3 5.1"',
        'Subtitles (3): 4: hdmv_pgs_subtitle/eng "SDH" [default]; 5: hdmv_pgs_subtitle/fre "fre"; 6: hdmv_pgs_subtitle/pol "SDL" [forced]',
      ].join("\n"),
    );
  });

  // behavior: a file with only audio lists no empty subtitles line
  it("should omit the group line if that group has no tracks", () => {
    const osd = formatTrackListOsd(parseMpvTrackList([mpvTrackList[1]]));

    expect(osd).toBe('Audio tracks (1): 2: truehd/eng "Atmos 7.1" [default]');
  });

  // behavior: nothing to show is an empty string, so the caller can skip the OSD
  it("should return an empty string if there is no track", () => {
    expect(formatTrackListOsd([])).toBe("");
  });
});
