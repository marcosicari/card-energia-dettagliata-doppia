import { THRESHOLD_LEVELS } from "../model/thresholds";
import type { EditorKey, Tr } from "../localize/editor";

/**
 * Declarative description of every editor field. Each field maps 1:1 to a config path,
 * so the form data is simply { [path]: value } and no per-field mapping code is needed.
 */
export interface Field {
  /** dotted path relative to the edited object, e.g. "options.unit" */
  path: string;
  selector: Record<string, unknown>;
  label: EditorKey;
  /** translated options of a select selector, added to `selector.select.options` */
  options?: Array<{ value: string; label: EditorKey }>;
  required?: boolean;
  /** value shown (and behavior applied) while the option is unset in the config */
  default?: unknown;
  /** show only when the edited object matches */
  when?: (obj: any) => boolean;
  /** rendered as color picker + hex field instead of a selector */
  kind?: "color";
  /** sensor kind validated against the live HA state */
  check?: "power" | "battery" | "energy";
  /** the value is a list (the config path is written with "[]" in coveredPaths) */
  multi?: boolean;
}

const power = { entity: { domain: "sensor", device_class: "power" } };
const energy = { entity: { domain: "sensor", device_class: "energy" } };
const text = { text: {} };
const icon = { icon: {} };
export const COLOR_KEYS = ["accent", "flow", "inactive", "bar", "background", "text"];

/** Individual colors are editable with the "custom" preset, or when the YAML already sets some. */
const customColors = (cfg: any): boolean =>
  cfg?.colors?.preset === "custom" || COLOR_KEYS.some((k) => !!cfg?.colors?.[k]);

const color = (path: string, label: EditorKey): Field => ({
  path,
  selector: text,
  label,
  kind: "color",
  when: path.startsWith("colors.") ? customColors : undefined,
});

/** Quick choices for the color rows; "" means: use the Home Assistant theme. */
export const PALETTE: Array<{ value: string; label: EditorKey }> = [
  { value: "", label: "color_theme" },
  { value: "var(--primary-color)", label: "palette_primary" },
  { value: "var(--accent-color)", label: "palette_accent" },
  { value: "#9184d9", label: "palette_violet" },
  { value: "#b5abfc", label: "palette_light_violet" },
  { value: "#f2c94c", label: "palette_yellow" },
  { value: "#4caf50", label: "palette_green" },
  { value: "#03a9f4", label: "palette_blue" },
  { value: "#f44336", label: "palette_red" },
  { value: "#ff9800", label: "palette_orange" },
  { value: "#9e9e9e", label: "palette_gray" },
];
const opts = (values: string[]) => ({ select: { mode: "box", options: values.map((v) => ({ value: v, label: v })) } });

export const GENERAL: Field[] = [
  { path: "title", selector: text, label: "field_title" },
  { path: "options.unit", selector: opts(["W", "kW", "auto"]), label: "field_unit", default: "W" },
  { path: "options.decimals", selector: { number: { min: 0, max: 4, mode: "box" } }, label: "field_decimals", default: 2 },
  { path: "options.animation", selector: { boolean: {} }, label: "field_animation", default: true },
  { path: "options.show_consumers", selector: { boolean: {} }, label: "field_show_consumers", default: true },
  {
    path: "options.only_active_consumers",
    selector: { boolean: {} },
    label: "field_only_active_consumers",
    default: false,
    when: (cfg: any) => cfg?.options?.show_consumers !== false,
  },
  { path: "options.show_unassigned", selector: { boolean: {} }, label: "field_show_unassigned", default: true, when: (cfg: any) => cfg?.options?.show_consumers !== false },
  { path: "options.remember_selection", selector: { boolean: {} }, label: "field_remember_selection", default: true },
  { path: "options.wrap_rooms", selector: { boolean: {} }, label: "field_wrap_rooms", default: false },
  { path: "options.focus_selected", selector: { boolean: {} }, label: "field_focus_selected", default: false },
];

/** Energy mode: only offered once an element has an energy sensor. */
export const hasEnergySensor = (cfg: any): boolean => {
  const rooms = [...(cfg?.rooms ?? []), ...(cfg?.floors ?? []).flatMap((f: any) => f?.rooms ?? [])];
  return (
    !!cfg?.home?.total_energy_entity ||
    (cfg?.sources ?? []).some((s: any) => !!s?.energy_entity) ||
    rooms.some((r: any) => (r?.consumers ?? []).some((c: any) => !!c?.energy_entity))
  );
};

export const ENERGY_MODE: Field[] = [
  {
    path: "options.mode",
    selector: { select: { mode: "dropdown" } },
    options: [
      { value: "power", label: "mode_power" },
      { value: "energy", label: "mode_energy" },
    ],
    label: "field_mode",
    default: "power",
    when: hasEnergySensor,
  },
  {
    path: "options.energy_periods",
    selector: { select: { multiple: true, mode: "list" } },
    options: [
      { value: "today", label: "period_today" },
      { value: "week", label: "period_week" },
      { value: "month", label: "period_month" },
    ],
    label: "field_energy_periods",
    default: ["today", "week", "month"],
    multi: true,
    when: hasEnergySensor,
  },
];

export const COLORS: Field[] = [
  { path: "colors.preset", selector: opts(["theme", "nocturne", "custom"]), label: "field_color_preset", default: "theme" },
  color("colors.accent", "field_color_accent"),
  color("colors.flow", "field_color_flow"),
  color("colors.inactive", "field_color_inactive"),
  color("colors.bar", "field_color_bar"),
  color("colors.background", "field_color_background"),
  color("colors.text", "field_color_text"),
];

