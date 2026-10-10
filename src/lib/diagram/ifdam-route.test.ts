import { describe, expect, it } from "vitest";
import { layerLayout } from "./graph-layout";
import {
  centerOf,
  edgeGeometry,
  nodeContains,
  type DiagramNode,
  type Point,
  type Segment,
} from "./node-edge";

/**
 * T-0702: the pieces the IFDAM figure is made of (screen, trigger, process,
 * data store) laid out with `layerLayout` + `ranks` and routed with the
 * existing `orthogonalRoute`. `node-edge` is not changed for this; these tests
 * pin that it already does what the figure needs.
 */

type Spec = {
  /** id, shape, width, height, row */
  nodes: [string, string, number, number, "main" | "store"][];
  edges: [string, string][];
};

const SCREEN = (id: string): Spec["nodes"][number] => [id, "screen", 200, 110, "main"];
const TRIGGER = (id: string): Spec["nodes"][number] => [id, "hexagon", 120, 40, "main"];
const PROCESS = (id: string): Spec["nodes"][number] => [id, "ellipse", 130, 60, "main"];
const STORE = (id: string): Spec["nodes"][number] => [id, "cylinder", 110, 56, "store"];

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lays a figure out the way T-0703 will: arrows touching a store are left out
 * of the ranking, and each store takes the column of the first non-store it is
 * connected to.
 */
function figure(spec: Spec) {
  const isStore = new Set(spec.nodes.filter((n) => n[4] === "store").map((n) => n[0]));
  const flowEdges = spec.edges.filter(([a, b]) => !isStore.has(a) && !isStore.has(b));
  const first = layerLayout(
    spec.nodes.map(([id, , width, height, row]) => ({ id, width, height, row })),
    flowEdges.map(([from, to]) => ({ from, to })),
    { rows: ["main", "store"] },
  );
  const ranks = new Map<string, number>();
  // a store takes the column of the first node it is joined to (a store joined only to
  // another store follows that store once it has one)
  for (let pass = 0; pass < isStore.size + 1; pass++) {
    for (const id of isStore) {
      if (ranks.has(id)) continue;
      for (const [x, y] of spec.edges) {
        const other = x === id ? y : y === id ? x : null;
        if (other === null) continue;
        const r = isStore.has(other) ? ranks.get(other) : first.rank.get(other);
        if (r !== undefined) {
          ranks.set(id, r);
          break;
        }
      }
    }
  }
  const layout = layerLayout(
    spec.nodes.map(([id, , width, height, row]) => ({ id, width, height, row })),
    flowEdges.map(([from, to]) => ({ from, to })),
    { rows: ["main", "store"], ranks },
  );
  const nodes: DiagramNode[] = spec.nodes.map(([id, shape, width, height]) => {
    const p = layout.nodes.get(id)!;
    return { id, shape, width, height, x: p.cx - width / 2, y: p.cy - height / 2 };
  });
  const used: Segment[] = [];
  const routes = new Map<string, Point[]>();
  spec.edges.forEach(([from, to], i) => {
    const a = nodes.find((n) => n.id === from)!;
    const b = nodes.find((n) => n.id === to)!;
    const geo = edgeGeometry(a, b, "orthogonal", {
      obstacles: nodes.filter((n) => n !== a && n !== b),
      used,
    })!;
    geo.points.slice(1).forEach((q, j) => used.push({ a: geo.points[j], b: q }));
    routes.set(`${i}:${from}>${to}`, geo.points);
  });
  return { layout, nodes, routes, spec };
}

const node = (f: ReturnType<typeof figure>, id: string) => f.nodes.find((n) => n.id === id)!;
const route = (f: ReturnType<typeof figure>, from: string, to: string) => {
  const key = [...f.routes.keys()].find((k) => k.endsWith(`:${from}>${to}`))!;
  return f.routes.get(key)!;
};
const pts = (p: Point[]) => p.map((q) => [r2(q.x), r2(q.y)]);

function segmentCrossesBox(a: Point, b: Point, n: DiagramNode): boolean {
  const steps = 40;
  for (let i = 1; i < steps; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    if (nodeContains(n, p)) return true;
  }
  return false;
}

/** Every segment is horizontal or vertical and none enters a node it neither starts nor ends at. */
function expectClean(f: ReturnType<typeof figure>) {
  f.spec.edges.forEach(([from, to], i) => {
    const points = f.routes.get(`${i}:${from}>${to}`)!;
    points.slice(1).forEach((q, j) => {
      const p = points[j];
      expect(p.x === q.x || p.y === q.y, `${from}>${to} segment ${j} is axis aligned`).toBe(true);
      for (const n of f.nodes) {
        if (n.id === from || n.id === to) continue;
        expect(segmentCrossesBox(p, q, n), `${from}>${to} passes through ${n.id}`).toBe(false);
      }
    });
  });
}

