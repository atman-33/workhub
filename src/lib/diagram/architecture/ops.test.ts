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
  moveFrame,
  moveNodeTo,
  moveNodesTo,
  patchFrame,
  patchNode,
  reattach,
  reparentByDrop,
  reverseEdge,
  setEdgeBidi,
  setEdgeLabel,
  setNodeFrame,
  setNodeKind,
  setNote,
} from "./ops";
import { layoutArchitecture } from "./layout";
import { parseArchitecture, serializeArchitecture, type ArchitectureDocModel } from "./parse";

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

describe("moveNodesTo (T-0716 group drag)", () => {
  it("moves every given block to its new centre in one update", () => {
    const d = docOf();
    const moved = moveNodesTo(
      d,
      new Map([
        ["C-001", { x: 300.4, y: 200.6 }],
        ["C-002", { x: 100, y: 100 }],
      ]),
    );
    expect(moved.nodes[0]).toMatchObject({ x: 300, y: 201, frame: "G-001" });
    expect(moved.nodes[1]).toMatchObject({ x: 100, y: 100 });
    // Blocks outside the move keep their exact model objects: a block the
    // groups place never gains a `@` from a drag it was not part of.
    expect(moved.edges).toBe(d.edges);
    expect(moved.stickies).toBe(d.stickies);
    expect(moved.frames).toBe(d.frames);
  });

  it("never rewrites frame membership, even inside another frame's rectangle", () => {
    const doc = parseArchitecture(FRAMED);
    const layout = layoutArchitecture(doc);
    const g2 = layout.frameById.get("G-002")!;
    const moved = moveNodesTo(
      doc,
      new Map([["C-001", { x: g2.x + g2.width / 2, y: g2.y + g2.height / 2 }]]),
    );
    // A lone drop here would join G-002 (`reparentByDrop`); the group drag
    // keeps the block where it was a member of, and the frame follows instead.
    const node = moved.nodes.find((n) => n.id === "C-001")!;
    expect(node.frame).toBe("G-001");
    expect([node.x, node.y]).toEqual([
      Math.round(g2.x + g2.width / 2),
      Math.round(g2.y + g2.height / 2),
    ]);
    const relaid = layoutArchitecture(moved);
    // The frame follows: its rectangle still wraps the moved member.
    const g1 = relaid.frameById.get("G-001")!;
    const member = relaid.byId.get("C-001")!;
    expect(g1.x).toBeLessThanOrEqual(member.x);
    expect(g1.y).toBeLessThanOrEqual(member.y);
    expect(g1.x + g1.width).toBeGreaterThanOrEqual(member.x + member.width);
    expect(g1.y + g1.height).toBeGreaterThanOrEqual(member.y + member.height);
  });

  it("frames follow the moved members on the next layout", () => {
    const doc = parseArchitecture(FRAMED);
    const before = layoutArchitecture(doc).frameById.get("G-001")!;
    const moved = moveNodesTo(doc, new Map([["C-001", { x: 900, y: 700 }]]));
    const after = layoutArchitecture(moved).frameById.get("G-001")!;
    // The same members, so the frame's size only re-derives; its corner
    // travelled with the moved block instead of staying behind.
    expect([after.x, after.y]).not.toEqual([before.x, before.y]);
    expect(after.x).toBeLessThan(900);
    expect(after.y).toBeLessThan(700);
  });

  it("writes only the moved blocks' `@`, and keeps kinds, memos and arrows", () => {
    const d = docOf();
    const moved = moveNodesTo(d, new Map([["C-001", { x: 10, y: 10 }]]));
    expect(moved.nodes[0]).toMatchObject({ kind: "block", frame: "G-001" });
    const out = serializeArchitecture(NOTE, moved, "2026-10-11");
    expect(out).toContain("C-001 Screen frame:G-001 @10,10");
    expect(out).toContain("- C-002 API\n");
    expect(out).toContain('- C-001 -> C-002 "Calls"');
  });

  it("returns the same model for an empty move or unknown ids only", () => {
    const d = docOf();
    expect(moveNodesTo(d, new Map())).toBe(d);
    expect(moveNodesTo(d, new Map([["C-009", { x: 1, y: 1 }]]))).toBe(d);
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

  it("labels, turns both ways, reverses one way and deletes", () => {    const doc = docOf();
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

const FRAMED = `---
type: architecture
title: t
created: 2026-10-10
updated: 2026-10-10
---

## Frames

- G-001 Left
- G-002 Right

## Nodes

- C-001 A frame:G-001
- C-002 B frame:G-001
- C-003 C frame:G-002

## Edges

## Stickies
`;

describe("moveFrame (T-0711)", () => {
  it("moves every member by the same distance, and nothing else", () => {
    const doc = parseArchitecture(FRAMED);
    const layout = layoutArchitecture(doc);
    const before = new Map([...layout.byId].map(([id, n]) => [id, [n.cx, n.cy]]));
    const moved = moveFrame(doc, layout, "G-001", 10, -20);
    for (const id of ["C-001", "C-002"]) {
      const [cx, cy] = before.get(id)!;
      expect(moved.nodes.find((n) => n.id === id)).toMatchObject({
        x: Math.round(cx + 10),
        y: Math.round(cy - 20),
        frame: "G-001",
      });
    }
    expect(moved.nodes.find((n) => n.id === "C-003")).toBe(doc.nodes[2]);
    expect(moved.frames).toBe(doc.frames);
  });

  it("changes nothing for a frame with no members", () => {
    const doc = parseArchitecture(FRAMED);
    expect(moveFrame(doc, layoutArchitecture(doc), "G-009", 10, 10)).toBe(doc);
  });
});

describe("reparentByDrop (T-0711)", () => {
  it("joins the frame it is dropped in, and always moves", () => {
    const doc = parseArchitecture(FRAMED);
    const layout = layoutArchitecture(doc);
    const g2 = layout.frameById.get("G-002")!;
    const out = reparentByDrop(doc, layout, "C-001", g2.x + g2.width / 2, g2.y + g2.height / 2);
    const node = out.nodes.find((n) => n.id === "C-001")!;
    expect(node.frame).toBe("G-002");
    expect([node.x, node.y]).toEqual([
      Math.round(g2.x + g2.width / 2),
      Math.round(g2.y + g2.height / 2),
    ]);
  });

  it("leaves its frame when dropped outside of it", () => {
    const doc = parseArchitecture(FRAMED);
    const layout = layoutArchitecture(doc);
    const g1 = layout.frameById.get("G-001")!;
    const out = reparentByDrop(doc, layout, "C-001", g1.x - 100, g1.y - 100);
    const node = out.nodes.find((n) => n.id === "C-001")!;
    expect("frame" in node).toBe(false);
    expect([node.x, node.y]).toEqual([Math.round(g1.x - 100), Math.round(g1.y - 100)]);
  });

  it("stays in its frame when dropped inside of it", () => {
    const doc = parseArchitecture(FRAMED);
    const layout = layoutArchitecture(doc);
    const g1 = layout.frameById.get("G-001")!;
    const out = reparentByDrop(doc, layout, "C-001", g1.x + g1.width / 2, g1.y + g1.height / 2);
    const node = out.nodes.find((n) => n.id === "C-001")!;
    expect(node.frame).toBe("G-001");
  });

  it("never leaves a frame with no other member", () => {
    const doc = parseArchitecture(FRAMED);
    const layout = layoutArchitecture(doc);
    const out = reparentByDrop(doc, layout, "C-003", 3000, 3000);
    const node = out.nodes.find((n) => n.id === "C-003")!;
    expect(node.frame).toBe("G-002");
    expect([node.x, node.y]).toEqual([3000, 3000]);
  });

  it("leaves an unknown block alone", () => {
    const doc = parseArchitecture(FRAMED);
    expect(reparentByDrop(doc, layoutArchitecture(doc), "C-009", 0, 0)).toBe(doc);
  });
});

describe("edge ports (T-0712)", () => {
  it("connects with pins, and reverses them with their ends", () => {
    const doc = parseArchitecture(FRAMED);
    const pinned = connect(doc, "C-001", "C-003", false, {
      fromPort: { side: "E", at: 0.5 },
      toPort: { side: "W" },
    });
    expect(pinned.edges).toHaveLength(1);
    expect(pinned.edges[0]).toMatchObject({
      fromPort: { side: "E", at: 0.5 },
      toPort: { side: "W" },
    });
    const reversed = reverseEdge(pinned, { from: "C-001", to: "C-003", bidi: false });
    expect(reversed.edges[0]).toMatchObject({
      from: "C-003",
      to: "C-001",
      fromPort: { side: "W" },
      toPort: { side: "E", at: 0.5 },
    });
  });

  it("reattaching pins the moved end anew, and keeps pins otherwise", () => {
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

- C-001:E -> C-002:W

## Stickies
`);
    const moved = reattach(
      doc,
      { from: "C-001", to: "C-002", bidi: false },
      "to",
      "C-003",
      { side: "N", at: 0.25 },
    );
    expect(moved.edges).toEqual([
      {
        from: "C-001",
        to: "C-003",
        bidi: false,
        fromPort: { side: "E" },
        toPort: { side: "N", at: 0.25 },
      },
    ]);
    // Without a new pin the moved end keeps the pin it had.
    const kept = reattach(doc, { from: "C-001", to: "C-002", bidi: false }, "to", "C-003");
    expect(kept.edges).toEqual([
      {
        from: "C-001",
        to: "C-003",
        bidi: false,
        fromPort: { side: "E" },
        toPort: { side: "W" },
      },
    ]);
  });
});
