import { describe, expect, it } from "vitest";
import {
  idsInRect,
  normalizeRect,
  rectHitsBox,
  replaceSelected,
  shiftPositions,
  toggleSelected,
  unionSelected,
  type MarqueeRect,
} from "./multi-select";

const box = (id: string, x: number, y: number, w = 100, h = 50) => ({ id, x, y, width: w, height: h });

describe("normalizeRect", () => {
  it("orders the corners whatever way the drag ran", () => {
    expect(normalizeRect({ x: 30, y: 40 }, { x: 10, y: 5 })).toEqual({ x0: 10, y0: 5, x1: 30, y1: 40 });
    expect(normalizeRect({ x: 10, y: 5 }, { x: 30, y: 40 })).toEqual({ x0: 10, y0: 5, x1: 30, y1: 40 });
  });

  it("keeps a press that never travelled as an empty rectangle", () => {
    expect(normalizeRect({ x: 7, y: 7 }, { x: 7, y: 7 })).toEqual({ x0: 7, y0: 7, x1: 7, y1: 7 });
  });
});

describe("rectHitsBox", () => {
  const rect: MarqueeRect = { x0: 0, y0: 0, x1: 200, y1: 200 };

  it("hits a box inside and a box it only overlaps", () => {
    expect(rectHitsBox(rect, box("in", 10, 10))).toBe(true);
    expect(rectHitsBox(rect, box("over", 150, 150))).toBe(true);
  });

  it("misses a box clear of the rectangle", () => {
    expect(rectHitsBox(rect, box("out", 300, 10))).toBe(false);
    expect(rectHitsBox(rect, box("above", 10, -100))).toBe(false);
  });

  it("counts a shared edge as a hit, so a thin sliver still selects", () => {
    expect(rectHitsBox(rect, box("edge", 200, 10, 100, 50))).toBe(true);
    expect(rectHitsBox(rect, box("past", 201, 10, 100, 50))).toBe(false);
  });
});

describe("idsInRect", () => {
  it("returns the caught ids in layout order", () => {
    const boxes = [box("a", 10, 10), box("b", 500, 500), box("c", 120, 120)];
    expect(idsInRect(boxes, { x0: 0, y0: 0, x1: 200, y1: 200 })).toEqual(["a", "c"]);
  });

  it("catches nothing for an empty drag", () => {
    expect(idsInRect([box("a", 10, 10)], { x0: 5, y0: 5, x1: 5, y1: 5 })).toEqual([]);
  });
});

describe("selection reducer", () => {
  it("toggles one id and keeps the rest in order", () => {
    expect(toggleSelected([], "a")).toEqual(["a"]);
    expect(toggleSelected(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleSelected(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("replaces the selection on a plain click, and clears on null", () => {
    expect(replaceSelected("b")).toEqual(["b"]);
    expect(replaceSelected(null)).toEqual([]);
  });

  it("unions a Shift marquee without moving the focused node", () => {
    expect(unionSelected(["a"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(unionSelected(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(unionSelected([], ["b"])).toEqual(["b"]);
  });
});

describe("shiftPositions", () => {
  const origins = new Map([
    ["a", { x: 100, y: 100 }],
    ["b", { x: 300, y: 200 }],
    ["c", { x: 500, y: 500 }],
  ]);
  const identity = (x: number, y: number) => ({ x, y });

  it("moves every selected node by the same delta", () => {
    const out = shiftPositions(origins, ["a", "b"], 10, -20, identity);
    expect(out.get("a")).toEqual({ x: 110, y: 80 });
    expect(out.get("b")).toEqual({ x: 310, y: 180 });
    expect(out.has("c")).toBe(false);
  });

  it("rounds through snap: whole pixels for free canvases", () => {
    const pixel = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y) });
    const out = shiftPositions(origins, ["a"], 10.6, 10.4, pixel);
    expect(out.get("a")).toEqual({ x: 111, y: 110 });
  });

  it("rounds through snap: clamped units for the 2x2 matrix", () => {
    const units = new Map([
      ["M-001", { x: 0.2, y: 0.85 }],
      ["M-002", { x: 0.99, y: 0.01 }],
    ]);
    const clampUnit = (x: number, y: number) => ({
      x: Math.min(1, Math.max(0, Math.round(x * 100) / 100)),
      y: Math.min(1, Math.max(0, Math.round(y * 100) / 100)),
    });
    const out = shiftPositions(units, ["M-001", "M-002"], 0.03, -0.03, clampUnit);
    expect(out.get("M-001")).toEqual({ x: 0.23, y: 0.82 });
    // The edge turns back instead of leaving the plot.
    expect(out.get("M-002")).toEqual({ x: 1, y: 0 });
  });

  it("skips ids with no origin, so a lost node gains no position", () => {
    const out = shiftPositions(origins, ["a", "ghost"], 5, 5, identity);
    expect([...out.keys()]).toEqual(["a"]);
  });

  it("does not mutate the origins", () => {
    const before = new Map(origins);
    shiftPositions(origins, ["a", "b"], 10, 10, identity);
    expect(origins).toEqual(before);
  });
});
