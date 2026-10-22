import type { ColorsConfig, EnergyCardConfig } from "./config";

/**
 * Several plants in one card. A plant is a complete energy flow of its own (home, sources, floors or
 * rooms); the card draws one diagram per plant. Top-level `sources`, `colors` and `options` are shared:
 * they are the defaults of every plant, and top-level sources (typically the grid) appear in each one.
 *
 * Everything here is pure: a plant becomes an ordinary single-plant config, which the existing model,
 * validation and rendering handle unchanged.
 */

/** Room kept free in the 64 characters of `options.storage_id` for the suffix added per plant. */
const STORAGE_ID_BASE = 50;

/** Shared colors with the colors of a plant on top; thresholds per level are merged level by level. */
export function mergeColors(shared?: ColorsConfig | null, own?: ColorsConfig | null): ColorsConfig | undefined {
  if (!shared && !own) return undefined;
  const merged: ColorsConfig = { ...shared, ...own };
  if (shared?.level_thresholds || own?.level_thresholds) {
    merged.level_thresholds = { ...shared?.level_thresholds, ...own?.level_thresholds };
  }
  return merged;
}

/**
 * The remembered selection of a plant must not be shared with another plant, even when both have the same
 * floors and rooms: each plant gets its own id, built from the id of the card (if any) and the position.
 */
export function plantStorageId(base: string | undefined, index: number): string {
  return `${(base ?? "").slice(0, STORAGE_ID_BASE)}:p${index}`;
}

/**
 * The single-plant config of `cfg.plants[index]`. With `ownSourcesOnly` the shared sources are left out, so
 * that a validation error points at the sources of the plant (`sources[0]` is then `plants[i].sources[0]`).
 */
export function plantConfig(cfg: EnergyCardConfig, index: number, ownSourcesOnly = false): EnergyCardConfig {
  const plant = cfg.plants?.[index];
  if (!plant) throw new RangeError(`plants[${index}] does not exist`);
  const out: EnergyCardConfig = { type: cfg.type, title: plant.name };
  if (plant.home) out.home = plant.home;
  out.sources = [...(plant.sources ?? []), ...(ownSourcesOnly ? [] : (cfg.sources ?? []))];
  if (plant.floors) out.floors = plant.floors;
  if (plant.rooms) out.rooms = plant.rooms;
  const colors = mergeColors(cfg.colors, plant.colors);
  if (colors) out.colors = colors;
  out.options = {
    ...cfg.options,
    ...plant.options,
    storage_id: plantStorageId(plant.options?.storage_id ?? cfg.options?.storage_id, index),
  };
  return out;
}

/** The single-plant configs of all plants of the card (none without `plants`). */
export function plantConfigs(cfg: EnergyCardConfig): EnergyCardConfig[] {
  return (cfg.plants ?? []).map((_, i) => plantConfig(cfg, i));
}
