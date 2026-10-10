import { describe, expect, it } from "vitest";
import {
  findNode,
  formatNode,
  memoOf,
  nextNodeId,
  parseIfdam,
  sectionItems,
  serializeIfdam,
  warningCount,
} from "./parse";

const NOTE = `---
type: ifdam
title: Todo の登録
created: 2026-10-10
updated: 2026-10-10
---

## Nodes

- V-001 Todo 一覧 ^screen
  show: 登録済みの Todo の一覧
  action: 「追加」ボタン
  input: 検索語
  show: 件数
  入口の画面。メモ行。
- V-002 「追加」ボタンをクリック ^trigger
  show: これは画面ではないのでメモ
- V-003 Todo 追加 ^screen @560,200
  input: タイトル（必須）
  action: 「登録」ボタン
- V-004 Todo を登録する task:T-0100 #blue
- V-005 Todo ^store
- V-006 「登録しました」を表示する ^message
- V-007 一覧を取得する

## Edges

- V-001 -> V-002
- V-002 -> V-003
- V-003 -> V-004
- V-004 -> V-005
- V-005 -> V-004
- V-004 -> V-006 "成功"
- V-006 -> V-007
- V-007 -> V-001

## Stickies

- S-001 node:V-004 @40,-30 #red 重複チェックは未定

## Notes

人間の覚え書き。

## Memo

触らない。
- V-099 memo の中の行
  show: 触らない
`;

const save = (content: string, edit = (d: ReturnType<typeof parseIfdam>) => d) =>
  serializeIfdam(content, edit(parseIfdam(content)), "2026-10-11");
const stamped = (note: string) => note.replace("updated: 2026-10-10", "updated: 2026-10-11");

