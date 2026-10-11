import { describe, expect, it } from "vitest";
import { computeModel, type Reader } from "../src/model/compute";
import { collectEntityIds, ConfigError, validateConfig } from "../src/model/config";
import { formatPower, stateToWatts } from "../src/model/units";
import { computeLayout, flowDuration } from "../src/view/layout";

const reader = (values: Record<string, number>): Reader => (id) =>
  id in values ? { watts: values[id], valid: true } : { watts: 0, valid: false };

describe("units", () => {
  it("converts kW and MW to W", () => {
    expect(stateToWatts({ state: "1.5", attributes: { unit_of_measurement: "kW" } })).toBe(1500);
    expect(stateToWatts({ state: "2", attributes: { unit_of_measurement: "MW" } })).toBe(2_000_000);
  });
  it("rejects unavailable, unknown units and undefined", () => {
    expect(stateToWatts({ state: "unavailable", attributes: {} })).toBeNull();
    expect(stateToWatts({ state: "5", attributes: { unit_of_measurement: "V" } })).toBeNull();
    expect(stateToWatts(undefined)).toBeNull();
  });
  it("formats power", () => {
    expect(formatPower(3420, "auto", 2, "en")).toBe("3.42 kW");
    expect(formatPower(420, "auto", 2, "en")).toBe("420 W");
    expect(formatPower(0.4)).toBe("0 W");
    expect(formatPower(500, "kW", 2, "en")).toBe("0.50 kW");
  });
});

describe("config", () => {
  it("rejects floors and rooms together", () => {
    expect(() => validateConfig({ type: "x", floors: [{ floor_id: "eg" }], rooms: [{ area_id: "k" }] })).toThrow(ConfigError);
  });
  it("rejects non-sensor entities", () => {
    expect(() => validateConfig({ type: "x", sources: [{ entity: "light.a" }] })).toThrow(ConfigError);
  });
  it("collects entity ids without duplicates", () => {
    const cfg = validateConfig({
      type: "x",
      home: { total_entity: "sensor.total" },
      sources: [
        { entity: "sensor.bat", type: "battery", soc_entity: "sensor.soc" },
        { entity: "sensor.bat2", type: "battery", soc_entity: "sensor.soc" }, // same SoC sensor twice is fine
      ],
      rooms: [{ area_id: "k", consumers: [{ entity: "sensor.a" }, { entity: "sensor.b" }] }],
    });
    expect(collectEntityIds(cfg).sort()).toEqual(["sensor.a", "sensor.b", "sensor.bat", "sensor.bat2", "sensor.soc", "sensor.total"]);
  });
});

describe("compute", () => {
  const cfg = validateConfig({
    type: "x",
    home: { total_entity: "sensor.total" },
    sources: [
      { entity: "sensor.pv", type: "solar" },
      { entity: "sensor.grid", type: "grid" },
      { entity: "sensor.bat", type: "battery", soc_entity: "sensor.soc" },
    ],
    floors: [{ floor_id: "eg", name: "EG", rooms: [{ area_id: "k", name: "K", consumers: [{ entity: "sensor.a" }, { entity: "sensor.b" }] }] }],
  });

  it("sums consumers, rooms and floors; total drives unassigned", () => {
    const m = computeModel(cfg, reader({ "sensor.pv": 3000, "sensor.grid": 500, "sensor.bat": 0, "sensor.total": 3500, "sensor.a": 800, "sensor.b": 200 }));
    expect(m.floors[0].rooms[0].watts).toBe(1000);
    expect(m.floors[0].watts).toBe(1000);
    expect(m.homeWatts).toBe(3500);
    expect(m.unassigned).toBe(2500);
    expect(m.autarky).toBeCloseTo(1 - 500 / 3500);
  });

  it("falls back to room sum without total sensor", () => {
    const m = computeModel(cfg, reader({ "sensor.a": 800, "sensor.b": 200 }));
    expect(m.homeWatts).toBe(1000);
    expect(m.unassigned).toBe(0);
  });

  it("treats invalid readings as 0 and marks them", () => {
    const m = computeModel(cfg, reader({ "sensor.a": 800 }));
    expect(m.floors[0].rooms[0].consumers.find((c) => c.entity === "sensor.b")).toMatchObject({ watts: 0, valid: false });
  });

  it("handles signs: solar clipped, battery charge and grid export reversed", () => {
    const m = computeModel(cfg, reader({ "sensor.pv": -50, "sensor.grid": -700, "sensor.bat": -300, "sensor.soc": 76 }));
    const [pv, grid, bat] = m.sources;
    expect(pv.watts).toBe(0);
    expect(grid).toMatchObject({ watts: -700, reverse: true });
    expect(bat).toMatchObject({ watts: -300, reverse: true, soc: 76 });
  });

  it("invert flips the sign", () => {
    const c = validateConfig({ type: "x", sources: [{ entity: "sensor.g", type: "grid", invert: true }] });
    expect(computeModel(c, reader({ "sensor.g": 400 })).sources[0].watts).toBe(-400);
  });

  it("computes source shares", () => {
    const m = computeModel(cfg, reader({ "sensor.pv": 750, "sensor.grid": 250, "sensor.bat": 0 }));
    expect(m.sources[0].share).toBeCloseTo(0.75);
  });
});

