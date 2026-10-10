import { describe, expect, it } from "vitest";
import { rankColumnLayout } from "./graph-layout";
import {
  boundaryPoint,
  centerOf,
  edgeGeometry,
  nodeContains,
  orthogonalRoute,
  verticalRoute,
  type DiagramNode,
  type Point,
  type Segment,
} from "./node-edge";

type Spec = {
  /** id, shape, width, height */
  nodes: [string, string, number, number][];
  edges: [string, string][];
};

const terminal = (id: string): Spec["nodes"][number] => [id, "pill", 100, 40];
const process = (id: string): Spec["nodes"][number] => [id, "rect", 100, 40];
const decision = (id: string): Spec["nodes"][number] => [id, "diamond", 120, 80];
const io = (id: string): Spec["nodes"][number] => [id, "parallelogram", 120, 40];
const sub = (id: string): Spec["nodes"][number] => [id, "subroutine", 120, 40];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Lays a chart out and routes every arrow the way the program flow will. */
function chart(spec: Spec) {
  const layout = rankColumnLayout(
    spec.nodes.map(([id, , width, height]) => ({ id, width, height })),
    spec.edges.map(([from, to]) => ({ from, to })),
  );
  const nodes: DiagramNode[] = spec.nodes.map(([id, shape, width, height]) => {
    const p = layout.nodes.get(id)!;
    return { id, shape, width, height, x: p.cx - width / 2, y: p.cy - height / 2 };
  });
  const used: Segment[] = [];
  const geometries = new Map<string, NonNullable<ReturnType<typeof edgeGeometry>>>();
  const routes: Record<string, [number, number][]> = {};
  for (const [from, to] of spec.edges) {
    const a = nodes.find((n) => n.id === from)!;
    const b = nodes.find((n) => n.id === to)!;
    const geo = edgeGeometry(a, b, "orthogonal", {
      flow: "down",
      obstacles: nodes.filter((n) => n !== a && n !== b),
      used,
    })!;
    geo.points.slice(1).forEach((q, i) => used.push({ a: geo.points[i], b: q }));
    geometries.set(`${from}->${to}`, geo);
    routes[`${from}->${to}`] = geo.points.map((p: Point) => [r2(p.x), r2(p.y)]);
  }
  const centres = Object.fromEntries(
    [...layout.nodes].map(([id, p]) => [id, [r2(p.cx), r2(p.cy)]]),
  );
  return { nodes, centres, routes, geometries };
}

/** An arrow end is on the outline when a hair toward the line is out and a hair back into the node is in. */
function expectOnOutline(n: DiagramNode, p: Point, along: Point) {
  const len = Math.hypot(along.x - p.x, along.y - p.y);
  const ux = (along.x - p.x) / len;
  const uy = (along.y - p.y) / len;
  expect(nodeContains(n, { x: p.x + ux * 0.05, y: p.y + uy * 0.05 })).toBe(false);
  expect(nodeContains(n, { x: p.x - ux * 0.05, y: p.y - uy * 0.05 })).toBe(true);
}

const rounded = (points: Point[]) => points.map((p) => ({ x: r2(p.x), y: r2(p.y) }));

/** Every segment of every route is horizontal or vertical, and no route runs through a box it is not joined to. */
function expectCleanRoutes(c: ReturnType<typeof chart>, edges: [string, string][]) {
  for (const [from, to] of edges) {
    const geo = c.geometries.get(`${from}->${to}`)!;
    geo.points.slice(1).forEach((q, i) => {
      const p = geo.points[i];
      expect(p.x === q.x || p.y === q.y).toBe(true);
    });
    for (const n of c.nodes) {
      if (n.id === from || n.id === to) continue;
      for (let i = 1; i < geo.points.length; i++) {
        const a = geo.points[i - 1];
        const b = geo.points[i];
        const hit =
          Math.max(a.x, b.x) > n.x &&
          Math.min(a.x, b.x) < n.x + n.width &&
          Math.max(a.y, b.y) > n.y &&
          Math.min(a.y, b.y) < n.y + n.height;
        expect(hit, `${from}->${to} runs through ${n.id}`).toBe(false);
      }
    }
  }
}

