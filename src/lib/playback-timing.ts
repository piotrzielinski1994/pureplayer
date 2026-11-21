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

// The fields of a <video> that explain a silent stall: paused alone leaves a
// black frame at 00:00 with no error on screen, and a packaged webview has no
// devtools to inspect it. `errorCode` is MediaError.code (null when no error).
export type ElementState = {
  paused: boolean;
  readyState: number;
  currentTime: number;
  errorCode: number | null;
  bufferedEnds: number[];
};

// The length to show in the transport. The source's real duration wins whenever
// ffprobe reported one: an HLS playlist's own duration is NaN before the first
// segment and the already-encoded length afterwards, so a total taken from it keeps
// growing while the film streams - a moving number is not a total.
export function resolveDuration(
  elementDuration: number,
  probed: number | null,
): number {
  if (probed !== null && Number.isFinite(probed) && probed > 0) {
    return probed;
  }
  if (Number.isFinite(elementDuration) && elementDuration > 0) {
    return elementDuration;
  }
  return 0;
}

// One log line for the element state at the first canplay, so the app log shows
// whether the stream buffered but never started (paused) or never buffered at all
// (readyState 0, empty buffered).
export function describeElementState(state: ElementState): string {
  const buffered = state.bufferedEnds.map((end) => end.toFixed(2)).join(",");
  return `element: paused=${state.paused} readyState=${state.readyState} t=${state.currentTime.toFixed(2)}s error=${state.errorCode ?? "none"} buffered=[${buffered}]`;
}
