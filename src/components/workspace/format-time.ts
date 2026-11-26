const HOUR_SEC = 3600;

export function formatTime(
  totalSeconds: number,
  referenceSeconds: number = totalSeconds,
): string {
  const hours = Math.floor(totalSeconds / HOUR_SEC);
  const minutes = Math.floor((totalSeconds % HOUR_SEC) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (value: number) => value.toString().padStart(2, "0");
  if (Math.max(totalSeconds, referenceSeconds) < HOUR_SEC) {
    return `${pad(minutes)}:${pad(seconds)}`;
  }
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}
