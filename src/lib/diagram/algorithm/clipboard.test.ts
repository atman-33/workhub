import { beforeEach, describe, expect, it } from "vitest";
import { hasClip, readClip, resetClipboard, setClip } from "../clipboard";
import {
  ALGORITHM_PASTE_OFFSET,
  copyAlgorithmNodes,
  pasteAlgorithmNodes,
  type AlgorithmClip,
} from "./clipboard";
import { parseAlgorithm } from "./parse";

const NOTE = `---
type: algorithm
title: t
---

## Nodes

- A-001 開始 ^start @100,200
- A-004 読む ^io task:T-0100 #blue @300,200
  メモ。
- A-005 在庫あり? ^decision
- A-009 未配置

## Edges

- A-001 -> A-004
- A-004 -> A-005 "はい"
- A-005 -> A-009 "いいえ"

## Stickies

- S-001 node:A-001 @10,10 memo
`;

const docOf = () => parseAlgorithm(NOTE);

describe("copyAlgorithmNodes", () => {
  it("copies a lone node with no arrows", () => {
    const c = copyAlgorithmNodes(docOf(), ["A-004"]);
    expect(c.nodes.map((n) => n.id)).toEqual(["A-004"]);
    expect(c.edges).toEqual([]);
  });

  it("copies the arrows between selected nodes only, with their labels", () => {
    expect(copyAlgorithmNodes(docOf(), ["A-004", "A-005"]).edges).toEqual([
      { from: "A-004", to: "A-005", label: "はい" },
    ]);
    expect(copyAlgorithmNodes(docOf(), ["A-001", "A-005"]).edges).toEqual([]);
  });

  it("drops the arrows to nodes outside a multi-select", () => {
    const c = copyAlgorithmNodes(docOf(), ["A-001", "A-004", "A-005"]);
    expect(c.nodes.map((n) => n.id)).toEqual(["A-001", "A-004", "A-005"]);
    // A-001 -> A-004 and A-004 -> A-005 are inside; A-005 -> A-009 stays behind.
    expect(c.edges).toEqual([
      { from: "A-001", to: "A-004" },
      { from: "A-004", to: "A-005", label: "はい" },
    ]);
  });

  it("copies by value, so a later edit does not reach the clip", () => {
    const doc = docOf();
    const c = copyAlgorithmNodes(doc, ["A-004"]);
    c.nodes[0].title = "changed";
    expect(doc.nodes.find((n) => n.id === "A-004")!.title).toBe("読む");
  });
});

describe("pasteAlgorithmNodes", () => {
  it("takes the next free id above everything in the document, however many copies", () => {
    const doc = docOf();
    expect(pasteAlgorithmNodes(doc, copyAlgorithmNodes(doc, ["A-004"]), 1).ids).toEqual(["A-010"]);
    const two = pasteAlgorithmNodes(doc, copyAlgorithmNodes(doc, ["A-004", "A-005"]), 1);
    expect(two.ids).toEqual(["A-010", "A-011"]);
  });

  it("keeps the kind and everything the node carries, and shifts a placed node diagonally", () => {
    const doc = docOf();
    const first = pasteAlgorithmNodes(doc, copyAlgorithmNodes(doc, ["A-004"]), 1);
    const n1 = first.doc.nodes.find((n) => n.id === first.ids[0])!;
    expect(n1).toMatchObject({
      kind: "io",
      title: "読む",
      task: "T-0100",
      color: "blue",
      note: "メモ。",
      x: 300 + ALGORITHM_PASTE_OFFSET,
      y: 200 + ALGORITHM_PASTE_OFFSET,
    });
    const third = pasteAlgorithmNodes(doc, copyAlgorithmNodes(doc, ["A-004"]), 3);
    const n3 = third.doc.nodes.find((n) => n.id === third.ids[0])!;
    expect([n3.x, n3.y]).toEqual([300 + 3 * ALGORITHM_PASTE_OFFSET, 200 + 3 * ALGORITHM_PASTE_OFFSET]);
  });

  it("leaves an auto-placed node to the layout", () => {
    const doc = docOf();
    const out = pasteAlgorithmNodes(doc, copyAlgorithmNodes(doc, ["A-009"]), 1);
    const copy = out.doc.nodes.find((n) => n.id === out.ids[0])!;
    expect(copy.x).toBeUndefined();
    expect(copy.y).toBeUndefined();
  });

  it("re-creates the labelled arrows inside the selection and keeps the originals", () => {
    const doc = docOf();
    const out = pasteAlgorithmNodes(doc, copyAlgorithmNodes(doc, ["A-004", "A-005"]), 1);
    expect(out.doc.edges.slice(0, 3)).toEqual(doc.edges);
    expect(out.doc.edges.slice(3)).toEqual([{ from: "A-010", to: "A-011", label: "はい" }]);
    expect(out.doc.stickies).toEqual(doc.stickies);
  });

  it("shifts every node of a multi-paste diagonally and keeps each kind", () => {
    const doc = docOf();
    const out = pasteAlgorithmNodes(doc, copyAlgorithmNodes(doc, ["A-001", "A-004"]), 2);
    expect(out.ids).toEqual(["A-010", "A-011"]);
    const [start, io] = out.ids.map((id) => out.doc.nodes.find((n) => n.id === id)!);
    expect(start).toMatchObject({ kind: "start", x: 100 + 2 * ALGORITHM_PASTE_OFFSET });
    expect(io).toMatchObject({ kind: "io", x: 300 + 2 * ALGORITHM_PASTE_OFFSET });
    expect(out.doc.edges.slice(3)).toEqual([{ from: "A-010", to: "A-011" }]);
  });
});

describe("the shared clipboard", () => {
  beforeEach(() => resetClipboard());

  it("holds an algorithm clip under its own kind and file", () => {
    const clip = copyAlgorithmNodes(docOf(), ["A-004"]);
    setClip("algorithm", "a.md", clip);
    expect(hasClip("algorithm", "a.md")).toBe(true);
    expect(readClip<AlgorithmClip>("algorithm", "a.md")?.payload).toEqual(clip);
    // Another kind's, and another file's, are not this clip.
    expect(readClip("pfd", "a.md")).toBeNull();
    expect(readClip("algorithm", "b.md")).toBeNull();
  });
});
