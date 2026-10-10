import { afterEach, describe, expect, it } from "vitest";
import { findNode, nextNodeId, parsePfd, serializePfd, warningCount } from "./parse";
import { SYMBOLS, mayConnect, symbolOf } from "./symbols";

const NOTE = `---
type: pfd
title: 開発の流れ
created: 2026-10-09
updated: 2026-10-09
---

## Nodes

- P-001 要件を整理する @120,160
  定義書の要点。
  二行目。
- D-001 要件定義書 task:T-0100 #amber @360,160
- P-002 設計する
- D-002 設計書 @-40,-12

## Edges

- P-001 -> D-001
- D-001 -> P-002
- P-002 -> D-002

## Stickies

- S-001 node:D-001 @40,-20 #red 要確認

## Notes

人間の覚え書き。

## Memo

触らない。
- P-099 memo の中の行
`;

const save = (content: string, edit = (d: ReturnType<typeof parsePfd>) => d) =>
  serializePfd(content, edit(parsePfd(content)), "2026-10-10");

describe("parsePfd", () => {
  it("reads nodes, arrows and their modifiers", () => {
    const doc = parsePfd(NOTE);
    expect(doc.title).toBe("開発の流れ");
    expect(doc.nodes).toHaveLength(4);
    expect(doc.nodes[0]).toEqual({
      id: "P-001",
      title: "要件を整理する",
      x: 120,
      y: 160,
      note: "定義書の要点。\n二行目。",
    });
    expect(doc.nodes[1]).toEqual({
      id: "D-001",
      title: "要件定義書",
      x: 360,
      y: 160,
      color: "amber",
      task: "T-0100",
    });
    expect(doc.nodes[2]).toEqual({ id: "P-002", title: "設計する" });
    // Coordinates are absolute and may be negative; whole pixels.
    expect(doc.nodes[3]).toMatchObject({ x: -40, y: -12 });
    expect(parsePfd("## Nodes\n\n- P-001 a @10.6,-3.4\n").nodes[0]).toMatchObject({ x: 11, y: -3 });
    expect(doc.edges).toEqual([
      { from: "P-001", to: "D-001" },
      { from: "D-001", to: "P-002" },
      { from: "P-002", to: "D-002" },
    ]);
    expect(doc.stickies).toHaveLength(1);
    expect(warningCount(doc)).toBe(0);
  });

  it("does not read the memo", () => {
    expect(parsePfd(NOTE).nodes.find((n) => n.id === "P-099")).toBeUndefined();
  });

  it("keeps an unrecognised # or malformed @ as part of the title", () => {
    const doc = parsePfd("## Nodes\n\n- P-001 x #nocolor @1;2\n");
    expect(doc.nodes[0]).toMatchObject({ title: "x #nocolor @1;2" });
    expect(doc.nodes[0].x).toBeUndefined();
  });

  it("mints ids per prefix for hand-written lines and repairs duplicates", () => {
    const doc = parsePfd("## Nodes\n\n- D-007 a\n- 受付\n- D-007 dup\n- P-003 p\n- P-003 q\n");
    expect(doc.nodes.map((n) => n.id)).toEqual(["D-007", "P-004", "D-008", "P-003", "P-005"]);
    expect(doc.mintedIds).toBe(true);
    expect(nextNodeId(doc.nodes, "D")).toBe("D-009");
    expect(nextNodeId(doc.nodes, "P")).toBe("P-006");
  });
});