/** The arrow's two ends sit on the outlines of the nodes it joins. */
function expectEndsOnOutline(f: ReturnType<typeof figure>) {
  f.spec.edges.forEach(([from, to], i) => {
    const points = f.routes.get(`${i}:${from}>${to}`)!;
    const a = f.nodes.find((n) => n.id === from)!;
    const b = f.nodes.find((n) => n.id === to)!;
    for (const [n, end, inner] of [
      [a, points[0], points[1]],
      [b, points[points.length - 1], points[points.length - 2]],
    ] as const) {
      // a hair along the arrow, towards the node, is inside; away from it, outside
      const len = Math.hypot(inner.x - end.x, inner.y - end.y);
      const ux = (inner.x - end.x) / len;
      const uy = (inner.y - end.y) / len;
      expect(nodeContains(n, { x: end.x - ux * 0.05, y: end.y - uy * 0.05 })).toBe(true);
      expect(nodeContains(n, { x: end.x + ux * 0.05, y: end.y + uy * 0.05 })).toBe(false);
    }
  });
}

describe("IFDAM figure: two rows, store under its process (golden)", () => {
  const f = figure({
    nodes: [SCREEN("list"), TRIGGER("add"), PROCESS("save"), STORE("todos")],
    edges: [
      ["list", "add"],
      ["add", "save"],
      ["save", "todos"],
      ["todos", "save"],
    ],
  });

  it("puts the store in the process's column, in the lower row", () => {
    const save = f.layout.nodes.get("save")!;
    const todos = f.layout.nodes.get("todos")!;
    expect(todos.rank).toBe(save.rank);
    expect(todos.cx).toBe(save.cx);
    expect(todos.row).toBe("store");
    expect(todos.cy).toBeGreaterThan(save.cy);
    expect(f.layout.rows.map((r) => r.key)).toEqual(["main", "store"]);
    // main row is as tall as the screen; the store row starts where it ends
    expect(f.layout.rows[0].height).toBe(150);
    expect(f.layout.rows[1].y).toBe(150);
  });

  it("has the store and the process on one vertical line", () => {
    expect(node(f, "todos").x + node(f, "todos").width / 2).toBe(node(f, "save").x + node(f, "save").width / 2);
  });

  it("is clean and ends on the outlines", () => {
    expectClean(f);
    expectEndsOnOutline(f);
  });
});

describe("IFDAM figure: write and read on one line", () => {
  const f = figure({
    nodes: [SCREEN("list"), TRIGGER("add"), PROCESS("save"), STORE("todos")],
    edges: [
      ["list", "add"],
      ["add", "save"],
      ["save", "todos"],
      ["todos", "save"],
    ],
  });

  it("draws a write and a read between the same two nodes as one straight vertical line", () => {
    const write = route(f, "save", "todos");
    const read = route(f, "todos", "save");
    expect(write).toHaveLength(2);
    expect(read).toHaveLength(2);
    expect(write[0].x).toBe(write[1].x);
    // same line, opposite directions: the two arrows overlap into one with a head at each end
    expect(pts(read)).toEqual(pts([...write].reverse()));
    const save = node(f, "save");
    const todos = node(f, "todos");
    expect(r2(write[0].y)).toBe(r2(save.y + save.height)); // bottom of the ellipse
    expect(r2(write[1].y)).toBe(r2(todos.y)); // apex of the lid
  });

  it("ends the arrows on the cylinder's lid, apex included", () => {
    const write = route(f, "save", "todos");
    const todos = node(f, "todos");
    expect(r2(write[1].y)).toBe(r2(todos.y));
    expect(nodeContains(todos, { x: write[1].x, y: write[1].y + 0.05 })).toBe(true);
    expect(nodeContains(todos, { x: write[1].x, y: write[1].y - 0.05 })).toBe(false);
  });
});

describe("IFDAM figure: a loop goes under", () => {
  const f = figure({
    nodes: [SCREEN("list"), TRIGGER("add"), PROCESS("save"), STORE("todos")],
    edges: [
      ["list", "add"],
      ["add", "save"],
      ["save", "todos"],
      ["todos", "save"],
      ["save", "list"], // back to the first screen
    ],
  });

  it("is a loop for the ranking, so the screen stays first", () => {
    expect(f.layout.rank.get("list")).toBe(0);
    expect(f.layout.rank.get("save")).toBe(2);
    // flow arrows only (the store arrows are left out): list>add, add>save, save>list
    expect(f.layout.back).toEqual([false, false, true]);
  });

  it("runs the return arrow below the main row and into the screen's underside, through no box", () => {
    const loop = route(f, "save", "list");
    const list = node(f, "list");
    const save = node(f, "save");
    const todos = node(f, "todos");
    const lowest = Math.max(...loop.map((p) => p.y));
    expect(lowest).toBeGreaterThan(save.y + save.height);
    // it turns in the gap above the store row: the store is not in its way, so no wider detour
    expect(lowest).toBeLessThan(todos.y);
    const end = loop[loop.length - 1];
    expect(r2(end.y)).toBe(r2(list.y + list.height)); // enters from below
    expectClean(f);
    expectEndsOnOutline(f);
  });
});

