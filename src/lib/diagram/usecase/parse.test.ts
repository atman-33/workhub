import { describe, expect, it } from "vitest";
import {
  actionsOf,
  findNode,
  formatEdge,
  formatNode,
  nextNodeId,
  parseUsecase,
  samePair,
  serializeUsecase,
  warningCount,
} from "./parse";

const NOTE = `---
type: usecase
title: 施設予約システム
created: 2026-10-10
updated: 2026-10-10
---

## Nodes

- U-001 予約システム ^system
  施設の予約と空き状況を管理する。hover で出るメモ。
- U-002 窓口担当者 #blue
  施設の空き状況を見る
  予約を代理で登録する
- U-003 利用者 #green
  空き状況を調べる
  予約を申し込む
- U-004 施設管理者 @90,60
  施設と開館日を登録する
- U-005 決済サービス ^ext task:T-0100

## Edges

- U-002 -- U-001
- U-003 -- U-001
- U-004 -- U-001
- U-001 -> U-005 "決済を依頼"

## Stickies

- S-001 node:U-003 @40,-30 #red オンライン予約は後回し

## 覚え書き

人間の覚え書き。

## Memo

触らない。
- U-099 memo の中の行
`;

describe("parseUsecase", () => {
  const doc = parseUsecase(NOTE);

  it("reads kinds from marks: none is a person", () => {
    expect(doc.nodes.map((n) => [n.id, n.kind])).toEqual([
      ["U-001", "system"],
      ["U-002", "person"],
      ["U-003", "person"],
      ["U-004", "person"],
      ["U-005", "ext"],
    ]);
  });

  it("reads title, colour, task, position and the note lines", () => {
    const person = findNode(doc.nodes, "U-002")!;
    expect(person.title).toBe("窓口担当者");
    expect(person.color).toBe("blue");
    expect(actionsOf(person)).toEqual(["施設の空き状況を見る", "予約を代理で登録する"]);
    expect(findNode(doc.nodes, "U-004")).toMatchObject({ x: 90, y: 60 });
    expect(findNode(doc.nodes, "U-005")).toMatchObject({ task: "T-0100", kind: "ext" });
    expect(findNode(doc.nodes, "U-001")!.note).toBe("施設の予約と空き状況を管理する。hover で出るメモ。");
  });

  it("accepts ^person and tokens in any order", () => {
    const d = parseUsecase("---\ntype: usecase\n---\n\n## Nodes\n\n- U-001 @1,2 #red ^person 客 task:T-1\n");
    expect(d.nodes[0]).toMatchObject({ title: "客", kind: "person", color: "red", x: 1, y: 2, task: "T-1" });
  });

  it("keeps an unknown ^mark in the title", () => {
    const d = parseUsecase("---\ntype: usecase\n---\n\n## Nodes\n\n- U-001 クラウド ^cloud\n");
    expect(d.nodes[0].title).toBe("クラウド ^cloud");
    expect(d.nodes[0].kind).toBe("person");
  });

  it("reads -- as a line and -> as an arrow, with optional labels", () => {
    expect(doc.edges).toEqual([
      { from: "U-002", to: "U-001", arrow: false },
      { from: "U-003", to: "U-001", arrow: false },
      { from: "U-004", to: "U-001", arrow: false },
      { from: "U-001", to: "U-005", arrow: true, label: "決済を依頼" },
    ]);
  });

  it("reads stickies and the hidden flag", () => {
    expect(doc.stickies).toHaveLength(1);
    expect(doc.stickies[0].targetId).toBe("U-003");
    expect(doc.stickiesHidden).toBe(false);
    expect(
      parseUsecase(NOTE.replace("type: usecase", "type: usecase\nstickies: hidden")).stickiesHidden,
    ).toBe(true);
  });

  it("has no warnings for a clean note", () => {
    expect(warningCount(doc)).toBe(0);
    expect(doc.mintedIds).toBe(false);
  });
});

