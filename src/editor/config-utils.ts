import { collectEnergyIds, collectEntityIds, type EnergyCardConfig, type RoomConfig } from "../model/config";

export type Pointer = Array<string | number>;
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads a dotted path ("options.unit") from a plain object. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

const isEmpty = (v: unknown): boolean => v === undefined || v === "" || v === null;

/**
 * Immutable write of a dotted path. Empty values (undefined, "", null) delete the key,
 * and objects that become empty are removed, so the result matches hand-written YAML.
 */
export function setPath<T extends object>(obj: T, path: string, value: unknown): T {
  const set = (cur: unknown, keys: string[]): unknown => {
    const base: Obj = isObj(cur) ? { ...cur } : {};
    const [head, ...rest] = keys;
    const next = rest.length ? set(base[head], rest) : value;
    if (isEmpty(next) || (isObj(next) && Object.keys(next).length === 0)) delete base[head];
    else base[head] = next;
    return base;
  };
  return set(obj, path.split(".")) as T;
}

/** Immutable update of the value at a pointer like ["floors", 0, "rooms", 1]. */
export function updateIn<T>(root: T, ptr: Pointer, fn: (v: any) => any): T {
  if (ptr.length === 0) return fn(root);
  const [head, ...rest] = ptr;
  const cur = root as any;
  const copy = Array.isArray(cur) ? [...cur] : { ...cur };
  copy[head as any] = updateIn(cur?.[head], rest, fn);
  return copy as T;
}

export function getIn(root: unknown, ptr: Pointer): any {
  return ptr.reduce<any>((cur, k) => cur?.[k], root);
}

export function moveItem<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  [copy[index], copy[to]] = [copy[to], copy[index]];
  return copy;
}

export function removeItem<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

type AreaRef = { area_id: string; floor_id?: string | null };

/**
 * Rooms that cannot move onto a floor: their area is unknown or has no floor in Home
 * Assistant. `toggleFloors` leaves them out of the floor layout.
 */
export function roomsWithoutFloor(cfg: EnergyCardConfig, areas: AreaRef[] = []): RoomConfig[] {
  return (cfg.rooms ?? []).filter((r) => !areas.find((a) => a.area_id === r.area_id)?.floor_id);
}

/**
 * Switches between floors and top-level rooms. Turning floors on groups the rooms by the
 * floor their area belongs to in Home Assistant; rooms whose area has no floor are left out
 * (see `roomsWithoutFloor`; the editor tells the user and keeps them). Turning floors off
 * flattens the floors again and appends the rooms in `restore` that left out earlier, unless
 * their area is on a floor meanwhile; a sensor already used elsewhere is not assigned twice.
 */
export function toggleFloors(
  cfg: EnergyCardConfig,
  useFloors: boolean,
  areas: AreaRef[] = [],
  restore: RoomConfig[] = [],
): EnergyCardConfig {
  const { floors, rooms, ...rest } = cfg;
  if (useFloors) {
    if (floors) return cfg;
    const byFloor = new Map<string, RoomConfig[]>();
    for (const r of rooms ?? []) {
      const fid = areas.find((a) => a.area_id === r.area_id)?.floor_id;
      if (fid) byFloor.set(fid, [...(byFloor.get(fid) ?? []), r]);
    }
    return { ...rest, floors: [...byFloor].map(([floor_id, rs]) => ({ floor_id, rooms: rs })) };
  }
  if (!floors) return cfg;
  const flat: RoomConfig[] = floors.flatMap((f) => f.rooms ?? []);
  const usedAreas = new Set(flat.map((r) => r.area_id));
  const sensorsOf = (r: RoomConfig) => (r.consumers ?? []).flatMap((c) => [c.entity, c.energy_entity].filter((e): e is string => !!e));
  const usedSensors = new Set(flat.flatMap(sensorsOf));
  for (const r of restore) {
    if (usedAreas.has(r.area_id)) continue;
    usedAreas.add(r.area_id);
    const consumers = (r.consumers ?? []).filter((c) => ![c.entity, c.energy_entity].some((e) => e && usedSensors.has(e)));
    sensorsOf({ ...r, consumers }).forEach((e) => usedSensors.add(e));
    flat.push({ ...r, consumers });
  }
  return { ...rest, rooms: flat };
}

export interface Duplicate {
  entity: string;
  places: string[];
}

/**
 * Consumer sensors (power and energy) that are taken by any slot other than `ptr` (a pointer like
 * ["floors", 0, "rooms", 1, "consumers", 2]); these must not be offered again.
 */
export function consumerEntitiesExcept(cfg: EnergyCardConfig | undefined, ptr: Pointer): string[] {
  const own = ptr.join(".");
  const taken: string[] = [];
  const scan = (rooms: RoomConfig[] | undefined, base: Pointer) =>
    (rooms ?? []).forEach((r, i) =>
      (r.consumers ?? []).forEach((c, j) => {
        const at = [...base, i, "consumers", j].join(".");
        if (at === own) return;
        if (c.entity) taken.push(c.entity);
        if (c.energy_entity) taken.push(c.energy_entity);
      }),
    );
  scan(cfg?.rooms, ["rooms"]);
  (cfg?.floors ?? []).forEach((f, i) => scan(f.rooms, ["floors", i, "rooms"]));
  return taken;
}

/** Sensors (power or energy) assigned to more than one consumer slot; the card refuses such a config. */
export function findDuplicates(cfg: EnergyCardConfig): Duplicate[] {
  const seen = new Map<string, string[]>();
  const add = (entity: string, place: string) => seen.set(entity, [...(seen.get(entity) ?? []), place]);
  const rooms = (rs: RoomConfig[], prefix: string) =>
    rs.forEach((r) =>
      (r.consumers ?? []).forEach((c) => {
        const place = `${prefix}${r.name ?? r.area_id}`;
        if (c.entity) add(c.entity, place);
        if (c.energy_entity) add(c.energy_entity, place);
      }),
    );
  rooms(cfg.rooms ?? [], "");
  (cfg.floors ?? []).forEach((f) => rooms(f.rooms ?? [], `${f.name ?? f.floor_id} › `));
  return [...seen].filter(([, p]) => p.length > 1).map(([entity, places]) => ({ entity, places }));
}

/** Moves the item at `from` so that it ends up at index `to`. */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/**
 * Entities whose changes the editor re-renders for: power and energy sensors alike, because the
 * hints of the fields (device class, unit) depend on the state of both.
 */
export function observedEntityIds(cfg: EnergyCardConfig): string[] {
  return [...new Set([...collectEntityIds(cfg), ...collectEnergyIds(cfg)])];
}
