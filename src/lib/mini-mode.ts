export type MiniMode = "off" | "bar" | "playlist";

export type MiniTarget = "bar" | "playlist";

export function nextMiniMode(current: MiniMode, target: MiniTarget): MiniMode {
  return current === target ? "off" : target;
}
