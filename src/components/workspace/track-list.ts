// MPV tracks are read as scalar properties (`track-list/N/*`, see viewport.tsx)
// and turned into plain track objects here for the in-app audio/subtitle
// pickers.

export type TrackKind = "audio" | "subtitle";

export type MediaTrack = {
  id: number | null;
  kind: TrackKind;
  codec: string;
  lang: string;
  title: string;
  isDefault: boolean;
  isForced: boolean;
};

const KIND_BY_TYPE: Record<string, TrackKind> = {
  audio: "audio",
  sub: "subtitle",
  subtitle: "subtitle",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// mpv's `track-list` is a JSON array of objects; anything else (not loaded yet,
// junk payload) yields an empty list instead of a throw.
// Build one track from the per-index properties mpv exposes under
// `track-list/N/*`. Unlike the `track-list` node format, these scalar reads are
// reliably serialised by the libmpv wrapper, so the listing never hangs on a
// property that never resolves.
export type MpvTrackProperties = {
  id: number | null;
  type: unknown;
  codec: unknown;
  lang: unknown;
  title: unknown;
  isDefault: unknown;
  isForced: unknown;
};

export function trackFromProperties(
  properties: MpvTrackProperties,
): MediaTrack | null {
  const kind = KIND_BY_TYPE[text(properties.type).toLowerCase()];
  if (!kind) {
    return null;
  }
  return {
    id: properties.id,
    kind,
    codec: text(properties.codec),
    lang: text(properties.lang) || "und",
    title: text(properties.title),
    isDefault: properties.isDefault === true,
    isForced: properties.isForced === true,
  };
}

export function parseMpvTrackList(value: unknown): MediaTrack[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const tracks: MediaTrack[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const kind = KIND_BY_TYPE[text(record.type).toLowerCase()];
    if (!kind) {
      continue;
    }
    tracks.push({
      id: typeof record.id === "number" ? record.id : null,
      kind,
      codec: text(record.codec),
      lang: text(record.lang) || "und",
      title: text(record.title),
      isDefault: record.default === true,
      isForced: record.forced === true,
    });
  }
  return tracks;
}
