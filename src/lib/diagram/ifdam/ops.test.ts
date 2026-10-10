import { describe, expect, it } from "vitest";
import { layoutIfdam } from "./layout";
import {
  addNode,
  addNodeAfter,
  addSectionItem,
  autoAlign,
  connect,
  deleteEdge,
  deleteNode,
  hasManualPositions,
  moveNodeTo,
  nudgeNode,
  patchNode,
  reattach,
  removeSectionItem,
  setEdgeLabel,
  setMemo,
  setNodeKind,
  setSectionItem,
} from "./ops";
import { formatNode, memoOf, parseIfdam, sectionItems, serializeIfdam } from "./parse";

const NOTE = `---
type: ifdam
title: t
updated: 2026-10-10
---

## Nodes

- V-001 一覧 ^screen
  show: 一覧
  memo one
  input: 検索語
  show: 件数
  memo two
  action: 追加
- V-002 追加ボタン ^trigger
- V-003 登録する
- V-004 Todo ^store

## Edges

- V-001 -> V-002
- V-002 -> V-003
- V-003 -> V-004

## Stickies

- S-001 node:V-003 @10,10 #amber note

## Memo

keep
`;

const doc = () => parseIfdam(NOTE);
const linesOf = (d: ReturnType<typeof doc>, id: string) => formatNode(d.nodes.find((n) => n.id === id)!).slice(1);

describe("nodes", () => {
  it("adds a node with the next id, as a process by default, unplaced", () => {
    const { doc: d, id } = addNode(doc());
    expect(id).toBe("V-005");
    expect(d.nodes[4]).toEqual({ id: "V-005", title: "", kind: "process", lines: [] });
    expect(addNode(doc(), { kind: "screen", title: "S", x: 10.4, y: 20.6 }).doc.nodes[4]).toMatchObject({
      kind: "screen",
      x: 10,
      y: 21,
    });
  });

  it("adds after a node the element that normally follows, and joins them", () => {
    let d = doc();
    const kinds: [string, string][] = [];
    for (const from of ["V-001", "V-002", "V-003", "V-004"]) {
      const added = addNodeAfter(d, from);
      d = added.doc;
      kinds.push([from, d.nodes.find((n) => n.id === added.id)!.kind]);
      expect(d.edges.some((e) => e.from === from && e.to === added.id)).toBe(true);
    }
    expect(kinds).toEqual([
      ["V-001", "trigger"],
      ["V-002", "process"],
      ["V-003", "message"],
      ["V-004", "process"],
    ]);
    expect(addNodeAfter(doc(), "V-003", { kind: "store" }).doc.nodes[4].kind).toBe("store");
    expect(addNodeAfter(doc(), "V-999").doc.edges).toHaveLength(3);
  });

  it("never changes an id, and removes a key patched to undefined", () => {
    const d = patchNode(moveNodeTo(doc(), "V-002", 5, 6), "V-002", { id: "V-999", x: undefined, y: undefined, title: "x" });
    expect(d.nodes[1]).toMatchObject({ id: "V-002", title: "x" });
    expect("x" in d.nodes[1]).toBe(false);
  });

  it("deletes a node with its arrows and stickies", () => {
    const d = deleteNode(doc(), "V-003");
    expect(d.nodes.map((n) => n.id)).toEqual(["V-001", "V-002", "V-004"]);
    expect(d.edges).toEqual([{ from: "V-001", to: "V-002" }]);
    expect(d.stickies).toHaveLength(0);
  });

  it("moves, nudges from where it is drawn, and auto-aligns", () => {
    let d = moveNodeTo(doc(), "V-003", 100.4, 200.6);
    expect(d.nodes[2]).toMatchObject({ x: 100, y: 201 });
    expect(hasManualPositions(d)).toBe(true);
    expect(hasManualPositions(autoAlign(d))).toBe(false);
    const layout = layoutIfdam(doc());
    const at = layout.byId.get("V-002")!;
    d = nudgeNode(doc(), layout, "V-002", 8, -8);
    expect(d.nodes[1]).toMatchObject({ x: Math.round(at.cx + 8), y: Math.round(at.cy - 8) });
    expect(nudgeNode(doc(), layout, "V-404", 1, 1).nodes).toEqual(doc().nodes);
  });
});

