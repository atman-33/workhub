import { describe, expect, it } from "vitest";
import {
  findNode,
  formatNode,
  nextNodeId,
  parseAlgorithm,
  serializeAlgorithm,
  warningCount,
} from "./parse";

const NOTE = `---
type: algorithm
title: 注文の在庫引当
created: 2026-10-10
updated: 2026-10-10
direction: right
---

## Nodes

- A-001 引当開始 ^start
- A-002 注文を読み込む ^io
- A-003 在庫あり? ^decision
- A-004 在庫を引き当てる ^sub task:T-0100
  引当ロジックは reserve() を呼ぶ。
  二行目。
- A-005 入荷を待つ #amber
- A-006 結果を返す ^io @220,560
- A-007 終了 ^end
- A-008 帳票 ^doc @-40,-12

## Edges

- A-001 -> A-002
- A-002 -> A-003
- A-003 -> A-004 "はい"
- A-003 -> A-005 "いいえ"
- A-004 -> A-006
- A-006 -> A-007
- A-005 -> A-002 "入荷後に再試行"

## Stickies

- S-001 node:A-003 @40,-30 #red 在庫の定義を確認

## Notes

人間の覚え書き。

## Memo

触らない。
- A-099 memo の中の行
`;

const save = (content: string, edit = (d: ReturnType<typeof parseAlgorithm>) => d) =>
  serializeAlgorithm(content, edit(parseAlgorithm(content)), "2026-10-11");
const stamped = (note: string) => note.replace("updated: 2026-10-10", "updated: 2026-10-11");

describe("parseAlgorithm", () => {
  it("reads nodes, kinds, arrows, labels and modifiers", () => {
    const doc = parseAlgorithm(NOTE);
    expect(doc.title).toBe("注文の在庫引当");
    expect(doc.nodes.map((n) => [n.id, n.kind])).toEqual([
      ["A-001", "start"],
      ["A-002", "io"],
      ["A-003", "decision"],
      ["A-004", "sub"],
      ["A-005", "process"],
      ["A-006", "io"],
      ["A-007", "end"],
      ["A-008", "doc"],
    ]);
    expect(doc.nodes[3]).toEqual({
      id: "A-004",
      title: "在庫を引き当てる",
      kind: "sub",
      task: "T-0100",
      note: "引当ロジックは reserve() を呼ぶ。\n二行目。",
    });
    expect(doc.nodes[4]).toEqual({ id: "A-005", title: "入荷を待つ", kind: "process", color: "amber" });
    expect(doc.nodes[5]).toMatchObject({ x: 220, y: 560 });
    // Absolute, may be negative, whole pixels.
    expect(doc.nodes[7]).toMatchObject({ x: -40, y: -12 });
    expect(parseAlgorithm("## Nodes\n\n- A-001 a @10.6,-3.4\n").nodes[0]).toMatchObject({ x: 11, y: -3 });
    expect(doc.edges).toEqual([
      { from: "A-001", to: "A-002" },
      { from: "A-002", to: "A-003" },
      { from: "A-003", to: "A-004", label: "はい" },
      { from: "A-003", to: "A-005", label: "いいえ" },
      { from: "A-004", to: "A-006" },
      { from: "A-006", to: "A-007" },
      { from: "A-005", to: "A-002", label: "入荷後に再試行" },
    ]);
    expect(doc.stickies).toHaveLength(1);
    expect(warningCount(doc)).toBe(0);
  });

  it("takes modifiers in any order and the title is what is left", () => {
    const n = parseAlgorithm("## Nodes\n\n- A-001 @5,6 #blue ^io ファイルを 読む task:T-1\n").nodes[0];
    expect(n).toEqual({ id: "A-001", title: "ファイルを 読む", kind: "io", color: "blue", task: "T-1", x: 5, y: 6 });
  });

  it("accepts an explicit ^process and writes it back without the mark", () => {
    const doc = parseAlgorithm("## Nodes\n\n- A-001 x ^process\n");
    expect(doc.nodes[0].kind).toBe("process");
    expect(formatNode(doc.nodes[0])).toEqual(["- A-001 x"]);
  });

  it("keeps an unknown ^mark, an unknown # and a malformed @ as part of the title", () => {
    const doc = parseAlgorithm("## Nodes\n\n- A-001 x ^foo #nocolor @1;2\n");
    expect(doc.nodes[0]).toMatchObject({ title: "x ^foo #nocolor @1;2", kind: "process" });
    expect(doc.nodes[0].x).toBeUndefined();
    // And it survives a save as it was.
    expect(save("## Nodes\n\n- A-001 x ^foo #nocolor @1;2\n")).toContain("- A-001 x ^foo #nocolor @1;2\n");
  });

  it("does not read the memo", () => {
    expect(parseAlgorithm(NOTE).nodes.find((n) => n.id === "A-099")).toBeUndefined();
  });

  it("mints ids for hand-written lines and repairs duplicates; ids are never reused", () => {
    const doc = parseAlgorithm("## Nodes\n\n- A-007 a\n- 受付\n- A-007 dup\n- A-003 p\n");
    expect(doc.nodes.map((n) => n.id)).toEqual(["A-007", "A-008", "A-009", "A-003"]);
    expect(doc.mintedIds).toBe(true);
    expect(nextNodeId(doc.nodes)).toBe("A-010");
    expect(findNode(doc.nodes, "A-008")?.title).toBe("受付");
  });

  it("merges duplicate arrows, keeping the first label", () => {
    const doc = parseAlgorithm(
      '## Nodes\n\n- A-001 a\n- A-002 b\n\n## Edges\n\n- A-001 -> A-002\n- A-001 -> A-002 "はい"\n- A-001 -> A-002 "いいえ"\n',
    );
    expect(doc.edges).toEqual([{ from: "A-001", to: "A-002", label: "はい" }]);
  });
});

