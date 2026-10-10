import { describe, expect, it } from "vitest";
import { layoutUsecase } from "./layout";
import {
  addNode,
  addNodeLinked,
  applyPatch,
  autoAlign,
  connect,
  deleteEdge,
  deleteNode,
  hasManualPositions,
  moveNodeTo,
  moveNodesTo,
  nudgeNode,
  patchNode,
  reattach,
  reverseEdge,
  setEdgeArrow,
  setEdgeLabel,
  setNodeKind,
  setNote,
} from "./ops";
import { actionsOf, parseUsecase, serializeUsecase } from "./parse";

const NOTE = `---
type: usecase
title: t
updated: 2026-10-10
---

## Nodes

- U-001 システム ^system
- U-002 客
  見る
- U-003 管理者 @90,60
- U-004 決済 ^ext

## Edges

- U-002 -- U-001 "利用"
- U-001 -> U-004

## Stickies

- S-001 node:U-002 @10,10 #red 要確認
`;
const docOf = () => parseUsecase(NOTE);

describe("nodes", () => {
  it("adds a node with the next id, a person by default, and a position only when given", () => {
    const { doc, id } = addNode(docOf());
    expect(id).toBe("U-005");
    expect(doc.nodes.at(-1)).toMatchObject({ kind: "person", title: "" });
    expect(doc.nodes.at(-1)!.x).toBeUndefined();
    expect(addNode(docOf(), { kind: "ext", x: 10.4, y: 20.6 }).doc.nodes.at(-1)).toMatchObject({
      kind: "ext",
      x: 10,
      y: 21,
    });
  });

  it("adds a person linked to the first system as `person -- system`", () => {
    const { doc, id } = addNodeLinked(docOf(), undefined, { title: "新人" });
    expect(doc.edges.at(-1)).toEqual({ from: id, to: "U-001", arrow: false });
  });

  it("adds an external service linked as `system -- service`, to the chosen system", () => {
    const base = addNode(docOf(), { kind: "system", title: "二つ目" });
    const { doc, id } = addNodeLinked(base.doc, base.id, { kind: "ext" });
    expect(doc.edges.at(-1)).toEqual({ from: base.id, to: id, arrow: false });
  });

  it("adds a node alone when there is no system", () => {
    const { doc } = addNodeLinked({ ...docOf(), nodes: [], edges: [], stickies: [] }, undefined, {});
    expect(doc.nodes).toHaveLength(1);
    expect(doc.edges).toHaveLength(0);
  });

  it("never changes an id through a patch, and removes a key set to undefined", () => {
    const doc = patchNode(docOf(), "U-003", { id: "U-999", color: "red", x: undefined, y: undefined });
    const n = doc.nodes.find((x) => x.id === "U-003")!;
    expect(n.color).toBe("red");
    expect(n.x).toBeUndefined();
    expect(applyPatch({ a: 1, b: 2 }, { b: undefined })).toEqual({ a: 1 });
  });

  it("keeps the note when the kind changes, so a person's actions become a memo and back", () => {
    const asSystem = setNodeKind(docOf(), "U-002", "system");
    expect(asSystem.nodes[1]).toMatchObject({ kind: "system", note: "見る" });
    const back = setNodeKind(asSystem, "U-002", "person");
    expect(actionsOf(back.nodes[1])).toEqual(["見る"]);
    expect(layoutUsecase(asSystem).bubbleOf.has("U-002")).toBe(false);
    expect(layoutUsecase(back).bubbleOf.has("U-002")).toBe(true);
  });

  it("sets a note one item per line, dropping blanks, and clears it when empty", () => {
    expect(setNote(docOf(), "U-003", "a\n\n  b  \n").nodes[2].note).toBe("a\nb");
    expect(setNote(docOf(), "U-002", "").nodes[1].note).toBeUndefined();
  });

  it("deletes a node with its lines and stickies", () => {
    const doc = deleteNode(docOf(), "U-002");
    expect(doc.nodes.map((n) => n.id)).toEqual(["U-001", "U-003", "U-004"]);
    expect(doc.edges).toEqual([{ from: "U-001", to: "U-004", arrow: true }]);
    expect(doc.stickies).toEqual([]);
  });

  it("moves one node (a @ on it only), nudges from where it is drawn, and auto-aligns", () => {
    const moved = moveNodeTo(docOf(), "U-002", 100.4, 50.6);
    expect(moved.nodes[1]).toMatchObject({ x: 100, y: 51 });
    expect(moved.nodes[3].x).toBeUndefined();
    const doc = docOf();
    const laid = layoutUsecase(doc).byId.get("U-004")!;
    expect(nudgeNode(doc, layoutUsecase(doc), "U-004", 10, -5).nodes[3]).toMatchObject({
      x: Math.round(laid.cx + 10),
      y: Math.round(laid.cy - 5),
    });
    expect(nudgeNode(doc, layoutUsecase(doc), "nope", 1, 1)).toBe(doc);
    expect(hasManualPositions(doc)).toBe(true);
    const cleared = autoAlign(doc);
    expect(hasManualPositions(cleared)).toBe(false);
  });
});