describe("program flow golden charts", () => {
  it("branch: the first exit drops from the bottom vertex, the second leaves the right vertex and drops into the top", () => {
    const spec: Spec = {
      nodes: [terminal("s"), decision("d"), process("y"), process("n")],
      edges: [["s", "d"], ["d", "y"], ["d", "n"]],
    };
    const c = chart(spec);
    expect(c.centres).toEqual({ s: [60, 20], d: [60, 128], y: [60, 236], n: [242, 236] });
    expect(c.routes).toEqual({
      "s->d": [[60, 40], [60, 88]],
      "d->y": [[60, 168], [60, 216]],
      "d->n": [[120, 128], [242, 128], [242, 216]],
    });
    expectCleanRoutes(c, spec.edges);
  });

  it("merge: the side branch comes back to the main line through the gap above the merge", () => {
    const spec: Spec = {
      nodes: [terminal("s"), decision("d"), process("y"), process("n"), process("m"), terminal("e")],
      edges: [["s", "d"], ["d", "y"], ["d", "n"], ["y", "m"], ["n", "m"], ["m", "e"]],
    };
    const c = chart(spec);
    expect(c.centres).toEqual({
      s: [60, 20],
      d: [60, 128],
      y: [60, 236],
      n: [242, 236],
      m: [60, 324],
      e: [60, 412],
    });
    expect(c.routes).toEqual({
      "s->d": [[60, 40], [60, 88]],
      "d->y": [[60, 168], [60, 216]],
      "d->n": [[120, 128], [242, 128], [242, 216]],
      "y->m": [[60, 256], [60, 304]],
      "n->m": [[242, 256], [242, 280], [60, 280], [60, 304]],
      "m->e": [[60, 344], [60, 392]],
    });
    expectCleanRoutes(c, spec.edges);
  });

  it("loop: the back edge leaves the right side, runs up outside everything and enters the right side", () => {
    const spec: Spec = {
      nodes: [terminal("s"), process("a"), decision("d"), process("w"), terminal("e")],
      edges: [["s", "a"], ["a", "d"], ["d", "e"], ["d", "w"], ["w", "a"]],
    };
    const c = chart(spec);
    expect(c.centres).toEqual({
      s: [60, 20],
      a: [60, 108],
      d: [60, 216],
      w: [242, 324],
      e: [60, 324],
    });
    expect(c.routes).toEqual({
      "s->a": [[60, 40], [60, 88]],
      "a->d": [[60, 128], [60, 176]],
      "d->e": [[60, 256], [60, 304]],
      "d->w": [[120, 216], [242, 216], [242, 304]],
      // out of w's right side (292), 28 beyond the rightmost box, up to a's row, left into a's right side (110)
      "w->a": [[292, 324], [320, 324], [320, 108], [110, 108]],
    });
    expectCleanRoutes(c, spec.edges);
    // the head points left into the box
    expect(c.geometries.get("w->a")!.headAngle).toBeCloseTo(Math.PI, 6);
  });

  it("skip: an arrow past the main line goes round its right side", () => {
    const spec: Spec = {
      nodes: [terminal("s"), decision("d"), process("a"), process("b"), terminal("e")],
      edges: [["s", "d"], ["d", "a"], ["a", "b"], ["b", "e"], ["d", "b"]],
    };
    const c = chart(spec);
    expect(c.routes["d->b"]).toEqual([[120, 128], [148, 128], [148, 324], [110, 324]]);
    expect(c.routes["d->a"]).toEqual([[60, 168], [60, 216]]);
    expect(c.routes["a->b"]).toEqual([[60, 256], [60, 304]]);
    expectCleanRoutes(c, spec.edges);
  });

  it("three-way branch: down, right and left, merging below", () => {
    const spec: Spec = {
      nodes: [terminal("s"), decision("d"), process("a"), process("b"), process("c"), terminal("e")],
      edges: [["s", "d"], ["d", "a"], ["d", "b"], ["d", "c"], ["a", "e"], ["b", "e"], ["c", "e"]],
    };
    const c = chart(spec);
    expect(c.centres).toEqual({
      s: [232, 20],
      d: [232, 128],
      a: [232, 236],
      b: [414, 236],
      c: [50, 236],
      e: [232, 324],
    });
    expect(c.routes).toEqual({
      "s->d": [[232, 40], [232, 88]],
      "d->a": [[232, 168], [232, 216]],
      "d->b": [[292, 128], [414, 128], [414, 216]],
      "d->c": [[172, 128], [50, 128], [50, 216]],
      "a->e": [[232, 256], [232, 304]],
      "b->e": [[414, 256], [414, 280], [232, 280], [232, 304]],
      "c->e": [[50, 256], [50, 280], [232, 280], [232, 304]],
    });
    expectCleanRoutes(c, spec.edges);
  });

  it("puts every arrow end on the outline of the shape it meets, input/output and subroutine included", () => {
    const spec: Spec = {
      nodes: [terminal("s"), io("i"), decision("d"), sub("p"), io("o"), process("w"), terminal("e")],
      edges: [
        ["s", "i"],
        ["i", "d"],
        ["d", "p"],
        ["d", "w"],
        ["p", "o"],
        ["w", "i"],
        ["o", "e"],
        ["d", "o"],
      ],
    };
    const c = chart(spec);
    expectCleanRoutes(c, spec.edges);
    for (const [from, to] of spec.edges) {
      const geo = c.geometries.get(`${from}->${to}`)!;
      const a = c.nodes.find((n) => n.id === from)!;
      const b = c.nodes.find((n) => n.id === to)!;
      expectOnOutline(a, geo.start, geo.points[1]);
      expectOnOutline(b, geo.end, geo.points[geo.points.length - 2]);
    }
  });
});

