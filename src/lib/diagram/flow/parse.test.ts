import { describe, expect, it } from "vitest";
import { parseFlow, serializeFlow, warningCount } from "./parse";

const NOTE = `---
type: flow
title: 受注フロー
created: 2026-10-09
updated: 2026-10-09
---

## Lanes

- L-001 営業 #blue
- L-002 経理 #green

## Steps

- F-001 受注 ^start lane:L-001
- F-002 見積を作る lane:L-001 task:T-0100
  メモ行。
  二行目。
- F-003 金額 1 万円超? ^decision lane:L-001
- F-004 承認する lane:L-002 @640,0
- F-005 完了 ^end lane:L-001 #red @900,-12

## Edges

- F-001 -> F-002
- F-002 -> F-003
- F-003 -> F-004 "はい"
- F-003 -> F-005 "いいえ"

## Stickies

- S-001 node:F-004 @40,-20 #red 要確認

## Notes

人間の覚え書き。

## Memo

触らない。
- F-099 memo の中の行
`;

const save = (content: string, edit = (d: ReturnType<typeof parseFlow>) => d) =>
  serializeFlow(content, edit(parseFlow(content)), "2026-10-10");

describe("parseFlow", () => {
  it("reads lanes, steps, arrows and their modifiers", () => {
    const doc = parseFlow(NOTE);
    expect(doc.title).toBe("受注フロー");
    expect(doc.lanes).toEqual([
      { id: "L-001", title: "営業", color: "blue" },
      { id: "L-002", title: "経理", color: "green" },
    ]);
    expect(doc.steps).toHaveLength(5);
    expect(doc.steps[0]).toEqual({ id: "F-001", title: "受注", kind: "start", lane: "L-001" });
    expect(doc.steps[1]).toEqual({
      id: "F-002",
      title: "見積を作る",
      kind: "process",
      lane: "L-001",
      task: "T-0100",
      note: "メモ行。\n二行目。",
    });
    expect(doc.steps[2]).toMatchObject({ title: "金額 1 万円超?", kind: "decision" });
    expect(doc.steps[3]).toMatchObject({ x: 640, y: 0 });
    // Positions are whole pixels.
    expect(parseFlow("## Steps\n\n- F-001 a @10.6,-3.4\n").steps[0]).toMatchObject({ x: 11, y: -3 });
    expect(doc.steps[4]).toMatchObject({ kind: "end", color: "red", x: 900, y: -12 });
    expect(doc.edges).toEqual([
      { from: "F-001", to: "F-002" },
      { from: "F-002", to: "F-003" },
      { from: "F-003", to: "F-004", label: "はい" },
      { from: "F-003", to: "F-005", label: "いいえ" },
    ]);
    expect(doc.stickies).toHaveLength(1);
    expect(doc.rawSteps).toEqual([]);
    expect(warningCount(doc)).toBe(0);
  });

  it("does not read the memo", () => {
    expect(parseFlow(NOTE).steps.find((s) => s.id === "F-099")).toBeUndefined();
  });

  it("keeps a lane: that names no lane, and an unrecognised ^ or # in the title", () => {
    const doc = parseFlow("## Steps\n\n- F-001 x ^weird #nocolor lane:L-404\n");
    expect(doc.steps[0]).toMatchObject({ title: "x ^weird #nocolor", lane: "L-404" });
  });

  it("mints ids for hand-written lines", () => {
    const doc = parseFlow("## Lanes\n\n- 営業\n\n## Steps\n\n- F-007 a\n- 受付\n- F-007 dup\n");
    expect(doc.lanes[0].id).toBe("L-001");
    expect(doc.steps.map((s) => s.id)).toEqual(["F-007", "F-008", "F-009"]);
    expect(doc.mintedIds).toBe(true);
  });
});

