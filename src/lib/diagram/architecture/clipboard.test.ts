import { beforeEach, describe, expect, it } from "vitest";
import { hasClip, readClip, resetClipboard, setClip } from "../clipboard";
import {
  ARCHITECTURE_PASTE_OFFSET,
  copyArchitectureNodes,
  pasteArchitectureNodes,
  type ArchitectureClip,
} from "./clipboard";
import { layoutArchitecture } from "./layout";
import { parseArchitecture } from "./parse";

const NOTE = `---
type: architecture
title: t
---

## Frames

- G-001 Left
- G-002 Right

## Nodes

- C-001 A frame:G-001 @100,100
- C-002 B frame:G-001 @300,100
- C-003 C frame:G-002
- C-004 D @900,100
  A memo

## Edges

- C-001:E -> C-002:W "Uses"
- C-002 -> C-003
- C-001 <-> C-004 "Both"

## Stickies

- S-001 node:C-001 @10,10 memo
- S-002 node:G-001 @10,10 frame memo
`;

const docOf = () => parseArchitecture(NOTE);

describe("copyArchitectureNodes", () => {
  it("copies one block with its frame, kind and memo, and no arrows", () => {
    const c = copyArchitectureNodes(docOf(), ["C-004"]);
    expect(c.nodes.map((n) => n.id)).toEqual(["C-004"]);
    expect(c.nodes[0]).toMatchObject({ title: "D", note: "A memo" });
    expect(c.edges).toEqual([]);
  });

  it("copies the arrows inside the selection with their pins and labels", () => {
    const c = copyArchitectureNodes(docOf(), ["C-001", "C-002"]);
    expect(c.edges).toEqual([
      {
        from: "C-001",
        to: "C-002",
        bidi: false,
        label: "Uses",
        fromPort: { side: "E" },
        toPort: { side: "W" },
      },
    ]);
  });

  it("keeps a two-way arrow inside, and drops arrows to blocks outside", () => {
    const c = copyArchitectureNodes(docOf(), ["C-001", "C-004"]);
    expect(c.edges).toEqual([{ from: "C-001", to: "C-004", bidi: true, label: "Both" }]);
    // C-001 -> C-002 and C-002 -> C-003 both stay behind with C-002/C-003.
    expect(copyArchitectureNodes(docOf(), ["C-001", "C-003"]).edges).toEqual([]);
  });

  it("copies by value, so a later edit does not reach the clip", () => {
    const doc = docOf();
    const c = copyArchitectureNodes(doc, ["C-001"]);
    c.nodes[0].title = "changed";
    expect(doc.nodes.find((n) => n.id === "C-001")!.title).toBe("A");
  });
});

describe("pasteArchitectureNodes", () => {
  it("takes the next free id above everything in the document", () => {
    const doc = docOf();
    const clip = copyArchitectureNodes(doc, ["C-001", "C-002"]);
    const once = pasteArchitectureNodes(doc, clip, 1);
    expect(once.ids).toEqual(["C-005", "C-006"]);
    const twice = pasteArchitectureNodes(once.doc, clip, 2);
    expect(twice.ids).toEqual(["C-007", "C-008"]);
  });

  it("keeps each pasted block in its frame, like a single-block paste", () => {
    const doc = docOf();
    const { doc: next, ids } = pasteArchitectureNodes(
      doc,
      copyArchitectureNodes(doc, ["C-001", "C-003", "C-004"]),
      1,
    );
    // Same decision as the single-block paste: membership travels with the
    // block, so the frames re-derive around the copies on the next layout.
    expect(next.nodes.find((n) => n.id === ids[0])!.frame).toBe("G-001");
    expect(next.nodes.find((n) => n.id === ids[1])!.frame).toBe("G-002");
    expect("frame" in next.nodes.find((n) => n.id === ids[2])!).toBe(false);
    const relaid = layoutArchitecture(next);
    for (const id of ids) {
      expect(relaid.byId.has(id)).toBe(true);
    }
  });

  it("offsets only a placed block, and leaves an unplaced one to the groups", () => {
    const doc = docOf();
    const { doc: next, ids } = pasteArchitectureNodes(
      doc,
      copyArchitectureNodes(doc, ["C-001", "C-003"]),
      2,
    );
    const [placed, unplaced] = ids.map((id) => next.nodes.find((n) => n.id === id)!);
    expect([placed.x, placed.y]).toEqual([
      100 + 2 * ARCHITECTURE_PASTE_OFFSET,
      100 + 2 * ARCHITECTURE_PASTE_OFFSET,
    ]);
    expect(unplaced.x).toBeUndefined();
    expect(unplaced.y).toBeUndefined();
  });

  it("remaps the copied arrows onto the copies with pins, and leaves the rest alone", () => {
    const doc = docOf();
    const { doc: next, ids } = pasteArchitectureNodes(
      doc,
      copyArchitectureNodes(doc, ["C-001", "C-002"]),
      1,
    );
    expect(next.edges).toContainEqual({
      from: ids[0],
      to: ids[1],
      bidi: false,
      label: "Uses",
      fromPort: { side: "E" },
      toPort: { side: "W" },
    });
    expect(next.edges.slice(0, 3)).toEqual(doc.edges);
    // Stickies are never copied: the copies arrive bare, and the frame's own
    // sticky (S-002) is unaffected.
    expect(next.stickies).toEqual(doc.stickies);
  });
});

describe("shared clipboard", () => {
  beforeEach(() => resetClipboard());

  it("round-trips a clip through the shared layer for the architecture kind", () => {
    const clip: ArchitectureClip = copyArchitectureNodes(docOf(), ["C-001", "C-002"]);
    setClip("architecture", "/v/a.md", clip);
    expect(hasClip("architecture", "/v/a.md")).toBe(true);
    expect(readClip<ArchitectureClip>("architecture", "/v/a.md")!.payload.nodes[0].id).toBe("C-001");
    expect(hasClip("architecture", "/v/b.md")).toBe(false);
  });
});
