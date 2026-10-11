import { describe, expect, it } from "vitest";
import { validateConfig, ConfigError } from "../src/model/config";
import { computeModel } from "../src/model/compute";
import {
  DEFAULT_THRESHOLDS,
  duplicateThresholds,
  thresholdLevel,
  isIdle,
  sortThresholds,
  thresholdColor,
  thresholdWidth,
  resolveThresholds,
  DEFAULT_LEVEL_THRESHOLDS,
  THRESHOLD_LEVELS,
  elementThresholds,
} from "../src/model/thresholds";

const T = sortThresholds(DEFAULT_THRESHOLDS); // 0 green, 500 orange, 2000 red

describe("thresholdColor", () => {
  it("picks the highest range that is reached", () => {
    expect(thresholdColor(T, 0)).toBe("#4caf50");
    expect(thresholdColor(T, 499)).toBe("#4caf50");
    expect(thresholdColor(T, 500)).toBe("#ff9800");
    expect(thresholdColor(T, 1999)).toBe("#ff9800");
    expect(thresholdColor(T, 2000)).toBe("#f44336");
    expect(thresholdColor(T, 50_000)).toBe("#f44336");
  });
  it("uses the absolute value (export / charging)", () => {
    expect(thresholdColor(T, -2500)).toBe("#f44336");
  });
  it("has no color below the first range or without thresholds", () => {
    expect(thresholdColor([{ from: 100, color: "#111" }], 50)).toBeUndefined();
    expect(thresholdColor([], 1000)).toBeUndefined();
  });
});

describe("sortThresholds", () => {
  it("sorts ascending and drops unusable entries", () => {
    const sorted = sortThresholds([
      { from: 2000, color: "#c" },
      { from: 0, color: "#a" },
      { from: -5, color: "#x" },
      { from: 500, color: "" },
      { from: Number.NaN, color: "#n" },
      { from: 500, color: "#b" },
    ]);
    expect(sorted.map((t) => t.color)).toEqual(["#a", "#b", "#c"]);
    expect(sortThresholds(undefined)).toEqual([]);
  });
  it("finds duplicate ranges", () => {
    expect(duplicateThresholds([{ from: 1, color: "a" }, { from: 1, color: "b" }, { from: 2, color: "c" }])).toEqual([1]);
    expect(duplicateThresholds(DEFAULT_THRESHOLDS)).toEqual([]);
  });
});

describe("isIdle", () => {
  it("treats under 1 W as idle", () => {
    expect(isIdle(0)).toBe(true);
    expect(isIdle(0.4)).toBe(true);
    expect(isIdle(-0.4)).toBe(true);
    expect(isIdle(1)).toBe(false);
    expect(isIdle(-30)).toBe(false);
  });
});

describe("threshold configuration", () => {
  const cfg = (thresholds: unknown) => ({ type: "x", colors: { thresholds } });
  it("accepts a valid list", () => {
    expect(() => validateConfig(cfg([{ from: 0, color: "#fff" }, { from: 800, color: "red" }]))).not.toThrow();
  });
  it("rejects a bad shape with a readable message", () => {
    expect(() => validateConfig(cfg("nope"))).toThrow(ConfigError);
    expect(() => validateConfig(cfg([{ from: "500", color: "#fff" }]))).toThrow(/thresholds\[0\]\.from/);
    expect(() => validateConfig(cfg([{ from: -1, color: "#fff" }]))).toThrow(/thresholds\[0\]\.from/);
    expect(() => validateConfig(cfg([{ from: 5 }]))).toThrow(/thresholds\[0\]\.color/);
  });
});

describe("thresholdLevel", () => {
  const sorted = sortThresholds([
    { from: 2000, color: "#f44336" },
    { from: 0, color: "#4caf50" },
    { from: 500, color: "#ff9800" },
  ]);
  it("counts the ranges that are reached", () => {
    expect(thresholdLevel(sorted, 0)).toBe(1);
    expect(thresholdLevel(sorted, 499)).toBe(1);
    expect(thresholdLevel(sorted, 500)).toBe(2);
    expect(thresholdLevel(sorted, -2500)).toBe(3);
  });
  it("is 0 below the first range and without thresholds", () => {
    expect(thresholdLevel(sortThresholds([{ from: 100, color: "red" }]), 50)).toBe(0);
    expect(thresholdLevel([], 5000)).toBe(0);
  });
});

describe("thresholdWidth", () => {
  const W = sortThresholds([
    { from: 0, color: "#4caf50", width: 1.5 },
    { from: 500, color: "#ff9800" },
    { from: 2000, color: "#f44336", width: 5 },
  ]);
  it("returns the width of the highest reached range that sets one", () => {
    expect(thresholdWidth(W, 100)).toBe(1.5);
    expect(thresholdWidth(W, 1000)).toBe(1.5); // the 500 W range sets none: the lower one stays
    expect(thresholdWidth(W, 2000)).toBe(5);
    expect(thresholdWidth(W, -2500)).toBe(5);
  });
  it("is undefined without a width or below the first range", () => {
    expect(thresholdWidth(T, 3000)).toBeUndefined();
    expect(thresholdWidth(sortThresholds([{ from: 100, color: "#fff", width: 3 }]), 50)).toBeUndefined();
  });
});

