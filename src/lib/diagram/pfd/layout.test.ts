import { describe, expect, it } from "vitest";
import {
  arrowHeadPoints,
  boundaryPoint,
  centerOf,
  edgeGeometry,
  nodeContains,
  type DiagramNode,
  type Point,
} from "../node-edge";
import { documentBottom, shapeOf } from "../shapes";
import { LINE_HEIGHT, textWidth } from "../text";
import { layoutPfd, NODE_FONT_SIZE, nodeTextY } from "./layout";
import { addNode, autoAlign, connect, deleteNode, moveNodeTo, reattach } from "./ops";
import { parsePfd } from "./parse";

const doc = parsePfd(`---
type: pfd
title: t
---

## Nodes

- P-001 要件を整理する
- D-001 要件定義書
- P-002 設計する
- D-002 設計書
- P-003 離れた作業 @500,-80

## Edges

- P-001 -> D-001
- D-001 -> P-002
- P-002 -> D-002
`);

const node = (shape: string, cx: number, cy: number, width = 140, height = 56): DiagramNode => ({
  id: "n",
  shape,
  x: cx - width / 2,
  y: cy - height / 2,
  width,
  height,
});

function expectOnBoundary(n: DiagramNode, p: Point) {
  const c = centerOf(n);
  const len = Math.hypot(p.x - c.x, p.y - c.y);
  const ux = (p.x - c.x) / len;
  const uy = (p.y - c.y) / len;
  expect(nodeContains(n, { x: c.x + ux * (len - 0.05), y: c.y + uy * (len - 0.05) })).toBe(true);
  expect(nodeContains(n, { x: c.x + ux * (len + 0.05), y: c.y + uy * (len + 0.05) })).toBe(false);
}