describe("a node's kind", () => {
  it("changes the mark, not the id, and keeps every line of a screen turned into something else", () => {
    const d = setNodeKind(doc(), "V-001", "process");
    expect(d.nodes[0].id).toBe("V-001");
    expect(linesOf(d, "V-001")).toEqual([
      "  show: 一覧",
      "  memo one",
      "  input: 検索語",
      "  show: 件数",
      "  memo two",
      "  action: 追加",
    ]);
    // on a process these are memo lines, as the file will read them next time
    expect(d.nodes[0].lines.every((l) => l.key === null)).toBe(true);
    expect(memoOf(d.nodes[0])).toContain("show: 一覧");
  });

  it("makes a process's `show:` lines items when it becomes a screen, matching what the file says", () => {
    const withMemo = parseIfdam("## Nodes\n\n- V-001 a\n  show: x\n  plain\n");
    expect(withMemo.nodes[0].lines).toEqual([
      { key: null, text: "show: x" },
      { key: null, text: "plain" },
    ]);
    const d = setNodeKind(withMemo, "V-001", "screen");
    expect(d.nodes[0].lines).toEqual([
      { key: "show", text: "x" },
      { key: null, text: "plain" },
    ]);
    // and the same document read back from the file it would write
    const text = serializeIfdam("## Nodes\n", d, "2026-10-11");
    expect(parseIfdam(text).nodes[0]).toEqual(d.nodes[0]);
  });

  it("goes to a screen and back without losing a line", () => {
    const d = setNodeKind(setNodeKind(doc(), "V-001", "store"), "V-001", "screen");
    expect(d.nodes[0].lines).toEqual(doc().nodes[0].lines);
  });
});

describe("a screen's items", () => {
  it("adds an item after the last one of its section, moving nothing else", () => {
    const d = addSectionItem(doc(), "V-001", "show", "新しい表示");
    expect(linesOf(d, "V-001")).toEqual([
      "  show: 一覧",
      "  memo one",
      "  input: 検索語",
      "  show: 件数",
      "  show: 新しい表示",
      "  memo two",
      "  action: 追加",
    ]);
  });

  it("puts the first item of an empty section at the end of the lines", () => {
    const d = addSectionItem(parseIfdam("## Nodes\n\n- V-001 s ^screen\n  show: a\n  memo\n"), "V-001", "input", "q");
    expect(linesOf(d, "V-001")).toEqual(["  show: a", "  memo", "  input: q"]);
  });

  it("ignores empty text and nodes that are not screens", () => {
    const d = doc();
    expect(addSectionItem(d, "V-001", "show", "  ")).toBe(d);
    expect(addSectionItem(d, "V-002", "show", "x")).toBe(d);
    expect(addSectionItem(d, "V-404", "show", "x")).toBe(d);
  });

  it("changes the nth item of a section, and removes it when emptied", () => {
    let d = setSectionItem(doc(), "V-001", "show", 1, "件数（合計）");
    expect(sectionItems(d.nodes[0], "show")).toEqual(["一覧", "件数（合計）"]);
    expect(linesOf(d, "V-001")[3]).toBe("  show: 件数（合計）");
    d = setSectionItem(d, "V-001", "show", 0, "   ");
    expect(sectionItems(d.nodes[0], "show")).toEqual(["件数（合計）"]);
    expect(linesOf(d, "V-001")).toEqual(["  memo one", "  input: 検索語", "  show: 件数（合計）", "  memo two", "  action: 追加"]);
  });

  it("removes one item and leaves the rest where they are", () => {
    const d = removeSectionItem(doc(), "V-001", "input", 0);
    expect(sectionItems(d.nodes[0], "input")).toEqual([]);
    expect(d.nodes[0].lines).toHaveLength(5);
    expect(removeSectionItem(doc(), "V-001", "input", 3).nodes).toEqual(doc().nodes);
  });

  it("keeps a multi-line item to one line", () => {
    const d = addSectionItem(doc(), "V-001", "action", "a\nb");
    expect(sectionItems(d.nodes[0], "action")).toEqual(["追加", "a b"]);
  });
});

