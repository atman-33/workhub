import { beforeEach, describe, expect, it } from "vitest";
import { hasClip, readClip, resetClipboard, setClip } from "../clipboard";
import {
  copyUsecaseNodes,
  pasteUsecaseNodes,
  USECASE_PASTE_OFFSET,
  type UsecaseClip,
} from "./clipboard";
import { actionsOf, parseUsecase } from "./parse";

const NOTE = `---
type: usecase
title: t
---

## Nodes

- U-001 システム ^system @300,200
- U-004 客 task:T-0100 #blue @100,200
  見る
  申し込む
- U-005 管理者
  登録する
- U-009 決済 ^ext

## Edges

- U-004 -- U-001
- U-005 -> U-001 "管理"
- U-001 -- U-009

## Stickies

- S-001 node:U-004 @10,10 memo
`;

const docOf = () => parseUsecase(NOTE);

describe("copyUsecaseNodes", () => {
  it("copies a person with its action lines, and no lines for a lone node", () => {
    const c = copyUsecaseNodes(docOf(), ["U-004"]);
    expect(c.nodes.map((n) => n.id)).toEqual(["U-004"]);
    expect(actionsOf(c.nodes[0])).toEqual(["見る", "申し込む"]);
    expect(c.edges).toEqual([]);
  });

  it("copies the lines between selected nodes only, arrowhead and label included", () => {
    expect(copyUsecaseNodes(docOf(), ["U-005", "U-001"]).edges).toEqual([
      { from: "U-005", to: "U-001", arrow: true, label: "管理" },
    ]);
    expect(copyUsecaseNodes(docOf(), ["U-004", "U-009"]).edges).toEqual([]);
  });

  it("keeps the internal lines of both kinds, `--` and `->`, in a multi-select", () => {
    const c = copyUsecaseNodes(docOf(), ["U-004", "U-001", "U-009"]);
    expect(c.nodes.map((n) => n.id)).toEqual(["U-001", "U-004", "U-009"]);
    expect(c.edges).toEqual([
      { from: "U-004", to: "U-001", arrow: false },
      { from: "U-001", to: "U-009", arrow: false },
    ]);
  });

  it("drops the lines to nodes outside a multi-select", () => {
    const c = copyUsecaseNodes(docOf(), ["U-004", "U-005", "U-009"]);
    expect(c.nodes.map((n) => n.id)).toEqual(["U-004", "U-005", "U-009"]);
    // U-004 -- U-001, U-005 -> U-001 and U-001 -- U-009 all stay behind with U-001.
    expect(c.edges).toEqual([]);
  });

  it("copies by value, so a later edit does not reach the clip", () => {
    const doc = docOf();
    const c = copyUsecaseNodes(doc, ["U-004"]);
    c.nodes[0].title = "changed";
    expect(doc.nodes.find((n) => n.id === "U-004")!.title).toBe("客");
  });
});

describe("pasteUsecaseNodes", () => {
  it("takes the next free id above everything in the document, however many copies", () => {
    const doc = docOf();
    const clip = copyUsecaseNodes(doc, ["U-004", "U-005"]);
    const once = pasteUsecaseNodes(doc, clip, 1);
    expect(once.ids).toEqual(["U-010", "U-011"]);
    const twice = pasteUsecaseNodes(once.doc, clip, 2);
    expect(twice.ids).toEqual(["U-012", "U-013"]);
  });

  it("keeps kind, task, colour and the actions, and offsets only a placed node", () => {
    const doc = docOf();
    const { doc: next, ids } = pasteUsecaseNodes(doc, copyUsecaseNodes(doc, ["U-004", "U-005"]), 2);
    const [a, b] = ids.map((id) => next.nodes.find((n) => n.id === id)!);
    expect(a).toMatchObject({ title: "客", kind: "person", task: "T-0100", color: "blue" });
    expect(actionsOf(a)).toEqual(["見る", "申し込む"]);
    expect([a.x, a.y]).toEqual([100 + 2 * USECASE_PASTE_OFFSET, 200 + 2 * USECASE_PASTE_OFFSET]);
    expect(b.x).toBeUndefined();
  });

  it("remaps the copied lines onto the copies, and leaves the source and stickies alone", () => {
    const doc = docOf();
    const { doc: next, ids } = pasteUsecaseNodes(doc, copyUsecaseNodes(doc, ["U-005", "U-001"]), 1);
    expect(next.edges).toContainEqual({ from: ids[1], to: ids[0], arrow: true, label: "管理" });
    expect(next.edges.slice(0, 3)).toEqual(doc.edges);
    expect(next.stickies).toEqual(doc.stickies);
  });
});

describe("shared clipboard", () => {
  beforeEach(() => resetClipboard());

  it("round-trips a clip through the shared layer for the usecase kind", () => {
    const clip: UsecaseClip = copyUsecaseNodes(docOf(), ["U-004"]);
    setClip("usecase", "/v/a.md", clip);
    expect(hasClip("usecase", "/v/a.md")).toBe(true);
    expect(readClip<UsecaseClip>("usecase", "/v/a.md")!.payload.nodes[0].id).toBe("U-004");
    expect(hasClip("usecase", "/v/b.md")).toBe(false);
  });
});