describe("boundaryPoint on the PFD shapes", () => {
  it.each(["ellipse", "document"])("stops on the %s outline in every direction", (shape) => {
    for (const size of [
      [140, 56],
      [110, 52],
      [200, 80],
      [96, 140],
    ]) {
      const n = node(shape, 30, -20, size[0], size[1]);
      for (let deg = 0; deg < 360; deg += 5) {
        const rad = (deg * Math.PI) / 180;
        const target = { x: 30 + Math.cos(rad) * 500, y: -20 + Math.sin(rad) * 500 };
        expectOnBoundary(n, boundaryPoint(n, target));
      }
    }
  });

  it("meets the ellipse at its vertices and at the diagonal", () => {
    const n = node("ellipse", 0, 0, 160, 60);
    expect(boundaryPoint(n, { x: 999, y: 0 }).x).toBeCloseTo(80, 3);
    expect(boundaryPoint(n, { x: 0, y: 999 }).y).toBeCloseTo(30, 3);
    // On the diagonal of the ellipse's own bounding box the point satisfies the equation.
    const d = boundaryPoint(n, { x: 80, y: 30 });
    expect((d.x / 80) ** 2 + (d.y / 30) ** 2).toBeCloseTo(1, 4);
  });

  it("meets the wavy bottom of a document where the wave is, not at the box edge", () => {
    const size = { width: 140, height: 60 };
    const n = node("document", 0, 0, size.width, size.height);
    // At three places along the bottom - the dip, the middle, the rise - the
    // shape ends exactly where the drawn wave is.
    for (const dx of [-size.width / 4, 0, size.width / 4]) {
      const bottom = documentBottom(dx, size);
      expect(shapeOf("document").contains(dx, bottom - 0.01, size)).toBe(true);
      expect(shapeOf("document").contains(dx, bottom + 0.01, size)).toBe(false);
    }
    // The wave is real: the dip reaches the bottom of the box, the rise sits well above it.
    expect(documentBottom(-size.width / 4, size)).toBeCloseTo(30, 3);
    expect(documentBottom(size.width / 4, size)).toBeLessThan(30 - 5);
    // The top and the sides are straight.
    expect(boundaryPoint(n, { x: 0, y: -500 }).y).toBeCloseTo(-30, 3);
    expect(boundaryPoint(n, { x: 500, y: -10 }).x).toBeCloseTo(70, 3);
  });

  it("draws the outline the same wave the arrows stop on", () => {
    const size = { width: 140, height: 60 };
    const el = shapeOf("document").outline({ x: -70, y: -30, ...size });
    expect(el.tag).toBe("path");
    const points = [...String(el.attrs.d).matchAll(/L ([-\d.]+) ([-\d.]+)/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    // Every sampled point of the bottom edge is on the line `contains` uses.
    const bottom = points.slice(1);
    expect(bottom.length).toBeGreaterThan(20);
    for (const p of bottom) expect(p.y).toBeCloseTo(documentBottom(p.x, size), 1);
  });

  it("is star-shaped about its centre, so a line crosses the outline once", () => {
    for (const [width, height] of [
      [110, 52],
      [140, 60],
      [200, 90],
      [96, 140],
    ]) {
      const size = { width, height };
      const shape = shapeOf("document");
      for (let deg = 0; deg < 360; deg += 3) {
        const rad = (deg * Math.PI) / 180;
        let wasOut = false;
        for (let r = 0; r < Math.hypot(width, height); r += 0.25) {
          const inside = shape.contains(Math.cos(rad) * r, Math.sin(rad) * r, size);
          if (!inside) wasOut = true;
          else expect(wasOut).toBe(false);
        }
      }
    }
  });
});

describe("curved arrows", () => {
  it("leave and enter on the outlines and head along the curve at the tip", () => {
    const a = { ...node("ellipse", 0, 0, 140, 56), id: "a" };
    for (const [bx, by] of [
      [300, 0],
      [300, 120],
      [260, -140],
      [-260, 90],
      [20, 220],
    ]) {
      const b = { ...node("document", bx, by, 120, 56), id: "b" };
      const g = edgeGeometry(a, b, "curve")!;
      expect(g.style).toBe("curve");
      expectOnBoundary(a, g.start);
      expectOnBoundary(b, g.end);
      // The head points the way the line is going at the tip: the angle of the
      // tip against a point a little before it on the curve.
      const near = g.points[g.points.length - 2];
      const along = Math.atan2(g.end.y - near.y, g.end.x - near.x);
      const diff = Math.abs(Math.atan2(Math.sin(g.headAngle - along), Math.cos(g.headAngle - along)));
      expect(diff).toBeLessThan(0.25);
      // The head's tip is the line's end and its base lies back along the line.
      const [tip, left, right] = arrowHeadPoints(g.end, g.headAngle);
      expect(tip).toEqual(g.end);
      const base = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
      expect(Math.hypot(base.x - near.x, base.y - near.y)).toBeLessThan(
        Math.hypot(g.end.x - near.x, g.end.y - near.y) + 12,
      );
    }
  });

  it("enter a document from below through the ripple", () => {
    const process = { ...node("ellipse", 0, 140, 140, 56), id: "p" };
    const deliverable = { ...node("document", 0, 0, 120, 56), id: "d" };
    const g = edgeGeometry(process, deliverable, "curve")!;
    expectOnBoundary(deliverable, g.end);
    // It arrives from below, so the head points up.
    expect(Math.sin(g.headAngle)).toBeLessThan(-0.9);
    expect(g.end.y).toBeGreaterThan(0);
  });
});

describe("layoutPfd", () => {
  it("places nodes without a position in columns by flow, in a single row", () => {
    const layout = layoutPfd(doc);
    const x = (id: string) => layout.byId.get(id)!.cx;
    expect(x("P-001")).toBeLessThan(x("D-001"));
    expect(x("D-001")).toBeLessThan(x("P-002"));
    expect(x("P-002")).toBeLessThan(x("D-002"));
    // Alone in their columns, they share the row's middle line.
    expect(layout.byId.get("D-001")!.cy).toBe(layout.byId.get("P-002")!.cy);
    expect(layout.byId.get("P-002")!.cy).toBe(layout.byId.get("D-002")!.cy);
    expect(layout.byId.get("P-001")!.placed).toBe(false);
  });

  it("lays out same-kind arrows and loops by flow without hanging", () => {
    const d = parsePfd(`## Nodes

- P-001 a
- P-002 b
- P-003 c
- D-001 d
- D-002 e

## Edges

- P-001 -> P-002
- P-002 -> P-003
- P-003 -> P-001
- D-001 -> D-002
- P-003 -> D-001
`);
    const layout = layoutPfd(d);
    const x = (id: string) => layout.byId.get(id)!.cx;
    expect(layout.edges).toHaveLength(5);
    expect(x("P-001")).toBeLessThan(x("P-002"));
    expect(x("P-002")).toBeLessThan(x("P-003"));
    expect(x("D-001")).toBeLessThan(x("D-002"));
    for (const n of layout.nodes) expect(Number.isFinite(n.cx) && Number.isFinite(n.cy)).toBe(true);
  });

  it("puts a node with @x,y exactly there, negatives included", () => {
    const layout = layoutPfd(doc);
    const far = layout.byId.get("P-003")!;
    expect([far.cx, far.cy, far.placed]).toEqual([500, -80, true]);
    expect(layout.bounds.y).toBeLessThanOrEqual(far.y);
  });

  it("gives every node its shape from the symbol and draws the arrows as curves", () => {
    const layout = layoutPfd(doc);
    expect(layout.byId.get("P-001")!.shape).toBe("ellipse");
    expect(layout.byId.get("D-001")!.shape).toBe("document");
    expect(layout.edges).toHaveLength(3);
    expect(layout.edges.every((e) => e.geometry.style === "curve")).toBe(true);
  });

  it("fits the title inside the ellipse and the document", () => {
    const long = parsePfd(
      [
        "## Nodes",
        "",
        "- P-001 とても長い名前のプロセスをここに書いてみる",
        "- D-001 a long deliverable name that wraps onto lines",
        "",
      ].join("\n"),
    );
    for (const n of layoutPfd(long).nodes) {
      const tw = Math.max(...n.lines.map((l) => textWidth(l, NODE_FONT_SIZE)));
      const th = n.lines.length * NODE_FONT_SIZE * LINE_HEIGHT;
      const mid = (nodeTextY(n, 0) + nodeTextY(n, n.lines.length - 1)) / 2 - NODE_FONT_SIZE * 0.36;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          expect(nodeContains(n, { x: n.cx + (sx * tw) / 2, y: mid + (sy * th) / 2 })).toBe(true);
        }
      }
    }
  });

  it("does not move other nodes when one is placed", () => {
    const before = layoutPfd(doc);
    const after = layoutPfd(moveNodeTo(doc, "D-001", 900, 300));
    for (const id of ["P-001", "P-002", "D-002"]) {
      expect(after.byId.get(id)!.cx).toBe(before.byId.get(id)!.cx);
      expect(after.byId.get(id)!.cy).toBe(before.byId.get(id)!.cy);
    }
    expect(after.byId.get("D-001")!).toMatchObject({ cx: 900, cy: 300, placed: true });
  });

  it("follows a pinned node while it is dragged", () => {
    const layout = layoutPfd(doc, [], { pinned: { id: "D-001", cx: 5, cy: 6 } });
    expect(layout.byId.get("D-001")).toMatchObject({ cx: 5, cy: 6 });
    const e = layout.edges.find((x) => x.key === "P-001->D-001")!;
    expect(e.geometry.end.x).toBeLessThan(120);
  });

  it("places stickies against their node and leaves them out when none are passed", () => {
    const stickies = parsePfd("## Nodes\n\n- P-001 a\n\n## Stickies\n\n- S-001 node:P-001 @40,10 hi\n- S-002 node:P-404 lost\n").stickies;
    const layout = layoutPfd(parsePfd("## Nodes\n\n- P-001 a\n"), stickies);
    expect(layout.stickies.map((s) => s.id)).toEqual(["S-001"]);
    expect(layoutPfd(doc).stickies).toEqual([]);
  });

  it("lays out nothing as an empty box", () => {
    const layout = layoutPfd({ nodes: [], edges: [] });
    expect(layout.nodes).toEqual([]);
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("ops", () => {
  it("adds nodes with the next id of their prefix, placed only when asked", () => {
    const a = addNode(doc, { prefix: "D", title: "新しい書類" });
    expect(a.id).toBe("D-003");
    expect(a.doc.nodes[a.doc.nodes.length - 1]).toEqual({ id: "D-003", title: "新しい書類" });
    const b = addNode(a.doc, { prefix: "P", x: 10.4, y: -3.6 });
    expect(b.id).toBe("P-004");
    expect(b.doc.nodes[b.doc.nodes.length - 1]).toMatchObject({ x: 10, y: -4 });
  });

  it("connects any two different nodes, same kind included, once per pair", () => {
    expect(connect(doc, "P-001", "P-002").edges).toContainEqual({ from: "P-001", to: "P-002" });
    expect(connect(doc, "D-001", "D-002").edges).toContainEqual({ from: "D-001", to: "D-002" });
    expect(connect(doc, "P-001", "D-001")).toBe(doc); // already there
    expect(connect(doc, "P-001", "P-001")).toBe(doc); // not to itself
    expect(connect(doc, "P-001", "X-001")).toBe(doc); // not to an unknown id
    const next = connect(doc, "P-003", "D-001");
    expect(next.edges).toContainEqual({ from: "P-003", to: "D-001" });
    expect(reattach(doc, { from: "P-001", to: "D-001" }, "to", "P-002").edges).toContainEqual({
      from: "P-001",
      to: "P-002",
    });
    expect(
      reattach(doc, { from: "P-001", to: "D-001" }, "to", "D-002").edges,
    ).toContainEqual({ from: "P-001", to: "D-002" });
  });

  it("deleting a node takes its arrows and stickies with it", () => {
    const withSticky = { ...doc, stickies: [{ id: "S-001", targetId: "D-001", dx: 1, dy: 2, text: "x" }] };
    const out = deleteNode(withSticky, "D-001");
    expect(out.nodes.some((n) => n.id === "D-001")).toBe(false);
    expect(out.edges).toEqual([{ from: "P-002", to: "D-002" }]);
    expect(out.stickies).toEqual([]);
  });

  it("auto-align forgets every position", () => {
    expect(autoAlign(doc).nodes.every((n) => n.x === undefined && n.y === undefined)).toBe(true);
    expect(autoAlign(doc).nodes.map((n) => n.title)).toEqual(doc.nodes.map((n) => n.title));
  });
});

describe("edge ports (T-0718)", () => {
  const PORTED = parsePfd(`---
type: pfd
title: t
---

## Nodes

- P-001 A
- D-001 B

## Edges

- P-001:E -> D-001:W

## Stickies
`);

  it("starts and lands a pinned curve exactly on its ports", () => {
    const layout = layoutPfd(PORTED);
    expect(layout.edges).toHaveLength(1);
    const [edge] = layout.edges;
    expect(edge.geometry.style).toBe("curve");
    const from = layout.byId.get("P-001")!;
    const to = layout.byId.get("D-001")!;
    expect([edge.geometry.start.x, edge.geometry.start.y]).toEqual([
      from.x + from.width,
      from.y + from.height / 2,
    ]);
    expect([edge.geometry.end.x, edge.geometry.end.y]).toEqual([
      to.x,
      to.y + to.height / 2,
    ]);
  });
});