describe("autarky", () => {
  const room = { area_id: "k", name: "K", consumers: [{ entity: "sensor.a" }] };
  const withSources = (sources: unknown[]) => validateConfig({ type: "x", sources, rooms: [room] });

  it("is 1 - grid import / home consumption", () => {
    const m = computeModel(withSources([{ entity: "sensor.grid", type: "grid" }]), reader({ "sensor.grid": 250, "sensor.a": 1000 }));
    expect(m.autarky).toBeCloseTo(0.75);
  });
  it("counts export as no import and clamps to 0..1", () => {
    const grid = withSources([{ entity: "sensor.grid", type: "grid" }]);
    expect(computeModel(grid, reader({ "sensor.grid": -900, "sensor.a": 1000 })).autarky).toBe(1);
    expect(computeModel(grid, reader({ "sensor.grid": 5000, "sensor.a": 1000 })).autarky).toBe(0);
  });
  it("is left out without a grid source instead of showing 100 %", () => {
    const pvOnly = withSources([{ entity: "sensor.pv", type: "solar" }]);
    expect(computeModel(pvOnly, reader({ "sensor.pv": 0, "sensor.a": 1000 })).autarky).toBeNull();
    expect(computeModel(validateConfig({ type: "x", rooms: [room] }), reader({ "sensor.a": 1000 })).autarky).toBeNull();
  });
  it("is left out while a grid sensor is unreadable, even if another one works", () => {
    const two = withSources([
      { entity: "sensor.grid", type: "grid" },
      { entity: "sensor.grid2", type: "grid" },
    ]);
    expect(computeModel(two, reader({ "sensor.grid": 100, "sensor.a": 1000 })).autarky).toBeNull();
    expect(computeModel(two, reader({ "sensor.grid": 100, "sensor.grid2": 100, "sensor.a": 1000 })).autarky).toBeCloseTo(0.8);
  });
  it("is left out without consumption", () => {
    const grid = withSources([{ entity: "sensor.grid", type: "grid" }]);
    expect(computeModel(grid, reader({ "sensor.grid": 0, "sensor.a": 0 })).autarky).toBeNull();
  });
});

describe("layout", () => {
  it("places rows per the concept", () => {
    const l = computeLayout({ width: 300, sources: 3, floors: 3, rooms: 3 });
    expect([l.yHome, l.yFloor, l.yRoom]).toEqual([124, 226, 300]);
    expect(l.sourceXs).toEqual([50, 150, 250]);
    const flat = computeLayout({ width: 300, sources: 2, floors: 0, rooms: 5 });
    expect(flat.yRoom).toBe(226);
  });
  it("keeps 64px columns for many rooms", () => {
    expect(computeLayout({ width: 300, sources: 1, floors: 0, rooms: 10 }).width).toBe(640);
  });
  it("animation duration is clamped and absent without power", () => {
    expect(flowDuration(0)).toBeNull();
    expect(flowDuration(5)).toBe(3.2);
    expect(flowDuration(10_000)).toBeCloseTo(0.35);
  });
});

import { roomPositions, MAX_ROOMS_PER_ROW, ROOM_FIT_W } from "../src/view/layout";
import { listedConsumers, type ConsumerNode } from "../src/model/compute";