describe("moveNodesTo (T-0716 group drag)", () => {
  it("moves every given node to its new centre in one update", () => {
    const d = docOf();
    const moved = moveNodesTo(
      d,
      new Map([
        ["U-001", { x: 300.4, y: 200.6 }],
        ["U-002", { x: 100, y: 100 }],
      ]),
    );
    expect(moved.nodes[0]).toMatchObject({ x: 300, y: 201 });
    expect(moved.nodes[1]).toMatchObject({ x: 100, y: 100 });
    // Nodes outside the move keep their exact model objects: a node the ring
    // places never gains a `@` from a drag it was not part of.
    expect(moved.nodes[2]).toBe(d.nodes[2]);
    expect(moved.nodes[3]).toBe(d.nodes[3]);
    expect(moved.edges).toBe(d.edges);
    expect(moved.stickies).toBe(d.stickies);
  });

  it("moves a system on its own: nothing is contained, so nobody follows", () => {
    const d = docOf();
    const moved = moveNodesTo(d, new Map([["U-001", { x: 400, y: 300 }]]));
    expect(moved.nodes[0]).toMatchObject({ kind: "system", x: 400, y: 300 });
    // The people and services around it stay exactly where they were.
    expect(moved.nodes.slice(1)).toEqual(d.nodes.slice(1));
  });

  it("keeps a person's actions, and writes only the moved nodes' `@`", () => {
    const d = docOf();
    const moved = moveNodesTo(
      d,
      new Map([
        ["U-002", { x: 10, y: 10 }],
        ["U-004", { x: 20, y: 20 }],
      ]),
    );
    expect(actionsOf(moved.nodes[1])).toEqual(["見る"]);
    const out = serializeUsecase(NOTE, moved, "2026-10-11");
    expect(out).toContain("- U-002 客 @10,10\n");
    expect(out).toContain("- U-004 決済 ^ext @20,20\n");
  });

  it("returns the same model for an empty move or unknown ids only", () => {
    const d = docOf();
    expect(moveNodesTo(d, new Map())).toBe(d);
    expect(moveNodesTo(d, new Map([["U-009", { x: 1, y: 1 }]]))).toBe(d);
  });
});

describe("lines are undirected", () => {
  it("refuses a second line for a pair in either order, a node to itself and a missing end", () => {
    const doc = docOf();
    expect(connect(doc, "U-001", "U-002")).toBe(doc);
    expect(connect(doc, "U-002", "U-001", true)).toBe(doc);
    expect(connect(doc, "U-001", "U-004")).toBe(doc);
    expect(connect(doc, "U-004", "U-001")).toBe(doc);
    expect(connect(doc, "U-001", "U-001")).toBe(doc);
    expect(connect(doc, "U-001", "U-099")).toBe(doc);
  });

  it("adds a line or an arrow between unjoined nodes", () => {
    expect(connect(docOf(), "U-003", "U-001").edges.at(-1)).toEqual({ from: "U-003", to: "U-001", arrow: false });
    expect(connect(docOf(), "U-001", "U-003", true).edges.at(-1)).toEqual({ from: "U-001", to: "U-003", arrow: true });
  });

  it("moves an end; a move onto an existing pair merges and keeps the first line's label", () => {
    const moved = reattach(docOf(), { from: "U-002", to: "U-001" }, "from", "U-003");
    expect(moved.edges[0]).toEqual({ from: "U-003", to: "U-001", arrow: false, label: "利用" });
    // moving U-001 -> U-004 onto U-002 -- U-001 (reverse order of the existing pair)
    const withExtra = connect(docOf(), "U-003", "U-001");
    const merged = reattach(withExtra, { from: "U-003", to: "U-001" }, "from", "U-002");
    expect(merged.edges).toHaveLength(2);
    expect(merged.edges[0]).toMatchObject({ from: "U-002", to: "U-001", label: "利用" });
  });

  it("gives the moved line's label to a twin that has none", () => {
    let doc = connect(docOf(), "U-003", "U-001");
    doc = setEdgeLabel(doc, { from: "U-003", to: "U-001" }, "管理");
    doc = setEdgeLabel(doc, { from: "U-002", to: "U-001" }, undefined);
    const merged = reattach(doc, { from: "U-003", to: "U-001" }, "from", "U-002");
    expect(merged.edges).toHaveLength(2);
    expect(merged.edges.find((e) => e.to === "U-001")).toMatchObject({ from: "U-002", label: "管理" });
  });

  it("changes nothing for a reattach that is no move, a self line or an unknown line", () => {
    const doc = docOf();
    expect(reattach(doc, { from: "U-002", to: "U-001" }, "from", "U-002")).toBe(doc);
    expect(reattach(doc, { from: "U-002", to: "U-001" }, "from", "U-001")).toBe(doc);
    expect(reattach(doc, { from: "U-009", to: "U-001" }, "from", "U-002")).toBe(doc);
  });

  it("finds a line by its pair in either order for label, arrow, reverse and delete", () => {
    let doc = setEdgeLabel(docOf(), { from: "U-001", to: "U-002" }, "  変えた ");
    expect(doc.edges[0].label).toBe("変えた");
    doc = setEdgeArrow(doc, { from: "U-001", to: "U-002" }, true);
    expect(doc.edges[0].arrow).toBe(true);
    doc = reverseEdge(doc, { from: "U-002", to: "U-001" });
    expect(doc.edges[0]).toMatchObject({ from: "U-001", to: "U-002", arrow: true });
    doc = deleteEdge(doc, { from: "U-002", to: "U-001" });
    expect(doc.edges).toEqual([{ from: "U-001", to: "U-004", arrow: true }]);
    expect(setEdgeLabel(docOf(), { from: "U-009", to: "U-001" }, "x").edges).toEqual(docOf().edges);
  });

  it("writes an edited model back as a clean note", () => {
    const doc = setEdgeArrow(connect(docOf(), "U-003", "U-001"), { from: "U-002", to: "U-001" }, true);
    const out = serializeUsecase(NOTE, doc, "2026-10-10");
    expect(out).toContain('- U-002 -> U-001 "利用"\n- U-001 -> U-004\n- U-003 -- U-001\n');
    expect(parseUsecase(out).edges).toEqual(doc.edges);
  });
});
