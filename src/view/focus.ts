import type { Layout } from "./layout";

/** Position and opacity of a floor or room node. */
export interface Pos {
  x: number;
  y: number;
  o: number;
}

/** Duration of the slide when the selection changes. */
export const FOCUS_MS = 380;

export const ease = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export const lerp = (a: Pos, b: Pos, t: number): Pos => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  o: a.o + (b.o - a.o) * t,
});

export interface FocusInput {
  layout: Layout;
  floors: number;
  /** index of the selected floor, undefined = none (all floors are shown) */
  selFloor?: number;
  /** rooms in the visible row */
  rooms: number;
  /** index of the selected room within the visible row */
  selRoom?: number;
  /** false: every node sits at its normal place */
  focus: boolean;
}

/**
 * Where the floor and room nodes belong. With `focus`, the selected element of a level sits in the
 * middle under its parent and the other elements of that level are hidden behind it; the children
 * of the selected element are spread around the new middle as usual.
 */
export function focusTargets(i: FocusInput): { floors: Pos[]; rooms: Pos[] } {
  const l = i.layout;
  const floorFocus = i.focus && i.selFloor !== undefined;
  const roomFocus = i.focus && i.selRoom !== undefined;
  return {
    floors: Array.from({ length: i.floors }, (_, k) => ({
      x: floorFocus ? l.homeX : l.floorXs[k],
      y: l.yFloor,
      o: floorFocus && k !== i.selFloor ? 0 : 1,
    })),
    rooms: Array.from({ length: i.rooms }, (_, k) => ({
      x: roomFocus ? l.homeX : l.roomXs[k],
      y: roomFocus ? l.yRoom : l.roomYs[k],
      o: roomFocus && k !== i.selRoom ? 0 : 1,
    })),
  };
}

/**
 * A slide from the positions last shown to the new targets. Nodes that are new start (invisible) at
 * `origin`, nodes that are gone fade out where they were. With `reduced` motion nodes do not move,
 * they only fade in and out.
 */
export class Tween {
  private readonly from = new Map<string, Pos>();
  private readonly to = new Map<string, Pos>();
  /** ids of nodes that are not part of the new targets */
  readonly leaving = new Set<string>();

  constructor(
    prev: Map<string, Pos>,
    next: Map<string, Pos>,
    origin: (id: string) => Pos,
    reduced: boolean,
    private readonly start: number,
    private readonly duration = FOCUS_MS,
  ) {
    for (const [id, to] of next) {
      const was = prev.get(id) ?? origin(id);
      this.from.set(id, reduced ? { ...was, x: to.x, y: to.y } : was);
      this.to.set(id, to);
    }
    for (const [id, was] of prev) {
      if (next.has(id)) continue;
      this.leaving.add(id);
      this.from.set(id, was);
      this.to.set(id, { ...was, o: 0 });
    }
  }

  finished(now: number): boolean {
    return now - this.start >= this.duration;
  }

  sample(id: string, now: number): Pos | undefined {
    const a = this.from.get(id);
    const b = this.to.get(id);
    return a && b ? lerp(a, b, ease((now - this.start) / this.duration)) : undefined;
  }
}
