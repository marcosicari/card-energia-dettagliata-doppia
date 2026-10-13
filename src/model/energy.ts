import type { Reader } from "./compute";
import { ENERGY_PERIODS, type EnergyPeriod } from "./config";

export { ENERGY_PERIODS, type EnergyPeriod };

/** Offset of a time zone to UTC at a moment, in ms (positive east of Greenwich). */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The moment a calendar day starts in a time zone (handles days with a daylight saving change). */
export function localMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  const off = tzOffsetMs(new Date(guess), timeZone);
  const result = guess - off;
  const off2 = tzOffsetMs(new Date(result), timeZone);
  return new Date(off2 === off ? result : guess - off2);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Index (0 = Sunday) of the first day of the week from the Home Assistant locale (`first_weekday`); Monday by default. */
export const firstWeekdayIndex = (value: string | undefined): number => {
  const i = WEEKDAYS.indexOf(String(value ?? "").toLowerCase());
  return i >= 0 ? i : 1;
};

/** Start of the day / week / month that contains `now`, in the time zone of Home Assistant. */
export function periodStart(period: EnergyPeriod, now: Date, timeZone: string, firstWeekday = 1): Date {
  const local = new Date(now.getTime() + tzOffsetMs(now, timeZone));
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() + 1;
  const d = local.getUTCDate();
  if (period === "month") return localMidnight(y, m, 1, timeZone);
  if (period === "today") return localMidnight(y, m, d, timeZone);
  const back = (local.getUTCDay() - firstWeekday + 7) % 7;
  const start = new Date(Date.UTC(y, m - 1, d - back));
  return localMidnight(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate(), timeZone);
}

interface WsHass {
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
}

type StatRow = { change?: number | null };

/** Sum of the hourly / daily "change" values of each sensor, in kWh. */
export function sumChanges(result: Record<string, StatRow[] | undefined>): Map<string, number> {
  const sums = new Map<string, number>();
  for (const [id, rows] of Object.entries(result ?? {})) {
    if (!Array.isArray(rows)) continue;
    sums.set(id, rows.reduce((s, r) => s + (typeof r.change === "number" && Number.isFinite(r.change) ? r.change : 0), 0));
  }
  return sums;
}

/**
 * Energy used since the start of the period for every sensor, in watt hours. Sensors without
 * statistics (no state class, or not recorded) are missing from the result.
 */
export async function loadEnergy(
  hass: WsHass,
  ids: string[],
  period: EnergyPeriod,
  now: Date,
  timeZone: string,
  firstWeekday = 1,
): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const result = await hass.callWS<Record<string, StatRow[]>>({
    type: "recorder/statistics_during_period",
    start_time: periodStart(period, now, timeZone, firstWeekday).toISOString(),
    end_time: now.toISOString(),
    statistic_ids: ids,
    // buckets align with the day in the time zone of Home Assistant; hours are only needed within one day
    period: period === "today" ? "hour" : "day",
    types: ["change"],
    // converts every energy statistic to kWh, whatever unit the sensor reports
    units: { energy: "kWh" },
  });
  const kwh = sumChanges(result);
  return new Map([...kwh].map(([id, v]) => [id, v * 1000]));
}

const MISSING = { watts: 0, valid: false };

/** Reader over loaded energy values (watt hours in "watts"); sensors without a value are invalid. */
export const energyReader =
  (values: Map<string, number>): Reader =>
  (id) => {
    const v = values.get(id);
    return v === undefined ? MISSING : { watts: v, valid: true };
  };

/** Periods the switch offers: the configured ones in their fixed order, all of them by default. */
export function offeredPeriods(configured: readonly EnergyPeriod[] | undefined): EnergyPeriod[] {
  const wanted = (configured ?? []).filter((p) => ENERGY_PERIODS.includes(p));
  return wanted.length ? ENERGY_PERIODS.filter((p) => wanted.includes(p)) : [...ENERGY_PERIODS];
}