describe("resolveThresholds", () => {
  const shared = [{ from: 0, color: "#111" }];
  const room = [{ from: 800, color: "#222" }];
  it("uses the own list of a level and falls back to the shared one", () => {
    const r = resolveThresholds(shared, { room });
    expect(r.room).toEqual(room);
    expect(r.floor).toEqual(shared);
    expect(r.source).toEqual(shared);
    expect(r.consumer).toEqual(shared);
  });
  it("gives empty lists without any configuration", () => {
    const r = resolveThresholds(undefined, undefined);
    for (const l of THRESHOLD_LEVELS) expect(r[l]).toEqual([]);
  });
  it("has different default limits per level, rising towards the top", () => {
    const top = (l: (typeof THRESHOLD_LEVELS)[number]) => Math.max(...DEFAULT_LEVEL_THRESHOLDS[l].map((t) => t.from));
    expect(top("source")).toBeGreaterThan(top("floor"));
    expect(top("floor")).toBeGreaterThan(top("room"));
    expect(top("room")).toBeGreaterThan(top("consumer"));
  });
});

describe("per-level threshold configuration", () => {
  const cfg = (colors: unknown) => ({ type: "x", colors });
  it("accepts width and level lists", () => {
    expect(() =>
      validateConfig(cfg({ thresholds: [{ from: 0, color: "#fff", width: 2 }], level_thresholds: { room: [{ from: 800, color: "red", width: 12 }] } })),
    ).not.toThrow();
  });
  it("rejects a bad width", () => {
    for (const width of [0.4, 13, "3", NaN]) {
      expect(() => validateConfig(cfg({ thresholds: [{ from: 0, color: "#fff", width }] }))).toThrow(/thresholds\[0\]\.width/);
    }
  });
  it("rejects unknown levels and bad shapes with the path", () => {
    expect(() => validateConfig(cfg({ level_thresholds: { garage: [] } }))).toThrow(/level_thresholds\.garage/);
    expect(() => validateConfig(cfg({ level_thresholds: "x" }))).toThrow(/level_thresholds must be a mapping/);
    expect(() => validateConfig(cfg({ level_thresholds: { room: [{ from: -1, color: "#fff" }] } }))).toThrow(/level_thresholds\.room\[0\]\.from/);
    expect(() => validateConfig(cfg({ level_thresholds: { floor: [{ from: 0, color: "#fff" }, { from: 5 }] } }))).toThrow(/level_thresholds\.floor\[1\]\.color/);
  });
});

describe("elementThresholds", () => {
  const level = sortThresholds([{ from: 0, color: "#111" }]);
  it("prefers the own list of an element, sorted", () => {
    const own = [{ from: 500, color: "#333" }, { from: 100, color: "#222" }];
    expect(elementThresholds(own, level).map((t) => t.from)).toEqual([100, 500]);
  });
  it("falls back to the level for no or only invalid own entries", () => {
    expect(elementThresholds(undefined, level)).toBe(level);
    expect(elementThresholds([], level)).toBe(level);
    expect(elementThresholds([{ from: -1, color: "#333" }], level)).toBe(level);
  });
});

describe("thresholds on elements", () => {
  const T = [{ from: 100, color: "#ff9800", width: 3 }];
  const full = {
    type: "x",
    sources: [{ entity: "sensor.pv", thresholds: T }],
    floors: [{ floor_id: "eg", thresholds: T, rooms: [{ area_id: "kueche", thresholds: T, consumers: [{ entity: "sensor.a", thresholds: T }] }] }],
  };
  it("accepts valid lists on sources, floors, rooms and consumers", () => {
    expect(() => validateConfig(full)).not.toThrow();
    expect(() => validateConfig({ type: "x", rooms: [{ area_id: "bad", thresholds: T, consumers: [{ entity: "sensor.b", thresholds: T }] }] })).not.toThrow();
  });
  it("names the path of a bad entry", () => {
    const bad = [{ from: 0, color: "#fff", width: 99 }];
    expect(() => validateConfig({ ...full, sources: [{ entity: "sensor.pv", thresholds: bad }] })).toThrow(/sources\[0\]\.thresholds\[0\]\.width/);
    expect(() => validateConfig({ type: "x", floors: [{ floor_id: "eg", thresholds: "x" }] })).toThrow(/floors\[0\]\.thresholds must be a list/);
    expect(() => validateConfig({ type: "x", rooms: [{ area_id: "a", thresholds: [{ from: -1, color: "#fff" }] }] })).toThrow(/rooms\[0\]\.thresholds\[0\]\.from/);
    expect(() =>
      validateConfig({ type: "x", rooms: [{ area_id: "a", consumers: [{ entity: "sensor.a", thresholds: [{ from: 1 }] }] }] }),
    ).toThrow(/rooms\[0\]\.consumers\[0\]\.thresholds\[0\]\.color/);
  });
  it("carries them into the model nodes", () => {
    const m = computeModel(full as never, () => ({ watts: 10, valid: true }));
    expect(m.sources[0].thresholds).toEqual(T);
    expect(m.floors[0].thresholds).toEqual(T);
    expect(m.floors[0].rooms[0].thresholds).toEqual(T);
    expect(m.floors[0].rooms[0].consumers[0].thresholds).toEqual(T);
  });
});
