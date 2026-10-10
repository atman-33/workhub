import { describe, expect, it } from "vitest";
import { nodeContains, type Point } from "../node-edge";
import { cylinderLid, shapeOf } from "../shapes";
import {
  layoutIfdam,
  measureNode,
  nodeTextY,
  SCREEN_MAX_WIDTH,
  SCREEN_MIN_WIDTH,
  type IfdamLayout,
  type PositionedNode,
} from "./layout";
import { parseIfdam, type IfdamNode } from "./parse";

const screen = (title: string, lines: IfdamNode["lines"] = []) =>
  measureNode({ title, kind: "screen", lines });

describe("measureNode: screen", () => {
  it("is a low box with the title in the middle when it holds nothing", () => {
    const m = screen("Todo 一覧");
    expect(m.rules).toEqual([]);
    expect(m.sections).toEqual([]);
    expect(m.band).toBe(0);
    expect(m.height).toBe(40);
    expect(m.width).toBe(SCREEN_MIN_WIDTH);
    // the one title line is centred
    expect(m.titleTop * 2 + m.lines.length * 18.85).toBeCloseTo(m.height, 5);
  });

  it("draws only the sections that have items, with a rule under the title and between sections", () => {
    const one = screen("A", [{ key: "input", text: "検索語" }]);
    expect(one.sections.map((s) => s.key)).toEqual(["input"]);
    expect(one.rules).toHaveLength(1);

    const two = screen("A", [
      { key: "action", text: "ボタン" },
      { key: "show", text: "一覧" },
    ]);
    // drawn in the order show, input, action whatever the order written
    expect(two.sections.map((s) => s.key)).toEqual(["show", "action"]);
    expect(two.rules).toHaveLength(2);

    const three = screen("A", [
      { key: "show", text: "a" },
      { key: "input", text: "b" },
      { key: "action", text: "c" },
      { key: null, text: "memo is not drawn" },
    ]);
    expect(three.sections.map((s) => s.key)).toEqual(["show", "input", "action"]);
    expect(three.rules).toHaveLength(3);
    expect(three.rules[0]).toBe(three.band);
    // rules ascend, and every one is inside the box
    expect([...three.rules].sort((a, b) => a - b)).toEqual(three.rules);
    expect(three.rules[2]).toBeLessThan(three.height);
    expect(three.height).toBeGreaterThan(two.height);
    expect(two.height).toBeGreaterThan(one.height);
  });

  it("places every line of text inside the box, each below the one before", () => {
    const m = screen("Todo 一覧", [
      { key: "show", text: "登録済みの Todo の一覧" },
      { key: "show", text: "件数" },
      { key: "input", text: "検索語" },
      { key: "action", text: "「追加」ボタン" },
    ]);
    const baselines: number[] = [];
    for (const s of m.sections) {
      baselines.push(s.captionY);
      for (const item of s.items) for (let i = 0; i < item.lines.length; i++) baselines.push(item.y + i * 17.4);
    }
    for (let i = 1; i < baselines.length; i++) expect(baselines[i]).toBeGreaterThan(baselines[i - 1]);
    expect(baselines[0]).toBeGreaterThan(m.band);
    expect(baselines[baselines.length - 1]).toBeLessThan(m.height);
  });

  it("wraps a long item, grows the box with it and never passes the widest a screen may be", () => {
    const long = "とても長い項目の文字列がここに入っていて、箱の幅に収まらないので折り返される".repeat(2);
    const m = screen("A", [{ key: "show", text: long }]);
    expect(m.width).toBeGreaterThan(SCREEN_MAX_WIDTH - 24);
    expect(m.width).toBeLessThanOrEqual(SCREEN_MAX_WIDTH);
    expect(m.sections[0].items[0].lines.length).toBeGreaterThan(1);
    expect(m.sections[0].items[0].lines.join("")).toBe(long);
    const short = screen("A", [{ key: "show", text: "x" }]);
    expect(m.height).toBeGreaterThan(short.height);
  });

  it("widens for a long title, wraps it past the widest, and is wider than the minimum for wide items", () => {
    const wide = screen("A fairly long screen title", [{ key: "show", text: "short" }]);
    expect(wide.width).toBeGreaterThan(SCREEN_MIN_WIDTH);
    const wrapped = screen("とても長い画面の名前がここに入っていて幅に収まらない場合は折り返す");
    expect(wrapped.lines.length).toBeGreaterThan(1);
    expect(wrapped.width).toBeGreaterThan(SCREEN_MAX_WIDTH - 24);
    expect(wrapped.width).toBeLessThanOrEqual(SCREEN_MAX_WIDTH);
  });

  it("has the same numbers every time (a golden)", () => {
    const m = screen("Todo 一覧", [
      { key: "show", text: "登録済みの Todo の一覧" },
      { key: "input", text: "検索語" },
      { key: "action", text: "「追加」ボタン" },
    ]);
    expect({ width: m.width, height: m.height, rules: m.rules.map((r) => Math.round(r * 100) / 100) }).toEqual({
      width: 167,
      height: 161,
      rules: [33, 75.63, 118.25],
    });
  });
});

