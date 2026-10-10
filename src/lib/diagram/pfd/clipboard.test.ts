import { describe, expect, it } from "vitest";
import { copyPfdNodes, pastePfdNodes, PFD_PASTE_OFFSET } from "./clipboard";
import { parsePfd } from "./parse";

const NOTE = `---
type: pfd
title: t
created: 2026-10-09
updated: 2026-10-09
---

## Nodes

- P-001 反応 @100,200
- P-004 精製 task:T-0100 #blue @300,200
- D-001 タンク
- P-009 未配置

## Edges

- P-001 -> D-001

## Stickies

- S-001 node:P-001 @10,10 memo
`;

const docOf = () => parsePfd(NOTE);

describe("copyPfdNodes", () => {
  it("copies a lone node with no arrows", () => {
    const c = copyPfdNodes(docOf(), ["P-001"]);
    expect(c.nodes.map((n) => n.id)).toEqual(["P-001"]);
    expect(c.edges).toEqual([]);
  });

  it("copies the arrow between two selected nodes only", () => {
    expect(copyPfdNodes(docOf(), ["P-001", "D-001"]).edges).toEqual([{ from: "P-001", to: "D-001" }]);
    expect(copyPfdNodes(docOf(), ["P-001", "P-004"]).edges).toEqual([]);
  });
});

describe("pastePfdNodes", () => {
  it("numbers the copy within its own symbol prefix", () => {
    const doc = docOf();
    expect(pastePfdNodes(doc, copyPfdNodes(doc, ["P-004"]), 1).ids).toEqual(["P-010"]);
    expect(pastePfdNodes(doc, copyPfdNodes(doc, ["D-001"]), 1).ids).toEqual(["D-002"]);
  });

  it("shifts a placed node diagonally, one more step per paste", () => {
    const doc = docOf();
    const first = pastePfdNodes(doc, copyPfdNodes(doc, ["P-004"]), 1);
    const n1 = first.doc.nodes.find((n) => n.id === first.ids[0])!;
    expect([n1.x, n1.y]).toEqual([300 + PFD_PASTE_OFFSET, 200 + PFD_PASTE_OFFSET]);
    const third = pastePfdNodes(doc, copyPfdNodes(doc, ["P-004"]), 3);
    const n3 = third.doc.nodes.find((n) => n.id === third.ids[0])!;
    expect([n3.x, n3.y]).toEqual([300 + 3 * PFD_PASTE_OFFSET, 200 + 3 * PFD_PASTE_OFFSET]);
    expect(n3).toMatchObject({ title: "精製", task: "T-0100", color: "blue" });
  });

  it("leaves an auto-placed node to the layout", () => {
    const doc = docOf();
    const out = pastePfdNodes(doc, copyPfdNodes(doc, ["D-001"]), 1);
    expect(out.doc.nodes.find((n) => n.id === out.ids[0])!.x).toBeUndefined();
  });

  it("re-creates the arrows inside the selection and keeps the originals", () => {
    const doc = docOf();
    const out = pastePfdNodes(doc, copyPfdNodes(doc, ["P-001", "D-001"]), 1);
    expect(out.ids).toEqual(["P-010", "D-002"]);
    expect(out.doc.edges).toEqual([
      { from: "P-001", to: "D-001" },
      { from: "P-010", to: "D-002" },
    ]);
    expect(out.doc.stickies).toEqual(doc.stickies);
  });
});
