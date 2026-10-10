import { describe, expect, it } from "vitest";
import { ringBubbleSide, ringClearance } from "../graph-layout";
import { BUBBLE_TAIL, speechBubbleOutline } from "../shapes";
import { boundsOfBoxes } from "../sticky-layout";
import {
  BUBBLE_MAX_WIDTH,
  layoutUsecase,
  measureBubble,
  ringClearanceFor,
  measureNode,
  nodeTextY,
  ORIGIN,
} from "./layout";
import { parseUsecase, type UsecaseNode } from "./parse";

const NOTE = `---
type: usecase
title: 施設予約システム
---

## Nodes

- U-001 予約システム ^system
  hover で出るメモ。
- U-002 窓口担当者 #blue
  施設の空き状況を見る
  予約を代理で登録する
- U-003 利用者 #green
  空き状況を調べる
  予約を申し込む
- U-004 施設管理者 @90,60
  施設と開館日を登録する
- U-005 決済サービス ^ext task:T-0100

## Edges

- U-002 -- U-001
- U-003 -- U-001
- U-004 -- U-001
- U-001 -> U-005 "決済を依頼"
- U-005 -- U-005
`;

const doc = parseUsecase(NOTE);

const person = (id: string, actions: string[]): UsecaseNode => ({
  id,
  title: `人 ${id}`,
  kind: "person",
  ...(actions.length ? { note: actions.join("\n") } : {}),
});

describe("measureNode", () => {
  it("sizes a person as icon + name, at least 88 wide, wrapping the name at 140", () => {
    const small = measureNode("客", "person");
    expect(small.width).toBe(88);
    expect(small.height).toBeGreaterThanOrEqual(44 + 6 + 18);
    const long = measureNode("とても長い名前の役割を持つ担当者のかたがた", "person");
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.height).toBeGreaterThan(small.height);
  });

  it("sizes a system at least 200x120 and an external service at least 120x48", () => {
    expect(measureNode("S", "system")).toMatchObject({ width: 200, height: 120 });
    expect(measureNode("決済", "ext")).toMatchObject({ width: 120, height: 48 });
    expect(measureNode("とても長い名前の外部のサービスをここに書く", "ext").lines.length).toBeGreaterThan(1);
  });
});

describe("measureBubble", () => {
  it("is null without actions", () => {
    expect(measureBubble([])).toBeNull();
  });

  it("fits the longest line, at most 200 wide, and wraps long items with a hanging indent", () => {
    const short = measureBubble(["見る"])!;
    expect(short.width).toBeLessThan(BUBBLE_MAX_WIDTH);
    const long = measureBubble(["とても長い項目の文章をここにずらずらと書いていくと折り返される"])!;
    expect(long.width).toBeLessThanOrEqual(BUBBLE_MAX_WIDTH);
    expect(long.items[0].lines.length).toBeGreaterThan(1);
    expect(long.height).toBeGreaterThan(short.height);
  });

  it("stacks the items without a gap in between and no cap on the height", () => {
    const m = measureBubble(Array.from({ length: 12 }, (_, i) => `項目 ${i}`))!;
    expect(m.items).toHaveLength(12);
    expect(m.items[1].y - m.items[0].y).toBeCloseTo(12 * 1.45, 5);
    expect(m.height).toBeGreaterThan(12 * 17);
  });
});

