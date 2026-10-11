import { describe, expect, it } from "vitest";
import { Tween, ease, focusTargets, lerp, type Pos } from "../src/view/focus";
import { computeLayout } from "../src/view/layout";

const layout = computeLayout({ width: 600, sources: 2, floors: 3, rooms: 4 });
const base = { layout, floors: 3, rooms: 4 };

describe("focusTargets", () => {
  it("keeps every node in place without focus", () => {
    const t = focusTargets({ ...base, selFloor: 1, selRoom: 2, focus: false });
    expect(t.floors.map((p) => p.x)).toEqual(layout.floorXs);
    expect(t.rooms.map((p) => p.x)).toEqual(layout.roomXs);
    expect([...t.floors, ...t.rooms].every((p) => p.o === 1)).toBe(true);
  });
  it("shows all floors spread out while none is selected", () => {
    const t = focusTargets({ ...base, focus: true });
    expect(t.floors.map((p) => p.x)).toEqual(layout.floorXs);
    expect(t.floors.every((p) => p.o === 1)).toBe(true);
  });
  it("moves all floors to the middle and hides all but the selected one", () => {
    const t = focusTargets({ ...base, selFloor: 1, focus: true });
    expect(t.floors.every((p) => p.x === layout.homeX)).toBe(true);
    expect(t.floors.map((p) => p.o)).toEqual([0, 1, 0]);
    // its rooms stay spread around the new middle
    expect(t.rooms.map((p) => p.x)).toEqual(layout.roomXs);
  });
  it("moves all rooms to the middle and hides all but the selected one", () => {
    const t = focusTargets({ ...base, selFloor: 0, selRoom: 3, focus: true });
    expect(t.rooms.every((p) => p.x === layout.homeX && p.y === layout.yRoom)).toBe(true);
    expect(t.rooms.map((p) => p.o)).toEqual([0, 0, 0, 1]);
  });
});

describe("tween", () => {
  const a = (x: number, o = 1): Pos => ({ x, y: 10, o });
  const origin = () => ({ x: 50, y: 0, o: 0 });
  it("eases from 0 to 1", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(2)).toBe(1);
    expect(ease(0.5)).toBeGreaterThan(0.5);
  });
  it("slides known nodes, grows new ones from the origin and fades the gone ones out", () => {
    const prev = new Map([["a", a(0)], ["gone", a(30)]]);
    const next = new Map([["a", a(100)], ["new", a(80)]]);
    const t = new Tween(prev, next, origin, false, 1000, 400);
    expect(t.sample("a", 1000)).toEqual(a(0));
    expect(t.sample("a", 1400)).toEqual(a(100));
    expect(t.sample("new", 1000)).toEqual({ x: 50, y: 0, o: 0 });
    expect(t.sample("new", 1400)).toEqual(a(80));
    expect(t.leaving.has("gone")).toBe(true);
    expect(t.sample("gone", 1400)).toEqual({ x: 30, y: 10, o: 0 });
    expect(t.sample("nothing", 1200)).toBeUndefined();
    expect(t.finished(1399)).toBe(false);
    expect(t.finished(1400)).toBe(true);
  });
  it("only fades with reduced motion", () => {
    const prev = new Map([["a", a(0, 1)]]);
    const next = new Map([["a", a(100, 0)]]);
    const t = new Tween(prev, next, origin, true, 0, 400);
    expect(t.sample("a", 0)).toEqual({ x: 100, y: 10, o: 1 });
    expect(t.sample("a", 400)).toEqual({ x: 100, y: 10, o: 0 });
  });
  it("lerp mixes all three values", () => {
    expect(lerp({ x: 0, y: 0, o: 0 }, { x: 10, y: 20, o: 1 }, 0.5)).toEqual({ x: 5, y: 10, o: 0.5 });
  });
});
