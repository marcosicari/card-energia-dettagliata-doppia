import { MAX_THRESHOLD_WIDTH, MIN_THRESHOLD_WIDTH, THRESHOLD_LEVELS, type LevelThresholds, type ThresholdConfig } from "./thresholds";
import { isValidColor } from "./colors";

export type SourceType = "solar" | "battery" | "grid" | "generic";

export interface SourceConfig {
  entity: string;
  name?: string;
  type?: SourceType;
  icon?: string;
  color?: string;
  soc_entity?: string;
  invert?: boolean;
  /** energy counter (kWh) for the energy mode */
  energy_entity?: string;
  /** own thresholds for the line of this source (replace the level thresholds) */
  thresholds?: ThresholdConfig[];
}

export interface ConsumerConfig {
  entity: string;
  name?: string;
  /** energy counter (kWh) for the energy mode */
  energy_entity?: string;
  /** own thresholds for the bar of this consumer */
  thresholds?: ThresholdConfig[];
}

/** Rooms are Home Assistant areas; name and icon are resolved from the area registry. */
export interface RoomConfig {
  area_id: string;
  /** resolved at runtime, not user configurable */
  name?: string;
  icon?: string;
  color?: string;
  /** own thresholds for the line to this room */
  thresholds?: ThresholdConfig[];
  consumers?: ConsumerConfig[];
}

/** Floors are Home Assistant floors; name and icon are resolved from the floor registry. */
export interface FloorConfig {
  floor_id: string;
  /** resolved at runtime, not user configurable */
  name?: string;
  icon?: string;
  color?: string;
  /** own thresholds for the line to this floor */
  thresholds?: ThresholdConfig[];
  rooms?: RoomConfig[];
}

export interface ColorsConfig {
  preset?: "theme" | "nocturne" | "custom";
  accent?: string;
  flow?: string;
  inactive?: string;
  bar?: string;
  background?: string;
  text?: string;
  /** color of lines and bars by power range, in watts */
  thresholds?: ThresholdConfig[];
  /** own thresholds per level (source, floor, room, consumer); unset levels use `thresholds` */
  level_thresholds?: LevelThresholds;
}

export interface OptionsConfig {
  unit?: "auto" | "W" | "kW";
  decimals?: number;
  animation?: boolean;
  show_unassigned?: boolean;
  /** show the list of consumers under the diagram (default true) */
  show_consumers?: boolean;
  /** list only consumers that draw power (1 W or more); sensors that cannot be read stay listed as warnings */
  only_active_consumers?: boolean;
  remember_selection?: boolean;
  wrap_rooms?: boolean;
  /** the selected floor / room slides to the middle under its parent, the others of its level fade out */
  focus_selected?: boolean;
  /** what the card shows when it loads: the power now, or the energy of a period (default power) */
  mode?: "power" | "energy";
  /** periods the switch offers in the energy mode (default all) */
  energy_periods?: Array<"today" | "week" | "month">;
}

export interface EnergyCardConfig {
  type: string;
  title?: string;
  home?: { total_entity?: string; total_energy_entity?: string };
  sources?: SourceConfig[];
  floors?: FloorConfig[];
  rooms?: RoomConfig[];
  colors?: ColorsConfig;
  options?: OptionsConfig;
}

const SOURCE_TYPES: SourceType[] = ["solar", "battery", "grid", "generic"];

export class ConfigError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function checkEntity(id: unknown, where: string): void {
  if (typeof id !== "string" || !/^sensor\.[a-z0-9_]+$/.test(id)) {
    throw new ConfigError(`${where}: "${String(id)}" is not a sensor entity (sensor.*)`);
  }
}

/** `value` must be a list (or absent); returns it as an array for iteration. */
function list(value: unknown, where: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ConfigError(`${where} must be a list`);
  return value;
}

function checkColor(value: unknown, where: string): void {
  if (!isValidColor(value)) {
    throw new ConfigError(`${where}: "${String(value)}" is not a color (use e.g. #9184d9, rgb(…), red or var(--primary-color))`);
  }
}

function checkBool(value: unknown, where: string): void {
  if (value !== undefined && typeof value !== "boolean") throw new ConfigError(`${where} must be true or false`);
}

function checkRoom(room: unknown, where: string): void {
  if (!isObj(room) || typeof room.area_id !== "string" || !room.area_id) {
    throw new ConfigError(`${where}: room needs an area_id (a Home Assistant area)`);
  }
  checkColor(room.color, `${where}.color`);
  checkThresholds(room.thresholds, `${where}.thresholds`);
  list(room.consumers, `${where}.consumers`).forEach((c, i) => {
    checkEntity(isObj(c) ? c.entity : undefined, `${where}.consumers[${i}]`);
    if (isObj(c) && c.energy_entity) checkEntity(c.energy_entity, `${where}.consumers[${i}].energy_entity`);
    if (isObj(c)) checkThresholds(c.thresholds, `${where}.consumers[${i}].thresholds`);
  });
}

