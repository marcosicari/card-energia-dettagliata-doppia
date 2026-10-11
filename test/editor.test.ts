import { describe, expect, it } from "vitest";
import {
  findDuplicates,
  getPath,
  moveItem,
  roomsWithoutFloor,
  setPath,
  toggleFloors,
  updateIn,
} from "../src/editor/config-utils";
import { configPaths, coveredPaths } from "../src/editor/schema";
import { validateConfig, type EnergyCardConfig } from "../src/model/config";

// A config that uses every documented option (concept, section 3).
const FULL: EnergyCardConfig = {
  type: "custom:detailed-energy-card",
  title: "Energiefluss",
  home: { total_entity: "sensor.total" },
  sources: [
    { entity: "sensor.pv", name: "PV", type: "solar", icon: "mdi:solar-power", color: "#f2c94c", soc_entity: "sensor.soc", invert: false, thresholds: [{ from: 100, color: "#ff9800", width: 3 }] },
  ],
  floors: [
    {
      floor_id: "eg",
      color: "#fff",
      thresholds: [{ from: 100, color: "#ff9800", width: 3 }],
      rooms: [{ area_id: "kueche", color: "#fff", thresholds: [{ from: 100, color: "#ff9800", width: 3 }], consumers: [{ entity: "sensor.a", name: "Backofen", thresholds: [{ from: 100, color: "#ff9800", width: 3 }] }] }],
    },
  ],
  rooms: [{ area_id: "bad", color: "#fff", thresholds: [{ from: 100, color: "#ff9800", width: 3 }], consumers: [{ entity: "sensor.b", name: "Boiler", thresholds: [{ from: 100, color: "#ff9800", width: 3 }] }] }],
  colors: {
    preset: "custom",
    accent: "#111",
    flow: "#222",
    inactive: "#333",
    bar: "#444",
    background: "#555",
    text: "#666",
    thresholds: [{ from: 500, color: "#ff9800", width: 3 }],
    level_thresholds: {
      source: [{ from: 2000, color: "#ff9800", width: 4 }],
      floor: [{ from: 1500, color: "#ff9800", width: 4 }],
      room: [{ from: 800, color: "#ff9800", width: 3 }],
      consumer: [{ from: 300, color: "#ff9800", width: 3 }],
    },
  },
  options: { unit: "auto", decimals: 2, animation: true, show_unassigned: true, show_consumers: true, only_active_consumers: false, remember_selection: true, wrap_rooms: false, focus_selected: false },
};

describe("editor coverage", () => {
  it("has a field for every config key", () => {
    const keys = configPaths(FULL).filter((p) => p !== "type");
    const covered = new Set(coveredPaths());
    expect(keys.filter((k) => !covered.has(k))).toEqual([]);
  });
  it("covers no key the config does not know", () => {
    const known = new Set(configPaths(FULL));
    expect(coveredPaths().filter((p) => !known.has(p))).toEqual([]);
  });
  it("full sample config is itself valid", () => {
    expect(() => validateConfig({ ...FULL, rooms: undefined })).not.toThrow();
  });
});

describe("config utils", () => {
  it("getPath/setPath handle dotted paths immutably", () => {
    const a = { title: "x" };
    const b = setPath(a, "options.unit", "kW");
    expect(b).toEqual({ title: "x", options: { unit: "kW" } });
    expect(a).toEqual({ title: "x" });
    expect(getPath(b, "options.unit")).toBe("kW");
  });
  it("empty values remove the key and prune empty parents", () => {
    const cfg = { options: { unit: "kW" }, title: "t" };
    expect(setPath(cfg, "options.unit", "")).toEqual({ title: "t" });
    expect(setPath(cfg, "title", undefined)).toEqual({ options: { unit: "kW" } });
  });
  it("keeps false booleans", () => {
    expect(setPath({}, "options.animation", false)).toEqual({ options: { animation: false } });
  });
  it("updateIn edits nested list items", () => {
    const cfg = updateIn(FULL, ["floors", 0, "rooms", 0, "consumers"], (l) => [...l, { entity: "sensor.c" }]);
    expect(cfg.floors![0].rooms![0].consumers).toHaveLength(2);
    expect(FULL.floors![0].rooms![0].consumers).toHaveLength(1);
  });
  it("moveItem stays inside bounds", () => {
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
  });
  it("toggleFloors moves rooms between levels", () => {
    const flat: EnergyCardConfig = { type: "x", rooms: [{ area_id: "k" }] };
    const areas = [{ area_id: "k", floor_id: "eg" }, { area_id: "x", floor_id: null }];
    const withFloors = toggleFloors(flat, true, areas);
    expect(withFloors.rooms).toBeUndefined();
    expect(withFloors.floors).toEqual([{ floor_id: "eg", rooms: [{ area_id: "k" }] }]);
    // rooms whose area has no floor are dropped
    expect(toggleFloors({ type: "x", rooms: [{ area_id: "x" }] }, true, areas).floors).toEqual([]);
    const back = toggleFloors(
      { type: "x", floors: [{ floor_id: "eg", rooms: [{ area_id: "a" }] }, { floor_id: "og", rooms: [{ area_id: "b" }] }] },
      false,
    );
    expect(back.floors).toBeUndefined();
    expect(back.rooms!.map((r) => r.area_id)).toEqual(["a", "b"]);
  });
  it("names the rooms that cannot move onto a floor", () => {
    const areas = [{ area_id: "k", floor_id: "eg" }, { area_id: "x", floor_id: null }, { area_id: "y" }];
    const cfg: EnergyCardConfig = { type: "x", rooms: [{ area_id: "k" }, { area_id: "x" }, { area_id: "y" }, { area_id: "gone" }] };
    expect(roomsWithoutFloor(cfg, areas).map((r) => r.area_id)).toEqual(["x", "y", "gone"]);
    // without the registry every room looks floorless: the editor must not toggle then
    expect(roomsWithoutFloor(cfg).length).toBe(4);
    expect(roomsWithoutFloor({ type: "x", floors: [] }, areas)).toEqual([]);
  });
  it("toggling floors off restores the rooms that were left out", () => {
    const areas = [{ area_id: "k", floor_id: "eg" }, { area_id: "x", floor_id: null }];
    const flat: EnergyCardConfig = {
      type: "x",
      rooms: [{ area_id: "k", consumers: [{ entity: "sensor.a" }] }, { area_id: "x", consumers: [{ entity: "sensor.b" }] }],
    };
    const on = toggleFloors(flat, true, areas);
    expect(on.floors).toEqual([{ floor_id: "eg", rooms: [flat.rooms![0]] }]);
    const left = roomsWithoutFloor(flat, areas);
    const back = toggleFloors(on, false, areas, left);
    expect(back.floors).toBeUndefined();
    expect(back.rooms).toEqual(flat.rooms);
  });
  it("does not restore a room twice or assign a sensor twice", () => {
    const cfg: EnergyCardConfig = {
      type: "x",
      floors: [{ floor_id: "eg", rooms: [{ area_id: "k", consumers: [{ entity: "sensor.a" }] }, { area_id: "x" }] }],
    };
    const left = [
      { area_id: "x", consumers: [{ entity: "sensor.zz" }] }, // its area is on a floor meanwhile
      { area_id: "y", consumers: [{ entity: "sensor.a" }, { entity: "sensor.b" }] }, // sensor.a is taken
    ];
    const back = toggleFloors(cfg, false, [], left);
    expect(back.rooms!.map((r) => r.area_id)).toEqual(["k", "x", "y"]);
    expect(back.rooms![2].consumers).toEqual([{ entity: "sensor.b" }]);
    expect(() => validateConfig(back)).not.toThrow();
  });
  it("finds duplicate assignments", () => {
    const cfg: EnergyCardConfig = {
      type: "x",
      rooms: [
        { area_id: "a", name: "A", consumers: [{ entity: "sensor.x" }] },
        { area_id: "b", name: "B", consumers: [{ entity: "sensor.x" }, { entity: "sensor.y" }] },
      ],
    };
    expect(findDuplicates(cfg)).toEqual([{ entity: "sensor.x", places: ["A", "B"] }]);
  });
});

