import { describe, expect, it } from "vitest";
import { computeModel } from "../src/model/compute";
import { collectEnergyIds, hasEnergy, validateConfig, type EnergyCardConfig } from "../src/model/config";
import { energyReader, firstWeekdayIndex, loadEnergy, localMidnight, offeredPeriods, periodStart, sumChanges } from "../src/model/energy";
import { formatEnergy } from "../src/model/units";

const BERLIN = "Europe/Berlin";

describe("periodStart", () => {
  it("starts the day at local midnight, in the time zone of Home Assistant", () => {
    // 2026-10-13 12:00 UTC is 14:00 in Berlin (summer time, +02:00)
    const now = new Date("2026-10-13T12:00:00Z");
    expect(periodStart("today", now, BERLIN).toISOString()).toBe("2026-10-12T22:00:00.000Z");
    expect(periodStart("today", now, "UTC").toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(periodStart("today", now, "America/New_York").toISOString()).toBe("2026-10-13T04:00:00.000Z");
  });
  it("uses the local date when it differs from the UTC date", () => {
    // 23:30 UTC on the 13th is already the 14th in Berlin
    expect(periodStart("today", new Date("2026-10-13T23:30:00Z"), BERLIN).toISOString()).toBe("2026-10-13T22:00:00.000Z");
  });
  it("starts the week on the configured first weekday", () => {
    // Tuesday 2026-10-13
    const now = new Date("2026-10-13T12:00:00Z");
    expect(periodStart("week", now, "UTC", 1).toISOString()).toBe("2026-10-12T00:00:00.000Z"); // Monday
    expect(periodStart("week", now, "UTC", 0).toISOString()).toBe("2026-10-11T00:00:00.000Z"); // Sunday
    expect(periodStart("week", new Date("2026-10-12T08:00:00Z"), "UTC", 1).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(periodStart("week", new Date("2026-10-11T08:00:00Z"), "UTC", 1).toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });
  it("starts the month on the 1st", () => {
    expect(periodStart("month", new Date("2026-10-13T12:00:00Z"), BERLIN).toISOString()).toBe("2026-09-30T22:00:00.000Z");
  });
  it("copes with the days of a daylight saving change", () => {
    // 2026-03-29: clocks go forward at 02:00 in Berlin, the day starts at +01:00, the next one at +02:00
    expect(localMidnight(2026, 3, 29, BERLIN).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(localMidnight(2026, 3, 30, BERLIN).toISOString()).toBe("2026-03-29T22:00:00.000Z");
    // 2026-10-25: clocks go back, the day starts at +02:00
    expect(localMidnight(2026, 10, 25, BERLIN).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(periodStart("week", new Date("2026-03-30T10:00:00Z"), BERLIN, 1).toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(periodStart("week", new Date("2026-03-29T10:00:00Z"), BERLIN, 1).toISOString()).toBe("2026-03-22T23:00:00.000Z");
  });
  it("reads the first weekday of the Home Assistant locale", () => {
    expect(firstWeekdayIndex("monday")).toBe(1);
    expect(firstWeekdayIndex("sunday")).toBe(0);
    expect(firstWeekdayIndex("saturday")).toBe(6);
    expect(firstWeekdayIndex("language")).toBe(1);
    expect(firstWeekdayIndex(undefined)).toBe(1);
  });
});

describe("loading energy", () => {
  it("sums the changes of every sensor", () => {
    const sums = sumChanges({ a: [{ change: 1.5 }, { change: 0.5 }, { change: null }], b: [], c: [{ change: 2 }] });
    expect([...sums]).toEqual([["a", 2], ["b", 0], ["c", 2]]);
  });
  it("asks Home Assistant for the statistics of the period in kWh and returns Wh", async () => {
    const calls: Record<string, unknown>[] = [];
    const hass = {
      callWS: async <T,>(msg: Record<string, unknown>) => {
        calls.push(msg);
        return { "sensor.a": [{ change: 1.25 }, { change: 0.25 }] } as T;
      },
    };
    const now = new Date("2026-10-13T12:00:00Z");
    const out = await loadEnergy(hass, ["sensor.a", "sensor.b"], "today", now, BERLIN);
    expect(out.get("sensor.a")).toBe(1500);
    expect(out.has("sensor.b")).toBe(false); // no statistics
    expect(calls[0]).toMatchObject({
      type: "recorder/statistics_during_period",
      start_time: "2026-10-12T22:00:00.000Z",
      end_time: now.toISOString(),
      statistic_ids: ["sensor.a", "sensor.b"],
      period: "hour",
      types: ["change"],
      units: { energy: "kWh" },
    });
    await loadEnergy(hass, ["sensor.a"], "month", now, BERLIN);
    expect(calls[1]).toMatchObject({ period: "day" });
  });
  it("does not ask without sensors", async () => {
    const hass = {
      callWS: async () => {
        throw new Error("must not be called");
      },
    };
    expect((await loadEnergy(hass as never, [], "today", new Date(), "UTC")).size).toBe(0);
  });
});

describe("energy model", () => {
  const cfg: EnergyCardConfig = {
    type: "x",
    home: { total_entity: "sensor.p", total_energy_entity: "sensor.e_home" },
    sources: [
      { entity: "sensor.pv", energy_entity: "sensor.e_pv", type: "solar" },
      { entity: "sensor.grid", energy_entity: "sensor.e_grid", type: "grid" },
      { entity: "sensor.batt", type: "battery" }, // no energy sensor
    ],
    rooms: [{ area_id: "kueche", consumers: [{ entity: "sensor.oven", energy_entity: "sensor.e_oven" }, { entity: "sensor.fridge" }] }],
  };
  const values = new Map([["sensor.e_pv", 12400], ["sensor.e_grid", 5100], ["sensor.e_home", 19500], ["sensor.e_oven", 4200]]);
  it("is built from the energy sensors", () => {
    const m = computeModel(cfg, energyReader(values), energyReader(values), undefined, true);
    expect(m.sources.map((s) => s.watts)).toEqual([12400, 5100, 0]);
    expect(m.rooms[0].consumers.map((c) => c.watts)).toEqual([4200, 0]);
    expect(m.homeWatts).toBe(19500);
    expect(m.unassigned).toBe(19500 - 4200);
    expect(m.autarky).toBeCloseTo(1 - 5100 / 19500);
  });
  it("marks elements without an energy sensor", () => {
    const m = computeModel(cfg, energyReader(values), energyReader(values), undefined, true);
    expect(m.sources[2]).toMatchObject({ valid: false, noEnergy: true });
    expect(m.rooms[0].consumers[1]).toMatchObject({ valid: false, noEnergy: true });
    expect(m.rooms[0].consumers[0].noEnergy).toBeUndefined();
  });
  it("marks sensors without statistics as invalid, but not as missing", () => {
    const m = computeModel(cfg, energyReader(new Map()), energyReader(new Map()), undefined, true);
    expect(m.sources[0]).toMatchObject({ valid: false });
    expect(m.sources[0].noEnergy).toBeUndefined();
  });
  it("does not change the power model", () => {
    const power = new Map([["sensor.pv", 3000], ["sensor.grid", 500], ["sensor.p", 3500], ["sensor.oven", 800]]);
    const read = (id: string) => (power.has(id) ? { watts: power.get(id)!, valid: true } : { watts: 0, valid: false });
    const m = computeModel(cfg, read);
    expect(m.sources.map((s) => s.watts).slice(0, 2)).toEqual([3000, 500]);
    expect(m.homeWatts).toBe(3500);
  });
});

describe("energy configuration", () => {
  const base = { type: "x", sources: [{ entity: "sensor.pv", energy_entity: "sensor.e_pv" }] };
  it("knows whether the energy mode is available and which sensors it needs", () => {
    expect(hasEnergy({ type: "x", sources: [{ entity: "sensor.pv" }] })).toBe(false);
    expect(hasEnergy(base)).toBe(true);
    expect(hasEnergy({ type: "x", home: { total_energy_entity: "sensor.e" } })).toBe(true);
    const cfg: EnergyCardConfig = {
      ...base,
      home: { total_energy_entity: "sensor.e_home" },
      rooms: [{ area_id: "a", consumers: [{ entity: "sensor.c", energy_entity: "sensor.e_c" }] }],
    };
    expect(hasEnergy(cfg)).toBe(true);
    expect(collectEnergyIds(cfg).sort()).toEqual(["sensor.e_c", "sensor.e_home", "sensor.e_pv"]);
  });
  it("validates the new keys with their path", () => {
    expect(() => validateConfig({ ...base, options: { mode: "energy", energy_periods: ["today", "month"] } })).not.toThrow();
    expect(() => validateConfig({ ...base, options: { mode: "kwh" } })).toThrow(/options\.mode/);
    expect(() => validateConfig({ ...base, options: { energy_periods: ["year"] } })).toThrow(/options\.energy_periods\[0\]/);
    expect(() => validateConfig({ ...base, options: { energy_periods: "today" } })).toThrow(/options\.energy_periods must be a list/);
    expect(() => validateConfig({ type: "x", sources: [{ entity: "sensor.pv", energy_entity: "light.x" }] })).toThrow(/sources\[0\]\.energy_entity/);
    expect(() => validateConfig({ type: "x", home: { total_energy_entity: "x" } })).toThrow(/home\.total_energy_entity/);
    expect(() => validateConfig({ type: "x", rooms: [{ area_id: "a", consumers: [{ entity: "sensor.c", energy_entity: 5 }] }] })).toThrow(/consumers\[0\]\.energy_entity/);
  });
  it("offers the configured periods in a fixed order, all by default", () => {
    expect(offeredPeriods(undefined)).toEqual(["today", "week", "month"]);
    expect(offeredPeriods([])).toEqual(["today", "week", "month"]);
    expect(offeredPeriods(["month", "today"])).toEqual(["today", "month"]);
  });
});

describe("formatEnergy", () => {
  it("shows kWh with the given decimals", () => {
    expect(formatEnergy(12400, 1, "en")).toBe("12.4 kWh");
    expect(formatEnergy(12400, 1, "de")).toBe("12,4 kWh");
    expect(formatEnergy(19500, 0, "en")).toBe("20 kWh");
    expect(formatEnergy(-1500, 2, "en")).toBe("1.50 kWh");
  });
  it("shows 0 kWh below 0.01 kWh", () => {
    expect(formatEnergy(0, 1)).toBe("0 kWh");
    expect(formatEnergy(9, 1)).toBe("0 kWh");
  });
});
