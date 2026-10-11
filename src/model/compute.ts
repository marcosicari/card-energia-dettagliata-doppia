import type { EnergyCardConfig, RoomConfig, SourceType } from "./config";
import type { ThresholdConfig } from "./thresholds";

export interface Reading {
  watts: number;
  valid: boolean;
}
export type Reader = (entityId: string) => Reading;

export interface ConsumerNode {
  entity: string;
  name?: string;
  watts: number;
  valid: boolean;
  /** own thresholds from the config, replace the level thresholds */
  thresholds?: ThresholdConfig[];
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
  /** signed watts after `invert`; solar/generic are clipped at 0 */
  watts: number;
  valid: boolean;
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

function computeRoom(room: RoomConfig, read: Reader): RoomNode {
  const consumers = (room.consumers ?? []).map((c) => {
    const r = read(c.entity);
    return { entity: c.entity, name: c.name, watts: r.valid ? Math.max(0, r.watts) : 0, valid: r.valid, thresholds: c.thresholds };
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
 */
export function computeModel(
  cfg: EnergyCardConfig,
  read: Reader,
  readSoc: Reader = read,
  names: Record<SourceType, string> = DEFAULT_NAMES,
): EnergyModel {
  const sources: SourceNode[] = (cfg.sources ?? []).map((s) => {
    const type = s.type ?? "generic";
    const r = read(s.entity);
    let watts = r.valid ? r.watts : 0;
    if (s.invert) watts = -watts;
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
      reverse: watts < 0,
      share: 0,
      soc: soc?.valid ? soc.watts : undefined,
    };
  });

  const produced = sources.reduce((sum, s) => sum + Math.max(0, s.watts), 0);
  for (const s of sources) s.share = produced > 0 ? Math.max(0, s.watts) / produced : 0;

  const floors: FloorNode[] = (cfg.floors ?? []).map((f) => {
    const rooms = (f.rooms ?? []).map((r) => computeRoom(r, read));
    return { id: f.floor_id, name: f.name ?? f.floor_id, icon: f.icon, color: f.color, thresholds: f.thresholds, watts: rooms.reduce((s, r) => s + r.watts, 0), rooms };
  });
  const rooms = (cfg.rooms ?? []).map((r) => computeRoom(r, read));

  const roomSum = floors.length
    ? floors.reduce((s, f) => s + f.watts, 0)
    : rooms.reduce((s, r) => s + r.watts, 0);

  const total = cfg.home?.total_entity ? read(cfg.home.total_entity) : undefined;
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