describe("IFDAM figure: three boxes in a row", () => {
  const f = figure({
    nodes: [SCREEN("a"), TRIGGER("b"), PROCESS("c")],
    edges: [
      ["a", "b"],
      ["b", "c"],
      ["a", "c"], // skips b
    ],
  });

  it("joins neighbours with a straight line at the shared height", () => {
    const ab = route(f, "a", "b");
    const bc = route(f, "b", "c");
    expect(ab).toHaveLength(2);
    expect(bc).toHaveLength(2);
    expect(ab[0].y).toBe(ab[1].y);
    expect(bc[0].y).toBe(bc[1].y);
    expect(ab[0].y).toBe(bc[0].y);
    expect(r2(ab[0].x)).toBe(r2(node(f, "a").x + node(f, "a").width));
    expect(r2(ab[1].x)).toBe(r2(node(f, "b").x));
  });

  it("ends every arrow on the outlines and keeps neighbours clear of the other boxes", () => {
    expectEndsOnOutline(f);
    for (const [from, to] of [
      ["a", "b"],
      ["b", "c"],
    ]) {
      const points = route(f, from, to);
      for (const n of f.nodes) {
        if (n.id === from || n.id === to) continue;
        points.slice(1).forEach((q, k) => expect(segmentCrossesBox(points[k], q, n)).toBe(false));
      }
    }
  });

  // Known limit of the existing router, left as it is (node-edge is not changed here):
  // with the boxes level, the arrow that skips b has no way round and runs through it.
  // A layout keeps such an arrow clear by pinning a box (@x,y).
  it("runs a skip arrow across the middle box when all three are level (known limit)", () => {
    const ac = route(f, "a", "c");
    expect(segmentCrossesBox(ac[0], ac[ac.length - 1], node(f, "b"))).toBe(true);
    expect(ac.every((p) => p.y === ac[0].y)).toBe(true);
  });

  it("keeps the three on one line and in order", () => {
    const [a, b, c] = ["a", "b", "c"].map((id) => centerOf(node(f, id)));
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
  });
});

describe("IFDAM figure: three boxes stacked in one cell", () => {
  // three stores share the process's column (each touched in turn), stacked in written order
  const f = figure({
    nodes: [PROCESS("p"), STORE("d1"), STORE("d2"), STORE("d3")],
    edges: [
      ["p", "d1"],
      ["d1", "d2"],
      ["d2", "d3"],
    ],
  });

  it("stacks the stores in written order under the process, on one vertical line", () => {
    const ys = ["d1", "d2", "d3"].map((id) => f.layout.nodes.get(id)!.cy);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    const xs = ["p", "d1", "d2", "d3"].map((id) => f.layout.nodes.get(id)!.cx);
    expect(new Set(xs).size).toBe(1);
  });

  it("joins neighbours with a straight drop, ends on the outlines, and crosses no box", () => {
    expectClean(f);
    expectEndsOnOutline(f);
    for (const [from, to] of [
      ["p", "d1"],
      ["d1", "d2"],
      ["d2", "d3"],
    ]) {
      const r = route(f, from, to);
      expect(r).toHaveLength(2);
      expect(r[0].x).toBe(r[1].x);
      expect(r[1].y).toBeGreaterThan(r[0].y);
    }
  });

  it("leaves room between stacked stores for an arrow", () => {
    for (const [upper, lower] of [
      ["d1", "d2"],
      ["d2", "d3"],
    ]) {
      const a = node(f, upper);
      const b = node(f, lower);
      expect(b.y - (a.y + a.height)).toBeGreaterThanOrEqual(16);
    }
  });

  // Known limit, as above: an arrow to a store behind another one in the column is the straight
  // line through the nearer store (the stacked case returns the direct line without a cost check).
  it("runs an arrow past a nearer store in the same column straight through it (known limit)", () => {
    const g = figure({
      nodes: [PROCESS("p"), STORE("d1"), STORE("d2")],
      edges: [
        ["p", "d1"],
        ["p", "d2"],
      ],
    });
    const r = route(g, "p", "d2");
    expect(r).toHaveLength(2);
    expect(segmentCrossesBox(r[0], r[1], node(g, "d1"))).toBe(true);
  });
});
