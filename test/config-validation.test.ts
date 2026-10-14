import { describe, expect, it } from "vitest";
import { ConfigError, validateConfig } from "../src/model/config";
import { formatPower } from "../src/model/units";

const base = { type: "custom:detailed-energy-card" };
const rejects = (cfg: Record<string, unknown>, message: RegExp) => {
  expect(() => validateConfig({ ...base, ...cfg })).toThrow(ConfigError);
  expect(() => validateConfig({ ...base, ...cfg })).toThrow(message);
};

describe("validateConfig: types (U-5)", () => {
  it("names the field when a list is not a list", () => {
    rejects({ sources: {} }, /^sources must be a list/);
    rejects({ rooms: "kitchen" }, /^rooms must be a list/);
    rejects({ floors: [{ floor_id: "eg", rooms: "x" }] }, /floors\[0\]\.rooms must be a list/);
    rejects({ rooms: [{ area_id: "a", consumers: {} }] }, /rooms\[0\]\.consumers must be a list/);
    rejects({ colors: { thresholds: { from: 0 } } }, /colors\.thresholds must be a list/);
  });
  it("rejects entries that are not mappings", () => {
    rejects({ sources: ["sensor.grid"] }, /sources\[0\] must be a mapping/);
    rejects({ home: "sensor.total" }, /home must be a mapping/);
    rejects({ options: true }, /options must be a mapping/);
    rejects({ colors: "red" }, /colors must be a mapping/);
  });
  it("accepts absent and null sections", () => {
    expect(() => validateConfig({ ...base, home: null, options: null, colors: null, rooms: null })).not.toThrow();
  });
});

describe("validateConfig: options (U-1)", () => {
  it.each(["", 5, "x".repeat(65)])("rejects storage_id %j", (storage_id) => {
    rejects({ options: { storage_id } }, /options\.storage_id/);
  });
  it("accepts a storage_id", () => {
    expect(() => validateConfig({ ...base, options: { storage_id: "energy-view" } })).not.toThrow();
  });
  it.each([-1, -3, 21, 1.5, "2", Number.NaN])("rejects decimals %s", (decimals) => {
    rejects({ options: { decimals } }, /options\.decimals/);
  });
  it.each([0, 2, 4, 20])("accepts decimals %s", (decimals) => {
    expect(() => validateConfig({ ...base, options: { decimals } })).not.toThrow();
  });
  it("checks unit and switches", () => {
    rejects({ options: { unit: "MW" } }, /options\.unit/);
    rejects({ options: { animation: "no" } }, /options\.animation must be true or false/);
    rejects({ sources: [{ entity: "sensor.pv", invert: 1 }] }, /sources\[0\]\.invert/);
    expect(() => validateConfig({ ...base, options: { unit: "kW", animation: false, wrap_rooms: true } })).not.toThrow();
  });
});

describe("formatPower never throws on bad decimals", () => {
  it.each([-3, 25, 101, Number.NaN, 1.7])("decimals %s", (d) => {
    expect(() => formatPower(1234, "kW", d)).not.toThrow();
  });
  it("clamps into range", () => {
    expect(formatPower(1234, "kW", -3, "en")).toBe("1 kW");
    expect(formatPower(1234, "kW", 1.7, "en")).toBe("1.2 kW");
  });
});

describe("validateConfig: colors (S-1)", () => {
  const attack = "red;background:url(//example.com/x)";
  it("rejects CSS that is more than a color, wherever a color is set", () => {
    rejects({ colors: { accent: attack } }, /colors\.accent/);
    rejects({ colors: { background: "url(//example.com/x)" } }, /colors\.background/);
    rejects({ colors: { thresholds: [{ from: 0, color: attack }] } }, /colors\.thresholds\[0\]\.color/);
    rejects({ sources: [{ entity: "sensor.pv", color: attack }] }, /sources\[0\]\.color/);
    rejects({ floors: [{ floor_id: "eg", color: attack }] }, /floors\[0\]\.color/);
    rejects({ rooms: [{ area_id: "a", color: attack }] }, /rooms\[0\]\.color/);
    rejects({ floors: [{ floor_id: "eg", rooms: [{ area_id: "a", color: attack }] }] }, /floors\[0\]\.rooms\[0\]\.color/);
  });
  it("keeps existing color styles working", () => {
    expect(() =>
      validateConfig({
        ...base,
        colors: { preset: "custom", accent: "#9184d9", flow: "var(--primary-color)", bar: "orange", text: "rgb(233, 233, 237)" },
        sources: [{ entity: "sensor.pv", color: "gold" }],
      }),
    ).not.toThrow();
  });
  it("rejects unknown presets", () => {
    rejects({ colors: { preset: "neon" } }, /colors\.preset/);
  });
});
