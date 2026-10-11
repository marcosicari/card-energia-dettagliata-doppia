const de = {
  autarky: "Autarkie",
  import: "Bezug",
  export: "Einspeisung",
  charging: "lädt",
  consumers: "Verbraucher",
  unassigned: "Nicht erfasst",
  no_consumers: "Keine Verbraucher in diesem Raum",
  no_active_consumers: "Keine aktiven Verbraucher",
  no_rooms: "Keine Räume konfiguriert",
  unavailable: "Sensor nicht verfügbar",
  home: "Zuhause",
  source_solar: "PV",
  source_battery: "Batterie",
  source_grid: "Netz",
  source_generic: "Quelle",
  default_title: "Energiefluss",
  picker_description: "Energiefluss von Quellen über Etagen und Räume bis zu den Verbrauchern",
};
const en: typeof de = {
  autarky: "Self-sufficiency",
  import: "Import",
  export: "Export",
  charging: "charging",
  consumers: "consumers",
  unassigned: "Unassigned",
  no_consumers: "No consumers in this room",
  no_active_consumers: "No active consumers",
  no_rooms: "No rooms configured",
  unavailable: "Sensor unavailable",
  home: "Home",
  source_solar: "Solar",
  source_battery: "Battery",
  source_grid: "Grid",
  source_generic: "Source",
  default_title: "Energy flow",
  picker_description: "Power flow from sources through floors and rooms down to the consumers",
};

export type Key = keyof typeof de;

export function localize(lang: string | undefined, key: Key): string {
  return (lang?.startsWith("de") ? de : en)[key];
}

/** Names of the source types that are shown when a source has no name of its own. */
export function sourceNames(lang: string | undefined): Record<"solar" | "battery" | "grid" | "generic", string> {
  return {
    solar: localize(lang, "source_solar"),
    battery: localize(lang, "source_battery"),
    grid: localize(lang, "source_grid"),
    generic: localize(lang, "source_generic"),
  };
}