describe("wrapped rooms", () => {
  it("keeps one row up to the limit and when wrapping is off", () => {
    expect(roomPositions(MAX_ROOMS_PER_ROW, 600, true).row.every((r) => r === 0)).toBe(true);
    expect(roomPositions(9, 900, false).row.every((r) => r === 0)).toBe(true);
  });
  it("wraps into two staggered rows", () => {
    const { xs, row } = roomPositions(7, 400, true);
    expect(row).toEqual([0, 0, 0, 0, 1, 1, 1]);
    expect(xs.slice(4)).toEqual([100, 200, 300]);
  });
  it("computeLayout uses two rows, less width and more height", () => {
    const flat = computeLayout({ width: 300, sources: 1, floors: 0, rooms: 10 });
    const wrapped = computeLayout({ width: 300, sources: 1, floors: 0, rooms: 10, wrap: true });
    expect(flat.width).toBe(640);
    expect(wrapped.width).toBe(384);
    expect(wrapped.roomRows).toBe(2);
    expect(wrapped.height).toBe(flat.height + 96);
    expect(new Set(wrapped.roomYs).size).toBe(2);
  });
  it("computeLayout wraps only when a single row would be too narrow", () => {
    const rooms = 10;
    const enough = rooms * ROOM_FIT_W;
    const wide = computeLayout({ width: enough, sources: 0, floors: 0, rooms, wrap: true });
    expect(wide.roomRows).toBe(1);
    expect(new Set(wide.roomYs).size).toBe(1);
    const narrow = computeLayout({ width: enough - 1, sources: 0, floors: 0, rooms, wrap: true });
    expect(narrow.roomRows).toBe(2);
    // few rooms never wrap, however narrow the card is
    expect(computeLayout({ width: 200, sources: 0, floors: 0, rooms: MAX_ROOMS_PER_ROW, wrap: true }).roomRows).toBe(1);
  });
  it("computeLayout gives every room node the distance between neighbours as its width", () => {
    expect(computeLayout({ width: 600, sources: 0, floors: 0, rooms: 4 }).roomColW).toBe(150);
    // wrapped: 10 rooms use 6 columns in the first row, the second row sits in the gaps between them
    const wrapped = computeLayout({ width: 600, sources: 0, floors: 0, rooms: 10, wrap: true });
    expect(wrapped.roomColW).toBe(wrapped.width / 6);
    // never narrower than the minimum column width, the graph scrolls instead
    expect(computeLayout({ width: 100, sources: 0, floors: 0, rooms: 10 }).roomColW).toBe(64);
  });
});

import { roomPath } from "../src/view/layout";

describe("wrapped room geometry", () => {
  it("puts the second row into the gaps of the first row (odd and even counts)", () => {
    for (const n of [7, 8, 9, 10, 13]) {
      const { xs, row } = roomPositions(n, 600, true);
      const first = xs.filter((_, i) => row[i] === 0);
      const second = xs.filter((_, i) => row[i] === 1);
      const gaps = first.slice(1).map((x, i) => (x + first[i]) / 2);
      for (const x of second) expect(gaps.some((g) => Math.abs(g - x) < 0.001)).toBe(true);
      expect(first.length + second.length).toBe(n);
    }
  });
  it("routes second-row lines above the first row and straight down", () => {
    expect(roomPath(100, 50, 40, 200, 200)).toBe("M 100 50 C 100 125 40 125 40 200");
    expect(roomPath(100, 50, 40, 296, 200)).toBe("M 100 50 C 100 122 40 122 40 194 L 40 296");
  });
});

describe("flow speed", () => {
  it("gets faster with every step up in power", () => {
    const powers = [5, 50, 100, 300, 800, 1500, 3000, 4500];
    const durations = powers.map((w) => flowDuration(w)!);
    for (let i = 1; i < durations.length; i++) expect(durations[i]).toBeLessThan(durations[i - 1]);
  });
  it("makes 100 W and 1 kW clearly distinguishable", () => {
    expect(flowDuration(100)! - flowDuration(1000)!).toBeGreaterThan(0.8);
  });
  it("is the same for reversed flow", () => {
    expect(flowDuration(-800)).toBe(flowDuration(800));
  });
});

import { FLOOR_H } from "../src/view/layout";

describe("floors without a visible room row", () => {
  it("sit closer to the home and are fully inside the layout", () => {
    const withRooms = computeLayout({ width: 400, sources: 3, floors: 3, rooms: 3 });
    const noRooms = computeLayout({ width: 400, sources: 3, floors: 3, rooms: 0 });
    expect(noRooms.yFloor - noRooms.yHome).toBeLessThan(withRooms.yFloor - withRooms.yHome);
    expect(noRooms.height).toBeGreaterThanOrEqual(noRooms.yFloor + FLOOR_H);
  });
});

describe("listedConsumers", () => {
  const c = (entity: string, watts: number, valid = true): ConsumerNode => ({ entity, watts, valid });
  const all = [c("a", 800), c("b", 0.4), c("c", 1), c("d", 0), c("e", 0, false)];
  it("lists everything by default", () => {
    expect(listedConsumers(all, false)).toEqual(all);
  });
  it("leaves out the consumers at rest, but keeps the unreadable ones as warnings", () => {
    expect(listedConsumers(all, true).map((x) => x.entity)).toEqual(["a", "c", "e"]);
  });
  it("gives an empty list when nothing is active", () => {
    expect(listedConsumers([c("x", 0)], true)).toEqual([]);
  });
});
