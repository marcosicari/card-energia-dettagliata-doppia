import { describe, expect, it } from "vitest";
import { parseSelection, removeLegacyKeys, removeLegacyKeysOnce, selectionKey } from "../src/model/selection";
import type { EnergyCardConfig } from "../src/model/config";

const cfg = (extra: Partial<EnergyCardConfig> = {}): EnergyCardConfig =>
  ({
    type: "custom:detailed-energy-card",
    sources: [{ entity: "sensor.a", type: "grid" }],
    floors: [{ floor_id: "eg", rooms: [{ area_id: "kueche", consumers: [{ entity: "sensor.b" }] }] }],
    ...extra,
  }) as EnergyCardConfig;

describe("selectionKey", () => {
  it("ignores colors, names and options", () => {
    const base = selectionKey(cfg());
    const changed = selectionKey(
      cfg({
        colors: { accent: "#fff" },
        title: "Anderer Titel",
        floors: [{ floor_id: "eg", name: "Erdgeschoss", rooms: [{ area_id: "kueche", name: "Küche", consumers: [{ entity: "sensor.c" }] }] }],
      } as Partial<EnergyCardConfig>),
    );
    expect(changed).toBe(base);
  });

  it("differs when the structure differs", () => {
    const other = cfg({ floors: [{ floor_id: "og", rooms: [{ area_id: "bad", consumers: [{ entity: "sensor.b" }] }] }] } as Partial<EnergyCardConfig>);
    expect(selectionKey(other)).not.toBe(selectionKey(cfg()));
  });
});

describe("selectionKey of cards with the same structure", () => {
  it("is told apart by options.storage_id", () => {
    const a = selectionKey(cfg({ options: { storage_id: "power" } }));
    const b = selectionKey(cfg({ options: { storage_id: "energy" } }));
    expect(a).not.toBe(b);
    expect(a).not.toBe(selectionKey(cfg()));
    expect(selectionKey(cfg({ options: { storage_id: "power" } }))).toBe(a);
  });
  it("does not hash the structure", () => {
    const k = selectionKey(cfg());
    expect(k).toContain('"eg"');
    expect(k).toContain('"kueche"');
  });
});

describe("parseSelection", () => {
  it("reads a valid selection", () => {
    expect(parseSelection('{"floor":"eg","room":null}')).toEqual({ floor: "eg", room: null });
  });
  it.each([null, "", "null", "[]", "5", '"x"', "{", '{"floor":3,"room":{}}'])("treats %j as no selection", (raw) => {
    expect(parseSelection(raw)).toEqual({});
  });
  it("drops fields of the wrong type but keeps valid ones", () => {
    expect(parseSelection('{"floor":7,"room":"kueche"}')).toEqual({ room: "kueche" });
  });
});

describe("removeLegacyKeys", () => {
  it("removes old keys once and keeps new and foreign keys", () => {
    const data: Record<string, string> = {
      "detailed-energy-card:abc": "{}",
      "detailed-energy-card:sel:xyz": "{}", // hashed key of 1.0
      "detailed-energy-card:sel2:::[]": "{}",
      "other:key": "1",
    };
    const storage = {
      get length() {
        return Object.keys(data).length;
      },
      key: (i: number) => Object.keys(data)[i] ?? null,
      removeItem: (k: string) => void delete data[k],
    };
    removeLegacyKeys(storage);
    expect(Object.keys(data).sort()).toEqual(["detailed-energy-card:sel2:::[]", "other:key"]);
  });
});

describe("model ids", () => {
  it("keeps floor_id and area_id when names are resolved", async () => {
    const { computeModel } = await import("../src/model/compute");
    const model = computeModel(
      cfg({ floors: [{ floor_id: "eg", name: "Erdgeschoss", rooms: [{ area_id: "kueche", name: "Küche", consumers: [{ entity: "sensor.b" }] }] }] } as Partial<EnergyCardConfig>),
      () => ({ watts: 0, valid: true }),
    );
    expect(model.floors[0].id).toBe("eg");
    expect(model.floors[0].rooms[0].id).toBe("kueche");
  });
});

describe("removeLegacyKeysOnce", () => {
  it("scans the storage only the first time", () => {
    let scans = 0;
    const storage = {
      get length() {
        scans++;
        return 0;
      },
      key: () => null,
      removeItem: () => {},
    };
    removeLegacyKeysOnce(storage);
    removeLegacyKeysOnce(storage);
    expect(scans).toBe(1);
  });
});
