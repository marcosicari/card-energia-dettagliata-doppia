/**
 * Editor texts. The German source string is the key; English is looked up here.
 * Placeholders {0}, {1} are replaced by the extra arguments.
 */
const EN: Record<string, string> = {
  // sections
  Allgemein: "General",
  Farben: "Colors",
  Zuhause: "Home",
  Struktur: "Structure",
  "Stromquellen ({0})": "Power sources ({0})",
  "Verbraucher ({0})": "Consumers ({0})",
  "{0} Verbraucher": "{0} consumers",
  "{0} Räume": "{0} rooms",
  Quelle: "Source",
  // general fields
  Titel: "Title",
  Einheit: "Unit",
  Nachkommastellen: "Decimals",
  Animation: "Animation",
  "„Nicht erfasst“ anzeigen": "Show \"Unassigned\"",
  "Auswahl merken": "Remember selection",
  "Viele Räume in zwei Reihen umbrechen (statt scrollen)": "Wrap many rooms into two rows (instead of scrolling)",
  // colors
  Voreinstellung: "Preset",
  "Akzent / Auswahl": "Accent / selection",
  "Fluss-Linien": "Flow lines",
  "Inaktive Linien": "Inactive lines",
  "Verbraucher-Balken": "Consumer bars",
  "Hintergrund (leer = transparent)": "Background (empty = transparent)",
  "Text (leer = Theme)": "Text (empty = theme)",
  Farbe: "Color",
  "Schwellwerte (Farbe nach Leistung)": "Thresholds (color by power)",
  "Ab dem jeweiligen Wert (in W) bekommen Linien und Balken diese Farbe, darunter gilt die normale Farbe.":
    "From each value (in W) upwards lines and bars use this color; below the first value the normal color applies.",
  "ab (W)": "from (W)",
  "ab {0} W": "from {0} W",
  "+ Schwellwert": "+ Threshold",
  "Ampel-Farben einfügen": "Insert traffic-light colors",
  "Dieser Sensor ist bereits einem Verbraucher zugewiesen.": "This sensor is already assigned to a consumer.",
  "Mehrere Schwellwerte ab {0} W: nur einer davon gilt.": "Several thresholds from {0} W: only one of them applies.",
  "Strichstärke (px, leer = automatisch)": "Line width (px, empty = automatic)",
  "Optional gibt eine Stufe auch die Strichstärke vor. Jede Ebene kann eigene Werte haben, sonst gelten die Werte für „Alle“.":
    "A range can also set the line width. Each level can have its own values, otherwise the values for “All” apply.",
  "Diese Ebene nutzt die Werte für „Alle“.": "This level uses the values for “All”.",
  "Ampel-Werte für diese Ebene einfügen": "Insert traffic-light values for this level",
  "Von „Alle“ übernehmen": "Copy from “All”",
  "Schwellwerte: „{0}“ liegt über „{1}“, obwohl diese Ebene weiter oben liegt.":
    "Thresholds: “{0}” is higher than “{1}”, although that level is further up.",
  Alle: "All",
  Quellen: "Sources",
  Etagen: "Floors",
  Räume: "Rooms",
  Verbraucher: "Consumers",
  Primärfarbe: "Primary color",
  Akzentfarbe: "Accent color",
  Violett: "Violet",
  Hellviolett: "Light violet",
  Gelb: "Yellow",
  Grün: "Green",
  Blau: "Blue",
  Rot: "Red",
  Orange: "Orange",
  Grau: "Gray",
  "Eigene Farbe wählen": "Pick a custom color",
  "Zurücksetzen auf Theme": "Reset to theme",
  // home, sources, structure
  "Gesamt-Sensor (optional)": "Total sensor (optional)",
  Sensor: "Sensor",
  Typ: "Type",
  Name: "Name",
  "Name (optional)": "Name (optional)",
  Icon: "Icon",
  "Ladezustand (SoC)": "State of charge (SoC)",
  "Vorzeichen invertieren": "Invert sign",
  Etage: "Floor",
  "Bereich (Raum)": "Area (room)",
  "Etagen verwenden": "Use floors",
  "+ Quelle hinzufügen": "+ Add source",
  "+ Verbraucher": "+ Consumer",
  "+ Raum": "+ Room",
  "+ Etage": "+ Floor",
  "Nach oben": "Move up",
  "Nach unten": "Move down",
  Entfernen: "Remove",
  "Ziehen zum Sortieren": "Drag to reorder",
  // warnings and errors
  "Keine weiteren Bereiche in Home Assistant verfügbar.": "No more areas available in Home Assistant.",
  "Keine weiteren Etagen in Home Assistant angelegt.": "No more floors defined in Home Assistant.",
  "Räume ohne Etage wurden ausgeblendet: {0}. Etagen wieder auszuschalten stellt sie wieder her.":
    "Rooms without a floor were hidden: {0}. Turning floors off again restores them.",
  "{0} ist mehrfach zugeordnet: {1}": "{0} is assigned more than once: {1}",
  "Die Räume verbrauchen zusammen {0} W, mehr als der Gesamt-Sensor ({1} W). „Nicht erfasst“ wird nicht angezeigt.":
    "The rooms use {0} W together, more than the total sensor ({1} W). \"Unassigned\" is not shown.",
  "Geringer Kontrast zwischen Text und Hintergrund ({0} : 1, empfohlen ab 4.5 : 1)":
    "Low contrast between text and background ({0} : 1, 4.5 : 1 recommended)",
  "Nur sensor.* ist erlaubt": "Only sensor.* is allowed",
  "Entität nicht gefunden": "Entity not found",
  "Kein Leistungssensor (device_class: power)": "Not a power sensor (device_class: power)",
  "Einheit muss W, kW oder MW sein": "Unit must be W, kW or MW",
  "Kein Prozent-/Batteriesensor": "Not a percent/battery sensor",
  "Ungültige Farbe (z. B. #9184d9)": "Invalid color (e.g. #9184d9)",
};

/** Translates a German editor string; other languages than German get English. */
export type Tr = (de: string, ...args: Array<string | number>) => string;

export function makeTr(lang?: string): Tr {
  const german = !!lang?.toLowerCase().startsWith("de");
  return (de, ...args) => {
    const text = german ? de : (EN[de] ?? de);
    return text.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ""));
  };
}

export const editorKeys = (): string[] => Object.keys(EN);
