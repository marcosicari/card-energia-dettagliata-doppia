import { describe, expect, it } from "vitest";
import { ConfigError, validateConfig } from "../src/model/config";
import type { EnergyCardConfig } from "../src/model/config";
import { listedConsumers } from "../src/model/compute";
import { mergeColors, plantConfig, plantConfigs, plantStorageId } from "../src/model/plants";
import { parsePlantTab, plantTabKey } from "../src/model/selection";

const base = { type: "custom:detailed-energy-card" };
const rejects = (cfg: Record<string, unknown>, message: RegExp) => {
  expect(() => validateConfig({ ...base, ...cfg })).toThrow(ConfigError);
  expect(() => validateConfig({ ...base, ...cfg })).toThrow(message);
};

const grid = { entity: "sensor.grid", type: "grid" };
const cfg = (): Record<string, unknown> => ({
  sources: [grid],
  colors: { accent: "#111111", level_thresholds: { source: [{ from: 0, color: "#0f0" }] } },
  options: { unit: "kW" },
  plants: [
    {
      name: "House",
      home: { total_entity: "sensor.total_a" },
      sources: [{ entity: "sensor.pv_a", type: "solar" }],
      rooms: [{ area_id: "kitchen", consumers: [{ entity: "sensor.oven" }] }],
    },
    {
      name: "Annex",
      sources: [{ entity: "sensor.pv_b", type: "solar" }],
      rooms: [{ area_id: "garage", consumers: [{ entity: "sensor.wallbox" }] }],
    },
  ],
});

describe("validateConfig: plants", () => {
  it("accepts several plants with a shared grid", () => {
    expect(() => validateConfig({ ...base, ...cfg() })).not.toThrow();
  });
  it("keeps single-plant mode for an empty list", () => {
    expect(() => validateConfig({ ...base, plants: [], rooms: [{ area_id: "a" }] })).not.toThrow();
  });
  it("needs a name", () => {
    const c = cfg();
    (c.plants as Array<Record<string, unknown>>)[1].name = "";
    rejects(c, /plants\[1\].*name/);
  });
  it.each(["home", "floors", "rooms"])("rejects top-level %s with plants", (key) => {
    const value = { home: { total_entity: "sensor.t" }, floors: [{ floor_id: "eg" }], rooms: [{ area_id: "a" }] }[key];
    rejects({ ...cfg(), [key]: value }, /inside each plant/);
  });
  it("rejects nested plants", () => {
    const c = cfg();
    (c.plants as Array<Record<string, unknown>>)[0].plants = [{ name: "x" }];
    rejects(c, /cannot be nested/);
  });
  it("rejects a plant that is not a mapping and sources that are not a list", () => {
    rejects({ ...cfg(), plants: ["House"] }, /plants\[0\]/);
    const c = cfg();
    (c.plants as Array<Record<string, unknown>>)[0].sources = {};
    rejects(c, /plants\[0\].*sources/);
  });
  it("rejects the same consumer sensor in two plants", () => {
    const c = cfg();
    (c.plants as Array<Record<string, any>>)[1].rooms[0].consumers[0].entity = "sensor.oven";
    rejects(c, /plants\[1\]\./);
  });
  it("prefixes errors of a plant with its position and name", () => {
    const c = cfg();
    (c.plants as Array<Record<string, any>>)[1].rooms = [{ name: "no area_id" }];
    rejects(c, /plants\[1\] \(Annex\):/);
  });
  it("checks plants_layout", () => {
    rejects({ ...cfg(), options: { plants_layout: "grid" } }, /plants_layout/);
    for (const l of ["stack", "row", "tabs"]) {
      expect(() => validateConfig({ ...base, ...cfg(), options: { plants_layout: l } })).not.toThrow();
    }
  });
});

describe("plant derivation", () => {
  const full = () => ({ ...base, ...cfg() }) as unknown as EnergyCardConfig;

  it("appends the shared sources after the own ones and titles by plant name", () => {
    const p = plantConfig(full(), 0);
    expect(p.title).toBe("House");
    expect(p.sources?.map((s) => s.entity)).toEqual(["sensor.pv_a", "sensor.grid"]);
    expect(plantConfig(full(), 0, true).sources?.map((s) => s.entity)).toEqual(["sensor.pv_a"]);
  });
  it("yields plain single-plant configs that validate", () => {
    const all = plantConfigs(full());
    expect(all).toHaveLength(2);
    for (const p of all) {
      expect("plants" in p).toBe(false);
      expect(() => validateConfig(p as unknown as Record<string, unknown>)).not.toThrow();
    }
  });
  it("lets plant options override shared ones", () => {
    const c = full();
    c.plants![0].options = { unit: "W" };
    expect(plantConfig(c, 0).options?.unit).toBe("W");
    expect(plantConfig(c, 1).options?.unit).toBe("kW");
  });
  it("gives every plant its own short storage id", () => {
    expect(plantStorageId(undefined, 0)).toBe(":p0");
    const long = plantStorageId("x".repeat(64), 11);
    expect(long.length).toBeLessThanOrEqual(64);
    const ids = plantConfigs(full()).map((p) => p.options?.storage_id);
    expect(new Set(ids).size).toBe(2);
  });
  it("merges colors including thresholds per level", () => {
    const m = mergeColors(
      { accent: "#1", level_thresholds: { source: [{ from: 0, color: "a" }] } },
      { flow: "#2", level_thresholds: { room: [{ from: 5, color: "b" }] } },
    );
    expect(m?.accent).toBe("#1");
    expect(m?.flow).toBe("#2");
    expect(Object.keys(m?.level_thresholds ?? {}).sort()).toEqual(["room", "source"]);
    expect(mergeColors(undefined, undefined)).toBeUndefined();
  });
  it("throws for a missing plant", () => {
    expect(() => plantConfig(full(), 5)).toThrow(RangeError);
  });
});

describe("plant tab selection", () => {
  it("parses only valid indices", () => {
    expect(parsePlantTab("1", 2)).toBe(1);
    for (const bad of [null, "2", "-1", "x", "1.5", ""]) expect(parsePlantTab(bad, 2)).toBe(0);
  });
  it("keys by storage id and plant names", () => {
    const a = { ...base, plants: [{ name: "A" }, { name: "B" }] } as unknown as EnergyCardConfig;
    const b = { ...base, plants: [{ name: "A" }, { name: "C" }] } as unknown as EnergyCardConfig;
    expect(plantTabKey(a)).not.toBe(plantTabKey(b));
    expect(plantTabKey(a)).toContain("sel2:");
  });
});

describe("active_min_watts", () => {
  it("validates the option", () => {
    for (const bad of [-1, "30", Number.NaN]) rejects({ options: { active_min_watts: bad } }, /active_min_watts/);
    expect(() => validateConfig({ ...base, options: { only_active_consumers: true, active_min_watts: 30 } })).not.toThrow();
  });
  it("lists only consumers from the threshold on, unreadable ones stay as warnings", () => {
    const c = (watts: number, valid = true) => ({ entity: `sensor.w${watts}`, watts, valid }) as any;
    const all = [c(5), c(29.9), c(30), c(100), c(0, false)];
    expect(listedConsumers(all, true, 30).map((x) => x.watts)).toEqual([30, 100, 0]);
    expect(listedConsumers(all, true).map((x) => x.watts)).toEqual([5, 29.9, 30, 100, 0]);
    expect(listedConsumers(all, false, 30)).toHaveLength(5);
  });
});
