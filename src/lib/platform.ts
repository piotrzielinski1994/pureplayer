// The Windows build ships libmpv and no ffmpeg/ffprobe sidecars, so there an mpv
// failure has nowhere to fall back to.
export function hasFfmpegFallbackFor(userAgent: string): boolean {
  return !userAgent.includes("Windows");
}

export function hasFfmpegFallback(): boolean {
  return hasFfmpegFallbackFor(navigator.userAgent);
}