describe("verticalRoute", () => {
  const box = (cx: number, cy: number, width = 100, height = 40) => ({
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
  });

  it("is a straight drop for the same column", () => {
    expect(verticalRoute(box(50, 20), box(50, 108))).toEqual([
      { x: 50, y: 20 },
      { x: 50, y: 108 },
    ]);
  });

  it("is an L into the top for another column, or a Z when the L would cross a box", () => {
    expect(verticalRoute(box(50, 20), box(250, 108))).toEqual([
      { x: 50, y: 20 },
      { x: 250, y: 20 },
      { x: 250, y: 108 },
    ]);
    const blocker = box(150, 20, 40, 20);
    expect(verticalRoute(box(50, 20), box(250, 108), { obstacles: [blocker] })).toEqual([
      { x: 50, y: 20 },
      { x: 50, y: 64 },
      { x: 250, y: 64 },
      { x: 250, y: 108 },
    ]);
  });

  it("goes round the right side for a skip and for a return arrow", () => {
    const wall = box(50, 108);
    expect(verticalRoute(box(50, 20), box(50, 196), { obstacles: [wall] })).toEqual([
      { x: 50, y: 20 },
      { x: 128, y: 20 },
      { x: 128, y: 196 },
      { x: 50, y: 196 },
    ]);
    expect(verticalRoute(box(50, 196), box(50, 20))).toEqual([
      { x: 50, y: 196 },
      { x: 128, y: 196 },
      { x: 128, y: 20 },
      { x: 50, y: 20 },
    ]);
  });

  it("moves the lane out when another arrow already runs on it", () => {
    const used: Segment[] = [{ a: { x: 128, y: 0 }, b: { x: 128, y: 300 } }];
    const route = verticalRoute(box(50, 196), box(50, 20), { used });
    expect(route[1].x).toBe(140);
  });

  it("falls back to the horizontal router for boxes side by side", () => {
    const a = box(50, 20);
    const b = box(250, 30);
    expect(verticalRoute(a, b)).toEqual(orthogonalRoute(a, b));
  });
});

describe("EdgeOptions.flow and labelOffset", () => {
  const a: DiagramNode = { id: "a", shape: "rect", x: 0, y: 0, width: 100, height: 40 };
  const b: DiagramNode = { id: "b", shape: "rect", x: 200, y: 100, width: 100, height: 40 };

  it("keeps today's route when flow is absent or right", () => {
    const base = edgeGeometry(a, b, "orthogonal");
    expect(edgeGeometry(a, b, "orthogonal", { flow: "right" })).toEqual(base);
    // out of the right side, down the gap, into the left side
    expect(rounded(base!.points)).toEqual([
      { x: 100, y: 20 },
      { x: 150, y: 20 },
      { x: 150, y: 120 },
      { x: 200, y: 120 },
    ]);
  });

  it("routes downward when asked", () => {
    const geo = edgeGeometry(a, b, "orthogonal", { flow: "down" })!;
    expect(rounded(geo.points)).toEqual([
      { x: 100, y: 20 },
      { x: 250, y: 20 },
      { x: 250, y: 100 },
    ]);
    expect(geo.headAngle).toBeCloseTo(Math.PI / 2, 6);
  });

  it("does not change straight or curved arrows", () => {
    for (const style of ["straight", "curve"] as const) {
      expect(edgeGeometry(a, b, style, { flow: "down" })).toEqual(edgeGeometry(a, b, style));
    }
  });

  it("puts the label a fixed way along the first segment, held inside it", () => {
    const geo = edgeGeometry(a, b, "orthogonal", { flow: "down", labelOffset: 24 })!;
    expect(rounded([geo.mid])).toEqual([{ x: 124, y: 20 }]);
    const held = edgeGeometry(a, b, "orthogonal", { flow: "down", labelOffset: 9999 })!.mid;
    expect(rounded([held])).toEqual([{ x: 250, y: 20 }]);
    // the default is still the middle of the line
    const middle = edgeGeometry(a, b, "orthogonal", { flow: "down" })!.mid;
    expect(rounded([middle])).toEqual([{ x: 215, y: 20 }]);
  });

  it("agrees with boundaryPoint for the ends", () => {
    const geo = edgeGeometry(a, b, "orthogonal", { flow: "down" })!;
    expect(geo.start).toEqual(boundaryPoint(a, { x: 250, y: 20 }));
    expect(geo.end).toEqual(boundaryPoint(b, { x: 250, y: 20 }));
    expect(centerOf(b).x).toBe(250);
  });
});
