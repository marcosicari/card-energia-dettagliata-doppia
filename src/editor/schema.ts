import { THRESHOLD_LEVELS } from "../model/thresholds";

/**
 * Declarative description of every editor field. Each field maps 1:1 to a config path,
 * so the form data is simply { [path]: value } and no per-field mapping code is needed.
 */
export interface Field {
  /** dotted path relative to the edited object, e.g. "options.unit" */
  path: string;
  selector: Record<string, unknown>;
  label: string;
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

const color = (path: string, label: string): Field => ({
  path,
  selector: text,
  label,
  kind: "color",
  when: path.startsWith("colors.") ? customColors : undefined,
});

/** Quick choices for the color rows; "" means: use the Home Assistant theme. */
export const PALETTE: Array<{ value: string; label: string }> = [
  { value: "", label: "Theme" },
  { value: "var(--primary-color)", label: "Primärfarbe" },
  { value: "var(--accent-color)", label: "Akzentfarbe" },
  { value: "#9184d9", label: "Violett" },
  { value: "#b5abfc", label: "Hellviolett" },
  { value: "#f2c94c", label: "Gelb" },
  { value: "#4caf50", label: "Grün" },
  { value: "#03a9f4", label: "Blau" },
  { value: "#f44336", label: "Rot" },
  { value: "#ff9800", label: "Orange" },
  { value: "#9e9e9e", label: "Grau" },
];
const opts = (values: string[]) => ({ select: { mode: "box", options: values.map((v) => ({ value: v, label: v })) } });

export const GENERAL: Field[] = [
  { path: "title", selector: text, label: "Titel" },
  { path: "options.unit", selector: opts(["W", "kW", "auto"]), label: "Einheit", default: "W" },
  { path: "options.decimals", selector: { number: { min: 0, max: 4, mode: "box" } }, label: "Nachkommastellen", default: 2 },
  { path: "options.animation", selector: { boolean: {} }, label: "Animation", default: true },
  { path: "options.show_consumers", selector: { boolean: {} }, label: "Verbraucher-Liste anzeigen", default: true },
  {
    path: "options.only_active_consumers",
    selector: { boolean: {} },
    label: "Nur aktive Verbraucher anzeigen (ab 1 W)",
    default: false,
    when: (cfg: any) => cfg?.options?.show_consumers !== false,
  },
  { path: "options.show_unassigned", selector: { boolean: {} }, label: "„Nicht erfasst“ anzeigen", default: true, when: (cfg: any) => cfg?.options?.show_consumers !== false },
  { path: "options.remember_selection", selector: { boolean: {} }, label: "Auswahl merken", default: true },
  { path: "options.wrap_rooms", selector: { boolean: {} }, label: "Viele Räume in zwei Reihen umbrechen (statt scrollen)", default: false },
  { path: "options.focus_selected", selector: { boolean: {} }, label: "Gewählte Etage oder gewählten Raum in die Mitte schieben (die anderen blenden aus)", default: false },
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
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "power", label: "Leistung (jetzt)" },
          { value: "energy", label: "Energie (Heute, Woche, Monat)" },
        ],
      },
    },
    label: "Startansicht",
    default: "power",
    when: hasEnergySensor,
  },
  {
    path: "options.energy_periods",
    selector: {
      select: {
        multiple: true,
        mode: "list",
        options: [
          { value: "today", label: "Heute" },
          { value: "week", label: "Woche" },
          { value: "month", label: "Monat" },
        ],
      },
    },
    label: "Zeiträume im Schalter",
    default: ["today", "week", "month"],
    multi: true,
    when: hasEnergySensor,
  },
];

export const COLORS: Field[] = [
  { path: "colors.preset", selector: opts(["theme", "nocturne", "custom"]), label: "Voreinstellung", default: "theme" },
  color("colors.accent", "Akzent / Auswahl"),
  color("colors.flow", "Fluss-Linien"),
  color("colors.inactive", "Inaktive Linien"),
  color("colors.bar", "Verbraucher-Balken"),
  color("colors.background", "Hintergrund (leer = transparent)"),
  color("colors.text", "Text (leer = Theme)"),
];