/** One color range: from `from` watts upwards lines and bars use `color`. */
export const THRESHOLD: Field[] = [
  { path: "from", selector: { number: { min: 0, mode: "box", unit_of_measurement: "W" } }, label: "field_thr_from", required: true },
  color("color", "field_color"),
  {
    path: "width",
    selector: { number: { min: 0.5, max: 12, step: 0.5, mode: "box", unit_of_measurement: "px" } },
    label: "field_thr_width",
  },
];

export const HOME: Field[] = [
  { path: "home.total_entity", selector: power, label: "field_total_entity", check: "power" },
  { path: "home.total_energy_entity", selector: energy, label: "field_total_energy_entity", check: "energy" },
];

export const SOURCE: Field[] = [
  { path: "entity", selector: power, label: "field_sensor", required: true, check: "power" },
  { path: "energy_entity", selector: energy, label: "field_energy_entity", check: "energy" },
  { path: "type", selector: opts(["solar", "battery", "grid", "generic"]), label: "field_type" },
  { path: "name", selector: text, label: "field_name" },
  { path: "icon", selector: icon, label: "field_icon" },
  color("color", "field_color"),
  {
    path: "soc_entity",
    selector: { entity: { domain: "sensor" } },
    label: "field_soc",
    check: "battery",
    when: (s) => s?.type === "battery",
  },
  { path: "invert", selector: { boolean: {} }, label: "field_invert" },
];

export interface Choice {
  value: string;
  label: string;
}
const dropdown = (choices: Choice[]) => ({ select: { mode: "dropdown", options: choices } });

/** Floors can only be picked from the Home Assistant floor registry. */
export const floorFields = (choices: Choice[] = []): Field[] => [
  { path: "floor_id", selector: dropdown(choices), label: "field_floor", required: true },
  color("color", "field_color"),
];

/** Rooms can only be picked from the Home Assistant area registry. */
export const roomFields = (choices: Choice[] = []): Field[] => [
  { path: "area_id", selector: dropdown(choices), label: "field_area", required: true },
  color("color", "field_color"),
];

/** Consumer sensors: power sensors that are not yet assigned to another consumer. */
export const consumerFields = (exclude: string[] = []): Field[] => [
  {
    path: "entity",
    selector: { entity: { domain: "sensor", device_class: "power", exclude_entities: exclude } },
    label: "field_sensor",
    required: true,
    check: "power",
  },
  { path: "energy_entity", selector: energy, label: "field_energy_entity", check: "energy" },
  { path: "name", selector: text, label: "field_name_optional" },
];

export const CONSUMER: Field[] = consumerFields();

/** Builds the ha-form schema for the fields visible for `obj`. */
export function toSchema(fields: Field[], obj: unknown, tr: Tr) {
  return fields
    .filter((f) => !f.when || f.when(obj))
    .map((f) => ({ name: f.path, selector: withOptions(f, tr), required: f.required }));
}

/** Adds the translated `options` of a field to its select selector. */
function withOptions(f: Field, tr: Tr): Record<string, unknown> {
  if (!f.options) return f.selector;
  const select = f.selector.select as Record<string, unknown>;
  return { ...f.selector, select: { ...select, options: f.options.map((o) => ({ ...o, label: tr(o.label) })) } };
}

/** Translates a field-path -> label lookup for ha-form's computeLabel. */
export function labelFor(fields: Field[], name: string, tr: Tr): string {
  const field = fields.find((f) => f.path === name);
  return field ? tr(field.label) : name;
}

/**
 * Config keys the editor can edit, in the same notation as configPaths() below.
 * Used by the tests to prove that every config option has an editor field.
 */
export function coveredPaths(): string[] {
  const prefix = (p: string, fields: Field[]) => fields.map((f) => `${p}${f.path}`);
  return [
    ...prefix("", GENERAL),
    ...ENERGY_MODE.map((f) => `${f.path}${f.multi ? "[]" : ""}`),
    ...prefix("", COLORS),
    ...prefix("", HOME),
    ...prefix("colors.thresholds[].", THRESHOLD),
    ...THRESHOLD_LEVELS.flatMap((l) => prefix(`colors.level_thresholds.${l}[].`, THRESHOLD)),
    ...prefix("sources[].", SOURCE),
    ...prefix("sources[].thresholds[].", THRESHOLD),
    ...prefix("floors[].thresholds[].", THRESHOLD),
    ...prefix("floors[].rooms[].thresholds[].", THRESHOLD),
    ...prefix("floors[].rooms[].consumers[].thresholds[].", THRESHOLD),
    ...prefix("rooms[].thresholds[].", THRESHOLD),
    ...prefix("rooms[].consumers[].thresholds[].", THRESHOLD),
    ...prefix("floors[].", floorFields()),
    ...prefix("floors[].rooms[].", roomFields()),
    ...prefix("floors[].rooms[].consumers[].", CONSUMER),
    ...prefix("rooms[].", roomFields()),
    ...prefix("rooms[].consumers[].", CONSUMER),
  ];
}

/** Flattens a config object into leaf paths, arrays written as "[]". */
export function configPaths(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return [...new Set(value.flatMap((v) => configPaths(v, `${path}[]`)))];
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => configPaths(v, path ? `${path}.${k}` : k));
  }
  return [path];
}