describe("measureNode: the other elements", () => {
  it("sizes a trigger for its slanted sides, a store for its lids, a message at the minimum", () => {
    const trigger = measureNode({ title: "「追加」ボタンをクリック", kind: "trigger", lines: [] });
    expect(trigger.width).toBeGreaterThanOrEqual(88 + 28 - 1);
    const store = measureNode({ title: "Todo", kind: "store", lines: [] });
    expect(store.height).toBe(40 + 2 * 10);
    const message = measureNode({ title: "OK", kind: "message", lines: [] });
    expect({ w: message.width, h: message.height }).toEqual({ w: 88, h: 40 });
    const process = measureNode({ title: "Todo を登録する", kind: "process", lines: [] });
    expect(process.width).toBeGreaterThanOrEqual(120);
    expect(process.height).toBeGreaterThanOrEqual(52);
  });

  it("wraps long titles of every element", () => {
    const title = "とても長い名前がここに入っていて箱の幅に収まらないので折り返される".repeat(2);
    for (const kind of ["trigger", "process", "store", "message"] as const) {
      expect(measureNode({ title, kind, lines: [] }).lines.length).toBeGreaterThan(1);
    }
  });
});

// ---------------------------------------------------------------------------

const FIGURE = `---
type: ifdam
title: Todo の登録
---

## Nodes

- V-001 Todo 一覧 ^screen
  show: 登録済みの Todo の一覧
  show: 件数
  input: 検索語
  action: 「追加」ボタン
- V-002 「追加」ボタンをクリック ^trigger
- V-003 Todo 追加 ^screen
  show: 入力フォームの見出し
  input: タイトル（必須）
  input: 期限
  action: 「登録」ボタン
  action: 「キャンセル」ボタン
- V-004 「登録」ボタンをクリック ^trigger
- V-005 Todo を登録する task:T-0100
- V-006 Todo ^store
- V-007 「登録しました」を表示する ^message
- V-008 一覧を取得する

## Edges

- V-001 -> V-002
- V-002 -> V-003
- V-003 -> V-004
- V-004 -> V-005
- V-005 -> V-006
- V-005 -> V-007
- V-007 -> V-008
- V-006 -> V-008
- V-008 -> V-001
`;

const r2 = (n: number) => Math.round(n * 100) / 100;

function boxHit(a: Point, b: Point, n: PositionedNode): boolean {
  const steps = 60;
  for (let i = 1; i < steps; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    if (nodeContains(n, p)) return true;
  }
  return false;
}

