import { describe, expect, it } from "vitest";
import { layoutAlgorithm } from "./layout";
import {
  addNode,
  addNodeAfter,
  applyPatch,
  autoAlign,
  connect,
  deleteEdge,
  deleteNode,
  hasManualPositions,
  moveNodeTo,
  nudgeNode,
  patchNode,
  reattach,
  setEdgeLabel,
  setNodeKind,
} from "./ops";
import { parseAlgorithm, serializeAlgorithm } from "./parse";

const NOTE = `---
type: algorithm
title: t
created: 2026-10-10
updated: 2026-10-10
---

## Nodes

- A-001 開始 ^start @100,40
- A-002 在庫あり? ^decision
- A-003 引き当てる ^sub task:T-1 #blue
  メモ。
- A-004 待つ
- A-009 終了 ^end @300,400

## Edges

- A-001 -> A-002
- A-002 -> A-003 "はい"
- A-002 -> A-004 "いいえ"
- A-003 -> A-009
- A-004 -> A-002

## Stickies

- S-001 node:A-003 @40,-20 #red 要確認
- S-002 node:A-004 @32,24 別の付箋

## Memo

触らない。
`;

const docOf = () => parseAlgorithm(NOTE);

describe("addNode", () => {
  it("takes the next free id, never reusing a lower or deleted one", () => {
    const a = addNode(docOf(), { title: "x" });
    expect(a.id).toBe("A-010");
    expect(a.doc.nodes.at(-1)).toEqual({ id: "A-010", title: "x", kind: "process" });
    // Delete the newest and add again: the number is taken from what remains.
    const b = addNode(deleteNode(a.doc, "A-010"), {});
    expect(b.id).toBe("A-010");
    expect(addNode(deleteNode(docOf(), "A-009"), {}).id).toBe("A-005");
  });

  it("writes a position only when both coordinates are given, rounded", () => {
    expect(addNode(docOf(), { x: 10.6, y: -3.2 }).doc.nodes.at(-1)).toMatchObject({ x: 11, y: -3 });
    expect(addNode(docOf(), { x: 10 }).doc.nodes.at(-1)!.x).toBeUndefined();
    expect(addNode(docOf(), { kind: "io" }).doc.nodes.at(-1)!.kind).toBe("io");
  });
});

describe("addNodeAfter", () => {
  it("adds a node and joins it to the one it follows, leaving it to the layout", () => {
    const r = addNodeAfter(docOf(), "A-003", { title: "次" });
    expect(r.id).toBe("A-010");
    expect(r.doc.edges.at(-1)).toEqual({ from: "A-003", to: "A-010" });
    expect(r.doc.nodes.at(-1)!.x).toBeUndefined();
  });

  it("makes the new node the next exit of a decision, last in the order written", () => {
    const doc = docOf();
    const r = addNodeAfter(doc, "A-002", { kind: "io", title: "出力" });
    const exits = r.doc.edges.filter((e) => e.from === "A-002").map((e) => e.to);
    expect(exits).toEqual(["A-003", "A-004", "A-010"]);
    // The first exit is still the trunk; the new one goes to a column of its own.
    const l = layoutAlgorithm(r.doc);
    expect(l.byId.get("A-003")!.cx).toBe(l.byId.get("A-002")!.cx);
    expect(l.byId.get("A-010")!.cx).not.toBe(l.byId.get("A-002")!.cx);
  });

  it("adds the node alone for an unknown source", () => {
    const r = addNodeAfter(docOf(), "A-404");
    expect(r.doc.nodes).toHaveLength(6);
    expect(r.doc.edges).toEqual(docOf().edges);
  });
});

describe("patchNode and setNodeKind", () => {
  it("changes fields, removes one set to undefined, and keeps the id", () => {
    const d = patchNode(docOf(), "A-003", { color: undefined, title: "新", id: "A-777" });
    const n = d.nodes.find((x) => x.id === "A-003")!;
    expect(n).toMatchObject({ title: "新", task: "T-1", note: "メモ。" });
    expect("color" in n).toBe(false);
    expect(d.nodes.some((x) => x.id === "A-777")).toBe(false);
  });

  it("changes the kind and the arrows and stickies stay put", () => {
    const d = setNodeKind(docOf(), "A-004", "io");
    expect(d.nodes.find((n) => n.id === "A-004")!.kind).toBe("io");
    expect(d.edges).toEqual(docOf().edges);
    expect(serializeAlgorithm(NOTE, d, "2026-10-10")).toContain("- A-004 待つ ^io\n");
  });

  it("applyPatch leaves its input alone", () => {
    const base = { a: 1, b: 2 };
    expect(applyPatch(base, { b: undefined })).toEqual({ a: 1 });
    expect(base).toEqual({ a: 1, b: 2 });
  });
});

describe("deleteNode", () => {
  it("takes its arrows and stickies with it and nothing else", () => {
    const d = deleteNode(docOf(), "A-004");
    expect(d.nodes.map((n) => n.id)).toEqual(["A-001", "A-002", "A-003", "A-009"]);
    expect(d.edges).toEqual([
      { from: "A-001", to: "A-002" },
      { from: "A-002", to: "A-003", label: "はい" },
      { from: "A-003", to: "A-009" },
    ]);
    expect(d.stickies.map((s) => s.targetId)).toEqual(["A-003"]);
  });

  it("keeps a raw line it does not understand", () => {
    const withRaw = parseAlgorithm(`${NOTE.replace("## Stickies", "- see the sketch\n\n## Stickies")}`);
    expect(withRaw.rawEdges).toEqual(["- see the sketch"]);
    expect(deleteNode(withRaw, "A-004").rawEdges).toEqual(["- see the sketch"]);
  });
});

