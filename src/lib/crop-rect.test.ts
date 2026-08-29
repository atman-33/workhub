import { describe, expect, it } from "vitest";
import { gripAt, normalize, resize, type Rect } from "@/lib/crop-rect";

const MAX: Rect = { x: 0, y: 0, w: 800, h: 600 };
const SEL: Rect = { x: 100, y: 100, w: 200, h: 100 };

describe("gripAt", () => {
  it("reports corners before edges", () => {
    expect(gripAt(SEL, 100, 100)).toBe("nw");
    expect(gripAt(SEL, 300, 200)).toBe("se");
  });

  it("reports edges away from the corners", () => {
    expect(gripAt(SEL, 200, 100)).toBe("n");
    expect(gripAt(SEL, 300, 150)).toBe("e");
  });

  it("reports move inside and null outside", () => {
    expect(gripAt(SEL, 200, 150)).toBe("move");
    expect(gripAt(SEL, 50, 50)).toBeNull();
  });

  it("still hits the border just outside the rectangle", () => {
    expect(gripAt(SEL, 95, 150)).toBe("w");
  });
});

describe("resize", () => {
  it("moves within bounds without changing the size", () => {
    const moved = resize(SEL, "move", 700, 550, MAX);
    expect(moved).toEqual({ x: 600, y: 500, w: 200, h: 100 });
  });

  it("grows and shrinks from each edge", () => {
    expect(resize(SEL, "e", 400, 0, MAX)).toEqual({ x: 100, y: 100, w: 600, h: 100 });
    expect(resize(SEL, "w", -150, 0, MAX)).toEqual({ x: 0, y: 100, w: 300, h: 100 });
  });

  it("normalizes a drag that flips an edge past its opposite", () => {
    // The west edge dragged to 500 becomes the east edge; the mirrored
    // rectangle spans 300..500.
    expect(resize(SEL, "w", 400, 0, MAX)).toEqual({ x: 300, y: 100, w: 200, h: 100 });
  });

  it("clamps to the image bounds on every side", () => {
    expect(resize(SEL, "se", 1000, 1000, MAX)).toEqual({ x: 100, y: 100, w: 700, h: 500 });
    expect(resize(SEL, "nw", -1000, -1000, MAX)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  });
});

describe("normalize", () => {
  it("turns negative extents into a positive rectangle", () => {
    expect(normalize({ x: 10, y: 10, w: -5, h: -6 })).toEqual({ x: 5, y: 4, w: 5, h: 6 });
  });
});