/** Every segment is horizontal or vertical and none enters a node it neither starts nor ends at. */
function expectClean(layout: IfdamLayout) {
  for (const edge of layout.edges) {
    const pts = edge.geometry.points;
    pts.slice(1).forEach((q, j) => {
      const p = pts[j];
      expect(p.x === q.x || p.y === q.y, `${edge.key} segment ${j} is axis aligned`).toBe(true);
      for (const n of layout.nodes) {
        if (n.id === edge.from || n.id === edge.to) continue;
        expect(boxHit(p, q, n), `${edge.key} passes through ${n.id}`).toBe(false);
      }
    });
  }
}

/** The arrow's two ends sit on the outlines of the nodes it joins. */
function expectEndsOnOutline(layout: IfdamLayout) {
  for (const edge of layout.edges) {
    const pts = edge.geometry.points;
    for (const [id, end, inner] of [
      [edge.from, pts[0], pts[1]],
      [edge.to, pts[pts.length - 1], pts[pts.length - 2]],
    ] as const) {
      const n = layout.byId.get(id)!;
      const len = Math.hypot(inner.x - end.x, inner.y - end.y);
      const ux = (inner.x - end.x) / len;
      const uy = (inner.y - end.y) / len;
      expect(nodeContains(n, { x: end.x - ux * 0.05, y: end.y - uy * 0.05 }), `${edge.key} end inside ${id}`).toBe(true);
      expect(nodeContains(n, { x: end.x + ux * 0.05, y: end.y + uy * 0.05 }), `${edge.key} end outside ${id}`).toBe(false);
    }
  }
}

const edgeOf = (layout: IfdamLayout, from: string, to: string) =>
  layout.edges.find((e) => e.from === from && e.to === to)!;

