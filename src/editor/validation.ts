import type { EnergyCardConfig } from "../model/config";
import { computeModel } from "../model/compute";
import { powerReader } from "../model/readers";
import type { StateLike } from "../model/units";
import type { Field } from "./schema";
import { makeTr, type Tr } from "../localize/editor";
import { isValidColor } from "../model/colors";

export { isValidColor };

const DE = makeTr("de");

const POWER_UNITS = ["W", "kW", "MW"];
const ENERGY_UNITS = ["Wh", "kWh", "MWh"];

/** Message for an unsuitable sensor, undefined when the sensor is fine or not set yet. */
export function checkSensor(
  states: Record<string, StateLike | undefined>,
  entityId: unknown,
  check: NonNullable<Field["check"]>,
  tr: Tr = DE,
): string | undefined {
  if (typeof entityId !== "string" || !entityId) return undefined;
  if (!entityId.startsWith("sensor.")) return tr("Nur sensor.* ist erlaubt");
  const st = states[entityId];
  if (!st) return tr("Entität nicht gefunden");
  const attrs = st.attributes;
  if (check === "power") {
    if (attrs.device_class !== "power") return tr("Kein Leistungssensor (device_class: power)");
    if (!POWER_UNITS.includes(String(attrs.unit_of_measurement))) return tr("Einheit muss W, kW oder MW sein");
  } else if (check === "energy") {
    if (attrs.device_class !== "energy") return tr("Kein Energiesensor (device_class: energy)");
    if (!ENERGY_UNITS.includes(String(attrs.unit_of_measurement))) return tr("Einheit muss Wh, kWh oder MWh sein");
  } else if (attrs.device_class !== "battery" && attrs.unit_of_measurement !== "%") {
    return tr("Kein Prozent-/Batteriesensor");
  }
  return undefined;
}

/** Errors for ha-form (`error` prop), keyed by field path. */
export function fieldErrors(
  obj: unknown,
  fields: Field[],
  states: Record<string, StateLike | undefined>,
  get: (o: unknown, path: string) => unknown,
  tr: Tr = DE,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const value = get(obj, f.path);
    const msg = f.check
      ? checkSensor(states, value, f.check, tr)
      : f.kind === "color"
        ? colorError(value, tr)
        : undefined;
    if (msg) errors[f.path] = msg;
  }
  return errors;
}

export const colorError = (value: unknown, tr: Tr = DE): string | undefined =>
  isValidColor(value) ? undefined : tr("Ungültige Farbe (z. B. #9184d9)");

/** Set when the rooms use more power than the configured total sensor reports. */
export function sumConflict(
  cfg: EnergyCardConfig,
  states: Record<string, StateLike | undefined>,
): { rooms: number; total: number } | undefined {
  if (!cfg.home?.total_entity) return undefined;
  const model = computeModel(cfg, powerReader(states));
  if (!model.totalValid) return undefined;
  const rooms = model.floors.length
    ? model.floors.reduce((s, f) => s + f.watts, 0)
    : model.rooms.reduce((s, r) => s + r.watts, 0);
  return rooms > model.homeWatts + 1 ? { rooms, total: model.homeWatts } : undefined;
}

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb() and rgba() into [r, g, b]. */
export function parseColor(value: string | undefined): [number, number, number] | undefined {
  const v = (value ?? "").trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return undefined;
}

const luminance = ([r, g, b]: [number, number, number]): number => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Warning text when text and background fall below 4.5 : 1. `themeText` / `themeBg` are the
 * HA theme values used for whichever color is not set in the config. Silent when neither
 * color is customized (the theme is trusted) or a value cannot be parsed.
 */
export function contrastWarning(
  colors: { text?: string; background?: string } | undefined,
  themeText: string | undefined,
  themeBg: string | undefined,
  tr: Tr = DE,
): string | undefined {
  if (!colors?.text && !colors?.background) return undefined;
  const text = parseColor(colors.text && colors.text !== "theme" ? colors.text : themeText);
  const bg = parseColor(colors.background && colors.background !== "theme" ? colors.background : themeBg);
  if (!text || !bg) return undefined;
  const ratio = contrastRatio(text, bg);
  return ratio < 4.5
    ? tr("Geringer Kontrast zwischen Text und Hintergrund ({0} : 1, empfohlen ab 4.5 : 1)", ratio.toFixed(1))
    : undefined;
}
