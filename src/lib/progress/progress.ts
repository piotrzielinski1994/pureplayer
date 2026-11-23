import type { MediaFormat } from "@/components/workspace/mock-data";

// Below this the "resume" is noise - the file had barely started.
export const MIN_RESUME_SEC = 5;
// Within this of the end the file is treated as finished, so it starts over.
export const END_TOLERANCE_SEC = 5;
// A write closer than this to the last persisted position is skipped, so the
// ~4 Hz timeupdate never hammers the store.
export const SAVE_INTERVAL_SEC = 5;

export const PROGRESS_VERSION = 1;

const VIDEO_FORMATS = new Set<MediaFormat>([
  "MP4",
  "MKV",
  "MOV",
  "WEBM",
  "AVI",
]);

export function isVideoFormat(format: MediaFormat): boolean {
  return VIDEO_FORMATS.has(format);
}

export type ProgressEntry = {
  positionSec: number;
  durationSec: number;
  updatedAtMs: number;
};

// Keyed by media path (the media id), so the same file resolves across sessions
// regardless of playlist order.
export type ProgressMap = Record<string, ProgressEntry>;

export type ProgressFile = {
  version: typeof PROGRESS_VERSION;
  entries: ProgressMap;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseEntry(value: unknown): ProgressEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const { positionSec, durationSec, updatedAtMs } = value;
  if (
    !isFiniteNumber(positionSec) ||
    !isFiniteNumber(durationSec) ||
    !isFiniteNumber(updatedAtMs) ||
    positionSec < 0 ||
    durationSec <= 0
  ) {
    return null;
  }
  return { positionSec, durationSec, updatedAtMs };
}

export function parseProgressFile(raw: unknown): ProgressMap {
  if (!isRecord(raw) || raw.version !== PROGRESS_VERSION) {
    return {};
  }
  if (!isRecord(raw.entries)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw.entries).flatMap(([path, value]) => {
      const entry = parseEntry(value);
      return entry === null ? [] : [[path, entry] as const];
    }),
  );
}

export function toProgressFile(map: ProgressMap): ProgressFile {
  return { version: PROGRESS_VERSION, entries: map };
}

// Returns null when the position is not worth a write: unknown duration, or
// less than SAVE_INTERVAL_SEC of movement since the stored entry.
export function recordProgress(
  map: ProgressMap,
  path: string,
  positionSec: number,
  durationSec: number,
  nowMs: number,
): ProgressMap | null {
  if (
    !isFiniteNumber(positionSec) ||
    !isFiniteNumber(durationSec) ||
    durationSec <= 0
  ) {
    return null;
  }
  const position = Math.min(Math.max(0, positionSec), durationSec);
  const previous = map[path];
  if (
    previous &&
    previous.durationSec === durationSec &&
    Math.abs(previous.positionSec - position) < SAVE_INTERVAL_SEC
  ) {
    return null;
  }
  return {
    ...map,
    [path]: { positionSec: position, durationSec, updatedAtMs: nowMs },
  };
}

export function clearProgress(map: ProgressMap, path: string): ProgressMap {
  if (!(path in map)) {
    return map;
  }
  const { [path]: _removed, ...rest } = map;
  return rest;
}

export function resumePosition(entry: ProgressEntry | undefined): number {
  if (!entry || !isFiniteNumber(entry.positionSec)) {
    return 0;
  }
  if (entry.positionSec < MIN_RESUME_SEC) {
    return 0;
  }
  if (entry.positionSec >= entry.durationSec - END_TOLERANCE_SEC) {
    return 0;
  }
  return entry.positionSec;
}