describe("layoutIfdam: the Todo figure", () => {
  const doc = parseIfdam(FIGURE);
  const layout = layoutIfdam(doc);
  const at = (id: string) => layout.byId.get(id)!;

  it("runs left to right in the order of the flow, the loop being the only way back", () => {
    const xs = ["V-001", "V-002", "V-003", "V-004", "V-005", "V-007", "V-008"].map((id) => at(id).cx);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(xs.length);
    expect(edgeOf(layout, "V-008", "V-001").back).toBe(true);
    expect(layout.edges.filter((e) => e.back)).toHaveLength(1);
  });

  it("hangs the data store directly under the first process that touches it", () => {
    const save = at("V-005");
    const store = at("V-006");
    expect(store.cx).toBe(save.cx);
    expect(store.y).toBeGreaterThanOrEqual(save.y + save.height);
    const mainBottom = Math.max(...layout.nodes.filter((n) => n.kind !== "store").map((n) => n.y + n.height));
    expect(store.y + (store.height - 2 * cylinderLid(store)) / 2).toBeGreaterThan(mainBottom - 1);
  });

  it("does not let the store's arrows pull it, or the read arrow its reader, off the flow", () => {
    // V-006 -> V-008 reads the store; V-008 is still in the column after the message
    expect(at("V-008").cx).toBeGreaterThan(at("V-007").cx);
    expect(at("V-006").cx).toBe(at("V-005").cx);
  });

  it("draws the screens as screens with their sections", () => {
    expect(at("V-001").shape).toBe("screen");
    expect(at("V-001").sections.map((s) => s.key)).toEqual(["show", "input", "action"]);
    expect(at("V-001").rules).toHaveLength(3);
    expect(at("V-002").shape).toBe("hexagon");
    expect(at("V-005").shape).toBe("ellipse");
    expect(at("V-006").shape).toBe("cylinder");
    expect(at("V-007").shape).toBe("rounded");
    expect(at("V-002").rules).toEqual([]);
  });

  it("keeps every arrow clean and on the outlines", () => {
    expect(layout.edges).toHaveLength(9);
    expectClean(layout);
    expectEndsOnOutline(layout);
  });

  it("joins a process and its store with one vertical line, the write and the read on top of each other", () => {
    const g = layoutIfdam(
      parseIfdam("## Nodes\n\n- V-001 a\n- V-002 s ^store\n\n## Edges\n\n- V-001 -> V-002\n- V-002 -> V-001\n"),
    );
    const w = edgeOf(g, "V-001", "V-002").geometry.points;
    const r = edgeOf(g, "V-002", "V-001").geometry.points;
    expect(w).toHaveLength(2);
    expect(w[0].x).toBe(w[1].x);
    expect(r.map((p) => [r2(p.x), r2(p.y)])).toEqual([...w].reverse().map((p) => [r2(p.x), r2(p.y)]));
    expectEndsOnOutline(g);
  });

  it("sends the loop under the whole diagram, through the gaps and not along the store's line", () => {
    const loop = edgeOf(layout, "V-008", "V-001").geometry.points;
    const bottom = Math.max(...layout.nodes.map((n) => n.y + n.height));
    const lane = Math.max(...loop.map((p) => p.y));
    expect(lane).toBeGreaterThan(bottom);
    // it leaves the left side of V-008 and enters the right side of V-001
    const from = at("V-008");
    const to = at("V-001");
    expect(loop[0].x).toBeLessThan(from.cx);
    expect(loop[loop.length - 1].x).toBeGreaterThan(to.cx);
    // none of its vertical legs runs in a column that holds a box
    for (let i = 1; i < loop.length; i++) {
      if (loop[i].x !== loop[i - 1].x) continue;
      const x = loop[i].x;
      const lo = Math.min(loop[i].y, loop[i - 1].y);
      const hi = Math.max(loop[i].y, loop[i - 1].y);
      for (const n of layout.nodes) {
        const across = x > n.x - 6 && x < n.x + n.width + 6 && hi > n.y && lo < n.y + n.height;
        expect(across, `leg at x=${x} runs by ${n.id}`).toBe(false);
      }
    }
    // and nothing overlaps the process-store line
    const store = edgeOf(layout, "V-005", "V-006").geometry.points;
    expect(loop.some((p) => Math.abs(p.x - store[0].x) < 1)).toBe(false);
  });

  it("puts the loop's label on its lane", () => {
    const labelled = layoutIfdam({
      ...doc,
      edges: doc.edges.map((e) => (e.from === "V-008" ? { ...e, label: "戻る" } : e)),
    });
    const e = edgeOf(labelled, "V-008", "V-001");
    expect(e.labelBox).toBeDefined();
    expect(r2(e.labelBox!.y + e.labelBox!.height / 2)).toBe(r2(e.geometry.mid.y));
    expect(e.geometry.mid.y).toBe(Math.max(...e.geometry.points.map((p) => p.y)));
  });

  it("is the same every time", () => {
    expect(JSON.stringify(layoutIfdam(parseIfdam(FIGURE)))).toBe(JSON.stringify(layout));
  });

  it("reports bounds that hold every box, label and arrow point", () => {
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(layout.bounds.x);
      expect(n.x + n.width).toBeLessThanOrEqual(layout.bounds.x + layout.bounds.width);
    }
    for (const e of layout.edges) {
      for (const p of e.geometry.points) {
        expect(p.y).toBeLessThanOrEqual(layout.bounds.y + layout.bounds.height);
      }
    }
  });
});