describe("serializePfd", () => {
  it("round-trips a canonical note exactly, apart from the date", () => {
    expect(save(NOTE)).toBe(NOTE.replace("updated: 2026-10-09", "updated: 2026-10-10"));
  });

  it("keeps ## Memo and unknown sections in place when a node is added", () => {
    const out = save(NOTE, (d) => ({ ...d, nodes: [...d.nodes, { id: "P-003", title: "追加" }] }));
    expect(out).toContain("- P-003 追加\n");
    expect(out.slice(out.indexOf("## Notes"))).toBe(NOTE.slice(NOTE.indexOf("## Notes")));
  });

  it("writes a node's modifiers in a fixed order", () => {
    const out = save("## Nodes\n\n- P-001 x @10,20 #blue task:T-1\n");
    expect(out).toContain("- P-001 x task:T-1 #blue @10,20\n");
  });

  it("keeps broken lines verbatim and counts them as warnings", () => {
    const text = `---
type: pfd
title: t
---

## Nodes

- P-001 a
- X-001 a symbol this build does not know
  with a note of its own
- F-002 another kind's step
not a list item

## Edges

- P-001 -> P-404
- P-001 -> X-001
- see the sketch
`;
    const doc = parsePfd(text);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.rawNodes).toEqual([
      "- X-001 a symbol this build does not know",
      "  with a note of its own",
      "- F-002 another kind's step",
      "not a list item",
    ]);
    expect(doc.rawEdges).toEqual(["- P-001 -> P-404", "- P-001 -> X-001", "- see the sketch"]);
    expect(warningCount(doc)).toBe(7);

    const out = save(text);
    for (const line of [...doc.rawNodes, ...doc.rawEdges]) expect(out).toContain(line);
    expect(warningCount(parsePfd(out))).toBe(7);
  });

  it("reads an arrow between two nodes of the same kind like any other", () => {
    const text = `## Nodes

- P-001 a
- P-002 b
- D-001 c
- D-002 d

## Edges

- P-001 -> D-001
- P-001 -> P-002
- D-001 -> D-002
- D-002 -> P-002
`;
    const doc = parsePfd(text);
    expect(doc.edges).toEqual([
      { from: "P-001", to: "D-001" },
      { from: "P-001", to: "P-002" },
      { from: "D-001", to: "D-002" },
      { from: "D-002", to: "P-002" },
    ]);
    expect(doc.rawEdges).toEqual([]);
    expect(warningCount(doc)).toBe(0);
    const out = save(text);
    expect(out).toContain("- P-001 -> P-002\n");
    expect(out).toContain("- D-001 -> D-002\n");
    expect(parsePfd(out).edges).toEqual(doc.edges);
  });

  it("merges duplicate arrows into one and writes the pair once", () => {
    const text = "## Nodes\n\n- P-001 a\n- D-001 b\n\n## Edges\n\n- P-001 -> D-001\n- D-001 -> P-001\n- P-001 -> D-001\n";
    const doc = parsePfd(text);
    expect(doc.edges).toHaveLength(2);
    expect(save(text).match(/P-001 -> D-001/g)).toHaveLength(1);
    // Even a model that holds the pair twice writes it once.
    doc.edges = [...doc.edges, { from: "P-001", to: "D-001" }];
    expect(serializePfd("## Nodes\n", doc, "2026-10-10").match(/P-001 -> D-001/g)).toHaveLength(1);
  });

  it("keeps a sticky whose node is gone", () => {
    const text = "## Nodes\n\n- P-001 a\n\n## Stickies\n\n- S-001 node:P-009 lost\n";
    expect(warningCount(parsePfd(text))).toBe(1);
    expect(save(text)).toContain("- S-001 node:P-009 @32,24 lost");
  });

  it("adds missing sections before ## Memo, in order", () => {
    const text = "---\ntype: pfd\ntitle: t\n---\n\n## Memo\n\nkeep\n";
    const doc = parsePfd(text);
    doc.nodes = [{ id: "P-001", title: "a" }];
    const out = serializePfd(text, doc, "2026-10-10");
    const order = ["## Nodes", "## Edges", "## Memo"].map((h) => out.indexOf(h));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out.endsWith("## Memo\n\nkeep\n")).toBe(true);
  });

  it("keeps CRLF files CRLF", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    const out = save(crlf);
    expect(out).toContain("\r\n");
    expect(out.replace(/\r\n/g, "\n")).toBe(NOTE.replace("updated: 2026-10-09", "updated: 2026-10-10"));
    expect(parsePfd(crlf).nodes).toHaveLength(4);
  });

  it("writes stickies: hidden and removes it again", () => {
    const hidden = save(NOTE, (d) => ({ ...d, stickiesHidden: true }));
    expect(hidden).toContain("stickies: hidden");
    expect(parsePfd(hidden).stickiesHidden).toBe(true);
    expect(save(hidden, (d) => ({ ...d, stickiesHidden: false }))).not.toContain("stickies:");
  });
});

