export type PlaybackMarks = {
  activatedAtMs: number;
  prepareResolvedAtMs: number;
  firstFrameAtMs: number;
};

// One-line drop->first-frame timeline for the log file. prepare = backend probe +
// cache + IPC (activation -> prepareMediaUrl resolved); element-load = the <video>
// loading the prepared file (resolved -> first frame). Each phase rounded
// independently, so prepare + element-load may differ from total by 1ms.
export function formatTimeline(name: string, marks: PlaybackMarks): string {
  const prepareMs = Math.round(marks.prepareResolvedAtMs - marks.activatedAtMs);
  const elementLoadMs = Math.round(
    marks.firstFrameAtMs - marks.prepareResolvedAtMs,
  );
  const totalMs = Math.round(marks.firstFrameAtMs - marks.activatedAtMs);
  return `playback "${name}": prepare ${prepareMs}ms | element-load ${elementLoadMs}ms | total ${totalMs}ms`;
}