describe("layoutUsecase", () => {
  const layout = layoutUsecase(doc);

  it("puts the system in the middle and everything else around it, from 12 o'clock clockwise", () => {
    const sys = layout.byId.get("U-001")!;
    const around = ["U-002", "U-003", "U-005"].map((id) => layout.byId.get(id)!);
    // U-004 is pinned; the other three are on the ring of 4 (U-004 takes part)
    const first = around[0];
    expect(first.cy).toBeLessThan(sys.cy);
    for (const n of around) {
      expect(ringClearance(n, sys)).toBeGreaterThanOrEqual(32);
    }
    // 4 items: top, right, bottom, left
    expect(layout.byId.get("U-003")!.cx).toBeGreaterThan(sys.cx);
    expect(layout.byId.get("U-005")!.cx).toBeLessThan(sys.cx);
  });

  it("places a node with @x,y exactly there, and marks it placed", () => {
    const n = layout.byId.get("U-004")!;
    expect([n.cx, n.cy]).toEqual([90, 60]);
    expect(n.placed).toBe(true);
    expect(layout.byId.get("U-002")!.placed).toBe(false);
  });

  it("does not move the other nodes when one is pinned", () => {
    const free = layoutUsecase({ ...doc, nodes: doc.nodes.map(({ x: _x, y: _y, ...n }) => n) });
    for (const id of ["U-001", "U-002", "U-003", "U-005"]) {
      expect([layout.byId.get(id)!.cx, layout.byId.get(id)!.cy]).toEqual([
        free.byId.get(id)!.cx,
        free.byId.get(id)!.cy,
      ]);
    }
  });

  it("gives a bubble to each person with actions, none to systems, external services or empty people", () => {
    expect([...layout.bubbleOf.keys()].sort()).toEqual(["U-002", "U-003", "U-004"]);
    const withEmpty = layoutUsecase({ nodes: [...doc.nodes, person("U-009", [])], edges: [] });
    expect(withEmpty.bubbleOf.has("U-009")).toBe(false);
  });

  it("puts a system's note on the node as a hover memo, not in a bubble", () => {
    expect(layout.byId.get("U-001")!.note).toBe("hover で出るメモ。");
    expect(layout.byId.get("U-002")!.note).toBeUndefined();
  });

  it("puts each bubble on the outer side, clear of its person and the system", () => {
    const sys = layout.byId.get("U-001")!;
    for (const b of layout.bubbles) {
      const p = layout.byId.get(b.nodeId)!;
      expect(ringClearance(b, p)).toBeGreaterThanOrEqual(13.9);
      expect(ringClearance(b, sys)).toBeGreaterThan(0);
      // outer: the bubble is further from the system's centre than the person
      const dBubble = Math.hypot(b.x + b.width / 2 - sys.cx, b.y + b.height / 2 - sys.cy);
      const dPerson = Math.hypot(p.cx - sys.cx, p.cy - sys.cy);
      expect(dBubble).toBeGreaterThan(dPerson);
    }
  });

  it("gives the bubble a tail on the side facing the person, usable by speechBubbleOutline", () => {
    for (const b of layout.bubbles) {
      const opposite = { left: "right", right: "left", top: "bottom", bottom: "top" } as const;
      expect(b.tailSide).toBe(opposite[b.side]);
      expect(speechBubbleOutline(b, b.tailSide).attrs.d).toMatch(/^M .* Z$/);
    }
  });

  it("makes the bubble follow a dragged person, on the outer side of where it lands", () => {
    const dragged = layoutUsecase(doc, [], { pinned: { id: "U-002", cx: 700, cy: 400 } });
    const p = dragged.byId.get("U-002")!;
    expect([p.cx, p.cy]).toEqual([700, 400]);
    const b = dragged.bubbleOf.get("U-002")!;
    const sys = dragged.byId.get("U-001")!;
    expect(b.side).toBe(ringBubbleSide(p.cx - sys.cx, p.cy - sys.cy));
    expect(b.side).toBe("right");
    expect(ringClearance(b, p)).toBeCloseTo(14, 1);
  });

  it("draws straight lines cut at the outlines; an arrow has a head, a line has none; a self line is dropped", () => {
    expect(layout.edges).toHaveLength(4);
    const arrow = layout.edges.find((e) => e.from === "U-001" && e.to === "U-005")!;
    expect(arrow.head).toBe(true);
    expect(arrow.label).toBe("決済を依頼");
    expect(arrow.labelBox).toBeDefined();
    const line = layout.edges.find((e) => e.from === "U-002")!;
    expect(line.head).toBe(false);
    expect(line.geometry.style).toBe("straight");
    expect(line.geometry.points).toHaveLength(2);
    expect(layout.edges.some((e) => e.from === e.to)).toBe(false);
  });

  it("puts the label at the middle of the line", () => {
    const arrow = layout.edges.find((e) => e.label)!;
    const box = arrow.labelBox!;
    expect(box.x + box.width / 2).toBeCloseTo(arrow.geometry.mid.x, 5);
    expect(box.y + box.height / 2).toBeCloseTo(arrow.geometry.mid.y, 5);
  });

  it("keeps a label clear of every node: the ring leaves room for it on the line", () => {
    const long = parseUsecase(
      [
        "---",
        "type: usecase",
        "---",
        "",
        "## Nodes",
        "",
        "- U-001 S ^system",
        "- U-002 客",
        "- U-003 外部 ^ext",
        "",
        "## Edges",
        "",
        '- U-001 -> U-003 "決済を依頼する長いラベル"',
        '- U-002 -- U-001 "利用"',
        "",
      ].join("\n"),
    );
    const l = layoutUsecase(long);
    expect(l.edges.filter((e) => e.labelBox)).toHaveLength(2);
    for (const e of l.edges) {
      for (const n of l.nodes) expect(ringClearance(e.labelBox!, n)).toBeGreaterThanOrEqual(0);
    }
    expect(ringClearanceFor(long.edges)).toBeGreaterThan(32);
    expect(ringClearanceFor([])).toBe(32);
  });

  it("has bounds covering every node, bubble (tail included), label and sticky, from the origin", () => {
    const stickied = layoutUsecase(doc, [
      { id: "S-001", targetId: "U-003", dx: 40, dy: -30, color: "red", text: "メモ" },
    ]);
    expect(stickied.stickies).toHaveLength(1);
    const all = boundsOfBoxes([...stickied.nodes, ...stickied.bubbles, ...stickied.stickies]);
    expect(stickied.bounds.x).toBeLessThanOrEqual(all.x);
    expect(stickied.bounds.y).toBeLessThanOrEqual(all.y);
    expect(stickied.bounds.x + stickied.bounds.width).toBeGreaterThanOrEqual(all.x + all.width);
    expect(stickied.bounds.y + stickied.bounds.height).toBeGreaterThanOrEqual(all.y + all.height);
    // the ring part starts at the origin; the tail is the 8px beyond the bubble box
    const free = layoutUsecase({ nodes: doc.nodes.map(({ x: _x, y: _y, ...n }) => n), edges: [] });
    expect(free.bounds.x).toBeGreaterThanOrEqual(ORIGIN - BUBBLE_TAIL);
    expect(free.bounds.y).toBeGreaterThanOrEqual(ORIGIN - BUBBLE_TAIL);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(layoutUsecase(doc))).toBe(JSON.stringify(layoutUsecase(doc)));
  });

  it("draws an empty note and a note with no system", () => {
    expect(layoutUsecase({ nodes: [], edges: [] }).bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    const noSystem = layoutUsecase({ nodes: [person("U-001", ["a"]), person("U-002", ["b"])], edges: [] });
    expect(noSystem.nodes).toHaveLength(2);
  });

  it("styles the symbols: thick bold system, dashed external service, plain person", () => {
    expect(layout.byId.get("U-001")).toMatchObject({ strokeWidth: 2.5, bold: true });
    expect(layout.byId.get("U-005")!.dash).toBeDefined();
    expect(layout.byId.get("U-002")!.dash).toBeUndefined();
  });

  it("writes a person's name under the icon, a system's title at the top, a service's in the middle", () => {
    const p = layout.byId.get("U-002")!;
    expect(nodeTextY(p, 0)).toBeGreaterThan(p.y + 50);
    const s = layout.byId.get("U-001")!;
    expect(nodeTextY(s, 0)).toBeLessThan(s.y + 40);
    const e = layout.byId.get("U-005")!;
    expect(Math.abs(nodeTextY(e, 0) - e.cy)).toBeLessThan(8);
  });
});

