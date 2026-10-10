import { describe, expect, it } from "vitest";
import { convertNodeKind } from "./ops";
import { parsePfd, serializePfd, type PfdDocModel } from "./parse";

const HEAD = `---
type: pfd
title: t
created: 2026-10-09
updated: 2026-10-09
---
`;

const NOTE = `${HEAD}
## Nodes

- P-001 要件を整理する @120,160
- D-001 要件定義書 task:T-0100 #amber @360,160
  定義書の要点。
  二行目。
- P-002 設計する
- D-002 設計書 @-40,-12
- X-001 未知の記号

## Edges

- P-001 -> D-001
- D-001 -> P-002
- P-009 -> D-001

## Stickies

- S-001 node:D-001 @40,-20 #red 要確認
- S-002 node:P-002 @32,24 別の付箋

## Notes

人間の覚え書き。

## Memo

触らない。
- P-099 memo の中の行
`;

describe("convertNodeKind", () => {
  it("refuses when an arrow would join two nodes of one kind, and names it", () => {
    const before = parsePfd(NOTE);
    const r = convertNodeKind(before, "D-001", "P");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    if (r.reason !== "same-kind-edges") throw new Error("wrong reason");
    expect(r.edges).toEqual([
      { from: "P-001", to: "D-001" },
      { from: "D-001", to: "P-002" },
    ]);
    expect(before).toEqual(parsePfd(NOTE)); // nothing changed, no arrow dropped
  });

  it("converts a node that has no arrows and takes a fresh id of the new prefix", () => {
    const d = parsePfd(NOTE);
    const r = convertNodeKind(d, "D-002", "P");
    if (!r.ok) throw new Error("refused");
    expect(r.id).toBe("P-003"); // highest P- is P-002 (P-009 is only an arrow)
    expect(r.doc.nodes.map((n) => n.id)).toEqual(["P-001", "D-001", "P-002", "P-003"]);
    expect(r.doc.edges).toEqual(d.edges);
  });

  it("never reuses the old id: the next D- after converting a P- is past every D-", () => {
    const d = parsePfd(`${HEAD}\n## Nodes\n\n- P-001 a\n- D-001 b\n- D-004 c\n`);
    const r = convertNodeKind(d, "P-001", "D");
    if (!r.ok) throw new Error("refused");
    expect(r.id).toBe("D-005");
    expect(r.doc.nodes.some((n) => n.id === "P-001")).toBe(false);
  });

  it("keeps title, note, colour, task and position, and the node's place in the list", () => {
    const d = parsePfd(
      `${HEAD}\n## Nodes\n\n- P-001 a\n- P-002 leaf @10,20 #blue task:T-0001\n  note line\n- P-003 z\n`,
    );
    const r = convertNodeKind(d, "P-002", "D");
    if (!r.ok) throw new Error("refused");
    expect(r.doc.nodes.map((n) => n.id)).toEqual(["P-001", "D-001", "P-003"]);
    expect(r.doc.nodes[1]).toEqual({
      id: "D-001",
      title: "leaf",
      x: 10,
      y: 20,
      color: "blue",
      task: "T-0001",
      note: "note line",
    });
  });

  it("re-points arrows and stickies when the conversion makes every arrow valid", () => {
    // A model holding a same-kind arrow (a parsed note never does): turning P-002
    // into a deliverable repairs it, and both ends follow the new id.
    const d: PfdDocModel = {
      ...parsePfd(`${HEAD}\n## Nodes\n\n- P-001 a\n- P-002 b @1,2\n- D-001 c\n`),
      edges: [
        { from: "P-001", to: "P-002" },
        { from: "P-002", to: "P-001" },
      ],
      stickies: [
        { id: "S-001", targetId: "P-002", dx: 5, dy: 6, text: "hi" },
        { id: "S-002", targetId: "P-001", dx: 1, dy: 1, text: "other" },
      ],
    };
    const r = convertNodeKind(d, "P-002", "D");
    if (!r.ok) throw new Error("refused");
    expect(r.id).toBe("D-002");
    expect(r.doc.edges).toEqual([
      { from: "P-001", to: "D-002" },
      { from: "D-002", to: "P-001" },
    ]);
    expect(r.doc.stickies.map((s) => s.targetId)).toEqual(["D-002", "P-001"]);
    expect(r.doc.stickies[0]).toMatchObject({ id: "S-001", dx: 5, dy: 6, text: "hi" });
  });

  it("is a no-op for the kind it already has", () => {
    const d = parsePfd(NOTE);
    const r = convertNodeKind(d, "P-001", "P");
    if (!r.ok) throw new Error("refused");
    expect(r.doc).toBe(d);
    expect(r.id).toBe("P-001");
  });

  it("refuses an unknown node or an unknown prefix", () => {
    const d = parsePfd(NOTE);
    for (const r of [convertNodeKind(d, "P-404", "D"), convertNodeKind(d, "P-001", "Z")]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("unknown");
    }
  });

  it("through the file: only the node and its stickies change; raw lines and Memo stay", () => {
    const src = `${HEAD}
## Nodes

- P-001 a
- D-001 b @10,20
- X-001 unknown

## Edges

- P-001 -> X-001
- P-001 -> P-001

## Stickies

- S-001 node:D-001 @5,5 hi
- S-002 node:P-001 @1,1 other

## Notes

keep

## Memo

- P-001 stays in memo
`;
    const d = parsePfd(src);
    const r = convertNodeKind(d, "D-001", "P");
    if (!r.ok) throw new Error("refused");
    const out = serializePfd(src, r.doc, "2026-10-10");
    expect(out).toContain("- P-002 b @10,20");
    expect(out).not.toContain("D-001");
    expect(out).toContain("- S-001 node:P-002 @5,5 hi");
    expect(out).toContain("- S-002 node:P-001 @1,1 other");
    expect(out).toContain("- X-001 unknown");
    expect(out).toContain("- P-001 -> X-001");
    expect(out).toContain("- P-001 -> P-001");
    expect(out.slice(out.indexOf("## Notes"))).toBe(src.slice(src.indexOf("## Notes")));
  });
});
