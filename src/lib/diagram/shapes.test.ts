import { describe, expect, it } from "vitest";
import { boundaryPoint, centerOf, nodeContains, type DiagramNode, type Point } from "./node-edge";
import { PARALLELOGRAM_SLANT, SUBROUTINE_INSET, shapeOf } from "./shapes";

const node = (shape: string, width = 120, height = 48): DiagramNode => ({
  id: "n",
  shape,
  x: 200 - width / 2,
  y: 100 - height / 2,
  width,
  height,
});

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function polygonPoints(n: DiagramNode): Point[] {
  const el = shapeOf(n.shape).outline(n);
  expect(el.tag).toBe("polygon");
  return String(el.attrs.points)
    .split(" ")
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    });
}

/** Directions all around the centre, so every edge and corner is met. */
const ANGLES = Array.from({ length: 72 }, (_, i) => (i * Math.PI * 2) / 72 + 0.013);

describe("parallelogram", () => {
  it("is registered and leans right", () => {
    const n = node("parallelogram");
    expect(shapeOf("parallelogram").id).toBe("parallelogram");
    // top edge shifted right, bottom edge shifted left
    expect(polygonPoints(n)).toEqual([
      { x: 140 + PARALLELOGRAM_SLANT, y: 76 },
      { x: 260, y: 76 },
      { x: 260 - PARALLELOGRAM_SLANT, y: 124 },
      { x: 140, y: 124 },
    ]);
  });

  it("contains its centre and the filled corners, not the cut ones", () => {
    const n = node("parallelogram");
    const c = centerOf(n);
    expect(nodeContains(n, c)).toBe(true);
    // the empty corners: top-left and bottom-right of the box
    expect(nodeContains(n, { x: n.x + 2, y: n.y + 2 })).toBe(false);
    expect(nodeContains(n, { x: n.x + n.width - 2, y: n.y + n.height - 2 })).toBe(false);
    // the filled corners: top-right and bottom-left
    expect(nodeContains(n, { x: n.x + n.width - 2, y: n.y + 2 })).toBe(true);
    expect(nodeContains(n, { x: n.x + 2, y: n.y + n.height - 2 })).toBe(true);
    // just outside the box is out
    expect(nodeContains(n, { x: c.x, y: n.y - 1 })).toBe(false);
    expect(nodeContains(n, { x: n.x + n.width + 1, y: c.y })).toBe(false);
  });

  it("is half way along the slant at the centre line", () => {
    const n = node("parallelogram");
    const c = centerOf(n);
    expect(nodeContains(n, { x: n.x + PARALLELOGRAM_SLANT / 2 - 0.1, y: c.y })).toBe(false);
    expect(nodeContains(n, { x: n.x + PARALLELOGRAM_SLANT / 2 + 0.1, y: c.y })).toBe(true);
  });

  it("puts every arrow end point on the drawn outline", () => {
    const n = node("parallelogram");
    const pts = polygonPoints(n);
    const c = centerOf(n);
    for (const angle of ANGLES) {
      const p = boundaryPoint(n, { x: c.x + Math.cos(angle) * 300, y: c.y + Math.sin(angle) * 300 });
      const d = Math.min(...pts.map((a, i) => distanceToSegment(p, a, pts[(i + 1) % pts.length])));
      expect(d).toBeLessThan(0.01);
    }
  });

  it("keeps a narrow shape valid", () => {
    const n = node("parallelogram", 30, 40);
    expect(nodeContains(n, centerOf(n))).toBe(true);
    const pts = polygonPoints(n);
    expect(pts[0].x).toBeLessThan(pts[1].x);
  });
});

describe("subroutine", () => {
  it("is registered with the rectangle's reach", () => {
    const n = node("subroutine");
    expect(shapeOf("subroutine").id).toBe("subroutine");
    const c = centerOf(n);
    expect(nodeContains(n, c)).toBe(true);
    expect(nodeContains(n, { x: n.x + 1, y: n.y + 1 })).toBe(true);
    expect(nodeContains(n, { x: n.x + n.width + 1, y: c.y })).toBe(false);
  });

  it("draws the frame and one line inside each side as a single path", () => {
    const n = node("subroutine");
    const el = shapeOf("subroutine").outline(n);
    expect(el.tag).toBe("path");
    expect(el.attrs.d).toBe(
      [
        "M 140 76 H 260 V 124 H 140 Z",
        `M ${140 + SUBROUTINE_INSET} 76 V 124`,
        `M ${260 - SUBROUTINE_INSET} 76 V 124`,
      ].join(" "),
    );
  });

  it("puts every arrow end point on the outer frame", () => {
    const n = node("subroutine");
    const c = centerOf(n);
    for (const angle of ANGLES) {
      const p = boundaryPoint(n, { x: c.x + Math.cos(angle) * 300, y: c.y + Math.sin(angle) * 300 });
      const onVertical = Math.abs(Math.abs(p.x - c.x) - n.width / 2) < 0.01;
      const onHorizontal = Math.abs(Math.abs(p.y - c.y) - n.height / 2) < 0.01;
      expect(onVertical || onHorizontal).toBe(true);
    }
  });

  it("keeps the inner lines inside a narrow shape", () => {
    const n = node("subroutine", 24, 40);
    const d = String(shapeOf("subroutine").outline(n).attrs.d);
    // the inset shrinks to a quarter of the width, so the lines never cross
    expect(d).toContain(`M ${n.x + 6} ${n.y} V ${n.y + n.height}`);
    expect(d).toContain(`M ${n.x + n.width - 6} ${n.y} V ${n.y + n.height}`);
  });
});
