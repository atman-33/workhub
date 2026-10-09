import { describe, expect, it } from "vitest";
import type { Sticky } from "../sticky";
import { STICKY_WIDTH } from "../sticky-layout";
import {
  PLOT,
  defaultUnit,
  layoutMatrix,
  pointOf,
  unitAt,
} from "./layout";
import { parseMatrix } from "./parse";

const doc = (items: string[], labels = "") =>
  parseMatrix(`---\ntype: matrix2x2\n${labels}---\n\n## Items\n\n${items.join("\n")}\n`);

describe("coordinates", () => {
  it("puts x left-to-right and y bottom-to-top", () => {
    expect(pointOf(0, 0)).toEqual({ x: PLOT.x, y: PLOT.y + PLOT.height });
    expect(pointOf(1, 1)).toEqual({ x: PLOT.x + PLOT.width, y: PLOT.y });
    expect(pointOf(0.5, 0.5)).toEqual({
      x: PLOT.x + PLOT.width / 2,
      y: PLOT.y + PLOT.height / 2,
    });
  });

  it("maps a point back to unit coordinates, rounded to two decimals", () => {
    expect(unitAt(PLOT.x + PLOT.width * 0.7, PLOT.y + PLOT.height * 0.7)).toEqual({ x: 0.7, y: 0.3 });
    const p = pointOf(0.37, 0.62);
    expect(unitAt(p.x, p.y)).toEqual({ x: 0.37, y: 0.62 });
  });

  it("clamps a point outside the plot to its edge", () => {
    expect(unitAt(-500, -500)).toEqual({ x: 0, y: 1 });
    expect(unitAt(5000, 5000)).toEqual({ x: 1, y: 0 });
  });

  it("keeps the default slots near the middle and apart from each other", () => {
    const slots = Array.from({ length: 12 }, (_, k) => defaultUnit(k));
    for (const s of slots) {
      expect(s.x).toBeGreaterThan(0.2);
      expect(s.x).toBeLessThan(0.8);
      expect(s.y).toBeGreaterThan(0.2);
      expect(s.y).toBeLessThan(0.8);
    }
    expect(new Set(slots.map((s) => `${s.x},${s.y}`)).size).toBe(12);
  });
});

describe("layoutMatrix", () => {
  it("places an item's box centred on its coordinates", () => {
    const layout = layoutMatrix(doc(["- M-001 hello @0.25,0.75"]));
    const item = layout.byId.get("M-001")!;
    const centre = pointOf(0.25, 0.75);
    expect(item.x + item.width / 2).toBeCloseTo(centre.x);
    expect(item.y + item.height / 2).toBeCloseTo(centre.y);
    expect(item.placed).toBe(true);
  });

  it("spreads items with no `@` near the middle, and marks them unplaced", () => {
    const layout = layoutMatrix(doc(["- M-001 a", "- M-002 b", "- M-003 c"]));
    expect(layout.items.every((i) => !i.placed)).toBe(true);
    const centres = layout.items.map((i) => `${i.x + i.width / 2},${i.y + i.height / 2}`);
    expect(new Set(centres).size).toBe(3);
    for (const i of layout.items) {
      expect(Math.abs(i.x + i.width / 2 - (PLOT.x + PLOT.width / 2))).toBeLessThan(PLOT.width * 0.25);
    }
  });

  it("does not move the others when one item gets placed", () => {
    const before = layoutMatrix(doc(["- M-001 a", "- M-002 b", "- M-003 c"]));
    const after = layoutMatrix(doc(["- M-001 a @0.9,0.9", "- M-002 b", "- M-003 c"]));
    expect(after.byId.get("M-002")!.x).toBe(before.byId.get("M-002")!.x);
    expect(after.byId.get("M-003")!.y).toBe(before.byId.get("M-003")!.y);
  });

  it("wraps a long title and grows the box", () => {
    const layout = layoutMatrix(doc(["- M-001 short @0.5,0.5", `- M-002 ${"long ".repeat(30)}@0.5,0.2`]));
    const short = layout.byId.get("M-001")!;
    const long = layout.byId.get("M-002")!;
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.height).toBeGreaterThan(short.height);
  });

  it("draws only the labels that are filled in", () => {
    const empty = layoutMatrix(doc([]));
    expect(empty.axisTexts).toHaveLength(0);
    const some = layoutMatrix(doc([], "x_axis: 工数\ny_high: 大\nq_tl: 先にやる\n"));
    expect(some.axisTexts.map((a) => a.id).sort()).toEqual(["x_axis", "y_high"]);
    expect(some.quadrants.find((q) => q.key === "tl")!.label).toBe("先にやる");
    expect(some.quadrants.find((q) => q.key === "br")!.label).toBe("");
  });

  it("frames the plot even when the matrix is empty", () => {
    const layout = layoutMatrix(doc([]));
    expect(layout.bounds.width).toBeGreaterThanOrEqual(PLOT.width);
    expect(layout.bounds.height).toBeGreaterThanOrEqual(PLOT.height);
  });

  it("widens the frame for an item dropped past the plot's edge and for axis names", () => {
    const edge = layoutMatrix(doc(["- M-001 a very wide item title here @1.00,1.00"]));
    expect(edge.bounds.x + edge.bounds.width).toBeGreaterThan(PLOT.x + PLOT.width);
    const named = layoutMatrix(doc([], "y_axis: 効果\nx_axis: 工数\n"));
    expect(named.bounds.x).toBeLessThan(PLOT.x);
    expect(named.bounds.y + named.bounds.height).toBeGreaterThan(PLOT.y + PLOT.height);
  });
});

describe("stickies", () => {
  const sticky = (patch: Partial<Sticky> = {}): Sticky => ({
    id: "S-001",
    targetId: "M-001",
    dx: 96,
    dy: 24,
    text: "check me",
    ...patch,
  });

  it("places a sticky at its offset from the item's centre", () => {
    const layout = layoutMatrix(doc(["- M-001 a @0.5,0.5"]), [sticky()]);
    const item = layout.byId.get("M-001")!;
    const s = layout.stickies[0];
    expect(s.x).toBeCloseTo(item.x + item.width / 2 + 96);
    expect(s.y).toBeCloseTo(item.y + item.height / 2 + 24);
    expect(s.width).toBe(STICKY_WIDTH);
  });

  it("follows the item when it moves", () => {
    const at = (x: number, y: number) =>
      layoutMatrix(doc([`- M-001 a @${x},${y}`]), [sticky()]).stickies[0];
    const a = at(0.2, 0.2);
    const b = at(0.6, 0.8);
    expect(b.x - a.x).toBeCloseTo(PLOT.width * 0.4);
    expect(b.y - a.y).toBeCloseTo(-PLOT.height * 0.6);
  });

  it("drops (but does not delete) a sticky whose item is missing", () => {
    const layout = layoutMatrix(doc(["- M-001 a"]), [sticky({ targetId: "M-404" })]);
    expect(layout.stickies).toHaveLength(0);
  });

  it("counts stickies towards the frame", () => {
    const without = layoutMatrix(doc(["- M-001 a @0.9,0.9"]));
    const withSticky = layoutMatrix(doc(["- M-001 a @0.9,0.9"]), [sticky({ dx: 400, dy: 300 })]);
    expect(withSticky.bounds.width).toBeGreaterThan(without.bounds.width);
  });

  it("draws no sticky when the caller passes none (hidden setting)", () => {
    expect(layoutMatrix(doc(["- M-001 a"]), []).stickies).toHaveLength(0);
  });
});