describe("positions", () => {
  it("writes a @ only on the node that was dragged", () => {
    const d = moveNodeTo(docOf(), "A-002", 150.4, 99.6);
    expect(d.nodes.find((n) => n.id === "A-002")).toMatchObject({ x: 150, y: 100 });
    expect(d.nodes.find((n) => n.id === "A-004")!.x).toBeUndefined();
    expect(d.nodes.find((n) => n.id === "A-001")).toMatchObject({ x: 100, y: 40 });
  });

  it("nudges from where the node is drawn, written as a @", () => {
    const doc = docOf();
    const l = layoutAlgorithm(doc);
    const d = nudgeNode(doc, l, "A-004", 8, -4);
    const laid = l.byId.get("A-004")!;
    expect(d.nodes.find((n) => n.id === "A-004")).toMatchObject({
      x: Math.round(laid.cx + 8),
      y: Math.round(laid.cy - 4),
    });
    expect(nudgeNode(doc, l, "A-404", 8, 8)).toBe(doc);
  });

  it("auto-align removes every @ and only that", () => {
    const d = autoAlign(docOf());
    expect(d.nodes.every((n) => n.x === undefined && n.y === undefined)).toBe(true);
    expect(d.nodes.find((n) => n.id === "A-003")).toMatchObject({ task: "T-1", color: "blue", kind: "sub" });
    expect(hasManualPositions(docOf())).toBe(true);
    expect(hasManualPositions(d)).toBe(false);
  });
});

describe("arrows", () => {
  it("connects two nodes once, and never a node to itself", () => {
    const doc = docOf();
    const c = connect(doc, "A-001", "A-003");
    expect(c.edges.at(-1)).toEqual({ from: "A-001", to: "A-003" });
    expect(connect(c, "A-001", "A-003")).toBe(c);
    expect(connect(doc, "A-001", "A-001")).toBe(doc);
    expect(connect(doc, "A-001", "A-002")).toBe(doc);
  });

  it("lets any two kinds join, and a decision take any number of exits", () => {
    let d = docOf();
    for (const to of ["A-001", "A-009"]) d = connect(d, "A-002", to);
    expect(d.edges.filter((e) => e.from === "A-002")).toHaveLength(4);
  });

  it("moves an end of an arrow, merging into an existing pair and keeping its label", () => {
    const doc = docOf();
    const moved = reattach(doc, { from: "A-002", to: "A-004" }, "to", "A-009");
    expect(moved.edges).toContainEqual({ from: "A-002", to: "A-009", label: "いいえ" });
    const merged = reattach(doc, { from: "A-002", to: "A-004" }, "to", "A-003");
    expect(merged.edges.filter((e) => e.from === "A-002" && e.to === "A-003")).toEqual([
      { from: "A-002", to: "A-003", label: "はい" },
    ]);
    expect(merged.edges).toHaveLength(doc.edges.length - 1);
    expect(reattach(doc, { from: "A-002", to: "A-004" }, "to", "A-002")).toBe(doc);
  });

  it("sets, trims and clears a label", () => {
    const edge = { from: "A-003", to: "A-009" };
    const set = setEdgeLabel(docOf(), edge, "  完了  ");
    expect(set.edges.find((e) => e.to === "A-009")!.label).toBe("完了");
    const cleared = setEdgeLabel(set, edge, "  ");
    expect("label" in cleared.edges.find((e) => e.to === "A-009")!).toBe(false);
  });

  it("deletes one arrow", () => {
    const d = deleteEdge(docOf(), { from: "A-004", to: "A-002" });
    expect(d.edges).toHaveLength(4);
    expect(d.edges.some((e) => e.from === "A-004")).toBe(false);
  });
});

describe("through the file", () => {
  it("an edited document still round-trips and keeps ## Memo", () => {
    let d = docOf();
    d = addNodeAfter(d, "A-009", { kind: "end", title: "後始末" }).doc;
    d = setEdgeLabel(d, { from: "A-009", to: "A-010" }, "常に");
    const out = serializeAlgorithm(NOTE, d, "2026-10-11");
    expect(out.endsWith("## Memo\n\n触らない。\n")).toBe(true);
    expect(parseAlgorithm(out).nodes.at(-1)).toMatchObject({ id: "A-010", kind: "end", title: "後始末" });
    expect(parseAlgorithm(out).edges.at(-1)).toEqual({ from: "A-009", to: "A-010", label: "常に" });
  });
});

describe("edge ports (T-0719)", () => {
  const NOTE = `---
type: algorithm
title: t
---

## Nodes

- A-001 Start ^start
- A-002 Step
- A-003 End ^end

## Edges

## Stickies
`;

  it("connects with pins, and reattaching pins the moved end anew", () => {
    const doc = parseAlgorithm(NOTE);
    const pinned = connect(doc, "A-001", "A-002", {
      fromPort: { side: "E" },
      toPort: { side: "W", at: 0.25 },
    });
    expect(pinned.edges).toEqual([
      { from: "A-001", to: "A-002", fromPort: { side: "E" }, toPort: { side: "W", at: 0.25 } },
    ]);
    const moved = reattach(pinned, { from: "A-001", to: "A-002" }, "to", "A-003", {
      side: "N",
    });
    expect(moved.edges).toEqual([
      { from: "A-001", to: "A-003", fromPort: { side: "E" }, toPort: { side: "N" } },
    ]);
    const cleared = reattach(moved, { from: "A-001", to: "A-003" }, "to", "A-003", null);
    expect(cleared.edges).toEqual([{ from: "A-001", to: "A-003", fromPort: { side: "E" } }]);
  });
});
