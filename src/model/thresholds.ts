/** Colors by power range: from `from` watts upwards the line / bar gets `color`. */
export interface ThresholdConfig {
  from: number;
  color: string;
  /** absolute line width in px from this range upwards; unset: width follows the power */
  width?: number;
}

/** Levels of the graph that can have their own thresholds. */
export const THRESHOLD_LEVELS = ["source", "floor", "room", "consumer"] as const;
export type ThresholdLevel = (typeof THRESHOLD_LEVELS)[number];

export const MIN_THRESHOLD_WIDTH = 0.5;
export const MAX_THRESHOLD_WIDTH = 12;

/** Thresholds per level; a level without its own list falls back to colors.thresholds. */
export type LevelThresholds = Partial<Record<ThresholdLevel, ThresholdConfig[]>>;

/** Below this power a node or consumer counts as idle (also: no animation). */
export const IDLE_BELOW_W = 1;

export const isIdle = (watts: number): boolean => Math.abs(watts) < IDLE_BELOW_W;

/** Valid thresholds sorted by `from`; entries without a usable number or color are ignored. */
export function sortThresholds(list: ThresholdConfig[] | undefined): ThresholdConfig[] {
  return (list ?? [])
    .filter((t) => t && Number.isFinite(t.from) && t.from >= 0 && typeof t.color === "string" && t.color !== "")
    .sort((a, b) => a.from - b.from);
}

/** Sorted thresholds for every level (own list, else the shared one). */
export function resolveThresholds(
  shared: ThresholdConfig[] | undefined,
  perLevel: LevelThresholds | undefined,
): Record<ThresholdLevel, ThresholdConfig[]> {
  const base = sortThresholds(shared);
  const out = {} as Record<ThresholdLevel, ThresholdConfig[]>;
  for (const level of THRESHOLD_LEVELS) {
    const own = perLevel?.[level];
    out[level] = own ? sortThresholds(own) : base;
  }
  return out;
}

/**
 * Fixed line width of the highest range whose `from` is reached and that sets a `width`,
 * undefined otherwise (the width then follows the power). `sorted` must come from sortThresholds().
 */
export function thresholdWidth(sorted: ThresholdConfig[], watts: number): number | undefined {
  const abs = Math.abs(watts);
  let width: number | undefined;
  for (const t of sorted) {
    if (abs < t.from) break;
    if (typeof t.width === "number" && Number.isFinite(t.width)) width = t.width;
  }
  return width;
}

/**
 * Color of the highest range whose `from` is reached, undefined below the first range
 * (or without thresholds), so the normal flow / bar color applies there.
 * `sorted` must come from sortThresholds().
 */
export function thresholdColor(sorted: ThresholdConfig[], watts: number): string | undefined {
  const abs = Math.abs(watts);
  let color: string | undefined;
  for (const t of sorted) {
    if (abs >= t.from) color = t.color;
    else break;
  }
  return color;
}

/**
 * How many ranges are reached (0 below the first one, or without thresholds). Used as a second cue
 * besides the color: higher ranges draw thicker lines and bars, so they stay readable without color vision.
 * `sorted` must come from sortThresholds().
 */
export function thresholdLevel(sorted: ThresholdConfig[], watts: number): number {
  const abs = Math.abs(watts);
  let level = 0;
  for (const t of sorted) {
    if (abs >= t.from) level++;
    else break;
  }
  return level;
}

/** `from` values used by more than one threshold (only the last of them would apply). */
export function duplicateThresholds(list: ThresholdConfig[] | undefined): number[] {
  const seen = new Set<number>();
  const dups = new Set<number>();
  for (const t of list ?? []) {
    if (seen.has(t.from)) dups.add(t.from);
    seen.add(t.from);
  }
  return [...dups];
}

/** Traffic-light style defaults offered by the editor, in watts. */
export const DEFAULT_THRESHOLDS: ThresholdConfig[] = [
  { from: 0, color: "#4caf50" },
  { from: 500, color: "#ff9800" },
  { from: 2000, color: "#f44336" },
];

/** Traffic-light defaults per level, in watts: the bigger the part of the home, the higher the limits. */
export const DEFAULT_LEVEL_THRESHOLDS: Record<ThresholdLevel, ThresholdConfig[]> = {
  source: [
    { from: 0, color: "#4caf50", width: 2 },
    { from: 2000, color: "#ff9800", width: 4 },
    { from: 6000, color: "#f44336", width: 6 },
  ],
  floor: [
    { from: 0, color: "#4caf50", width: 2 },
    { from: 1500, color: "#ff9800", width: 3.5 },
    { from: 4000, color: "#f44336", width: 5.5 },
  ],
  room: [
    { from: 0, color: "#4caf50", width: 1.5 },
    { from: 800, color: "#ff9800", width: 3 },
    { from: 2500, color: "#f44336", width: 5 },
  ],
  consumer: [
    { from: 0, color: "#4caf50" },
    { from: 300, color: "#ff9800" },
    { from: 1500, color: "#f44336" },
  ],
};
