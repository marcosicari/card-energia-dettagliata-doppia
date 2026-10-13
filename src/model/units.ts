export interface StateLike {
  state: string;
  attributes: { unit_of_measurement?: string; friendly_name?: string; [k: string]: unknown };
}

const FACTORS: Record<string, number> = { W: 1, kW: 1000, MW: 1_000_000 };

/** Converts a power sensor state to watts; null if unavailable, non-numeric or wrong unit. */
export function stateToWatts(st: StateLike | undefined): number | null {
  if (!st) return null;
  const value = Number(st.state);
  if (st.state === "" || !Number.isFinite(value)) return null;
  const unit = st.attributes?.unit_of_measurement ?? "W";
  const factor = FACTORS[unit];
  return factor === undefined ? null : value * factor;
}

/**
 * State of charge in percent (0..100); null if unavailable, non-numeric or not a percentage.
 * A missing unit is accepted (some integrations leave it out), any other unit is not.
 */
export function stateToPercent(st: StateLike | undefined): number | null {
  if (!st) return null;
  const value = Number(st.state);
  if (st.state === "" || !Number.isFinite(value)) return null;
  const unit = st.attributes?.unit_of_measurement;
  if (unit !== undefined && unit !== "%") return null;
  return Math.min(100, Math.max(0, value));
}

export type UnitOption = "auto" | "W" | "kW";

const formats = new Map<string, Intl.NumberFormat>();

/** Intl.NumberFormat is expensive to create, so one instance per locale and number of decimals is reused. */
function numberFormat(locale: string | undefined, decimals: number): Intl.NumberFormat {
  const key = `${locale ?? ""}|${decimals}`;
  let nf = formats.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formats.set(key, nf);
  }
  return nf;
}

/** Formats watts, e.g. 3420 -> "3.42 kW" (auto). Values below 1 W show "0 W". */
export function formatPower(watts: number, unit: UnitOption = "auto", decimals = 2, locale?: string): string {
  const abs = Math.abs(watts);
  if (abs < 1) return "0 W";
  // Intl.NumberFormat throws outside 0..20; never let a bad option break rendering.
  const d = Number.isFinite(decimals) ? Math.min(20, Math.max(0, Math.trunc(decimals))) : 2;
  const useKw = unit === "kW" || (unit === "auto" && abs >= 1000);
  return useKw ? `${numberFormat(locale, d).format(abs / 1000)} kW` : `${numberFormat(locale, 0).format(abs)} W`;
}

/** Energy sensors: the factor to watt hours, undefined for any other unit. */
export const ENERGY_FACTORS: Record<string, number> = { Wh: 1, kWh: 1000, MWh: 1_000_000 };

/**
 * Formats watt hours as kWh, e.g. 12400 -> "12.4 kWh". Energy is shown in kWh only
 * (the W / kW setting is for power). Values below 0.01 kWh show "0 kWh".
 */
export function formatEnergy(wh: number, decimals = 1, locale?: string): string {
  const kwh = Math.abs(wh) / 1000;
  if (kwh < 0.01) return "0 kWh";
  const d = Number.isFinite(decimals) ? Math.min(20, Math.max(0, Math.trunc(decimals))) : 1;
  return `${numberFormat(locale, d).format(kwh)} kWh`;
}