describe("serializeFlow", () => {
  it("round-trips a canonical note exactly, apart from the date", () => {
    const out = save(NOTE);
    expect(out).toBe(NOTE.replace("updated: 2026-10-09", "updated: 2026-10-10"));
  });

  it("keeps ## Memo and unknown sections in place when a step is added", () => {
    const out = save(NOTE, (d) => ({
      ...d,
      steps: [...d.steps, { id: "F-006", title: "追加", kind: "process" }],
    }));
    expect(out).toContain("- F-006 追加\n");
    expect(out.slice(out.indexOf("## Notes"))).toBe(NOTE.slice(NOTE.indexOf("## Notes")));
  });

  it("writes a step's modifiers in a fixed order", () => {
    const out = save("## Steps\n\n- F-001 x #blue @10,20 task:T-1 lane:L-1 ^decision\n");
    expect(out).toContain("- F-001 x ^decision lane:L-1 task:T-1 #blue @10,20\n");
  });

  it("keeps broken lines verbatim and counts them as warnings", () => {
    const text = `---
type: flow
title: t
---

## Lanes

- L-001 営業
not a list item

## Steps

- F-001 a lane:L-001
- P-001 another kind's step
- N-002 [[x]] mindmap node

## Edges

- F-001 -> F-404 "missing target"
- F-001 -> F-001
- see the sketch
`;
    const doc = parseFlow(text);
    expect(doc.steps).toHaveLength(1);
    expect(doc.rawLanes).toEqual(["not a list item"]);
    expect(doc.rawSteps).toEqual(["- P-001 another kind's step", "- N-002 [[x]] mindmap node"]);
    // F-001 -> F-001 names a real step, so it is an arrow (kept, never drawn).
    expect(doc.edges).toEqual([{ from: "F-001", to: "F-001" }]);
    expect(doc.rawEdges).toEqual(['- F-001 -> F-404 "missing target"', "- see the sketch"]);
    expect(warningCount(doc)).toBe(5);

    const out = save(text);
    for (const line of [
      "not a list item",
      "- P-001 another kind's step",
      "- N-002 [[x]] mindmap node",
      '- F-001 -> F-404 "missing target"',
      "- see the sketch",
    ]) {
      expect(out).toContain(line);
    }
    // And they are still warnings after the round trip.
    expect(warningCount(parseFlow(out))).toBe(5);
  });

  it("keeps a sticky whose step is gone", () => {
    const text = "## Steps\n\n- F-001 a\n\n## Stickies\n\n- S-001 node:F-009 lost\n";
    const doc = parseFlow(text);
    expect(warningCount(doc)).toBe(1);
    expect(save(text)).toContain("- S-001 node:F-009 @32,24 lost");
  });

  it("merges two lines for one pair into one arrow, keeping a label", () => {
    const text = `## Steps

- F-001 a
- F-002 b

## Edges

- F-001 -> F-002
- F-002 -> F-001 "back"
- F-001 -> F-002 "first label"
- F-001 -> F-002 "second"
`;
    const doc = parseFlow(text);
    expect(doc.edges).toEqual([
      { from: "F-001", to: "F-002", label: "first label" },
      { from: "F-002", to: "F-001", label: "back" },
    ]);
    const out = save(text);
    expect(out.match(/F-001 -> F-002/g)).toHaveLength(1);
    expect(out).toContain('- F-002 -> F-001 "back"');
  });

  it("does not write the same pair twice even if the model holds it twice", () => {
    const doc = parseFlow("## Steps\n\n- F-001 a\n- F-002 b\n");
    doc.edges = [
      { from: "F-001", to: "F-002" },
      { from: "F-001", to: "F-002", label: "x" },
    ];
    const out = serializeFlow("## Steps\n", doc, "2026-10-10");
    expect(out.match(/F-001 -> F-002/g)).toHaveLength(1);
  });

  it("flattens quotes and newlines in an arrow label", () => {
    const doc = parseFlow("## Steps\n\n- F-001 a\n- F-002 b\n");
    doc.edges = [{ from: "F-001", to: "F-002", label: 'say "hi"\nnow' }];
    const out = serializeFlow("## Steps\n", doc, "2026-10-10");
    expect(out).toContain(`- F-001 -> F-002 "say 'hi' now"`);
    expect(parseFlow(out).edges[0].label).toBe("say 'hi' now");
  });

  it("adds missing sections before ## Memo, in order", () => {
    const text = "---\ntype: flow\ntitle: t\n---\n\n## Memo\n\nkeep\n";
    const doc = parseFlow(text);
    doc.steps = [{ id: "F-001", title: "a", kind: "process" }];
    const out = serializeFlow(text, doc, "2026-10-10");
    const order = ["## Lanes", "## Steps", "## Edges", "## Memo"].map((h) => out.indexOf(h));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out.endsWith("## Memo\n\nkeep\n")).toBe(true);
  });

  it("keeps CRLF files CRLF", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    const out = save(crlf);
    expect(out).toContain("\r\n");
    expect(out.replace(/\r\n/g, "\n")).toBe(NOTE.replace("updated: 2026-10-09", "updated: 2026-10-10"));
    expect(parseFlow(crlf).steps).toHaveLength(5);
  });

  it("writes stickies: hidden and removes it again", () => {
    const hidden = save(NOTE, (d) => ({ ...d, stickiesHidden: true }));
    expect(hidden).toContain("stickies: hidden");
    expect(parseFlow(hidden).stickiesHidden).toBe(true);
    expect(save(hidden, (d) => ({ ...d, stickiesHidden: false }))).not.toContain("stickies:");
  });
});