describe("undirected identity", () => {
  const base = (edges: string) =>
    `---\ntype: usecase\ntitle: t\n---\n\n## Nodes\n\n- U-001 A ^system\n- U-002 B\n- U-003 C\n\n## Edges\n\n${edges}\n`;

  it("keeps the second line of a reversed pair as a raw line and warns", () => {
    const d = parseUsecase(base('- U-002 -- U-001\n- U-001 -- U-002 "逆"'));
    expect(d.edges).toHaveLength(1);
    expect(d.edges[0]).toMatchObject({ from: "U-002", to: "U-001" });
    expect(d.rawEdges).toEqual(['- U-001 -- U-002 "逆"']);
    expect(warningCount(d)).toBe(1);
  });

  it("treats a line and an arrow on one pair as one relation, and an exact repeat too", () => {
    const d = parseUsecase(base("- U-002 -- U-001\n- U-001 -> U-002\n- U-002 -- U-001"));
    expect(d.edges).toHaveLength(1);
    expect(d.rawEdges).toHaveLength(2);
  });

  it("writes the raw duplicate back unchanged", () => {
    const content = base('- U-002 -- U-001\n- U-001 -- U-002 "逆"');
    const out = serializeUsecase(content, parseUsecase(content), "2026-10-10");
    expect(out).toContain('- U-002 -- U-001\n- U-001 -- U-002 "逆"\n');
  });

  it("does not write a pair twice when the model holds both orders", () => {
    const d = parseUsecase(base("- U-002 -- U-001"));
    d.edges.push({ from: "U-001", to: "U-002", arrow: true });
    const out = serializeUsecase(base("- U-002 -- U-001"), d, "2026-10-10");
    expect(out.match(/U-00[12] (--|->) U-00[12]/g)).toEqual(["U-002 -- U-001"]);
  });

  it("samePair ignores direction", () => {
    expect(samePair({ from: "a", to: "b" }, { from: "b", to: "a" })).toBe(true);
    expect(samePair({ from: "a", to: "b" }, { from: "a", to: "c" })).toBe(false);
  });
});

describe("raw lines", () => {
  it("keeps lines it cannot read: other kinds' ids, dangling ends, plain text", () => {
    const content =
      "---\ntype: usecase\n---\n\n## Nodes\n\n- U-001 A ^system\n- F-001 流れの行\nただの文\n- U-002 B\n\n## Edges\n\n- U-002 -- U-009\n- U-002 -- U-001\n乱れた行\n";
    const d = parseUsecase(content);
    expect(d.rawNodes).toEqual(["- F-001 流れの行", "ただの文"]);
    expect(d.rawEdges).toEqual(["- U-002 -- U-009", "乱れた行"]);
    expect(warningCount(d)).toBe(4);
    const out = serializeUsecase(content, d, "2026-10-10");
    for (const line of [...d.rawNodes, ...d.rawEdges]) expect(out).toContain(line);
  });

  it("mints ids for id-less nodes and repairs duplicates", () => {
    const d = parseUsecase("---\ntype: usecase\n---\n\n## Nodes\n\n- 客\n- U-001 A\n- U-001 B\n");
    expect(d.mintedIds).toBe(true);
    expect(d.nodes.map((n) => n.id)).toEqual(["U-002", "U-001", "U-003"]);
  });
});

describe("round trip", () => {
  it("is byte-identical for a clean note (updated unchanged)", () => {
    expect(serializeUsecase(NOTE, parseUsecase(NOTE), "2026-10-10")).toBe(NOTE);
  });

  it("changes only `updated` otherwise, and keeps ## Memo, unknown sections and stickies byte for byte", () => {
    const out = serializeUsecase(NOTE, parseUsecase(NOTE), "2026-11-01");
    expect(out).toBe(NOTE.replace("updated: 2026-10-10", "updated: 2026-11-01"));
  });

  it("keeps CRLF files CRLF", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    const out = serializeUsecase(crlf, parseUsecase(crlf), "2026-10-10");
    expect(out).toBe(crlf);
  });

  it("keeps an edited note's Memo and unknown sections", () => {
    const d = parseUsecase(NOTE);
    d.nodes[1] = { ...d.nodes[1], note: "新しい項目" };
    const out = serializeUsecase(NOTE, d, "2026-10-10");
    expect(out).toContain("## 覚え書き\n\n人間の覚え書き。");
    expect(out.slice(out.indexOf("## Memo"))).toBe(NOTE.slice(NOTE.indexOf("## Memo")));
    expect(out).toContain("- U-002 窓口担当者 #blue\n  新しい項目\n");
  });
});

describe("formatting", () => {
  it("writes mark, task, colour and position in the canonical order", () => {
    expect(
      formatNode({ id: "U-005", title: "決済", kind: "ext", task: "T-1", color: "red", x: 3.4, y: -2, note: "a\nb" }),
    ).toEqual(["- U-005 決済 ^ext task:T-1 #red @3,-2", "  a", "  b"]);
    expect(formatNode({ id: "U-002", title: "客", kind: "person" })).toEqual(["- U-002 客"]);
  });

  it("writes lines and arrows, and a quote in a label as an apostrophe", () => {
    expect(formatEdge({ from: "U-001", to: "U-002", arrow: false })).toBe("- U-001 -- U-002");
    expect(formatEdge({ from: "U-001", to: "U-002", arrow: true, label: 'a "b"' })).toBe(
      "- U-001 -> U-002 \"a 'b'\"",
    );
  });

  it("numbers the next node above the highest", () => {
    expect(nextNodeId(parseUsecase(NOTE).nodes)).toBe("U-006");
  });
});
