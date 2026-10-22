import type { EnergyCardConfig } from "./config";

export interface Selection {
  /** floor_id; undefined = default (largest floor), null = explicitly none selected, i.e. all floors */
  floor?: string | null;
  /** area_id of one room; undefined / null select all rooms of the row */
  room?: string | null;
}

export const STORAGE_PREFIX = "detailed-energy-card:";
const KEY_PREFIX = `${STORAGE_PREFIX}sel2:`;

/**
 * Storage key of a card: derived from the floor and area ids only, so changing colors, names or
 * consumers keeps the remembered selection, while two cards with different structure stay apart.
 * The ids are used as they are (no hash, so no collisions). Cards with the same structure
 * (say a power and an energy view) are told apart by `options.storage_id`.
 */
export function selectionKey(cfg: EnergyCardConfig | undefined): string {
  const ids = {
    f: (cfg?.floors ?? []).map((f) => [f.floor_id, (f.rooms ?? []).map((r) => r.area_id)]),
    r: (cfg?.rooms ?? []).map((r) => r.area_id),
  };
  return `${KEY_PREFIX}${encodeURIComponent(cfg?.options?.storage_id ?? "")}:${JSON.stringify(ids)}`;
}

/**
 * Storage key of the plant that is open in the tabs layout. Built from the names of the plants, so another
 * set of plants starts at the first tab; it lies under the `sel2:` prefix, which the cleanup of old keys keeps.
 */
export function plantTabKey(cfg: EnergyCardConfig | undefined): string {
  const names = (cfg?.plants ?? []).map((p) => p.name);
  return `${KEY_PREFIX}plants:${encodeURIComponent(cfg?.options?.storage_id ?? "")}:${JSON.stringify(names)}`;
}

/** The remembered tab as an index into `count` plants; anything else (missing, old, out of range) is the first. */
export function parsePlantTab(raw: string | null, count: number): number {
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 && n < count ? n : 0;
}

const idOrNull = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === "string" ? v : undefined;

/** Reads a stored value defensively: anything that is not the expected shape counts as "no selection". */
export function parseSelection(raw: string | null): Selection {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    const o = v as Record<string, unknown>;
    const sel: Selection = {};
    const floor = idOrNull(o.floor);
    const room = idOrNull(o.room);
    if (floor !== undefined) sel.floor = floor;
    if (room !== undefined) sel.room = room;
    return sel;
  } catch {
    return {};
  }
}

/** Removes keys of the old formats (selection by name, key from the whole config, hashed key). */
export function removeLegacyKeys(storage: Pick<Storage, "length" | "key" | "removeItem">): void {
  const stale: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(STORAGE_PREFIX) && !k.startsWith(KEY_PREFIX)) stale.push(k);
  }
  for (const k of stale) storage.removeItem(k);
}

let legacyKeysRemoved = false;

/** The old keys only need to go once per page load, not with every `setConfig` (the editor sends one per change). */
export function removeLegacyKeysOnce(storage: Pick<Storage, "length" | "key" | "removeItem">): void {
  if (legacyKeysRemoved) return;
  removeLegacyKeys(storage);
  legacyKeysRemoved = true;
}