const UNITS = ["auto", "W", "kW"];
const MODES = ["power", "energy"];
export const ENERGY_PERIODS = ["today", "week", "month"] as const;
export type EnergyPeriod = (typeof ENERGY_PERIODS)[number];
/** Decimal places: Intl.NumberFormat accepts 0..20 everywhere; the editor offers 0..4. */
export const MAX_DECIMALS = 20;
const COLOR_KEYS = ["accent", "flow", "inactive", "bar", "background", "text"] as const;
const PRESETS = ["theme", "nocturne", "custom"];

function checkOptions(options: unknown): void {
  if (options === undefined || options === null) return;
  if (!isObj(options)) throw new ConfigError("options must be a mapping");
  if (options.unit !== undefined && !UNITS.includes(options.unit as string)) {
    throw new ConfigError(`options.unit: "${String(options.unit)}" must be one of ${UNITS.join(", ")}`);
  }
  const d = options.decimals;
  if (d !== undefined && (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > MAX_DECIMALS)) {
    throw new ConfigError(`options.decimals must be a whole number from 0 to ${MAX_DECIMALS}`);
  }
  if (options.mode !== undefined && !MODES.includes(options.mode as string)) {
    throw new ConfigError(`options.mode: "${String(options.mode)}" must be one of ${MODES.join(", ")}`);
  }
  list(options.energy_periods, "options.energy_periods").forEach((p, i) => {
    if (!(ENERGY_PERIODS as readonly unknown[]).includes(p)) {
      throw new ConfigError(`options.energy_periods[${i}]: "${String(p)}" must be one of ${ENERGY_PERIODS.join(", ")}`);
    }
  });
  for (const key of ["animation", "show_unassigned", "show_consumers", "only_active_consumers", "remember_selection", "wrap_rooms", "focus_selected"]) {
    checkBool(options[key], `options.${key}`);
  }
}

function checkColors(colors: unknown): void {
  if (colors === undefined || colors === null) return;
  if (!isObj(colors)) throw new ConfigError("colors must be a mapping");
  if (colors.preset !== undefined && !PRESETS.includes(colors.preset as string)) {
    throw new ConfigError(`colors.preset: "${String(colors.preset)}" must be one of ${PRESETS.join(", ")}`);
  }
  for (const key of COLOR_KEYS) checkColor(colors[key], `colors.${key}`);
  checkThresholds(colors.thresholds, "colors.thresholds");
  const perLevel = colors.level_thresholds;
  if (perLevel === undefined || perLevel === null) return;
  if (!isObj(perLevel)) throw new ConfigError("colors.level_thresholds must be a mapping");
  for (const [level, value] of Object.entries(perLevel)) {
    if (!(THRESHOLD_LEVELS as readonly string[]).includes(level)) {
      throw new ConfigError(`colors.level_thresholds.${level}: level must be one of ${THRESHOLD_LEVELS.join(", ")}`);
    }
    checkThresholds(value, `colors.level_thresholds.${level}`);
  }
}

function checkThresholds(value: unknown, path: string): void {
  list(value, path).forEach((t, i) => {
    if (!isObj(t) || typeof t.from !== "number" || !Number.isFinite(t.from) || t.from < 0) {
      throw new ConfigError(`${path}[${i}].from must be a number of watts (0 or more)`);
    }
    if (typeof t.color !== "string" || !t.color) throw new ConfigError(`${path}[${i}].color is required`);
    checkColor(t.color, `${path}[${i}].color`);
    const w = t.width;
    if (w !== undefined && (typeof w !== "number" || !Number.isFinite(w) || w < MIN_THRESHOLD_WIDTH || w > MAX_THRESHOLD_WIDTH)) {
      throw new ConfigError(`${path}[${i}].width must be a number from ${MIN_THRESHOLD_WIDTH} to ${MAX_THRESHOLD_WIDTH} (pixels)`);
    }
  });
}

/** A sensor may be assigned to one consumer slot only. */
function checkUniqueConsumers(cfg: EnergyCardConfig): void {
  const seen = new Map<string, string>();
  const scan = (rooms: RoomConfig[] | undefined, prefix: string) =>
    (rooms ?? []).forEach((r, i) =>
      (r.consumers ?? []).forEach((c, j) => {
        const where = `${prefix}[${i}].consumers[${j}]`;
        const first = seen.get(c.entity);
        if (first) throw new ConfigError(`${where}: "${c.entity}" is already assigned to ${first}; a sensor can be assigned only once`);
        seen.set(c.entity, where);
      }),
    );
  scan(cfg.rooms, "rooms");
  (cfg.floors ?? []).forEach((f, i) => scan(f.rooms, `floors[${i}].rooms`));
}

