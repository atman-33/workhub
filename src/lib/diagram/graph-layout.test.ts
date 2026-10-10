import { describe, expect, it } from "vitest";
import {
  layerLayout,
  rankNodes,
  ringBubbleSide,
  ringClearance,
  ringLayout,
  ringTailSide,
  type RingBox,
} from "./graph-layout";

const edge = (from: string, to: string) => ({ from, to });

describe("rankNodes", () => {
  it("ranks a chain", () => {
    const { rank, back } = rankNodes(["a", "b", "c"], [edge("a", "b"), edge("b", "c")]);
    expect([...rank]).toEqual([["a", 0], ["b", 1], ["c", 2]]);
    expect(back).toEqual([false, false]);
  });

  it("puts both branches of a split in the same column", () => {
    const { rank } = rankNodes(
      ["a", "yes", "no"],
      [edge("a", "yes"), edge("a", "no")],
    );
    expect(rank.get("yes")).toBe(1);
    expect(rank.get("no")).toBe(1);
  });

  it("puts a merge after its deepest input", () => {
    const { rank } = rankNodes(
      ["a", "b", "c", "m"],
      [edge("a", "b"), edge("b", "m"), edge("a", "m"), edge("c", "m")],
    );
    expect(rank.get("m")).toBe(2);
    expect(rank.get("c")).toBe(0);
  });

  it("leaves a loop's return arrow out of the ranking", () => {
    const { rank, back } = rankNodes(
      ["a", "b", "c", "d"],
      [edge("a", "b"), edge("b", "c"), edge("c", "b"), edge("c", "d")],
    );
    expect(back).toEqual([false, false, true, false]);
    expect([rank.get("a"), rank.get("b"), rank.get("c"), rank.get("d")]).toEqual([0, 1, 2, 3]);
  });

  it("treats a return to the start as a loop", () => {
    const { rank, back } = rankNodes(["a", "b"], [edge("a", "b"), edge("b", "a")]);
    expect(back).toEqual([false, true]);
    expect(rank.get("b")).toBe(1);
  });

  it("handles a cycle with no entry and a self loop", () => {
    const cycle = rankNodes(["a", "b"], [edge("a", "b"), edge("b", "a")]);
    expect(cycle.rank.size).toBe(2);
    const self = rankNodes(["a"], [edge("a", "a")]);
    expect(self.back).toEqual([true]);
    expect(self.rank.get("a")).toBe(0);
  });

  it("ignores arrows naming unknown nodes", () => {
    const { rank, back } = rankNodes(["a", "b"], [edge("a", "zzz"), edge("a", "b")]);
    expect(back).toEqual([false, false]);
    expect(rank.get("b")).toBe(1);
  });
});

describe("layerLayout", () => {
  const box = (id: string, row: string, width = 100, height = 40) => ({ id, row, width, height });

  it("makes columns of ranks and rows of keys", () => {
    const r = layerLayout(
      [box("a", "top"), box("b", "bottom"), box("c", "top")],
      [edge("a", "b"), edge("b", "c")],
      { rows: ["top", "bottom"], originX: 10, columnGap: 50, minRowHeight: 100, rowPad: 10 },
    );
    expect(r.columns.map((c) => c.x)).toEqual([10, 160, 310]);
    expect(r.rows.map((x) => [x.key, x.y, x.height])).toEqual([
      ["top", 0, 100],
      ["bottom", 100, 100],
    ]);
    expect(r.nodes.get("a")).toMatchObject({ cx: 60, cy: 50, rank: 0, row: "top" });
    expect(r.nodes.get("b")).toMatchObject({ cx: 210, cy: 150, rank: 1, row: "bottom" });
    expect(r.nodes.get("c")).toMatchObject({ cx: 360, cy: 50 });
  });

  it("stacks nodes that share a cell and grows the row to hold them", () => {
    const r = layerLayout(
      [box("a", "x"), box("yes", "x", 100, 60), box("no", "x", 100, 60)],
      [edge("a", "yes"), edge("a", "no")],
      { rows: ["x"], slotGap: 10, rowPad: 5, minRowHeight: 20 },
    );
    expect(r.rows[0].height).toBe(60 + 10 + 60 + 10);
    const yes = r.nodes.get("yes")!;
    const no = r.nodes.get("no")!;
    expect(no.cy - yes.cy).toBe(70);
    expect((yes.cy + no.cy) / 2).toBe(r.rows[0].y + r.rows[0].height / 2);
    expect(yes.cx).toBe(no.cx);
  });

  it("centres narrow nodes in their column", () => {
    const r = layerLayout([box("a", "x", 200), box("b", "x", 100)], [], { rows: ["x"], originX: 0 });
    // No arrows: both are rank 0, so one column 200 wide.
    expect(r.nodes.get("b")!.cx).toBe(100);
  });

  it("places a node of an unknown row in the first row, and survives no rows", () => {
    const r = layerLayout([box("a", "nope")], [], { rows: ["x", "y"] });
    expect(r.nodes.get("a")!.row).toBe("x");
    const none = layerLayout([box("a", "")], [], { rows: [] });
    expect(none.rows).toHaveLength(1);
  });

  it("does not move a node when an unrelated arrow is added", () => {
    const nodes = [box("a", "x"), box("b", "x"), box("c", "y"), box("d", "y")];
    const before = layerLayout(nodes, [edge("a", "b")], { rows: ["x", "y"] });
    const after = layerLayout(nodes, [edge("a", "b"), edge("c", "d")], { rows: ["x", "y"] });
    expect(after.nodes.get("a")).toEqual(before.nodes.get("a"));
    expect(after.nodes.get("b")).toEqual(before.nodes.get("b"));
  });
});

