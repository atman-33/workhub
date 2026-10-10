import { describe, expect, it } from "vitest";
import { layerLayout, rankNodes } from "./graph-layout";

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

