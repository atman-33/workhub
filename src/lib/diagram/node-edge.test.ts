import { describe, expect, it } from "vitest";
import {
  arrowHeadPoints,
  boundaryPoint,
  centerOf,
  connectEdges,
  edgeGeometry,
  hitNode,
  nodeContains,
  orthogonalRoute,
  reattachEdge,
  type DiagramEdge,
  type DiagramNode,
  type Point,
} from "./node-edge";
import { registerShape, shapeOf } from "./shapes";

const node = (id: string, shape: string, cx: number, cy: number, width = 100, height = 40): DiagramNode => ({
  id,
  shape,
  x: cx - width / 2,
  y: cy - height / 2,
  width,
  height,
});

const SHAPES = ["rect", "rounded", "pill", "diamond", "ellipse", "document"];

/** The point is on the boundary when a hair inside is in and a hair outside is out. */
function expectOnBoundary(n: DiagramNode, p: Point) {
  const c = centerOf(n);
  const len = Math.hypot(p.x - c.x, p.y - c.y);
  const ux = (p.x - c.x) / len;
  const uy = (p.y - c.y) / len;
  expect(nodeContains(n, { x: c.x + ux * (len - 0.05), y: c.y + uy * (len - 0.05) })).toBe(true);
  expect(nodeContains(n, { x: c.x + ux * (len + 0.05), y: c.y + uy * (len + 0.05) })).toBe(false);
}

