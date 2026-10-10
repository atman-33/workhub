import { describe, expect, it } from "vitest";
import {
  edgeGeometry,
  freeRoute,
  nodeContains,
  startHeadAngle,
  type DiagramNode,
  type Point,
  type Segment,
} from "./node-edge";
import type { Box } from "./sticky-layout";

const r2 = (n: number) => Math.round(n * 100) / 100;

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

const node = (id: string, x: number, y: number, width = 100, height = 40): DiagramNode => ({
  id,
  shape: "rect",
  x,
  y,
  width,
  height,
});

/** Routes every arrow the way the architecture diagram will, through `freeRoute`. */
function chart(nodes: DiagramNode[], edges: [string, string][]) {
  const used: Segment[] = [];
  const routes: Record<string, [number, number][]> = {};
  const geometries = new Map<string, NonNullable<ReturnType<typeof edgeGeometry>>>();
  for (const [from, to] of edges) {
    const a = nodes.find((n) => n.id === from)!;
    const b = nodes.find((n) => n.id === to)!;
    const geo = edgeGeometry(a, b, "orthogonal", {
      flow: "free",
      obstacles: nodes.filter((n) => n !== a && n !== b),
      used,
    })!;
    geo.points.slice(1).forEach((q, i) => used.push({ a: geo.points[i], b: q }));
    geometries.set(`${from}->${to}`, geo);
    routes[`${from}->${to}`] = geo.points.map((p: Point) => [r2(p.x), r2(p.y)]);
  }
  return { routes, geometries };
}

/** An arrow end is on the outline when a hair toward the line is out and a hair back into the node is in. */
function expectOnOutline(n: DiagramNode, p: Point, along: Point) {
  const len = Math.hypot(along.x - p.x, along.y - p.y);
  const ux = (along.x - p.x) / len;
  const uy = (along.y - p.y) / len;
  expect(nodeContains(n, { x: p.x + ux * 0.05, y: p.y + uy * 0.05 })).toBe(false);
  expect(nodeContains(n, { x: p.x - ux * 0.05, y: p.y - uy * 0.05 })).toBe(true);
}

/** Every segment of every route is horizontal or vertical, and no route runs
 * through a box it is not joined to. */
function expectCleanRoutes(
  c: ReturnType<typeof chart>,
  nodes: DiagramNode[],
  edges: [string, string][],
) {
  for (const [from, to] of edges) {
    const geo = c.geometries.get(`${from}->${to}`)!;
    geo.points.slice(1).forEach((q, i) => {
      const p = geo.points[i];
      expect(p.x === q.x || p.y === q.y, `${from}->${to} has a slant`).toBe(true);
    });
    for (const n of nodes) {
      if (n.id === from || n.id === to) continue;
      for (let i = 1; i < geo.points.length; i++) {
        const a = geo.points[i - 1];
        const b = geo.points[i];
        const hit =
          Math.max(a.x, b.x) > n.x + 1 &&
          Math.min(a.x, b.x) < n.x + n.width - 1 &&
          Math.max(a.y, b.y) > n.y + 1 &&
          Math.min(a.y, b.y) < n.y + n.height - 1;
        expect(hit, `${from}->${to} runs through ${n.id}`).toBe(false);
      }
    }
  }
}

describe("freeRoute golden routes", () => {
  it("right: straight across when level, through the middle of the gap otherwise", () => {
    const nodes = [node("a", 0, 0), node("b", 200, 0)];
    const c = chart(nodes, [["a", "b"]]);
    expect(c.routes).toEqual({ "a->b": [[100, 20], [200, 20]] });
    expectOnOutline(nodes[0], { x: 100, y: 20 }, { x: 200, y: 20 });
    expectOnOutline(nodes[1], { x: 200, y: 20 }, { x: 100, y: 20 });
  });

  it("left: a request answers to the left without going around", () => {
    const nodes = [node("a", 200, 0), node("b", 0, 0)];
    const c = chart(nodes, [["a", "b"]]);
    expect(c.routes).toEqual({ "a->b": [[200, 20], [100, 20]] });
  });

  it("down: a database below its process takes a straight drop", () => {
    const nodes = [node("a", 0, 0), node("b", 0, 200)];
    const c = chart(nodes, [["a", "b"]]);
    expect(c.routes).toEqual({ "a->b": [[50, 40], [50, 200]] });
  });

  it("diagonal: the axis the centres differ more along goes first", () => {
    const nodes = [node("a", 0, 0), node("b", 300, 200)];
    const c = chart(nodes, [["a", "b"]]);
    // Across first (300 > 200): out the right side, down the middle of the gap.
    expect(c.routes).toEqual({ "a->b": [[100, 20], [200, 20], [200, 220], [300, 220]] });
    expectCleanRoutes(c, nodes, [["a", "b"]]);
  });

  it("diagonal the tall way: up and down goes first", () => {
    const nodes = [node("a", 0, 200), node("b", 100, 0)];
    const c = chart(nodes, [["a", "b"]]);
    // 200 down the page beats 100 across: out the top, across the gap above.
    expect(c.routes).toEqual({ "a->b": [[50, 200], [50, 120], [150, 120], [150, 40]] });
    expectCleanRoutes(c, nodes, [["a", "b"]]);
  });

  it("blocked: a box in the way sends the arrow around the outside", () => {
    const nodes = [node("a", 0, 0), node("m", 150, -20, 60, 80), node("b", 300, 0)];
    const c = chart(nodes, [["a", "b"]]);
    // Every line through the gap hits m; the first free band is below both.
    expect(c.routes).toEqual({ "a->b": [[50, 40], [50, 68], [350, 68], [350, 40]] });
    expectCleanRoutes(c, nodes, [["a", "b"]]);
  });

  it("head-on pair: the return runs a lane aside, not on top", () => {
    const nodes = [node("a", 0, 0), node("b", 200, 0)];
    const c = chart(nodes, [
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(c.routes["a->b"]).toEqual([[100, 20], [200, 20]]);
    expect(c.routes["b->a"]).toEqual([[250, 40], [250, 32], [50, 32], [50, 40]]);
  });

  it("bidirectional: both heads from the same points", () => {
    const forward = [
      { x: 100, y: 20 },
      { x: 200, y: 20 },
    ];
    // The start head looks back down the line it came on.
    expect(startHeadAngle(forward)).toBeCloseTo(Math.PI, 10);
    expect(startHeadAngle([...forward].reverse())).toBeCloseTo(0, 10);
  });
});

describe("freeRoute leaves the old flows alone", () => {
  it("flow right and down never reach freeRoute", () => {
    const nodes = [node("a", 200, 0), node("b", 0, 0)];
    const right = edgeGeometry(nodes[0], nodes[1], "orthogonal", {})!;
    // The old leftward loop: under both nodes, not a straight line back.
    expect(right.points.length).toBeGreaterThan(2);
    const free = edgeGeometry(nodes[0], nodes[1], "orthogonal", { flow: "free" })!;
    expect(free.points).toHaveLength(2);
  });

  it("freeRoute with no gap anywhere still returns a route", () => {
    const route = freeRoute(box(0, 0, 100, 40), box(50, 10, 100, 40));
    expect(route.length).toBeGreaterThanOrEqual(2);
  });
});