import { consumerEntitiesExcept } from "../src/editor/config-utils";
import { consumerFields } from "../src/editor/schema";
import { ConfigError } from "../src/model/config";

describe("consumers are unique", () => {
  const cfg: EnergyCardConfig = {
    type: "x",
    rooms: [
      { area_id: "a", consumers: [{ entity: "sensor.one" }, { entity: "sensor.two" }] },
      { area_id: "b", consumers: [{ entity: "sensor.three" }] },
    ],
    floors: [{ floor_id: "eg", rooms: [{ area_id: "c", consumers: [{ entity: "sensor.four" }] }] }],
  };

  it("lists the sensors taken by all other slots", () => {
    expect(consumerEntitiesExcept({ ...cfg, floors: undefined }, ["rooms", 0, "consumers", 0]).sort()).toEqual([
      "sensor.three",
      "sensor.two",
    ]);
    expect(consumerEntitiesExcept(cfg, ["floors", 0, "rooms", 0, "consumers", 0]).sort()).toEqual([
      "sensor.one",
      "sensor.three",
      "sensor.two",
    ]);
  });
  it("keeps the own sensor selectable and ignores empty slots", () => {
    const withEmpty: EnergyCardConfig = { type: "x", rooms: [{ area_id: "a", consumers: [{ entity: "sensor.one" }, { entity: "" }] }] };
    expect(consumerEntitiesExcept(withEmpty, ["rooms", 0, "consumers", 1])).toEqual(["sensor.one"]);
    expect(consumerEntitiesExcept(withEmpty, ["rooms", 0, "consumers", 0])).toEqual([]);
  });
  it("hands the taken sensors to the entity picker as excluded", () => {
    const [entity] = consumerFields(["sensor.two"]);
    expect(entity.selector).toEqual({ entity: { domain: "sensor", device_class: "power", exclude_entities: ["sensor.two"] } });
  });
  it("rejects a sensor that is assigned twice, across rooms and floors", () => {
    const dup = (rooms: unknown, floors?: unknown) => () => validateConfig({ type: "x", rooms, floors });
    expect(dup([{ area_id: "a", consumers: [{ entity: "sensor.x" }, { entity: "sensor.x" }] }])).toThrow(ConfigError);
    expect(
      dup([{ area_id: "a", consumers: [{ entity: "sensor.x" }] }, { area_id: "b", consumers: [{ entity: "sensor.x" }] }]),
    ).toThrow(/rooms\[1\]\.consumers\[0\].*already assigned to rooms\[0\]\.consumers\[0\]/);
    expect(() =>
      validateConfig({
        type: "x",
        floors: [
          { floor_id: "eg", rooms: [{ area_id: "a", consumers: [{ entity: "sensor.x" }] }] },
          { floor_id: "og", rooms: [{ area_id: "b", consumers: [{ entity: "sensor.x" }] }] },
        ],
      }),
    ).toThrow(/floors\[1\]\.rooms\[0\]\.consumers\[0\]/);
  });
  it("accepts distinct sensors", () => {
    expect(() => validateConfig({ ...cfg, floors: undefined })).not.toThrow();
    expect(() => validateConfig({ ...cfg, rooms: undefined })).not.toThrow();
  });
});