/** One color range: from `from` watts upwards lines and bars use `color`. */
export const THRESHOLD: Field[] = [
  { path: "from", selector: { number: { min: 0, mode: "box", unit_of_measurement: "W" } }, label: "ab (W)", required: true },
  color("color", "Farbe"),
  {
    path: "width",
    selector: { number: { min: 0.5, max: 12, step: 0.5, mode: "box", unit_of_measurement: "px" } },
    label: "Strichstärke (px, leer = automatisch)",
  },
];

export const HOME: Field[] = [
  { path: "home.total_entity", selector: power, label: "Gesamt-Sensor (optional)", check: "power" },
  { path: "home.total_energy_entity", selector: energy, label: "Gesamt-Energiesensor (optional, kWh)", check: "energy" },
];

export const SOURCE: Field[] = [
  { path: "entity", selector: power, label: "Sensor", required: true, check: "power" },
  { path: "energy_entity", selector: energy, label: "Energiesensor (kWh, optional)", check: "energy" },
  { path: "type", selector: opts(["solar", "battery", "grid", "generic"]), label: "Typ" },
  { path: "name", selector: text, label: "Name" },
  { path: "icon", selector: icon, label: "Icon" },
  color("color", "Farbe"),
  {
    path: "soc_entity",
    selector: { entity: { domain: "sensor" } },
    label: "Ladezustand (SoC)",
    check: "battery",
    when: (s) => s?.type === "battery",
  },
  { path: "invert", selector: { boolean: {} }, label: "Vorzeichen invertieren" },
];

export interface Choice {
  value: string;
  label: string;
}
const dropdown = (choices: Choice[]) => ({ select: { mode: "dropdown", options: choices } });

/** Floors can only be picked from the Home Assistant floor registry. */
export const floorFields = (choices: Choice[] = []): Field[] => [
  { path: "floor_id", selector: dropdown(choices), label: "Etage", required: true },
  color("color", "Farbe"),
];

/** Rooms can only be picked from the Home Assistant area registry. */
export const roomFields = (choices: Choice[] = []): Field[] => [
  { path: "area_id", selector: dropdown(choices), label: "Bereich (Raum)", required: true },
  color("color", "Farbe"),
];

/** Consumer sensors: power sensors that are not yet assigned to another consumer. */
export const consumerFields = (exclude: string[] = []): Field[] => [
  {
    path: "entity",
    selector: { entity: { domain: "sensor", device_class: "power", exclude_entities: exclude } },
    label: "Sensor",
    required: true,
    check: "power",
  },
  { path: "energy_entity", selector: energy, label: "Energiesensor (kWh, optional)", check: "energy" },
  { path: "name", selector: text, label: "Name (optional)" },
];

export const CONSUMER: Field[] = consumerFields();

/** Builds the ha-form schema for the fields visible for `obj`. */
export function toSchema(fields: Field[], obj: unknown, tr: (s: string) => string = (s) => s) {
  return fields
    .filter((f) => !f.when || f.when(obj))
    .map((f) => ({ name: f.path, selector: translateOptions(f.selector, tr), required: f.required }));
}

/** Option labels of a select are translated like every other label. */
function translateOptions(selector: Record<string, unknown>, tr: (s: string) => string): Record<string, unknown> {
  const select = selector.select as { options?: Array<{ value: string; label: string }> } | undefined;
  if (!select?.options) return selector;
  return { ...selector, select: { ...select, options: select.options.map((o) => ({ ...o, label: tr(o.label) })) } };
}

/** Translates a field-path -> label lookup for ha-form's computeLabel. */
export function labelFor(fields: Field[], name: string, tr: (s: string) => string = (s) => s): string {
  return tr(fields.find((f) => f.path === name)?.label ?? name);
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