describe("parseIfdam", () => {
  const doc = parseIfdam(NOTE);

  it("reads the title and the five kinds, a plain line being a process", () => {
    expect(doc.title).toBe("Todo の登録");
    expect(doc.nodes.map((n) => [n.id, n.kind])).toEqual([
      ["V-001", "screen"],
      ["V-002", "trigger"],
      ["V-003", "screen"],
      ["V-004", "process"],
      ["V-005", "store"],
      ["V-006", "message"],
      ["V-007", "process"],
    ]);
    expect(findNode(doc.nodes, "V-004")).toMatchObject({
      title: "Todo を登録する",
      task: "T-0100",
      color: "blue",
    });
    expect(findNode(doc.nodes, "V-003")).toMatchObject({ x: 560, y: 200 });
    expect(doc.mintedIds).toBe(false);
  });

  it("keeps a screen's lines in the order written, keyed or not", () => {
    expect(findNode(doc.nodes, "V-001")!.lines).toEqual([
      { key: "show", text: "登録済みの Todo の一覧" },
      { key: "action", text: "「追加」ボタン" },
      { key: "input", text: "検索語" },
      { key: "show", text: "件数" },
      { key: null, text: "入口の画面。メモ行。" },
    ]);
  });

  it("reads the items of a section, and the memo apart from them", () => {
    const screen = findNode(doc.nodes, "V-001")!;
    expect(sectionItems(screen, "show")).toEqual(["登録済みの Todo の一覧", "件数"]);
    expect(sectionItems(screen, "input")).toEqual(["検索語"]);
    expect(sectionItems(screen, "action")).toEqual(["「追加」ボタン"]);
    expect(memoOf(screen)).toBe("入口の画面。メモ行。");
  });

  it("leaves show:/input:/action: under a node that is not a screen as memo", () => {
    const trigger = findNode(doc.nodes, "V-002")!;
    expect(trigger.lines).toEqual([{ key: null, text: "show: これは画面ではないのでメモ" }]);
    expect(sectionItems(trigger, "show")).toEqual([]);
    expect(memoOf(trigger)).toBe("show: これは画面ではないのでメモ");
  });

  it("reads the key with any spacing after the colon and only in lower case", () => {
    const d = parseIfdam(
      "## Nodes\n\n- V-001 A ^screen\n  show:tight\n  input:   wide\n  Show: Upper\n  action:\n  action:   \n",
    );
    expect(d.nodes[0].lines).toEqual([
      { key: "show", text: "tight" },
      { key: "input", text: "wide" },
      { key: null, text: "Show: Upper" },
      { key: null, text: "action:" },
      { key: null, text: "action:" },
    ]);
  });

  it("reads ^process as a process and writes it back without the mark", () => {
    const d = parseIfdam("## Nodes\n\n- V-001 a ^process\n");
    expect(d.nodes[0].kind).toBe("process");
    expect(formatNode(d.nodes[0])).toEqual(["- V-001 a"]);
  });

  it("reads the arrows, labels and duplicates", () => {
    expect(doc.edges).toHaveLength(8);
    expect(doc.edges.find((e) => e.from === "V-004" && e.to === "V-006")?.label).toBe("成功");
    const dup = parseIfdam(`## Nodes\n\n- V-001 a\n- V-002 b\n\n## Edges\n\n- V-001 -> V-002\n- V-001 -> V-002 "x"\n`);
    expect(dup.edges).toEqual([{ from: "V-001", to: "V-002", label: "x" }]);
  });

  it("puts an unknown ^word, a second mark and a bad @ in the title", () => {
    const d = parseIfdam(
      "## Nodes\n\n- V-001 a ^foo b\n- V-002 c ^screen ^store @10\n- V-003 d ^trigger @1,2 @3,4\n",
    );
    expect(d.nodes[0]).toMatchObject({ title: "a ^foo b", kind: "process" });
    expect(d.nodes[1]).toMatchObject({ title: "c ^store @10", kind: "screen" });
    expect(d.nodes[2]).toMatchObject({ title: "d @3,4", kind: "trigger", x: 1, y: 2 });
  });

  it("mints ids for lines without one and repairs duplicates", () => {
    const d = parseIfdam("## Nodes\n\n- no id ^screen\n  show: x\n- V-007 b\n- V-007 dup\n");
    expect(d.mintedIds).toBe(true);
    expect(d.nodes.map((n) => n.id)).toEqual(["V-008", "V-007", "V-009"]);
    expect(d.nodes[0].lines).toEqual([{ key: "show", text: "x" }]);
    expect(nextNodeId(d.nodes)).toBe("V-010");
  });

  it("keeps lines it cannot read as raw lines, with a warning", () => {
    const text = `## Nodes

- V-001 a ^screen
  show: one
show: stray at column zero
- F-001 another kind
- V-002 b

## Edges

- V-001 -> V-099
- not an arrow
- V-001 -> V-002
`;
    const d = parseIfdam(text);
    expect(d.nodes.map((n) => n.id)).toEqual(["V-001", "V-002"]);
    expect(d.rawNodes).toEqual(["show: stray at column zero", "- F-001 another kind"]);
    expect(d.rawEdges).toEqual(["- V-001 -> V-099", "- not an arrow"]);
    expect(warningCount(d)).toBe(4);
  });

  it("does not take the lines after a raw line for the previous node's", () => {
    const d = parseIfdam("## Nodes\n\n- V-001 a ^screen\n- F-001 x\n  show: not mine\n");
    expect(d.nodes[0].lines).toEqual([]);
    expect(d.rawNodes).toEqual(["- F-001 x", "  show: not mine"]);
  });

  it("copes with CRLF files", () => {
    const d = parseIfdam(NOTE.replace(/\n/g, "\r\n"));
    expect(d.nodes).toHaveLength(7);
    expect(findNode(d.nodes, "V-001")!.lines[0]).toEqual({ key: "show", text: "登録済みの Todo の一覧" });
  });
});

