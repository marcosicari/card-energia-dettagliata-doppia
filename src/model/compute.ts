import type { EnergyCardConfig, RoomConfig, SourceType } from "./config";
import { isIdle, type ThresholdConfig } from "./thresholds";

export interface Reading {
  watts: number;
  valid: boolean;
}
export type Reader = (entityId: string) => Reading;

export interface ConsumerNode {
  entity: string;
  name?: string;
  /** watts, or watt hours in the energy mode */
  watts: number;
  valid: boolean;
  /** energy mode: the consumer has no energy sensor */
  noEnergy?: boolean;
  /** own thresholds from the config, replace the level thresholds */
  thresholds?: ThresholdConfig[];
}
/** Consumers the list shows: with `onlyActive` the ones at rest (under 1 W) are left out, unreadable sensors stay as warnings. */
export function listedConsumers(consumers: ConsumerNode[], onlyActive: boolean, minWatts?: number): ConsumerNode[] {
  if (!onlyActive) return consumers;
  // `minWatts` raises the bar for "active" above the 1 W of idle (say 30 W: smaller loads stay hidden)
  const active = (w: number): boolean => (minWatts !== undefined ? Math.abs(w) >= minWatts : !isIdle(w));
  return consumers.filter((c) => !c.valid || active(c.watts));
}

export interface RoomNode {
  /** area_id from the config; stable across renames */
  id: string;
  name: string;
  icon?: string;
  color?: string;
  thresholds?: ThresholdConfig[];
  watts: number;
  consumers: ConsumerNode[];
}
export interface FloorNode {
  /** floor_id from the config; stable across renames */
  id: string;
  name: string;
  icon?: string;
  color?: string;
  thresholds?: ThresholdConfig[];
  watts: number;
  rooms: RoomNode[];
}
export interface SourceNode {
  entity: string;
  name: string;
  type: SourceType;
  icon?: string;
  color?: string;
  thresholds?: ThresholdConfig[];
  /** signed watts after `invert`; solar/generic are clipped at 0 (watt hours in the energy mode) */
  watts: number;
  valid: boolean;
  /** energy mode: the source has no energy sensor */
  noEnergy?: boolean;
  /** true while the source consumes power (battery charging, grid export) */
  reverse: boolean;
  /** share of all producing sources, 0..1 */
  share: number;
  /** state of charge in percent (battery) */
  soc?: number;
}
export interface EnergyModel {
  sources: SourceNode[];
  floors: FloorNode[];
  /** rooms directly under home (no floors configured) */
  rooms: RoomNode[];
  homeWatts: number;
  unassigned: number;
  /** 0..1, null when home consumption is zero or the grid is not measured (no grid source, or unreadable) */
  autarky: number | null;
  totalValid: boolean;
}

const DEFAULT_NAMES: Record<SourceType, string> = {
  solar: "PV",
  battery: "Batterie",
  grid: "Netz",
  generic: "Quelle",
};

const MISSING: Reading = { watts: 0, valid: false };

function computeRoom(room: RoomConfig, read: Reader, energy: boolean): RoomNode {
  const consumers = (room.consumers ?? []).map((c): ConsumerNode => {
    const noEnergy = energy && !c.energy_entity;
    const r = noEnergy ? MISSING : read(energy ? c.energy_entity! : c.entity);
    return { entity: c.entity, name: c.name, watts: r.valid ? Math.max(0, r.watts) : 0, valid: r.valid, noEnergy: noEnergy || undefined, thresholds: c.thresholds };
  });
  return {
    id: room.area_id,
    name: room.name ?? room.area_id,
    icon: room.icon,
    color: room.color,
    thresholds: room.thresholds,
    watts: consumers.reduce((s, c) => s + c.watts, 0),
    consumers,
  };
}

/**
 * `read` reads power sensors; `readSoc` reads state-of-charge sensors in percent
 * (defaults to `read`, which is enough for tests that use one lookup table).
 * With `energy` the model is built from the energy sensors instead (`read` then returns watt hours of
 * the period): elements without an energy sensor count 0 and are marked invalid.
 */
export function computeModel(
  cfg: EnergyCardConfig,
  read: Reader,
  readSoc: Reader = read,
  names: Record<SourceType, string> = DEFAULT_NAMES,
  energy = false,
): EnergyModel {
  const sources: SourceNode[] = (cfg.sources ?? []).map((s) => {
    const type = s.type ?? "generic";
    const noEnergy = energy && !s.energy_entity;
    const r = noEnergy ? MISSING : read(energy ? s.energy_entity! : s.entity);
    let watts = r.valid ? r.watts : 0;
    // an energy counter only counts what the source delivers
    if (s.invert && !energy) watts = -watts;
    if (type === "solar" || type === "generic") watts = Math.max(0, watts);
    const soc = s.soc_entity ? readSoc(s.soc_entity) : undefined;
    return {
      entity: s.entity,
      name: s.name ?? names[type],
      type,
      icon: s.icon,
      color: s.color,
      thresholds: s.thresholds,
      watts,
      valid: r.valid,
      noEnergy: noEnergy || undefined,
      reverse: watts < 0,
      share: 0,
      soc: soc?.valid ? soc.watts : undefined,
    };
  });

  const produced = sources.reduce((sum, s) => sum + Math.max(0, s.watts), 0);
  for (const s of sources) s.share = produced > 0 ? Math.max(0, s.watts) / produced : 0;

  const floors: FloorNode[] = (cfg.floors ?? []).map((f) => {
    const rooms = (f.rooms ?? []).map((r) => computeRoom(r, read, energy));
    return { id: f.floor_id, name: f.name ?? f.floor_id, icon: f.icon, color: f.color, thresholds: f.thresholds, watts: rooms.reduce((s, r) => s + r.watts, 0), rooms };
  });
  const rooms = (cfg.rooms ?? []).map((r) => computeRoom(r, read, energy));

  const roomSum = floors.length
    ? floors.reduce((s, f) => s + f.watts, 0)
    : rooms.reduce((s, r) => s + r.watts, 0);

  const totalId = energy ? cfg.home?.total_energy_entity : cfg.home?.total_entity;
  const total = totalId ? read(totalId) : undefined;
  const totalValid = !!total?.valid;
  const homeWatts = totalValid ? Math.max(0, total!.watts) : roomSum;
  const unassigned = totalValid ? Math.max(0, homeWatts - roomSum) : 0;

  // Self-sufficiency is "the part of the consumption not drawn from the grid", so it is only
  // known when the grid is measured: without a grid source, or with a grid sensor that
  // cannot be read, there is nothing to subtract and the badge is left out (not shown as 100 %).
  const grids = sources.filter((s) => s.type === "grid");
  const gridKnown = grids.length > 0 && grids.every((s) => s.valid);
  const gridImport = grids.reduce((sum, s) => sum + Math.max(0, s.watts), 0);
  const autarky = gridKnown && homeWatts > 0 ? Math.min(1, Math.max(0, 1 - gridImport / homeWatts)) : null;

  return { sources, floors, rooms, homeWatts, unassigned, autarky, totalValid };
}
