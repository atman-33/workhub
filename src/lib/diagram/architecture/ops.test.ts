import { describe, expect, it } from "vitest";
import {
  addFrame,
  addNode,
  autoAlign,
  connect,
  deleteEdge,
  deleteFrame,
  deleteNode,
  hasManualPositions,
  moveNodeTo,
  patchFrame,
  patchNode,
  reattach,
  reverseEdge,
  setEdgeBidi,
  setEdgeLabel,
  setNodeFrame,
  setNodeKind,
  setNote,
} from "./ops";
import { parseArchitecture, type ArchitectureDocModel } from "./parse";

const NOTE = `---
type: architecture
title: t
created: 2026-10-10
updated: 2026-10-10
---

## Frames

- G-001 Client #blue

## Nodes

- C-001 Screen frame:G-001
- C-002 API

## Edges

- C-001 -> C-002 "Calls"

## Stickies

- S-001 node:G-001 @10,10 Pinned to the frame
- S-002 node:C-001 @10,10 Pinned to the block
`;

const docOf = (): ArchitectureDocModel => parseArchitecture(NOTE);

describe("frames", () => {
  it("adds a frame with the next id", () => {
    const { doc, id } = addFrame(docOf(), { title: "Server" });
    expect(id).toBe("G-002");
    expect(doc.frames.map((f) => f.id)).toEqual(["G-001", "G-002"]);
  });

  it("patches a frame but never its id", () => {
    const doc = patchFrame(docOf(), "G-001", { id: "G-009", title: "New" });
    expect(doc.frames[0].id).toBe("G-001");
    expect(doc.frames[0].title).toBe("New");
  });

  it("deleting a frame leaves its members outside, and takes its stickies", () => {
    const doc = deleteFrame(docOf(), "G-001");
    expect(doc.frames).toEqual([]);
    const member = doc.nodes.find((n) => n.id === "C-001")!;
    expect("frame" in member).toBe(false);
    expect(doc.nodes.find((n) => n.id === "C-002")).toMatchObject({ id: "C-002" });
    expect(doc.stickies.map((s) => s.id)).toEqual(["S-002"]);
  });

  it("deleting an unknown frame changes nothing", () => {
    const doc = docOf();
    expect(deleteFrame(doc, "G-009")).toBe(doc);
  });

  it("moves a block into a frame and out again", () => {
    const inside = setNodeFrame(docOf(), "C-002", "G-001");
    expect(inside.nodes.find((n) => n.id === "C-002")!.frame).toBe("G-001");
    const outside = setNodeFrame(inside, "C-002", undefined);
    expect("frame" in outside.nodes.find((n) => n.id === "C-002")!).toBe(false);
  });
});

describe("blocks", () => {
  it("adds a block with kind, frame and placement", () => {
    const { doc, id } = addNode(docOf(), { title: "DB", kind: "db", frame: "G-001", x: 640.4, y: 260 });
    expect(id).toBe("C-003");
    expect(doc.nodes[2]).toMatchObject({ title: "DB", kind: "db", frame: "G-001", x: 640, y: 260 });
  });

  it("changes kind and memo, and never the id", () => {
    const renamed = setNodeKind(docOf(), "C-001", "round");
    expect(renamed.nodes[0].kind).toBe("round");
    const memo = setNote(renamed, "C-001", "  Line one\n\nLine two  ");
    expect(memo.nodes[0].note).toBe("Line one\nLine two");
    const cleared = setNote(memo, "C-001", "   ");
    expect("note" in cleared.nodes[0]).toBe(false);
    const patched = patchNode(cleared, "C-001", { id: "C-009" });
    expect(patched.nodes[0].id).toBe("C-001");
  });

  it("deleting a block takes its arrows and stickies", () => {
    const doc = deleteNode(docOf(), "C-001");
    expect(doc.nodes.map((n) => n.id)).toEqual(["C-002"]);
    expect(doc.edges).toEqual([]);
    expect(doc.stickies.map((s) => s.id)).toEqual(["S-001"]);
  });

  it("moves one block, and auto-align forgets every position", () => {
    const moved = moveNodeTo(docOf(), "C-002", 100.6, 200);
    expect(moved.nodes[1]).toMatchObject({ x: 101, y: 200 });
    expect(hasManualPositions(moved)).toBe(true);
    expect(hasManualPositions(docOf())).toBe(false);
    const aligned = autoAlign(moved);
    expect(hasManualPositions(aligned)).toBe(false);
  });
});

describe("arrows", () => {
  it("adds one-way and two-way arrows, and refuses pairs already joined", () => {
    const doc = docOf();
    const back = connect(doc, "C-002", "C-001");
    expect(back.edges[1]).toMatchObject({ from: "C-002", to: "C-001", bidi: false });
    expect(connect(doc, "C-001", "C-002")).toBe(doc);
    expect(connect(doc, "C-001", "C-002", true)).toBe(doc);
    expect(connect(doc, "C-001", "C-001")).toBe(doc);
    expect(connect(doc, "C-001", "C-009")).toBe(doc);
    const cleared = deleteEdge(doc, { from: "C-001", to: "C-002", bidi: false });
    const bidi = connect(cleared, "C-002", "C-001", true);
    expect(bidi.edges).toEqual([{ from: "C-002", to: "C-001", bidi: true }]);
  });

  it("reattaches an end, merging into an existing arrow with its label kept", () => {
    const doc = parseArchitecture(`---
type: architecture
title: t
---

## Frames

## Nodes

- C-001 A
- C-002 B
- C-003 C

## Edges

- C-001 -> C-002 "Old"
- C-001 -> C-003

## Stickies
`);
    const moved = reattach(doc, { from: "C-001", to: "C-003", bidi: false }, "to", "C-002");
    expect(moved.edges).toEqual([{ from: "C-001", to: "C-002", bidi: false, label: "Old" }]);
  });

  it("labels, turns both ways, reverses one way and deletes", () => {
    const doc = docOf();
    const labelled = setEdgeLabel(doc, { from: "C-001", to: "C-002", bidi: false }, "  New  ");
    expect(labelled.edges[0].label).toBe("New");
    const unlabelled = setEdgeLabel(labelled, { from: "C-001", to: "C-002", bidi: false }, "");
    expect("label" in unlabelled.edges[0]).toBe(false);
    const bidi = setEdgeBidi(doc, { from: "C-001", to: "C-002", bidi: false }, true);
    expect(bidi.edges[0].bidi).toBe(true);
    const back = setEdgeBidi(bidi, { from: "C-001", to: "C-002", bidi: true }, false);
    expect(back.edges[0].bidi).toBe(false);
    const reversed = reverseEdge(doc, { from: "C-001", to: "C-002", bidi: false });
    expect(reversed.edges[0]).toMatchObject({ from: "C-002", to: "C-001" });
    // A two-way arrow reads the same either way round.
    expect(reverseEdge(bidi, { from: "C-001", to: "C-002", bidi: true })).toBe(bidi);
    const deleted = deleteEdge(doc, { from: "C-001", to: "C-002", bidi: false });
    expect(deleted.edges).toEqual([]);
  });
});