describe("serializeAlgorithm", () => {
  it("round-trips a canonical note exactly, apart from the date", () => {
    expect(save(NOTE)).toBe(stamped(NOTE));
  });

  it("keeps the reserved direction key, unknown sections and ## Memo byte for byte", () => {
    const out = save(NOTE, (d) => ({
      ...d,
      nodes: [...d.nodes, { id: "A-009", title: "追加", kind: "process" }],
    }));
    expect(out).toContain("\n- A-009 追加\n");
    expect(out).toContain("direction: right\n");
    expect(out.slice(out.indexOf("## Notes"))).toBe(NOTE.slice(NOTE.indexOf("## Notes")));
  });

  it("writes a node's tokens in a fixed order, the mark after the title", () => {
    expect(save("## Nodes\n\n- A-001 x @10,20 #blue ^sub task:T-1\n")).toContain(
      "- A-001 x ^sub task:T-1 #blue @10,20\n",
    );
  });

  it("writes an edge label between quotes and cannot corrupt the line with one", () => {
    const out = save("## Nodes\n\n- A-001 a\n- A-002 b\n", (d) => ({
      ...d,
      edges: [{ from: "A-001", to: "A-002", label: 'say "hi"\nthere' }],
    }));
    expect(out).toContain("- A-001 -> A-002 \"say 'hi' there\"\n");
    expect(parseAlgorithm(out).edges[0].label).toBe("say 'hi' there");
  });

  it("keeps broken lines verbatim and counts them as warnings", () => {
    const text = `---
type: algorithm
title: t
---

## Nodes

- A-001 a
- F-001 another kind's step
  with a note of its own
not a list item
- X-001 something else

## Edges

- A-001 -> A-404
- A-001 -> F-001
- see the sketch
`;
    const doc = parseAlgorithm(text);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.rawNodes).toEqual([
      "- F-001 another kind's step",
      "  with a note of its own",
      "not a list item",
      "- X-001 something else",
    ]);
    expect(doc.rawEdges).toEqual(["- A-001 -> A-404", "- A-001 -> F-001", "- see the sketch"]);
    expect(warningCount(doc)).toBe(7);

    const out = save(text);
    for (const line of [...doc.rawNodes, ...doc.rawEdges]) expect(out).toContain(line);
    expect(warningCount(parseAlgorithm(out))).toBe(7);
  });

  it("keeps an arrow to itself in the model (it is only not drawn)", () => {
    const text = "## Nodes\n\n- A-001 a\n\n## Edges\n\n- A-001 -> A-001\n";
    expect(parseAlgorithm(text).edges).toEqual([{ from: "A-001", to: "A-001" }]);
    expect(save(text)).toContain("- A-001 -> A-001\n");
  });

  it("merges duplicate arrows into one and writes the pair once", () => {
    const text = "## Nodes\n\n- A-001 a\n- A-002 b\n\n## Edges\n\n- A-001 -> A-002\n- A-002 -> A-001\n- A-001 -> A-002\n";
    const doc = parseAlgorithm(text);
    expect(doc.edges).toHaveLength(2);
    expect(save(text).match(/A-001 -> A-002/g)).toHaveLength(1);
    doc.edges = [...doc.edges, { from: "A-001", to: "A-002" }];
    expect(serializeAlgorithm("## Nodes\n", doc, "2026-10-11").match(/A-001 -> A-002/g)).toHaveLength(1);
  });

  it("keeps a sticky whose node is gone", () => {
    const text = "## Nodes\n\n- A-001 a\n\n## Stickies\n\n- S-001 node:A-009 lost\n";
    expect(warningCount(parseAlgorithm(text))).toBe(1);
    expect(save(text)).toContain("- S-001 node:A-009 @32,24 lost");
  });

  it("adds missing sections before ## Memo, in order", () => {
    const text = "---\ntype: algorithm\ntitle: t\n---\n\n## Memo\n\nkeep\n";
    const doc = parseAlgorithm(text);
    doc.nodes = [{ id: "A-001", title: "a", kind: "start" }];
    const out = serializeAlgorithm(text, doc, "2026-10-11");
    const order = ["## Nodes", "## Edges", "## Memo"].map((h) => out.indexOf(h));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out.endsWith("## Memo\n\nkeep\n")).toBe(true);
  });

  it("keeps CRLF files CRLF", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    const out = save(crlf);
    expect(out).toContain("\r\n");
    expect(out.replace(/\r\n/g, "\n")).toBe(stamped(NOTE));
    expect(parseAlgorithm(crlf).nodes).toHaveLength(8);
  });

  it("writes stickies: hidden and removes it again", () => {
    const hidden = save(NOTE, (d) => ({ ...d, stickiesHidden: true }));
    expect(hidden).toContain("stickies: hidden");
    expect(parseAlgorithm(hidden).stickiesHidden).toBe(true);
    expect(save(hidden, (d) => ({ ...d, stickiesHidden: false }))).not.toContain("stickies:");
  });

  it("round-trips a title that holds characters the grammar uses", () => {
    const out = save("## Nodes\n\n- A-001 a -> b (x) | y: z\n");
    expect(out).toContain("- A-001 a -> b (x) | y: z\n");
  });
});

describe("edge ports (T-0719)", () => {
  const PORTS = `---
type: algorithm
title: t
---

## Nodes

- A-001 Start ^start
- A-002 Step
- A-003 End ^end

## Edges

- A-001:E@0.5 -> A-002:W "Go"
- A-002:N -> A-003

## Stickies
`;

  it("reads pinned sides and ratios", () => {
    const doc = parseAlgorithm(PORTS);
    expect(doc.edges).toEqual([
      {
        from: "A-001",
        to: "A-002",
        label: "Go",
        fromPort: { side: "E", at: 0.5 },
        toPort: { side: "W" },
      },
      { from: "A-002", to: "A-003", fromPort: { side: "N" } },
    ]);
    expect(doc.rawEdges).toEqual([]);
  });

  it("ignores pins for identity and writes them back", () => {
    const doc = parseAlgorithm(`${PORTS}\n`);
    const out = serializeAlgorithm(PORTS, doc, "2026-10-10");
    expect(out).toContain('- A-001:E@0.5 -> A-002:W "Go"');
    expect(out).toContain("- A-002:N -> A-003");
    expect(parseAlgorithm(out).edges).toEqual(doc.edges);
  });
});
