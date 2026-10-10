import { describe, expect, it } from "vitest";
import { rankColumnLayout } from "./graph-layout";

const edge = (from: string, to: string) => ({ from, to });
const box = (id: string, width = 100, height = 40) => ({ id, width, height });

/** id -> [column, rank] */
function grid(result: ReturnType<typeof rankColumnLayout>) {
  return Object.fromEntries([...result.nodes].map(([id, p]) => [id, [p.column, p.rank]]));
}

describe("rankColumnLayout", () => {
  it("runs a chain straight down in one column", () => {
    const r = rankColumnLayout([box("a"), box("b"), box("c")], [edge("a", "b"), edge("b", "c")]);
    expect(grid(r)).toEqual({ a: [0, 0], b: [0, 1], c: [0, 2] });
    expect(r.nodes.get("a")).toEqual({ rank: 0, column: 0, cx: 50, cy: 20 });
    expect(r.nodes.get("b")).toEqual({ rank: 1, column: 0, cx: 50, cy: 108 });
    expect(r.nodes.get("c")).toEqual({ rank: 2, column: 0, cx: 50, cy: 196 });
  });

  it("sends the 1st exit down, the 2nd right and the 3rd left, the 4th right again", () => {
    const r = rankColumnLayout(
      [box("d"), box("a"), box("b"), box("c"), box("x")],
      [edge("d", "a"), edge("d", "b"), edge("d", "c"), edge("d", "x")],
    );
    expect(grid(r)).toEqual({ d: [0, 0], a: [0, 1], b: [1, 1], c: [-1, 1], x: [2, 1] });
    // left to right: c, (d over a), b, x
    expect(r.columns.map((c) => c.column)).toEqual([-1, 0, 1, 2]);
    expect(r.nodes.get("c")!.cx).toBeLessThan(r.nodes.get("a")!.cx);
    expect(r.nodes.get("a")!.cx).toBeLessThan(r.nodes.get("b")!.cx);
    expect(r.nodes.get("b")!.cx).toBeLessThan(r.nodes.get("x")!.cx);
    expect(r.nodes.get("d")!.cx).toBe(r.nodes.get("a")!.cx);
  });

  it("follows the order the arrows were written, not the order of the nodes", () => {
    const r = rankColumnLayout(
      [box("d"), box("yes"), box("no")],
      [edge("d", "no"), edge("d", "yes")],
    );
    expect(grid(r)).toEqual({ d: [0, 0], no: [0, 1], yes: [1, 1] });
  });

  it("leaves a merge where it was first placed", () => {
    const r = rankColumnLayout(
      [box("d"), box("a"), box("b"), box("m")],
      [edge("d", "a"), edge("d", "b"), edge("a", "m"), edge("b", "m")],
    );
    expect(grid(r)).toEqual({ d: [0, 0], a: [0, 1], b: [1, 1], m: [0, 2] });
  });

  it("keeps a loop's return arrow out of the ranking", () => {
    const r = rankColumnLayout(
      [box("s"), box("a"), box("d"), box("w"), box("e")],
      [edge("s", "a"), edge("a", "d"), edge("d", "e"), edge("d", "w"), edge("w", "a")],
    );
    expect(r.back).toEqual([false, false, false, false, true]);
    expect(grid(r)).toEqual({ s: [0, 0], a: [0, 1], d: [0, 2], e: [0, 3], w: [1, 3] });
  });

  it("gives a second start its own column at the right end", () => {
    const r = rankColumnLayout([box("a"), box("b"), box("c")], [edge("a", "c")]);
    expect(grid(r)).toEqual({ a: [0, 0], c: [0, 1], b: [1, 0] });
  });

  it("never puts two nodes in one row and column", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const r = rankColumnLayout(
      ids.map((id) => box(id)),
      [
        edge("a", "b"),
        edge("a", "c"),
        edge("a", "d"),
        edge("b", "e"),
        edge("c", "e"),
        edge("d", "f"),
        edge("e", "g"),
        edge("f", "g"),
        edge("g", "h"),
        edge("g", "b"),
        edge("a", "h"),
      ],
    );
    const cells = [...r.nodes.values()].map((p) => `${p.column}:${p.rank}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("sizes columns by the widest node and rows by the tallest", () => {
    const r = rankColumnLayout(
      [box("d", 120, 80), box("a", 100, 40), box("b", 100, 40)],
      [edge("d", "a"), edge("d", "b")],
    );
    expect(r.columns).toEqual([
      { column: 0, x: 0, width: 120 },
      { column: 1, x: 192, width: 100 },
    ]);
    expect(r.rows).toEqual([
      { rank: 0, y: 0, height: 80 },
      { rank: 1, y: 128, height: 40 },
    ]);
    // centred in the column and in the row
    expect(r.nodes.get("a")).toEqual({ rank: 1, column: 0, cx: 60, cy: 148 });
    expect(r.nodes.get("b")).toEqual({ rank: 1, column: 1, cx: 242, cy: 148 });
  });

  it("honours the origin and the gaps", () => {
    const r = rankColumnLayout([box("a"), box("b")], [edge("a", "b")], {
      originX: 10,
      originY: 20,
      rowGap: 10,
    });
    expect(r.nodes.get("a")).toEqual({ rank: 0, column: 0, cx: 60, cy: 40 });
    expect(r.nodes.get("b")).toEqual({ rank: 1, column: 0, cx: 60, cy: 90 });
  });

  it("ignores arrows to unknown nodes and to itself, and copes with a cycle that has no entry", () => {
    const r = rankColumnLayout(
      [box("a"), box("b")],
      [edge("a", "ghost"), edge("a", "a"), edge("a", "b"), edge("b", "a")],
    );
    expect(grid(r)).toEqual({ a: [0, 0], b: [0, 1] });
  });

  it("is empty for no nodes and is deterministic", () => {
    expect(rankColumnLayout([], []).nodes.size).toBe(0);
    const nodes = [box("a"), box("b"), box("c")];
    const edges = [edge("a", "b"), edge("a", "c")];
    expect(rankColumnLayout(nodes, edges)).toEqual(rankColumnLayout(nodes, edges));
  });
});