describe("serializeIfdam", () => {
  it("round-trips a note byte for byte apart from `updated`", () => {
    expect(save(NOTE)).toBe(stamped(NOTE));
  });

  it("keeps ## Memo, unknown sections, raw lines and the order of a screen's lines", () => {
    const out = save(NOTE);
    expect(out.slice(out.indexOf("## Notes"))).toBe(NOTE.slice(NOTE.indexOf("## Notes")));
    const screen = out.slice(out.indexOf("- V-001"), out.indexOf("- V-002"));
    expect(screen).toBe(
      "- V-001 Todo 一覧 ^screen\n  show: 登録済みの Todo の一覧\n  action: 「追加」ボタン\n  input: 検索語\n  show: 件数\n  入口の画面。メモ行。\n",
    );
    expect(out).toContain("  show: これは画面ではないのでメモ\n");
  });

  it("writes unreadable lines back verbatim, after the readable ones", () => {
    const messy = `---
type: ifdam
title: x
updated: 2026-10-10
---

## Nodes

- V-001 a ^screen
  show: one
- F-001 another kind

## Edges

- V-001 -> V-099

## Memo

m
`;
    const out = save(messy);
    expect(out).toBe(stamped(messy));
    expect(out).toContain("- F-001 another kind");
    expect(out).toContain("- V-001 -> V-099");
  });

  it("keeps the file's line ending", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    const out = save(crlf);
    expect(out).toBe(stamped(crlf));
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("writes a node's tokens in the canonical order, 2-space continuation, one item a line", () => {
    const d = parseIfdam("## Nodes\n\n- V-001 #blue @5,6 task:T-1 ^screen Title\n    input:   x\n");
    expect(formatNode(d.nodes[0])).toEqual(["- V-001 Title ^screen task:T-1 #blue @5,6", "  input: x"]);
  });

  it("flattens a line break in an item so it cannot become two lines", () => {
    const d = parseIfdam("## Nodes\n\n- V-001 a ^screen\n");
    d.nodes[0].lines.push({ key: "show", text: "one\ntwo" }, { key: null, text: "  " });
    expect(formatNode(d.nodes[0])).toEqual(["- V-001 a ^screen", "  show: one two"]);
  });

  it("writes an arrow once per pair and the section order the grammar names", () => {
    const d = parseIfdam(NOTE);
    d.edges.push({ from: "V-001", to: "V-002" });
    const out = serializeIfdam(NOTE, d, "2026-10-11");
    expect(out).toBe(stamped(NOTE));
  });

  it("writes missing sections in, and stickies: hidden", () => {
    const out = serializeIfdam("---\ntype: ifdam\ntitle: t\n---\n", {
      ...parseIfdam("---\ntitle: t\n---\n"),
      stickiesHidden: true,
    }, "2026-10-11");
    expect(out).toContain("stickies: hidden");
    expect(out).toContain("## Nodes");
    expect(out).toContain("## Edges");
  });
});

describe("edge ports (T-0719)", () => {
  const PORTS = `---
type: ifdam
title: t
---

## Nodes

- V-001 Screen ^screen
  show: Item
- V-002 Do it
- V-003 Store ^store

## Edges

- V-001:E@0.5 -> V-002:W
- V-002:N -> V-003

## Stickies
`;

  it("reads pinned sides and ratios", () => {
    const doc = parseIfdam(PORTS);
    expect(doc.edges).toEqual([
      { from: "V-001", to: "V-002", fromPort: { side: "E", at: 0.5 }, toPort: { side: "W" } },
      { from: "V-002", to: "V-003", fromPort: { side: "N" } },
    ]);
    expect(doc.rawEdges).toEqual([]);
  });

  it("ignores pins for identity and writes them back", () => {
    const doc = parseIfdam(PORTS);
    const out = serializeIfdam(PORTS, doc, "2026-10-10");
    expect(out).toContain("- V-001:E@0.5 -> V-002:W");
    expect(out).toContain("- V-002:N -> V-003");
    expect(parseIfdam(out).edges).toEqual(doc.edges);
  });
});
