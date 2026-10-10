import { describe, expect, it } from "vitest";
import { copyMatrixItems, MATRIX_PASTE_OFFSET, pasteMatrixItems } from "./clipboard";
import { parseMatrix, serializeMatrix, type MatrixDocModel, type MatrixItem } from "./parse";

const NOTE = `---
type: matrix2x2
title: t
created: 2026-10-09
updated: 2026-10-09
---

## Items

- M-001 placed @0.20,0.85 #green task:T-0684
  note line
- M-002 unplaced
- M-005 edge @0.99,0.01

## Stickies

- S-001 node:M-001 @40,-20 #red 要確認

## Memo

keep me
`;

const docOf = () => parseMatrix(NOTE);
const find = (doc: MatrixDocModel, id: string) => doc.items.find((i) => i.id === id) as MatrixItem;

describe("copyMatrixItems", () => {
  it("snapshots the chosen items and leaves stickies out", () => {
    const doc = docOf();
    const items = copyMatrixItems(doc, ["M-001"]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "M-001", title: "placed", color: "green", task: "T-0684" });
    items[0].title = "mutated";
    expect(doc.items[0].title).toBe("placed");
  });

  it("ignores ids that are not in the document", () => {
    expect(copyMatrixItems(docOf(), ["M-099"])).toEqual([]);
  });

  it("snapshots several items at once, in note order", () => {
    const items = copyMatrixItems(docOf(), ["M-005", "M-001"]);
    expect(items.map((i) => i.id)).toEqual(["M-001", "M-005"]);
  });
});

describe("pasteMatrixItems", () => {
  it("gives the copy a fresh id above every id in the file", () => {
    const doc = docOf();
    const out = pasteMatrixItems(doc, copyMatrixItems(doc, ["M-001"]), 1);
    expect(out.ids).toEqual(["M-006"]);
    expect(out.doc.items.map((i) => i.id)).toEqual(["M-001", "M-002", "M-005", "M-006"]);
  });

  it("shifts a placed item right and down by the offset, y running upward", () => {
    const doc = docOf();
    const out = pasteMatrixItems(doc, copyMatrixItems(doc, ["M-001"]), 1);
    const copy = find(out.doc, out.ids[0]);
    expect(MATRIX_PASTE_OFFSET).toBe(0.03);
    expect(copy.x).toBeCloseTo(0.23, 5);
    expect(copy.y).toBeCloseTo(0.82, 5);
  });

  it("moves a later paste of the same copy one more step", () => {
    const doc = docOf();
    const out = pasteMatrixItems(doc, copyMatrixItems(doc, ["M-001"]), 2);
    const copy = find(out.doc, out.ids[0]);
    expect(copy.x).toBeCloseTo(0.26, 5);
    expect(copy.y).toBeCloseTo(0.79, 5);
  });

  it("turns back from an edge instead of leaving the plot", () => {
    const doc = docOf();
    const out = pasteMatrixItems(doc, copyMatrixItems(doc, ["M-005"]), 1);
    const copy = find(out.doc, out.ids[0]);
    expect(copy.x).toBeCloseTo(0.96, 5);
    expect(copy.y).toBeCloseTo(0.04, 5);
  });

  it("leaves an unplaced item unplaced", () => {
    const doc = docOf();
    const out = pasteMatrixItems(doc, copyMatrixItems(doc, ["M-002"]), 1);
    const copy = find(out.doc, out.ids[0]);
    expect(copy.x).toBeUndefined();
    expect(copy.y).toBeUndefined();
  });

  it("pastes several items at once under fresh ids", () => {
    const doc = docOf();
    const out = pasteMatrixItems(doc, copyMatrixItems(doc, ["M-001", "M-005"]), 1);
    expect(out.ids).toEqual(["M-006", "M-007"]);
    expect(out.doc.items.map((i) => i.id)).toEqual(["M-001", "M-002", "M-005", "M-006", "M-007"]);
    expect(find(out.doc, "M-006").x).toBeCloseTo(0.23, 5);
    expect(find(out.doc, "M-007").x).toBeCloseTo(0.96, 5);
  });

  it("does not touch the original, the stickies or the memo", () => {
    const doc = docOf();
    const before: MatrixDocModel = structuredClone(doc);
    const out = pasteMatrixItems(doc, copyMatrixItems(doc, ["M-001"]), 1);
    expect(doc).toEqual(before);
    expect(out.doc.stickies).toEqual(doc.stickies);
    const text = serializeMatrix(NOTE, out.doc, "2026-10-10");
    expect(text).toContain("## Memo\n\nkeep me\n");
    expect(text).toContain("- S-001 node:M-001 @40,-20 #red 要確認");
  });
});