describe("the symbol registry", () => {
  const added: string[] = [];
  const original = SYMBOLS.map((s) => ({ ...s, next: [...s.next] }));
  afterEach(() => {
    SYMBOLS.length = 0;
    SYMBOLS.push(...original.map((s) => ({ ...s, next: [...s.next] })));
    added.length = 0;
  });

  it("knows the process and the deliverable and lets any two different nodes connect", () => {
    expect(symbolOf("P-001")?.name).toBe("process");
    expect(symbolOf("D-004")?.name).toBe("deliverable");
    expect(symbolOf("X-001")).toBeUndefined();
    expect(mayConnect("P-001", "D-001")).toBe(true);
    expect(mayConnect("D-001", "P-001")).toBe(true);
    expect(mayConnect("P-001", "P-002")).toBe(true);
    expect(mayConnect("D-001", "D-002")).toBe(true);
    expect(mayConnect("P-001", "X-001")).toBe(false);
    expect(mayConnect("P-001", "P-001")).toBe(false);
  });

  it("makes a line of a new symbol readable with one added entry", () => {
    const text = "## Nodes\n\n- P-001 a\n- R-001 台帳 @10,20\n  メモ\n\n## Edges\n\n- R-001 -> P-001\n- P-001 -> R-001\n";
    // Before: the line is kept, not understood.
    const before = parsePfd(text);
    expect(before.nodes.map((n) => n.id)).toEqual(["P-001"]);
    expect(before.rawNodes).toHaveLength(2);

    SYMBOLS.push({
      prefix: "R",
      name: "record",
      shape: "rounded",
      label: { en: "Record", ja: "台帳" },
      next: ["P"],
    });
    const after = parsePfd(text);
    expect(after.nodes.map((n) => n.id)).toEqual(["P-001", "R-001"]);
    expect(findNode(after.nodes, "R-001")).toMatchObject({ x: 10, y: 20, note: "メモ" });
    // Before, both arrows named an unknown node and were kept raw; now both are real.
    expect(before.rawEdges).toHaveLength(2);
    expect(after.edges).toEqual([
      { from: "R-001", to: "P-001" },
      { from: "P-001", to: "R-001" },
    ]);
    expect(after.rawEdges).toEqual([]);
    // The round trip is stable, and numbering is per prefix.
    expect(save(text)).toBe(serializePfd(text, after, "2026-10-10"));
    expect(nextNodeId(after.nodes, "R")).toBe("R-002");
  });
});

describe("edge ports (T-0718)", () => {
  const PORTS = `---
type: pfd
title: t
---

## Nodes

- P-001 A
- D-001 B
- D-002 C

## Edges

- P-001:E@0.5 -> D-001:W
- P-001:N -> D-002

## Stickies
`;

  it("reads pinned sides and ratios", () => {
    const doc = parsePfd(PORTS);
    expect(doc.edges).toEqual([
      { from: "P-001", to: "D-001", fromPort: { side: "E", at: 0.5 }, toPort: { side: "W" } },
      { from: "P-001", to: "D-002", fromPort: { side: "N" } },
    ]);
    expect(doc.rawEdges).toEqual([]);
    expect(warningCount(doc)).toBe(0);
  });

  it("keeps an unknown side as a raw line, and ignores pins for identity", () => {
    const doc = parsePfd(`---
type: pfd
title: t
---

## Nodes

- P-001 A
- D-001 B

## Edges

- P-001:X -> D-001
- P-001:E -> D-001:W
- P-001 -> D-001

## Stickies
`);
    expect(doc.edges).toEqual([
      { from: "P-001", to: "D-001", fromPort: { side: "E" }, toPort: { side: "W" } },
    ]);
    expect(doc.rawEdges).toEqual(["- P-001:X -> D-001"]);
  });

  it("writes pins back and reads them again", () => {
    const doc = parsePfd(PORTS);
    const out = serializePfd(PORTS, doc, "2026-10-10");
    expect(out).toContain("- P-001:E@0.5 -> D-001:W");
    expect(out).toContain("- P-001:N -> D-002");
    expect(parsePfd(out).edges).toEqual(doc.edges);
  });
});