describe("memo", () => {
  it("replaces only the memo lines of a screen, in the place of the first", () => {
    const d = setMemo(doc(), "V-001", "new one\nnew two\n\nnew three");
    expect(linesOf(d, "V-001")).toEqual([
      "  show: 一覧",
      "  new one",
      "  new two",
      "  new three",
      "  input: 検索語",
      "  show: 件数",
      "  action: 追加",
    ]);
    expect(setMemo(doc(), "V-001", "").nodes[0].lines.every((l) => l.key !== null)).toBe(true);
  });

  it("puts a first memo of a screen after its items", () => {
    const d = setMemo(parseIfdam("## Nodes\n\n- V-001 s ^screen\n  show: a\n"), "V-001", "m");
    expect(linesOf(d, "V-001")).toEqual(["  show: a", "  m"]);
  });

  it("is the whole body of any other node", () => {
    const d = setMemo(parseIfdam("## Nodes\n\n- V-001 t ^trigger\n  show: old\n"), "V-001", "x\ny");
    expect(linesOf(d, "V-001")).toEqual(["  x", "  y"]);
  });
});

describe("arrows", () => {
  it("connects, once per pair and never a node to itself", () => {
    const d = doc();
    expect(connect(d, "V-001", "V-003").edges).toHaveLength(4);
    expect(connect(d, "V-001", "V-002")).toBe(d);
    expect(connect(d, "V-001", "V-001")).toBe(d);
    // any two different nodes may be joined, a store to a screen included
    expect(connect(d, "V-004", "V-001").edges).toHaveLength(4);
  });

  it("re-attaches an end, merging into an existing arrow", () => {
    const d = reattach(doc(), { from: "V-002", to: "V-003" }, "to", "V-004");
    expect(d.edges).toContainEqual({ from: "V-002", to: "V-004" });
    const same = doc();
    expect(reattach(same, { from: "V-002", to: "V-003" }, "to", "V-003")).toBe(same);
  });

  it("sets, clears and deletes", () => {
    let d = setEdgeLabel(doc(), { from: "V-002", to: "V-003" }, " 成功 ");
    expect(d.edges[1].label).toBe("成功");
    d = setEdgeLabel(d, { from: "V-002", to: "V-003" }, "");
    expect("label" in d.edges[1]).toBe(false);
    expect(deleteEdge(d, { from: "V-002", to: "V-003" }).edges).toHaveLength(2);
  });
});

describe("edge ports (T-0719)", () => {
  const NOTE = `---
type: ifdam
title: t
---

## Nodes

- V-001 Screen ^screen
  show: Item
- V-002 Do it
- V-003 Store ^store

## Edges

## Stickies
`;

  it("connects with pins, and reattaching pins the moved end anew", () => {
    const doc = parseIfdam(NOTE);
    const pinned = connect(doc, "V-001", "V-002", {
      fromPort: { side: "E" },
      toPort: { side: "W", at: 0.25 },
    });
    expect(pinned.edges).toEqual([
      { from: "V-001", to: "V-002", fromPort: { side: "E" }, toPort: { side: "W", at: 0.25 } },
    ]);
    const moved = reattach(pinned, { from: "V-001", to: "V-002" }, "to", "V-003", {
      side: "N",
    });
    expect(moved.edges).toEqual([
      { from: "V-001", to: "V-003", fromPort: { side: "E" }, toPort: { side: "N" } },
    ]);
    const cleared = reattach(moved, { from: "V-001", to: "V-003" }, "to", "V-003", null);
    expect(cleared.edges).toEqual([{ from: "V-001", to: "V-003", fromPort: { side: "E" } }]);
  });
});
