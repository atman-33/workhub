import { describe, expect, it } from "vitest";
import { nodeContains, type DiagramNode, type Point } from "../node-edge";
import { PARALLELOGRAM_SLANT, SUBROUTINE_INSET } from "../shapes";
import { DECISION_LABEL_OFFSET, layoutAlgorithm, measureNode, nodeTextY, ORIGIN } from "./layout";
import { parseAlgorithm } from "./parse";

const EXAMPLE = `---
type: algorithm
title: 注文の在庫引当
---

## Nodes

- A-001 引当開始 ^start
- A-002 注文を読み込む ^io
- A-003 在庫あり? ^decision
- A-004 在庫を引き当てる ^sub task:T-0100
- A-005 入荷を待つ #amber
- A-006 結果を返す ^io
- A-007 終了 ^end

## Edges

- A-001 -> A-002
- A-002 -> A-003
- A-003 -> A-004 "はい"
- A-003 -> A-005 "いいえ"
- A-004 -> A-006
- A-006 -> A-007
- A-005 -> A-002 "入荷後に再試行"
`;

const doc = parseAlgorithm(EXAMPLE);
const layout = layoutAlgorithm(doc);
const at = (id: string) => layout.byId.get(id)!;

describe("measureNode", () => {
  it("sizes a process at least 88 x 40 and wraps a long title at 180", () => {
    const small = measureNode("a", "process");
    expect(small.width).toBe(88);
    expect(small.height).toBe(40);
    const long = measureNode("あ".repeat(40), "process");
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.height).toBeGreaterThan(40);
  });

  it("adds the slant of an input/output and the rules of a predefined process to the text width", () => {
    const title = "a fairly long title for a box";
    const plain = measureNode(title, "process").width;
    expect(measureNode(title, "io").width).toBe(plain + 2 * PARALLELOGRAM_SLANT);
    expect(measureNode(title, "sub").width).toBe(plain + 2 * SUBROUTINE_INSET);
    expect(measureNode(title, "start").width).toBe(plain + 8);
    expect(measureNode(title, "end").width).toBe(plain + 8);
  });

  it("fits a decision's text inside its diamond", () => {
    for (const title of ["在庫あり?", "金額が 1 万円を超えていて、かつ承認済みか?"]) {
      const d = measureNode(title, "decision");
      expect(d.width).toBeGreaterThanOrEqual(120);
      expect(d.height).toBeGreaterThanOrEqual(64);
    }
  });

  it("makes a document taller than a process for the ripple", () => {
    expect(measureNode("書類", "doc").height).toBeGreaterThan(measureNode("書類", "process").height);
  });
});

