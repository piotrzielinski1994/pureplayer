export type FitMode = "contain" | "cover" | "fill";
export type Rotation = 0 | 90 | 180 | 270;

export type ViewportTransform = {
  rotationDeg: Rotation;
  fitMode: FitMode;
  zoom: number;
};

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];
export const FIT_MODES: readonly FitMode[] = ["contain", "cover", "fill"];

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.1;

export const DEFAULT_TRANSFORM: ViewportTransform = {
  rotationDeg: 0,
  fitMode: "contain",
  zoom: 1,
};

export function nextRotation(current: Rotation): Rotation {
  return ((current + 90) % 360) as Rotation;
}

export function nextFitMode(current: FitMode): FitMode {
  const index = FIT_MODES.indexOf(current);
  return FIT_MODES[(index + 1) % FIT_MODES.length];
}

export function clampZoom(zoom: number): number {
  const bounded = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  return Math.round(bounded * 10) / 10;
}

export function isDefaultTransform(transform: ViewportTransform): boolean {
  return (
    transform.rotationDeg === DEFAULT_TRANSFORM.rotationDeg &&
    transform.fitMode === DEFAULT_TRANSFORM.fitMode &&
    transform.zoom === DEFAULT_TRANSFORM.zoom
  );
}

export function formatTransform(transform: ViewportTransform): string {
  const facets = [
    transform.rotationDeg === 0 ? null : `${transform.rotationDeg}deg`,
    transform.fitMode === "contain" ? null : transform.fitMode,
    transform.zoom === 1 ? null : `${transform.zoom}x`,
  ].filter((facet): facet is string => facet !== null);
  return facets.join(" ");
}