/** Validates a raw Lovelace config; throws ConfigError with a readable message. */
export function validateConfig(raw: unknown): EnergyCardConfig {
  if (!isObj(raw)) throw new ConfigError("Invalid configuration");
  if (raw.title !== undefined && typeof raw.title !== "string") throw new ConfigError("title must be text");

  const sources = list(raw.sources, "sources");
  const floors = list(raw.floors, "floors");
  const rooms = list(raw.rooms, "rooms");
  if (floors.length && rooms.length) {
    throw new ConfigError("Use either `floors` or `rooms` on the top level, not both");
  }

  if (raw.home !== undefined && raw.home !== null) {
    if (!isObj(raw.home)) throw new ConfigError("home must be a mapping");
    if (raw.home.total_entity) checkEntity(raw.home.total_entity, "home.total_entity");
    if (raw.home.total_energy_entity) checkEntity(raw.home.total_energy_entity, "home.total_energy_entity");
  }

  sources.forEach((s, i) => {
    if (!isObj(s)) throw new ConfigError(`sources[${i}] must be a mapping with an entity`);
    checkEntity(s.entity, `sources[${i}].entity`);
    if (s.energy_entity) checkEntity(s.energy_entity, `sources[${i}].energy_entity`);
    if (s.type && !SOURCE_TYPES.includes(s.type as SourceType)) {
      throw new ConfigError(`sources[${i}].type: unknown type "${String(s.type)}"`);
    }
    if (s.soc_entity) checkEntity(s.soc_entity, `sources[${i}].soc_entity`);
    checkBool(s.invert, `sources[${i}].invert`);
    checkColor(s.color, `sources[${i}].color`);
    checkThresholds(s.thresholds, `sources[${i}].thresholds`);
  });

  checkColors(raw.colors);
  checkOptions(raw.options);

  floors.forEach((f, i) => {
    if (!isObj(f) || typeof f.floor_id !== "string" || !f.floor_id) {
      throw new ConfigError(`floors[${i}]: floor needs a floor_id (a Home Assistant floor)`);
    }
    checkColor(f.color, `floors[${i}].color`);
    checkThresholds(f.thresholds, `floors[${i}].thresholds`);
    list(f.rooms, `floors[${i}].rooms`).forEach((r, j) => checkRoom(r, `floors[${i}].rooms[${j}]`));
  });
  rooms.forEach((r, i) => checkRoom(r, `rooms[${i}]`));

  const cfg = raw as unknown as EnergyCardConfig;
  checkUniqueConsumers(cfg);
  return cfg;
}

/** All entity ids referenced by the config (used to limit re-renders). */
export function collectEntityIds(cfg: EnergyCardConfig): string[] {
  const ids = new Set<string>();
  if (cfg.home?.total_entity) ids.add(cfg.home.total_entity);
  for (const s of cfg.sources ?? []) {
    ids.add(s.entity);
    if (s.soc_entity) ids.add(s.soc_entity);
  }
  const rooms = [...(cfg.rooms ?? []), ...(cfg.floors ?? []).flatMap((f) => f.rooms ?? [])];
  for (const r of rooms) for (const c of r.consumers ?? []) ids.add(c.entity);
  return [...ids];
}

/** True when at least one element has an energy sensor, so the card can offer the energy mode. */
export function hasEnergy(cfg: EnergyCardConfig): boolean {
  const rooms = [...(cfg.rooms ?? []), ...(cfg.floors ?? []).flatMap((f) => f.rooms ?? [])];
  return (
    !!cfg.home?.total_energy_entity ||
    (cfg.sources ?? []).some((s) => !!s.energy_entity) ||
    rooms.some((r) => (r.consumers ?? []).some((c) => !!c.energy_entity))
  );
}

/** All energy sensors of the config (their statistics are requested together). */
export function collectEnergyIds(cfg: EnergyCardConfig): string[] {
  const ids = new Set<string>();
  if (cfg.home?.total_energy_entity) ids.add(cfg.home.total_energy_entity);
  for (const s of cfg.sources ?? []) if (s.energy_entity) ids.add(s.energy_entity);
  const rooms = [...(cfg.rooms ?? []), ...(cfg.floors ?? []).flatMap((f) => f.rooms ?? [])];
  for (const r of rooms) for (const c of r.consumers ?? []) if (c.energy_entity) ids.add(c.energy_entity);
  return [...ids];
}