describe("layoutAlgorithm: automatic placement", () => {
  it("runs the trunk straight down and sends the second exit to the right", () => {
    const x = (id: string) => at(id).cx;
    // start -> io -> decision -> sub -> io -> end is one column.
    for (const id of ["A-002", "A-003", "A-004", "A-006", "A-007"]) expect(x(id)).toBe(x("A-001"));
    expect(at("A-005").cx).toBeGreaterThan(at("A-003").cx);
    const ys = ["A-001", "A-002", "A-003", "A-004", "A-006", "A-007"].map((id) => at(id).cy);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(new Set(ys).size).toBe(ys.length);
    // "いいえ" shares the row of the step it is an alternative to.
    expect(at("A-005").cy).toBe(at("A-004").cy);
  });

  it("starts at the origin and is deterministic", () => {
    expect(Math.min(...layout.nodes.map((n) => n.x))).toBe(ORIGIN);
    expect(Math.min(...layout.nodes.map((n) => n.y))).toBe(ORIGIN);
    expect(JSON.stringify(layoutAlgorithm(doc))).toBe(JSON.stringify(layout));
  });

  it("gives a node its kind's shape", () => {
    expect(layout.nodes.map((n) => [n.id, n.shape])).toEqual([
      ["A-001", "pill"],
      ["A-002", "parallelogram"],
      ["A-003", "diamond"],
      ["A-004", "subroutine"],
      ["A-005", "rect"],
      ["A-006", "parallelogram"],
      ["A-007", "pill"],
    ]);
    expect(at("A-005")).toMatchObject({ color: "amber", placed: false });
    expect(at("A-004")).toMatchObject({ task: "T-0100" });
  });

  it("handles an empty note and a note with no arrows", () => {
    const empty = layoutAlgorithm({ nodes: [], edges: [] });
    expect(empty.nodes).toEqual([]);
    expect(empty.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    const loose = layoutAlgorithm(parseAlgorithm("## Nodes\n\n- A-001 a\n- A-002 b\n"));
    expect(loose.nodes).toHaveLength(2);
  });
});

describe("layoutAlgorithm: @x,y", () => {
  const pinnedDoc = parseAlgorithm(EXAMPLE.replace("- A-006 結果を返す ^io", "- A-006 結果を返す ^io @400,700"));
  const pinned = layoutAlgorithm(pinnedDoc);

  it("puts a node at its absolute centre and leaves every other node where it was", () => {
    expect(pinned.byId.get("A-006")).toMatchObject({ cx: 400, cy: 700, placed: true });
    for (const n of layout.nodes) {
      if (n.id === "A-006") continue;
      expect(pinned.byId.get(n.id)).toMatchObject({ cx: n.cx, cy: n.cy, placed: false });
    }
  });

  it("re-routes the arrows of a moved node to its new spot", () => {
    const into = pinned.edges.find((e) => e.key === "A-004->A-006" || (e.from === "A-004" && e.to === "A-006"))!;
    const last = into.geometry.points[into.geometry.points.length - 1];
    const box = pinned.byId.get("A-006")!;
    expect(Math.abs(last.x - box.cx) < box.width / 2 + 1 && Math.abs(last.y - box.cy) < box.height / 2 + 1).toBe(true);
  });

  it("holds a pinned (dragged) node under the pointer, wherever the file says", () => {
    const dragged = layoutAlgorithm(doc, [], { pinned: { id: "A-005", cx: 10, cy: 20 } });
    expect(dragged.byId.get("A-005")).toMatchObject({ cx: 10, cy: 20, placed: true });
    expect(dragged.byId.get("A-003")).toMatchObject({ cx: at("A-003").cx, cy: at("A-003").cy });
  });
});

describe("layoutAlgorithm: arrows", () => {
  const edgeOf = (from: string, to: string) => layout.edges.find((e) => e.from === from && e.to === to)!;

  it("draws every arrow, orthogonal, from one outline to the other", () => {
    expect(layout.edges).toHaveLength(doc.edges.length);
    for (const e of layout.edges) {
      const pts = e.geometry.points;
      pts.slice(1).forEach((q, i) => expect(pts[i].x === q.x || pts[i].y === q.y).toBe(true));
      const a = layout.byId.get(e.from)! as DiagramNode;
      const b = layout.byId.get(e.to)! as DiagramNode;
      const nudge = (p: Point, toward: Point, d: number): Point => {
        const len = Math.hypot(toward.x - p.x, toward.y - p.y);
        return { x: p.x + ((toward.x - p.x) / len) * d, y: p.y + ((toward.y - p.y) / len) * d };
      };
      // A hair into the node is in, a hair out is out.
      expect(nodeContains(a, nudge(pts[0], pts[1], -0.05))).toBe(true);
      expect(nodeContains(a, nudge(pts[0], pts[1], 0.05))).toBe(false);
      const n = pts.length;
      expect(nodeContains(b, nudge(pts[n - 1], pts[n - 2], -0.05))).toBe(true);
      expect(nodeContains(b, nudge(pts[n - 1], pts[n - 2], 0.05))).toBe(false);
    }
  });

  it("marks the loop as a back arrow and takes it round the right of the chart", () => {
    const loop = edgeOf("A-005", "A-002");
    expect(loop.back).toBe(true);
    expect(layout.edges.filter((e) => e.back)).toHaveLength(1);
    const right = Math.max(...layout.nodes.filter((n) => n.id !== "A-005" && n.id !== "A-002").map((n) => n.x + n.width));
    expect(Math.max(...loop.geometry.points.map((p) => p.x))).toBeGreaterThan(right - 1);
  });

  it("keeps clear of every node an arrow is not joined to", () => {
    for (const e of layout.edges) {
      const pts = e.geometry.points;
      for (const n of layout.nodes) {
        if (n.id === e.from || n.id === e.to) continue;
        pts.slice(1).forEach((q, i) => {
          const p = pts[i];
          const x0 = Math.min(p.x, q.x);
          const x1 = Math.max(p.x, q.x);
          const y0 = Math.min(p.y, q.y);
          const y1 = Math.max(p.y, q.y);
          const hit = x1 > n.x && x0 < n.x + n.width && y1 > n.y && y0 < n.y + n.height;
          expect(hit, `${e.from}->${e.to} through ${n.id}`).toBe(false);
        });
      }
    }
  });

  it("puts the label of an arrow leaving a decision on its first segment", () => {
    for (const to of ["A-004", "A-005"]) {
      const e = edgeOf("A-003", to);
      const start = e.geometry.points[0];
      const d = Math.hypot(e.geometry.mid.x - start.x, e.geometry.mid.y - start.y);
      const firstLen = Math.hypot(e.geometry.points[1].x - start.x, e.geometry.points[1].y - start.y);
      expect(d).toBeCloseTo(Math.min(DECISION_LABEL_OFFSET, firstLen), 5);
      expect(e.labelBox).toBeDefined();
      expect(e.labelBox!.x + e.labelBox!.width / 2).toBeCloseTo(e.geometry.mid.x, 5);
    }
  });

  it("gives a label box only to an arrow that has a label", () => {
    expect(edgeOf("A-001", "A-002").labelBox).toBeUndefined();
    expect(edgeOf("A-005", "A-002").labelBox).toBeDefined();
  });

  it("does not draw an arrow from a node to itself, and does not lose the rest", () => {
    const self = layoutAlgorithm(parseAlgorithm("## Nodes\n\n- A-001 a\n- A-002 b\n\n## Edges\n\n- A-001 -> A-001\n- A-001 -> A-002\n"));
    expect(self.edges.map((e) => e.key)).toHaveLength(1);
  });
});

describe("layoutAlgorithm: stickies and bounds", () => {
  const stickied = parseAlgorithm(`${EXAMPLE}\n## Stickies\n\n- S-001 node:A-003 @40,-30 #red 確認\n- S-002 node:A-404 lost\n`);

  it("pins a sticky to its node and drops one whose node is gone", () => {
    const l = layoutAlgorithm(stickied, stickied.stickies);
    expect(l.stickies).toHaveLength(1);
    expect(l.stickies[0].targetId).toBe("A-003");
  });

  it("draws no stickies when none are passed (hidden)", () => {
    expect(layoutAlgorithm(stickied).stickies).toEqual([]);
  });

  it("bounds everything drawn: nodes, label boxes, the loop's detour and stickies", () => {
    const l = layoutAlgorithm(stickied, stickied.stickies);
    const inside = (b: { x: number; y: number; width: number; height: number }) => {
      expect(b.x).toBeGreaterThanOrEqual(l.bounds.x - 0.001);
      expect(b.y).toBeGreaterThanOrEqual(l.bounds.y - 0.001);
      expect(b.x + b.width).toBeLessThanOrEqual(l.bounds.x + l.bounds.width + 0.001);
      expect(b.y + b.height).toBeLessThanOrEqual(l.bounds.y + l.bounds.height + 0.001);
    };
    l.nodes.forEach(inside);
    l.stickies.forEach(inside);
    l.edges.forEach((e) => {
      if (e.labelBox) inside(e.labelBox);
      e.geometry.points.forEach((p) => inside({ x: p.x, y: p.y, width: 0, height: 0 }));
    });
  });
});

describe("nodeTextY", () => {
  it("centres a process's text on the node and lifts a document's clear of the ripple", () => {
    const l = layoutAlgorithm(parseAlgorithm("## Nodes\n\n- A-001 a\n- A-002 d ^doc\n\n## Edges\n\n- A-001 -> A-002\n"));
    const p = l.byId.get("A-001")!;
    const d = l.byId.get("A-002")!;
    expect(nodeTextY(p, 0)).toBeCloseTo(p.cy + 13 * 0.36, 5);
    expect(nodeTextY(d, 0)).toBeLessThan(d.cy + 13 * 0.36);
  });
});

describe("edge ports (T-0719)", () => {
  it("starts and lands a pinned arrow exactly on its ports", () => {
    const doc = parseAlgorithm(`---
type: algorithm
title: t
---

## Nodes

- A-001 Start ^start
- A-002 Step

## Edges

- A-001:E -> A-002:W

## Stickies
`);
    const layout = layoutAlgorithm(doc);
    expect(layout.edges).toHaveLength(1);
    const [edge] = layout.edges;
    const from = layout.byId.get("A-001")!;
    const to = layout.byId.get("A-002")!;
    expect([edge.geometry.start.x, edge.geometry.start.y]).toEqual([
      from.x + from.width,
      from.y + from.height / 2,
    ]);
    expect([edge.geometry.end.x, edge.geometry.end.y]).toEqual([to.x, to.y + to.height / 2]);
  });
});
