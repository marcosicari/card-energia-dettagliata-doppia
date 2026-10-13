import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { editorKeys, makeTr } from "../src/localize/editor";
import { COLORS, CONSUMER, ENERGY_MODE, GENERAL, HOME, PALETTE, SOURCE, THRESHOLD, floorFields, roomFields } from "../src/editor/schema";
import { checkSensor, contrastWarning } from "../src/editor/validation";
import { sourceNames } from "../src/localize";
import { computeModel } from "../src/model/compute";
import type { EnergyCardConfig } from "../src/model/config";

describe("editor translations", () => {
  const keys = new Set(editorKeys());

  it("translates every field label and palette entry", () => {
    const labels = [...GENERAL, ...ENERGY_MODE, ...COLORS, ...HOME, ...THRESHOLD, ...SOURCE, ...floorFields(), ...roomFields(), ...CONSUMER].map((f) => f.label);
    const missing = [...labels, ...PALETTE.map((c) => c.label)].filter((l) => l && l !== "Theme" && !keys.has(l));
    expect(missing).toEqual([]);
  });

  it("translates every string the editor passes to _tr()", () => {
    const src = readFileSync("src/editor/card-editor.ts", "utf8");
    const used = [...src.matchAll(/_tr\(\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(15);
    expect(used.filter((u) => !keys.has(u))).toEqual([]);
  });

  it("translates the validation messages", () => {
    const en = makeTr("en");
    const states = { "sensor.t": { state: "1", attributes: { device_class: "temperature" } } };
    expect(checkSensor(states, "sensor.t", "power", en)).toBe("Not a power sensor (device_class: power)");
    expect(checkSensor(states, "sensor.gone", "power", en)).toBe("Entity not found");
    expect(contrastWarning({ text: "#777", background: "#888" }, undefined, undefined, en)).toMatch(/^Low contrast/);
  });

  it("uses German for de and English otherwise, and fills placeholders", () => {
    expect(makeTr("de")("Stromquellen ({0})", 3)).toBe("Stromquellen (3)");
    expect(makeTr("de-AT")("Farben")).toBe("Farben");
    expect(makeTr("en")("Stromquellen ({0})", 3)).toBe("Power sources (3)");
    expect(makeTr(undefined)("Farben")).toBe("Colors");
    expect(makeTr("fr")("Unbekannt")).toBe("Unbekannt");
  });
});

describe("default source names", () => {
  const cfg = {
    type: "custom:detailed-energy-card",
    sources: [
      { entity: "sensor.pv", type: "solar" },
      { entity: "sensor.bat", type: "battery" },
      { entity: "sensor.grid", type: "grid" },
      { entity: "sensor.x", type: "generic" },
      { entity: "sensor.own", type: "grid", name: "Hausanschluss" },
    ],
    rooms: [{ area_id: "k", consumers: [{ entity: "sensor.c" }] }],
  } as EnergyCardConfig;
  const read = () => ({ watts: 100, valid: true });

  it("are German for German users and English otherwise", () => {
    expect(computeModel(cfg, read, read, sourceNames("de")).sources.map((s) => s.name)).toEqual(["PV", "Batterie", "Netz", "Quelle", "Hausanschluss"]);
    expect(computeModel(cfg, read, read, sourceNames("en-GB")).sources.map((s) => s.name)).toEqual(["Solar", "Battery", "Grid", "Source", "Hausanschluss"]);
  });

  it("keep the German names when no names are passed", () => {
    expect(computeModel(cfg, read).sources[2].name).toBe("Netz");
  });
});