describe("layerLayout ranks (T-0702)", () => {
  const box = (id: string, row: string, width = 100, height = 40) => ({ id, row, width, height });
  const rows = ["main", "store"];

  it("puts a store directly below its process (golden)", () => {
    const nodes = [box("screen", "main"), box("trigger", "main"), box("proc", "main"), box("db", "store")];
    // the store's own arrows are left out of the ranking, as the IFDAM layout does
    const edges = [edge("screen", "trigger"), edge("trigger", "proc")];
    const r = layerLayout(nodes, edges, {
      rows,
      columnGap: 50,
      slotGap: 10,
      rowPad: 10,
      minRowHeight: 60,
      ranks: new Map([["db", 2]]),
    });
    expect(r.rank.get("db")).toBe(2);
    expect(r.columns.map((c) => [c.rank, c.x, c.width])).toEqual([
      [0, 0, 100],
      [1, 150, 100],
      [2, 300, 100],
    ]);
    expect(r.rows.map((x) => [x.key, x.y, x.height])).toEqual([
      ["main", 0, 60],
      ["store", 60, 60],
    ]);
    expect(r.nodes.get("screen")).toMatchObject({ cx: 50, cy: 30, rank: 0, row: "main" });
    expect(r.nodes.get("trigger")).toMatchObject({ cx: 200, cy: 30, rank: 1 });
    expect(r.nodes.get("proc")).toMatchObject({ cx: 350, cy: 30, rank: 2 });
    expect(r.nodes.get("db")).toMatchObject({ cx: 350, cy: 90, rank: 2, row: "store" });
  });

  it("stacks two stores of one column in written order", () => {
    const nodes = [box("a", "main"), box("p", "main"), box("d1", "store"), box("d2", "store")];
    const r = layerLayout(nodes, [edge("a", "p")], {
      rows,
      slotGap: 10,
      ranks: new Map([
        ["d1", 1],
        ["d2", 1],
      ]),
    });
    const d1 = r.nodes.get("d1")!;
    const d2 = r.nodes.get("d2")!;
    expect(d1.cx).toBe(r.nodes.get("p")!.cx);
    expect(d2.cx).toBe(d1.cx);
    expect(d2.cy - d1.cy).toBe(50);
  });

  it("changes nothing without ranks, with an empty map, or for unknown ids", () => {
    const nodes = [box("a", "main"), box("b", "main"), box("c", "store")];
    const edges = [edge("a", "b")];
    const plain = layerLayout(nodes, edges, { rows });
    for (const ranks of [new Map<string, number>(), new Map([["ghost", 4]])]) {
      const r = layerLayout(nodes, edges, { rows, ranks });
      expect(r.columns).toEqual(plain.columns);
      expect([...r.nodes]).toEqual([...plain.nodes]);
      expect([...r.rank]).toEqual([...plain.rank]);
    }
  });

  it("can move a node that has arrows, rounds, and never goes below 0", () => {
    const nodes = [box("a", "main"), box("b", "main")];
    const r = layerLayout(nodes, [edge("a", "b")], {
      rows,
      ranks: new Map([
        ["a", -3],
        ["b", 2.6],
      ]),
    });
    expect(r.rank.get("a")).toBe(0);
    expect(r.rank.get("b")).toBe(3);
    expect(r.columns).toHaveLength(4);
  });
});

