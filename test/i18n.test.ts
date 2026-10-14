import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeTr } from "../src/localize/editor";
import { checkSensor, contrastWarning } from "../src/editor/validation";
import { sourceNames } from "../src/localize";
import { computeModel } from "../src/model/compute";
import type { EnergyCardConfig } from "../src/model/config";

// Missing translations and unknown keys are compile errors (`en: typeof de`, `EditorKey`).
describe("editor translations", () => {
  it("translates the validation messages", () => {
    const en = makeTr("en");
    const states = { "sensor.t": { state: "1", attributes: { device_class: "temperature" } } };
    expect(checkSensor(states, "sensor.t", "power", en)).toBe("Not a power sensor (device_class: power)");
    expect(checkSensor(states, "sensor.gone", "power", en)).toBe("Entity not found");
    expect(checkSensor(states, "sensor.gone", "power")).toBe("Entität nicht gefunden");
    expect(contrastWarning({ text: "#777", background: "#888" }, undefined, undefined, en)).toMatch(/^Low contrast/);
  });

  it("uses German for de and English otherwise, and fills placeholders", () => {
    expect(makeTr("de")("section_sources", 3)).toBe("Stromquellen (3)");
    expect(makeTr("de-AT")("section_colors")).toBe("Farben");
    expect(makeTr("en")("section_sources", 3)).toBe("Power sources (3)");
    expect(makeTr(undefined)("section_colors")).toBe("Colors");
    expect(makeTr("fr")("section_colors")).toBe("Colors");
    expect(makeTr("en")("warn_duplicate_entity", "sensor.a")).toBe("sensor.a is assigned more than once: ");
  });

  it("leaves no German text in the editor sources", () => {
    const dir = "src/editor";
    const german = readdirSync(dir)
      .filter((n) => n.endsWith(".ts"))
      .flatMap((n) => readFileSync(`${dir}/${n}`, "utf8").split("\n").map((line, i) => [`${n}:${i + 1}`, line]))
      .filter(([, line]) => /[äöüÄÖÜß„“]/.test(line))
      .map(([at]) => at);
    expect(german).toEqual([]);
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