describe("boundaryPoint", () => {
  it("finds the sides of a rectangle", () => {
    const n = node("a", "rect", 100, 50, 100, 40);
    const side = boundaryPoint(n, { x: 400, y: 50 });
    expect(side.x).toBeCloseTo(150, 4);
    expect(side.y).toBeCloseTo(50, 4);
    const p = boundaryPoint(n, { x: 100, y: -300 });
    expect(p.x).toBeCloseTo(100, 4);
    expect(p.y).toBeCloseTo(30, 4);
  });

  it("finds the vertices of a diamond", () => {
    const n = node("a", "diamond", 0, 0, 120, 80);
    const right = boundaryPoint(n, { x: 500, y: 0 });
    expect(right.x).toBeCloseTo(60, 4);
    expect(right.y).toBeCloseTo(0, 4);
    const down = boundaryPoint(n, { x: 0, y: 500 });
    expect(down.x).toBeCloseTo(0, 4);
    expect(down.y).toBeCloseTo(40, 4);
    // Toward the corner of the bounding box the diamond edge is at half distance.
    const diag = boundaryPoint(n, { x: 60, y: 40 });
    expect(diag.x).toBeCloseTo(30, 4);
    expect(diag.y).toBeCloseTo(20, 4);
  });

  it("finds the points of an ellipse", () => {
    const n = node("a", "ellipse", 10, 10, 200, 100);
    const right = boundaryPoint(n, { x: 1000, y: 10 });
    expect(right.x).toBeCloseTo(110, 4);
    const top = boundaryPoint(n, { x: 10, y: -1000 });
    expect(top.y).toBeCloseTo(-40, 4);
  });

  it("follows the rounded corner of a rounded box", () => {
    const n = node("a", "rounded", 0, 0, 100, 60);
    // Toward the corner: on the corner arc (radius 8), not at the sharp corner.
    const p = boundaryPoint(n, { x: 50, y: 30 });
    const arcCentre = { x: 42, y: 22 };
    expect(Math.hypot(p.x - arcCentre.x, p.y - arcCentre.y)).toBeCloseTo(8, 3);
    expect(p.x).toBeLessThan(50);
  });

  it("puts the arrow on the boundary for every shape in every direction", () => {
    for (const shape of SHAPES) {
      const n = node("a", shape, 30, -20, 140, 56);
      for (let deg = 0; deg < 360; deg += 15) {
        const rad = (deg * Math.PI) / 180;
        const target = { x: 30 + Math.cos(rad) * 400, y: -20 + Math.sin(rad) * 400 };
        expectOnBoundary(n, boundaryPoint(n, target));
      }
    }
  });

  it("returns the centre for a target at the centre", () => {
    const n = node("a", "rect", 5, 5);
    expect(boundaryPoint(n, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  it("works for a shape added to the registry", () => {
    // A triangle pointing up: a "new symbol" costs one contains and one outline.
    registerShape({
      id: "test-triangle",
      contains: (dx, dy, s) => {
        const t = (dy + s.height / 2) / s.height; // 0 at the top, 1 at the bottom
        return t >= 0 && t <= 1 && Math.abs(dx) <= (s.width / 2) * t;
      },
      outline: (box) => ({ tag: "polygon", attrs: { points: `${box.x},${box.y}` } }),
    });
    const n = node("a", "test-triangle", 0, 0, 100, 100);
    const p = boundaryPoint(n, { x: 0, y: -400 });
    expect(p.y).toBeCloseTo(-50, 3); // the apex
    expectOnBoundary(n, boundaryPoint(n, { x: 300, y: 300 }));
  });

  it("falls back to a rectangle for an unknown shape", () => {
    expect(shapeOf("no-such-shape").id).toBe("rect");
  });
});

describe("hitNode", () => {
  it("uses the shape, not the box", () => {
    const d = node("d", "diamond", 0, 0, 100, 100);
    expect(hitNode([d], { x: 0, y: 0 })?.id).toBe("d");
    expect(hitNode([d], { x: 45, y: 45 })).toBeNull(); // inside the box, outside the diamond
  });

  it("prefers the node drawn last", () => {
    const a = node("a", "rect", 0, 0);
    const b = node("b", "rect", 10, 0);
    expect(hitNode([a, b], { x: 5, y: 0 })?.id).toBe("b");
  });
});

describe("edgeGeometry", () => {
  it("draws a straight arrow between the boundaries", () => {
    const a = node("a", "rect", 0, 0);
    const b = node("b", "rect", 300, 0);
    const g = edgeGeometry(a, b, "straight")!;
    expect(g.start.x).toBeCloseTo(50, 3);
    expect(g.end.x).toBeCloseTo(250, 3);
    expect(g.headAngle).toBeCloseTo(0, 6);
    expect(g.mid.x).toBeCloseTo(150, 3);
  });

  it("returns nothing for an arrow from a node to itself", () => {
    const a = node("a", "rect", 0, 0);
    expect(edgeGeometry(a, a, "orthogonal")).toBeNull();
  });

  it("turns a forward arrow into axis-aligned segments that meet the shapes", () => {
    const a = node("a", "diamond", 0, 0, 100, 60);
    const b = node("b", "rect", 300, 120);
    const g = edgeGeometry(a, b, "orthogonal")!;
    for (let i = 1; i < g.points.length; i++) {
      const dx = g.points[i].x - g.points[i - 1].x;
      const dy = g.points[i].y - g.points[i - 1].y;
      expect(Math.min(Math.abs(dx), Math.abs(dy))).toBeLessThan(1e-6);
    }
    expect(g.start.x).toBeCloseTo(50, 3); // the diamond's right vertex
    expect(g.start.y).toBeCloseTo(0, 3);
    expect(g.end.x).toBeCloseTo(250, 3); // the left side of b
    expect(g.end.y).toBeCloseTo(120, 3);
    expect(g.headAngle).toBeCloseTo(0, 6);
    expectOnBoundary(a, g.start);
    expectOnBoundary(b, g.end);
  });

  it("routes a loop back under both boxes and into the target from below", () => {
    const a = node("a", "rect", 400, 0);
    const b = node("b", "rect", 100, 0);
    const route = orthogonalRoute(a, b);
    expect(route).toHaveLength(4);
    expect(route[1].y).toBeGreaterThan(20); // below the bottom edges
    const g = edgeGeometry(a, b, "orthogonal")!;
    expect(g.end.y).toBeCloseTo(20, 3); // enters from the bottom
    expect(g.headAngle).toBeCloseTo(-Math.PI / 2, 6); // pointing up
    // A second loop between the same boxes does not lie on the first.
    const used = g.points.slice(1).map((p, i) => ({ a: g.points[i], b: p }));
    const g2 = edgeGeometry(a, b, "orthogonal", { used })!;
    expect(g2.points[1].y).toBeGreaterThan(g.points[1].y);
  });

  it("routes a loop back over both boxes when nothing below is viable", () => {
    const a = node("a", "rect", 400, 0);
    const b = node("b", "rect", 100, 0);
    // A box fills every lane below the two boxes.
    const blocker = { x: 0, y: 40, width: 600, height: 200 };
    const route = orthogonalRoute(a, b, { obstacles: [blocker] });
    expect(route).toHaveLength(4);
    expect(route[1].y).toBeLessThan(-20); // above the top edges
    const g = edgeGeometry(a, b, "orthogonal", { obstacles: [blocker] })!;
    expect(g.end.y).toBeCloseTo(-20, 3); // enters from the top
    expect(g.headAngle).toBeCloseTo(Math.PI / 2, 6); // pointing down
  });

  it("moves the vertical leg out of the way of a box in the gap", () => {
    const a = node("a", "rect", 0, 0);
    const b = node("b", "rect", 500, 200);
    const middle = orthogonalRoute(a, b);
    expect(middle[1].x).toBeCloseTo(250, 6); // the middle of the gap
    // A box sits where the vertical leg would go.
    const blocker = { x: 200, y: 100, width: 100, height: 60 };
    const route = orthogonalRoute(a, b, { obstacles: [blocker] });
    expect(route[1].x).not.toBeCloseTo(250, 1);
    const clear = (x: number) => x < blocker.x - 6 || x > blocker.x + blocker.width + 6;
    expect(clear(route[1].x)).toBe(true);
    expect(route[1].x).toBe(route[2].x);
  });

  it("keeps a second arrow off the vertical leg of the first", () => {
    const a = node("a", "rect", 0, 0);
    const b = node("b", "rect", 500, 200);
    const c = node("c", "rect", 500, -200);
    const first = edgeGeometry(a, b, "orthogonal")!;
    const used = first.points.slice(1).map((p, i) => ({ a: first.points[i], b: p }));
    const second = edgeGeometry(a, c, "orthogonal", { used })!;
    // Different directions, so no overlap is needed; same direction would move over.
    const third = edgeGeometry(a, node("d", "rect", 500, 400), "orthogonal", { used })!;
    expect(third.points[1].x).not.toBeCloseTo(first.points[1].x, 0);
    expect(second.points[1].x).toBeCloseTo(first.points[1].x, 0);
  });

  it("routes stacked nodes through the gap between them", () => {
    const a = node("a", "rect", 0, 0);
    const b = node("b", "rect", 30, 200);
    const route = orthogonalRoute(a, b);
    expect(route[1].y).toBeCloseTo(100, 6);
    const g = edgeGeometry(a, b, "orthogonal")!;
    expect(g.headAngle).toBeCloseTo(Math.PI / 2, 6);
  });

  it("curves between ellipses, meeting both boundaries, head along the tangent", () => {
    const a = node("a", "ellipse", 0, 0, 140, 70);
    const b = node("b", "ellipse", 320, 140, 140, 70);
    const g = edgeGeometry(a, b, "curve")!;
    expect(g.style).toBe("curve");
    expect(g.d.startsWith("M")).toBe(true);
    expect(g.d).toContain("C");
    expectOnBoundary(a, g.start);
    expectOnBoundary(b, g.end);
    // The head follows the last bit of the curve.
    const before = g.points[g.points.length - 2];
    const tangent = Math.atan2(g.end.y - before.y, g.end.x - before.x);
    expect(Math.abs(g.headAngle - tangent)).toBeLessThan(0.25);
    // An S-curve from a horizontal run arrives horizontally.
    expect(Math.abs(g.headAngle)).toBeLessThan(0.6);
  });

  it("falls back to a straight arrow when a curve cannot clear the nodes", () => {
    const a = node("a", "rect", 0, 0, 100, 100);
    const b = node("b", "rect", 60, 0, 100, 100);
    const g = edgeGeometry(a, b, "curve")!;
    expect(g.style).toBe("straight");
  });
});

describe("arrowHeadPoints", () => {
  it("puts the tip first and the base behind it", () => {
    const [tip, l, r] = arrowHeadPoints({ x: 10, y: 10 }, 0, 10, 4);
    expect(tip).toEqual({ x: 10, y: 10 });
    expect(l.x).toBeCloseTo(0, 6);
    expect(r.x).toBeCloseTo(0, 6);
    expect(Math.abs(l.y - r.y)).toBeCloseTo(8, 6);
  });

  it("turns with the angle", () => {
    const [tip, l] = arrowHeadPoints({ x: 0, y: 0 }, Math.PI / 2, 10, 4); // pointing down
    expect(tip).toEqual({ x: 0, y: 0 });
    expect(l.y).toBeCloseTo(-10, 6);
  });
});

describe("connectEdges / reattachEdge", () => {
  const edges: DiagramEdge[] = [
    { from: "a", to: "b", label: "yes" },
    { from: "b", to: "c" },
  ];
  const make = (from: string, to: string): DiagramEdge => ({ from, to });

  it("adds an arrow once", () => {
    const next = connectEdges(edges, "a", "c", make)!;
    expect(next).toHaveLength(3);
    expect(connectEdges(next, "a", "c", make)).toBeNull();
    expect(connectEdges(edges, "a", "a", make)).toBeNull();
  });

  it("honours a connection rule", () => {
    expect(connectEdges(edges, "a", "c", make, () => false)).toBeNull();
  });

  it("moves an end, keeping the label", () => {
    const next = reattachEdge(edges, { from: "a", to: "b" }, "to", "c")!;
    expect(next[0]).toEqual({ from: "a", to: "c", label: "yes" });
    const tail = reattachEdge(edges, { from: "b", to: "c" }, "from", "a")!;
    expect(tail[1]).toEqual({ from: "a", to: "c" });
  });

  it("merges into an arrow that already joins the new pair", () => {
    const withTwin: DiagramEdge[] = [...edges, { from: "a", to: "c" }];
    const next = reattachEdge(withTwin, { from: "a", to: "b" }, "to", "c")!;
    expect(next).toHaveLength(2);
    expect(next.find((e) => e.from === "a" && e.to === "c")?.label).toBe("yes");
  });

  it("does nothing for a no-op or a drop on the other end", () => {
    expect(reattachEdge(edges, { from: "a", to: "b" }, "to", "b")).toBeNull();
    expect(reattachEdge(edges, { from: "a", to: "b" }, "to", "a")).toBeNull();
    expect(reattachEdge(edges, { from: "x", to: "y" }, "to", "a")).toBeNull();
  });
});