describe("layoutIfdam: data stores", () => {
  const nodes = (extra: string) => `## Nodes\n\n${extra}`;

  it("puts a store touched by two processes under the first one written, the other arrow going round", () => {
    const g = layoutIfdam(
      parseIfdam(
        nodes(
          "- V-001 a\n- V-002 b\n- V-003 s ^store\n\n## Edges\n\n- V-001 -> V-002\n- V-001 -> V-003\n- V-002 -> V-003\n",
        ),
      ),
    );
    expect(g.byId.get("V-003")!.cx).toBe(g.byId.get("V-001")!.cx);
    expect(g.byId.get("V-003")!.y).toBeGreaterThan(g.byId.get("V-001")!.y);
    expectEndsOnOutline(g);
  });

  it("takes the first arrow in the order written, not the first process in the order of the nodes", () => {
    const g = layoutIfdam(
      parseIfdam(nodes("- V-001 a\n- V-002 b\n- V-003 s ^store\n\n## Edges\n\n- V-001 -> V-002\n- V-002 -> V-003\n- V-001 -> V-003\n")),
    );
    expect(g.byId.get("V-003")!.cx).toBe(g.byId.get("V-002")!.cx);
  });

  it("does not count the store's arrows for the ranks, so a store that is only read stays out of column 0", () => {
    const g = layoutIfdam(
      parseIfdam(nodes("- V-001 a\n- V-002 b\n- V-003 s ^store\n\n## Edges\n\n- V-001 -> V-002\n- V-003 -> V-002\n")),
    );
    // the store belongs under the node it touches (b), not at the start
    expect(g.byId.get("V-003")!.cx).toBe(g.byId.get("V-002")!.cx);
    expect(g.byId.get("V-002")!.cx).toBeGreaterThan(g.byId.get("V-001")!.cx);
  });

  it("stacks stores of one column in the order written, and puts a lone store in column 0", () => {
    const g = layoutIfdam(
      parseIfdam(nodes("- V-001 p\n- V-002 s1 ^store\n- V-003 s2 ^store\n- V-004 alone ^store\n\n## Edges\n\n- V-001 -> V-002\n- V-001 -> V-003\n")),
    );
    const s1 = g.byId.get("V-002")!;
    const s2 = g.byId.get("V-003")!;
    expect(s1.cx).toBe(g.byId.get("V-001")!.cx);
    expect(s2.cx).toBe(s1.cx);
    expect(s1.y).toBeLessThan(s2.y);
    expect(g.byId.get("V-004")!.cx).toBe(g.byId.get("V-001")!.cx); // column 0 as well
  });

  it("follows another store when the only arrow joins two stores", () => {
    const g = layoutIfdam(
      parseIfdam(nodes("- V-001 p\n- V-002 s1 ^store\n- V-003 s2 ^store\n\n## Edges\n\n- V-001 -> V-002\n- V-003 -> V-002\n")),
    );
    expect(g.byId.get("V-003")!.cx).toBe(g.byId.get("V-002")!.cx);
  });
});