describe("ringLayout", () => {
  const SYS = { id: "s1", width: 200, height: 120 };
  const SYS2 = { id: "s2", width: 160, height: 100 };
  const person = (i: number, lines = 2) => ({
    id: `p${i}`,
    width: 88 + (i % 3) * 20,
    height: 70 + (i % 2) * 14,
    bubble: { width: 100 + (i % 4) * 25, height: 24 + lines * 16 + (i % 3) * 8 },
  });
  /** Every other item is an external service: a plain box with no bubble. */
  const mixed = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      i % 3 === 2 ? { id: `e${i}`, width: 120, height: 48 } : person(i, 1 + (i % 5)),
    );

  function cellsAndBoxes(r: ReturnType<typeof ringLayout>, systems: { id: string; width: number; height: number }[], items: ReturnType<typeof mixed>) {
    const box = (id: string, w: number, h: number): RingBox => {
      const c = r.nodes.get(id)!;
      return { x: c.cx - w / 2, y: c.cy - h / 2, width: w, height: h };
    };
    const sys = systems.map((s) => box(s.id, s.width, s.height));
    const cells = items.map((it) => {
      const b = box(it.id, it.width, it.height);
      const bub = r.bubbles.get(it.id);
      if (!bub) return b;
      const x = Math.min(b.x, bub.x);
      const y = Math.min(b.y, bub.y);
      return {
        x,
        y,
        width: Math.max(b.x + b.width, bub.x + bub.width) - x,
        height: Math.max(b.y + b.height, bub.y + bub.height) - y,
      };
    });
    return { sys, cells };
  }

  for (const nSystems of [0, 1, 2]) {
    const systems = [SYS, SYS2].slice(0, nSystems);
    it(`never overlaps, with ${nSystems} system(s), 1 to 12 items`, () => {
      for (let n = 1; n <= 12; n++) {
        const items = mixed(n);
        const r = ringLayout(systems, items);
        const { sys, cells } = cellsAndBoxes(r, systems, items);
        for (let i = 0; i < cells.length; i++) {
          for (const s of sys) expect(ringClearance(cells[i], s)).toBeGreaterThanOrEqual(32 - 0.05);
          for (let j = i + 1; j < cells.length; j++) {
            expect(ringClearance(cells[i], cells[j])).toBeGreaterThanOrEqual(24 - 0.05);
          }
        }
        for (let i = 0; i < sys.length; i++) {
          for (let j = i + 1; j < sys.length; j++) expect(ringClearance(sys[i], sys[j])).toBeGreaterThanOrEqual(48 - 0.05);
        }
      }
    });
  }

  it("is deterministic and leaves its input alone", () => {
    const items = mixed(9);
    const before = JSON.stringify(items);
    const a = ringLayout([SYS, SYS2], items);
    const b = ringLayout([SYS, SYS2], items);
    expect(JSON.stringify([...a.nodes, ...a.bubbles, a.bounds])).toBe(JSON.stringify([...b.nodes, ...b.bubbles, b.bounds]));
    expect(JSON.stringify(items)).toBe(before);
  });

  it("puts the drawing's top left at the origin (bubbles included)", () => {
    for (let n = 0; n <= 12; n++) {
      const r = ringLayout([SYS], mixed(n));
      expect(r.bounds.x).toBeCloseTo(40, 1);
      expect(r.bounds.y).toBeCloseTo(40, 1);
    }
    const moved = ringLayout([SYS], mixed(4), { originX: 0, originY: 10 });
    expect(moved.bounds.x).toBeCloseTo(0, 1);
    expect(moved.bounds.y).toBeCloseTo(10, 1);
  });

  it("lays systems out in a row in file order, centre lines level", () => {
    const r = ringLayout([SYS, SYS2], mixed(4));
    const a = r.nodes.get("s1")!;
    const b = r.nodes.get("s2")!;
    expect(a.cy).toBe(b.cy);
    expect(b.cx - SYS2.width / 2 - (a.cx + SYS.width / 2)).toBeCloseTo(48, 1);
    expect(r.center.x).toBeCloseTo((a.cx - SYS.width / 2 + b.cx + SYS2.width / 2) / 2, 1);
  });

  it("starts at 12 o'clock and runs clockwise in file order", () => {
    const items = Array.from({ length: 4 }, (_, i) => ({ id: `x${i}`, width: 80, height: 40 }));
    const r = ringLayout([SYS], items);
    const c = r.center;
    const at = items.map((it) => r.nodes.get(it.id)!);
    expect(at[0].cx).toBeCloseTo(c.x, 1);
    expect(at[0].cy).toBeLessThan(c.y);
    expect(at[1].cx).toBeGreaterThan(c.x);
    expect(at[1].cy).toBeCloseTo(c.y, 1);
    expect(at[2].cx).toBeCloseTo(c.x, 1);
    expect(at[2].cy).toBeGreaterThan(c.y);
    expect(at[3].cx).toBeLessThan(c.x);
    // On an ellipse of aspect 1.4 : 1.
    expect((at[1].cx - c.x) / (c.y - at[0].cy)).toBeCloseTo(1.4, 1);
  });

  it("is mirror symmetric for 2, 4 and 6 items", () => {
    for (const n of [2, 4, 6]) {
      const items = Array.from({ length: n }, (_, i) => ({ id: `x${i}`, width: 80, height: 40 }));
      const r = ringLayout([SYS], items);
      for (const it of items) {
        const p = r.nodes.get(it.id)!;
        const mirrored = [...r.nodes.values()].some(
          (q) => Math.abs(q.cx - (2 * r.center.x - p.cx)) < 0.05 && Math.abs(q.cy - p.cy) < 0.05,
        );
        expect(mirrored).toBe(true);
      }
    }
  });

  it("grows the ring when the cells are crowded, and keeps it small when they are not", () => {
    const small = ringLayout([SYS], [{ id: "x0", width: 60, height: 30 }]);
    const crowded = ringLayout([SYS], Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, width: 120, height: 70 })));
    expect(crowded.rx).toBeGreaterThan(small.rx);
    expect(crowded.scale).toBeGreaterThan(1);
    expect(small.scale).toBe(1);
  });

  it("puts every bubble outside the ring, on the side the person leans to", () => {
    for (const n of [1, 2, 3, 5, 6, 7, 12]) {
      const items = Array.from({ length: n }, (_, i) => person(i));
      const r = ringLayout([SYS], items);
      for (const it of items) {
        const p = r.nodes.get(it.id)!;
        const b = r.bubbles.get(it.id)!;
        expect(b.side).toBe(ringBubbleSide(p.cx - r.center.x, p.cy - r.center.y));
        expect(b.tailSide).toBe(ringTailSide(b.side));
        const box = { x: p.cx - it.width / 2, y: p.cy - it.height / 2, width: it.width, height: it.height };
        const gap = ringClearance(box, b);
        expect(gap).toBeCloseTo(14, 1);
        if (b.side === "left") expect(b.x + b.width).toBeCloseTo(box.x - 14, 1);
        if (b.side === "right") expect(b.x).toBeCloseTo(box.x + box.width + 14, 1);
        if (b.side === "top") expect(b.y + b.height).toBeCloseTo(box.y - 14, 1);
        if (b.side === "bottom") expect(b.y).toBeCloseTo(box.y + box.height + 14, 1);
      }
    }
  });

  it("gives an external service or an empty bubble no bubble", () => {
    const r = ringLayout([SYS], [
      { id: "e", width: 120, height: 48 },
      { id: "z", width: 88, height: 70, bubble: { width: 0, height: 0 } },
    ]);
    expect(r.bubbles.size).toBe(0);
  });

  it("handles no items, and no systems with no items", () => {
    const only = ringLayout([SYS], []);
    expect(only.nodes.get("s1")).toEqual({ cx: 140, cy: 100 });
    expect(only.bounds).toEqual({ x: 40, y: 40, width: 200, height: 120 });
    expect(only.rx).toBe(0);
    const empty = ringLayout([], []);
    expect(empty.nodes.size).toBe(0);
    expect(empty.bounds).toEqual({ x: 40, y: 40, width: 0, height: 0 });
  });

  it("places a pinned item where it was pinned, decides its bubble side again, and leaves the others", () => {
    const items = Array.from({ length: 4 }, (_, i) => person(i));
    const base = ringLayout([SYS], items);
    const pinned = ringLayout([SYS], items, { pinned: new Map([["p0", { cx: 900, cy: 400 }]]) });
    expect(pinned.nodes.get("p0")).toEqual({ cx: 900, cy: 400 });
    expect(pinned.bubbles.get("p0")!.side).toBe("right");
    for (const id of ["s1", "p1", "p2", "p3"]) expect(pinned.nodes.get(id)).toEqual(base.nodes.get(id));
    const top = ringLayout([SYS], items, { pinned: new Map([["p1", { cx: 140, cy: -300 }]]) });
    expect(top.bubbles.get("p1")!.side).toBe("top");
  });

  // Golden: one system 200x120, people 88x70 with a 120x60 bubble each.
  const golden = (n: number) =>
    ringLayout(
      [{ id: "s", width: 200, height: 120 }],
      Array.from({ length: n }, (_, i) => ({ id: `p${i}`, width: 88, height: 70, bubble: { width: 120, height: 60 } })),
    );
  const dump = (r: ReturnType<typeof ringLayout>) => ({
    nodes: [...r.nodes].map(([id, c]) => [id, c.cx, c.cy]),
    bubbles: [...r.bubbles].map(([id, b]) => [id, b.side, b.x, b.y]),
    bounds: r.bounds,
    rx: r.rx,
    ry: r.ry,
  });

  it("golden: 1 person", () => {
    expect(dump(golden(1))).toEqual({
      nodes: [["s", 140, 276], ["p0", 140, 149]],
      bubbles: [["p0", "top", 80, 40]],
      bounds: { x: 40, y: 40, width: 200, height: 296 },
      rx: 177.8,
      ry: 127,
    });
  });

  it("golden: 2 people", () => {
    expect(dump(golden(2))).toEqual({
      nodes: [["s", 140, 276], ["p0", 140, 149], ["p1", 140, 403]],
      bubbles: [["p0", "top", 80, 40], ["p1", "bottom", 80, 452]],
      bounds: { x: 40, y: 40, width: 200, height: 472 },
      rx: 177.8,
      ry: 127,
    });
  });

  it("golden: 3 people", () => {
    expect(dump(golden(3))).toEqual({
      nodes: [["s", 397.6, 297.13], ["p0", 397.6, 149], ["p1", 577.2, 371.2], ["p2", 218, 371.2]],
      bubbles: [["p0", "top", 337.6, 40], ["p1", "right", 635.2, 341.2], ["p2", "left", 40, 341.2]],
      bounds: { x: 40, y: 40, width: 715.2, height: 366.2 },
      rx: 207.39,
      ry: 148.13,
    });
  });

  it("golden: 6 people", () => {
    expect(dump(golden(6))).toEqual({
      nodes: [
        ["s", 397.6, 297.13],
        ["p0", 397.6, 149],
        ["p1", 577.2, 223.07],
        ["p2", 577.2, 371.2],
        ["p3", 397.6, 445.27],
        ["p4", 218, 371.2],
        ["p5", 218, 223.07],
      ],
      bubbles: [
        ["p0", "top", 337.6, 40],
        ["p1", "right", 635.2, 193.07],
        ["p2", "right", 635.2, 341.2],
        ["p3", "bottom", 337.6, 494.27],
        ["p4", "left", 40, 341.2],
        ["p5", "left", 40, 193.07],
      ],
      bounds: { x: 40, y: 40, width: 715.2, height: 514.27 },
      rx: 207.39,
      ry: 148.13,
    });
  });

  it("golden: a pinned person among 3", () => {
    const r = ringLayout(
      [{ id: "s", width: 200, height: 120 }],
      Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, width: 88, height: 70, bubble: { width: 120, height: 60 } })),
      { pinned: new Map([["p1", { cx: 100, cy: 300 }]]) },
    );
    expect(r.nodes.get("p1")).toEqual({ cx: 100, cy: 300 });
    expect(r.bubbles.get("p1")).toMatchObject({ side: "left", x: -78, y: 270 });
  });

  it("does not widen the ring for a big bubble: a person with a 200x150 bubble sits as close to the system as one without (T-0706)", () => {
    const sys = { id: "s", width: 200, height: 120 };
    const plain = ringLayout([sys], [{ id: "p", width: 88, height: 70 }]);
    const big = ringLayout([sys], [{ id: "p", width: 88, height: 70, bubble: { width: 200, height: 150 } }]);
    // Same distance from the system's centre to the person (the bubble is on the far side).
    const gap = (r: ReturnType<typeof ringLayout>) => r.nodes.get("s")!.cy - r.nodes.get("p")!.cy;
    expect(gap(big)).toBe(gap(plain));
    // ... and the person is within one growth step of the minimum clearance (32px) from the system.
    expect(gap(big) - 60 - 35).toBeLessThanOrEqual(32 * 1.08 + 1);
    expect(big.scale).toBe(1);
  });
});
