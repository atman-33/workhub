import { beforeEach, describe, expect, it } from "vitest";
import { hasClip, readClip, resetClipboard, setClip } from "../clipboard";
import {
  copyIfdamNodes,
  IFDAM_PASTE_OFFSET,
  pasteIfdamNodes,
  type IfdamClip,
} from "./clipboard";
import { parseIfdam, sectionItems, serializeIfdam } from "./parse";

const NOTE = `---
type: ifdam
title: t
---

## Nodes

- V-001 一覧 ^screen @100,200
  show: 一覧
  input: 検索語
  show: 件数
  メモ
  action: 追加
- V-004 登録する task:T-0100 #blue @300,200
- V-005 Todo ^store
- V-009 未配置 ^screen
  show: x

## Edges

- V-001 -> V-004 "はい"
- V-004 -> V-005

## Stickies

- S-001 node:V-001 @10,10 memo
`;

const docOf = () => parseIfdam(NOTE);

describe("copyIfdamNodes", () => {
  it("copies a screen with its sections, in the order written, and its memo", () => {
    const c = copyIfdamNodes(docOf(), ["V-001"]);
    expect(c.nodes.map((n) => n.id)).toEqual(["V-001"]);
    expect(c.nodes[0].lines).toEqual(docOf().nodes[0].lines);
    expect(c.edges).toEqual([]);
  });

  it("takes the arrows between the copied nodes, labels included, and no others", () => {
    const c = copyIfdamNodes(docOf(), ["V-001", "V-004"]);
    expect(c.edges).toEqual([{ from: "V-001", to: "V-004", label: "はい" }]);
  });

  it("is a snapshot: later edits to the document do not change it", () => {
    const d = docOf();
    const c = copyIfdamNodes(d, ["V-001"]);
    d.nodes[0].lines[0].text = "changed";
    expect(c.nodes[0].lines[0].text).toBe("一覧");
  });
});

describe("pasteIfdamNodes", () => {
  it("adds a copy under the next free id, offset when placed, with its items", () => {
    const d = docOf();
    const { doc, ids } = pasteIfdamNodes(d, copyIfdamNodes(d, ["V-001"]), 1);
    expect(ids).toEqual(["V-010"]);
    const copy = doc.nodes.find((n) => n.id === "V-010")!;
    expect(copy).toMatchObject({
      kind: "screen",
      title: "一覧",
      x: 100 + IFDAM_PASTE_OFFSET,
      y: 200 + IFDAM_PASTE_OFFSET,
    });
    expect(sectionItems(copy, "show")).toEqual(["一覧", "件数"]);
    expect(copy.lines).toEqual(d.nodes[0].lines);
    // the pasted copy owns its lines
    copy.lines[0].text = "x";
    expect(d.nodes[0].lines[0].text).toBe("一覧");
  });

  it("leaves an unplaced node unplaced, fans repeated pastes out, and remaps arrows", () => {
    const d = docOf();
    const clip = copyIfdamNodes(d, ["V-001", "V-004", "V-009"]);
    const once = pasteIfdamNodes(d, clip, 1);
    expect(once.ids).toEqual(["V-010", "V-011", "V-012"]);
    const copy9 = once.doc.nodes.find((n) => n.id === "V-012")!;
    expect("x" in copy9).toBe(false);
    expect(once.doc.edges).toContainEqual({ from: "V-010", to: "V-011", label: "はい" });
    const twice = pasteIfdamNodes(once.doc, clip, 2);
    expect(twice.doc.nodes.find((n) => n.id === twice.ids[0])).toMatchObject({ x: 100 + 2 * IFDAM_PASTE_OFFSET });
  });

  it("writes the pasted screen back with its lines in order", () => {
    const d = docOf();
    const { doc } = pasteIfdamNodes(d, copyIfdamNodes(d, ["V-001"]), 1);
    const out = serializeIfdam(NOTE, doc, "2026-10-11");
    expect(out).toContain(
      "- V-010 一覧 ^screen @132,232\n  show: 一覧\n  input: 検索語\n  show: 件数\n  メモ\n  action: 追加\n",
    );
  });
});

describe("the shared clipboard", () => {
  beforeEach(() => resetClipboard());

  it("holds an ifdam snapshot for the note it came from only", () => {
    const clip: IfdamClip = copyIfdamNodes(docOf(), ["V-001"]);
    setClip("ifdam", "/v/a.md", clip);
    expect(hasClip("ifdam", "/v/a.md")).toBe(true);
    expect(hasClip("ifdam", "/v/b.md")).toBe(false);
    expect(hasClip("algorithm", "/v/a.md")).toBe(false);
    expect(readClip<IfdamClip>("ifdam", "/v/a.md")?.payload.nodes[0].id).toBe("V-001");
  });
});