describe("properties", () => {
  const actions = (n: number, lines = 1) =>
    Array.from({ length: n }, (_, i) =>
      lines === 1 ? `やること ${i}` : `やること ${i} ` + "とても長い説明の文章 ".repeat(lines * 2),
    );

  for (const systems of [0, 1, 2]) {
    for (const count of [1, 2, 3, 5, 8, 12]) {
      it(`keeps cells apart for ${systems} systems and ${count} people`, () => {
        const nodes: UsecaseNode[] = [];
        for (let s = 0; s < systems; s++) nodes.push({ id: `U-0${s + 1}0`, title: `S${s}`, kind: "system" });
        for (let i = 0; i < count; i++) nodes.push(person(`U-1${String(i).padStart(2, "0")}`, actions(1 + (i % 4), 1 + (i % 3))));
        nodes.push({ id: "U-200", title: "外部", kind: "ext" });
        const l = layoutUsecase({ nodes, edges: [] });
        const cells = l.nodes
          .filter((n) => n.kind !== "system")
          .map((n) => {
            const b = l.bubbleOf.get(n.id);
            return { id: n.id, box: b ? boundsOfBoxes([n, b]) : { x: n.x, y: n.y, width: n.width, height: n.height } };
          });
        for (let i = 0; i < cells.length; i++) {
          for (const sys of l.nodes.filter((n) => n.kind === "system")) {
            expect(ringClearance(cells[i].box, sys)).toBeGreaterThanOrEqual(32 - 1e-6);
          }
          for (let j = i + 1; j < cells.length; j++) {
            expect(ringClearance(cells[i].box, cells[j].box)).toBeGreaterThanOrEqual(24 - 1e-6);
          }
        }
        expect(JSON.stringify(l)).toBe(JSON.stringify(layoutUsecase({ nodes, edges: [] })));
      });
    }
  }
});

describe("golden", () => {
  it("lays out one system and two people at fixed coordinates", () => {
    const l = layoutUsecase({
      nodes: [
        { id: "U-001", title: "システム", kind: "system" },
        person("U-002", ["a"]),
        person("U-003", ["b"]),
      ],
      edges: [],
    });
    const pos = Object.fromEntries(l.nodes.map((n) => [n.id, [n.cx, n.cy]]));
    // U-002 at 12 o'clock, U-003 at 6 o'clock: same column, system between them
    expect(pos["U-002"][0]).toBe(pos["U-001"][0]);
    expect(pos["U-003"][0]).toBe(pos["U-001"][0]);
    expect(pos["U-002"][1]).toBeLessThan(pos["U-001"][1]);
    expect(pos["U-003"][1]).toBeGreaterThan(pos["U-001"][1]);
    expect(l.bubbleOf.get("U-002")!.side).toBe("top");
    expect(l.bubbleOf.get("U-003")!.side).toBe("bottom");
  });
});