describe("layoutIfdam: loops", () => {
  const rows = (...kinds: string[]) =>
    kinds.map((k, i) => `- V-00${i + 1} n${i + 1}${k ? ` ^${k}` : ""}`).join("\n");

  it("leaves a loop from a process with a store under it by the side, clear of the store's line", () => {
    const g = layoutIfdam(
      parseIfdam(
        `## Nodes\n\n- V-001 list ^screen\n- V-002 go ^trigger\n- V-003 save\n- V-004 todos ^store\n\n## Edges\n\n- V-001 -> V-002\n- V-002 -> V-003\n- V-003 -> V-004\n- V-003 -> V-001\n`,
      ),
    );
    const loop = edgeOf(g, "V-003", "V-001");
    expect(loop.back).toBe(true);
    expectClean(g);
    expectEndsOnOutline(g);
    const save = g.byId.get("V-003")!;
    // starts on the left side of the process, not the middle of its underside
    expect(loop.geometry.start.x).toBeLessThan(save.cx);
    expect(loop.geometry.points[0].y).toBeGreaterThan(save.cy);
  });

  it("leaves the target by the right side even with a store under it", () => {
    const g = layoutIfdam(
      parseIfdam(
        `## Nodes\n\n- V-001 list ^screen\n- V-002 cache ^store\n- V-003 go ^trigger\n- V-004 save\n\n## Edges\n\n- V-001 -> V-002\n- V-001 -> V-003\n- V-003 -> V-004\n- V-004 -> V-001\n`,
      ),
    );
    expectClean(g);
    expectEndsOnOutline(g);
    const list = g.byId.get("V-001")!;
    const end = edgeOf(g, "V-004", "V-001").geometry.end;
    expect(end.x).toBeGreaterThan(list.cx);
  });

  it("gives nested loops their own lanes, the shorter one inside", () => {
    const g = layoutIfdam(
      parseIfdam(
        `## Nodes\n\n${rows("screen", "trigger", "", "message", "screen")}\n\n## Edges\n\n- V-001 -> V-002\n- V-002 -> V-003\n- V-003 -> V-004\n- V-004 -> V-005\n- V-004 -> V-001\n- V-005 -> V-004\n`,
      ),
    );
    const lanes = g.edges.filter((e) => e.back).map((e) => Math.max(...e.geometry.points.map((p) => p.y)));
    expect(lanes).toHaveLength(2);
    expect(new Set(lanes).size).toBe(2);
    const long = edgeOf(g, "V-004", "V-001");
    const short = edgeOf(g, "V-005", "V-004");
    expect(Math.max(...long.geometry.points.map((p) => p.y))).toBeGreaterThan(
      Math.max(...short.geometry.points.map((p) => p.y)),
    );
    expectClean(g);
    expectEndsOnOutline(g);
  });

  it("routes any arrow to a node on its left the same way, a store included", () => {
    const g = layoutIfdam(
      parseIfdam(
        `## Nodes\n\n- V-001 a\n- V-002 b\n- V-003 s ^store\n\n## Edges\n\n- V-001 -> V-002\n- V-001 -> V-003\n- V-002 -> V-003\n`,
      ),
    );
    // the store is under a (left of b), so b -> s goes left
    const e = edgeOf(g, "V-002", "V-003");
    expect(e.back).toBe(true);
    expectClean(g);
    expectEndsOnOutline(g);
  });

  it("keeps a self arrow out of the picture", () => {
    const g = layoutIfdam(parseIfdam("## Nodes\n\n- V-001 a\n\n## Edges\n\n- V-001 -> V-001\n"));
    expect(g.edges).toHaveLength(0);
  });
});

describe("layoutIfdam: arrows whose straight line would cross a box", () => {
  it("takes the arrow to the second of two stores round the right of the column", () => {
    const g = layoutIfdam(
      parseIfdam(
        "## Nodes\n\n- V-001 save\n- V-002 todos ^store\n- V-003 log ^store\n\n## Edges\n\n- V-001 -> V-002\n- V-001 -> V-003\n- V-002 -> V-001\n",
      ),
    );
    const near = edgeOf(g, "V-001", "V-002").geometry.points;
    expect(near).toHaveLength(2); // the neighbour stays a straight drop
    const far = edgeOf(g, "V-001", "V-003").geometry.points;
    expect(far.length).toBeGreaterThan(2);
    const save = g.byId.get("V-001")!;
    expect(Math.max(...far.map((p) => p.x))).toBeGreaterThan(save.x + save.width);
    expect(far[0].x).toBeGreaterThan(save.cx); // leaves by the right side
    expectClean(g);
    expectEndsOnOutline(g);
  });

  it("takes an arrow that skips a box in the same row over the top", () => {
    const g = layoutIfdam(
      parseIfdam(
        "## Nodes\n\n- V-001 list ^screen\n- V-002 go ^trigger\n- V-003 save\n\n## Edges\n\n- V-001 -> V-002\n- V-002 -> V-003\n- V-001 -> V-003\n",
      ),
    );
    const skip = edgeOf(g, "V-001", "V-003").geometry.points;
    const top = Math.min(...g.nodes.map((n) => n.y));
    expect(Math.min(...skip.map((p) => p.y))).toBeLessThan(top);
    // the neighbours are still straight
    expect(edgeOf(g, "V-001", "V-002").geometry.points).toHaveLength(2);
    expectClean(g);
    expectEndsOnOutline(g);
  });

  it("leaves a straight line alone when nothing is in the way", () => {
    const g = layoutIfdam(
      parseIfdam("## Nodes\n\n- V-001 a\n- V-002 b\n\n## Edges\n\n- V-001 -> V-002\n"),
    );
    expect(edgeOf(g, "V-001", "V-002").geometry.points).toHaveLength(2);
  });
});

describe("layoutIfdam: pins and stickies", () => {
  it("puts a node with @ at that centre without moving the others", () => {
    const free = layoutIfdam(parseIfdam(FIGURE));
    const pinned = layoutIfdam(parseIfdam(FIGURE.replace("- V-005 Todo を登録する task:T-0100", "- V-005 Todo を登録する task:T-0100 @700,500")));
    expect(pinned.byId.get("V-005")).toMatchObject({ cx: 700, cy: 500, placed: true });
    for (const id of ["V-001", "V-002", "V-003", "V-004", "V-006", "V-007", "V-008"]) {
      expect(pinned.byId.get(id)!.cx).toBe(free.byId.get(id)!.cx);
      expect(pinned.byId.get(id)!.cy).toBe(free.byId.get(id)!.cy);
    }
  });

  it("holds the dragged node at the pinned spot", () => {
    const g = layoutIfdam(parseIfdam(FIGURE), [], { pinned: { id: "V-003", cx: 10, cy: 20 } });
    expect(g.byId.get("V-003")).toMatchObject({ cx: 10, cy: 20, x: 10 - g.byId.get("V-003")!.width / 2 });
  });

  it("carries the memo to the hover text and the stickies to their node", () => {
    const d = parseIfdam(FIGURE.replace("- V-002 「追加」ボタンをクリック ^trigger", "- V-002 「追加」ボタンをクリック ^trigger\n  hover text\n  show: kept as memo"));
    const g = layoutIfdam(d, [{ id: "S-001", targetId: "V-005", dx: 10, dy: 10, text: "n", color: "amber" } as never]);
    expect(g.byId.get("V-002")!.note).toBe("hover text\nshow: kept as memo");
    expect(g.byId.get("V-001")!.note).toBeUndefined();
    expect(g.stickies).toHaveLength(1);
  });
});

describe("nodeTextY", () => {
  it("sets a screen's title at the top and any other title on the centre line", () => {
    const g = layoutIfdam(parseIfdam(FIGURE));
    const s = g.byId.get("V-001")!;
    expect(nodeTextY(s, 0)).toBeLessThan(s.y + s.band);
    expect(nodeTextY(s, 0)).toBeGreaterThan(s.y);
    const p = g.byId.get("V-005")!;
    expect(Math.abs(nodeTextY(p, 0) - p.cy)).toBeLessThan(10);
    const store = g.byId.get("V-006")!;
    expect(nodeTextY(store, 0)).toBeGreaterThan(store.cy); // clear of the lid
  });

  it("uses each shape's registered outline for the arrows' sake", () => {
    const g = layoutIfdam(parseIfdam(FIGURE));
    for (const n of g.nodes) expect(shapeOf(n.shape).id).toBe(n.shape);
  });
});

describe("edge ports (T-0719)", () => {
  it("starts and lands a pinned arrow exactly on its ports", () => {
    const doc = parseIfdam(`---
type: ifdam
title: t
---

## Nodes

- V-001 Screen ^screen
  show: Item
- V-002 Do it

## Edges

- V-001:E -> V-002:W

## Stickies
`);
    const layout = layoutIfdam(doc);
    const pinned = layout.edges.filter((e) => e.from === "V-001" && e.to === "V-002");
    expect(pinned).toHaveLength(1);
    const [edge] = pinned;
    const from = layout.byId.get("V-001")!;
    const to = layout.byId.get("V-002")!;
    expect([edge.geometry.start.x, edge.geometry.start.y]).toEqual([
      from.x + from.width,
      from.y + from.height / 2,
    ]);
    expect([edge.geometry.end.x, edge.geometry.end.y]).toEqual([to.x, to.y + to.height / 2]);
  });
});
