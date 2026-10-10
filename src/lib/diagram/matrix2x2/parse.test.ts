import { describe, expect, it } from "vitest";
import {
  clampUnit,
  formatUnit,
  nextItemId,
  parseMatrix,
  serializeMatrix,
  warningCount,
} from "./parse";

const NOTE = `---
type: matrix2x2
title: 施策の優先度
created: 2026-10-09
updated: 2026-10-09
x_axis: 工数
x_low: 小
x_high: 大
y_axis: 効果
y_low: 小
y_high: 大
q_tl: 先にやる
q_tr: 計画してやる
q_bl: 気が向いたら
q_br: やらない
---

## Items

- M-001 タブの並び替え @0.20,0.85 #green task:T-0684
- M-002 図解 AI 編集 @0.75,0.70 #blue
  メモ行。
  二行目。
- M-003 置き場の整理

## Stickies

- S-001 node:M-002 @40,-20 #red 要確認

## Notes

人間の覚え書き。

## Memo

触らない。
- M-099 memo の中の行
`;

const save = (content: string, edit = (d: ReturnType<typeof parseMatrix>) => d) =>
  serializeMatrix(content, edit(parseMatrix(content)), "2026-10-10");

describe("parseMatrix", () => {
  it("reads items, positions, colours, tasks and notes", () => {
    const doc = parseMatrix(NOTE);
    expect(doc.title).toBe("施策の優先度");
    expect(doc.items).toHaveLength(3);
    expect(doc.items[0]).toEqual({
      id: "M-001",
      title: "タブの並び替え",
      x: 0.2,
      y: 0.85,
      color: "green",
      task: "T-0684",
    });
    expect(doc.items[1].note).toBe("メモ行。\n二行目。");
    expect(doc.items[1].title).toBe("図解 AI 編集");
    // No `@`: not placed yet.
    expect(doc.items[2].x).toBeUndefined();
    expect(doc.items[2].y).toBeUndefined();
  });

  it("reads the axis and quadrant labels", () => {
    const doc = parseMatrix(NOTE);
    expect(doc.xAxis).toBe("工数");
    expect(doc.yHigh).toBe("大");
    expect(doc.qTl).toBe("先にやる");
    expect(doc.qBr).toBe("やらない");
  });

  it("treats missing labels as empty", () => {
    const doc = parseMatrix("---\ntype: matrix2x2\n---\n\n## Items\n");
    expect(doc.xAxis).toBe("");
    expect(doc.qTr).toBe("");
  });

  it("reads stickies pinned to items", () => {
    const doc = parseMatrix(NOTE);
    expect(doc.stickies).toEqual([
      { id: "S-001", targetId: "M-002", dx: 40, dy: -20, color: "red", text: "要確認" },
    ]);
  });

  it("clamps and rounds out-of-range coordinates", () => {
    const doc = parseMatrix(
      "---\ntype: matrix2x2\n---\n\n## Items\n\n- M-001 a @1.5,-0.3\n- M-002 b @0.456,0.004\n- M-003 c @.5,1\n",
    );
    expect(doc.items.map((i) => [i.x, i.y])).toEqual([
      [1, 0],
      [0.46, 0],
      [0.5, 1],
    ]);
  });

  it("keeps a malformed `@` in the title instead of eating it", () => {
    const doc = parseMatrix("---\ntype: matrix2x2\n---\n\n## Items\n\n- M-001 mail @0.5 and @a,b\n");
    expect(doc.items[0].title).toBe("mail @0.5 and @a,b");
    expect(doc.items[0].x).toBeUndefined();
  });

  it("mints ids for hand-typed lines and repairs duplicates", () => {
    const doc = parseMatrix(
      "---\ntype: matrix2x2\n---\n\n## Items\n\n- M-001 a\n- typed by hand\n- M-001 dup\n",
    );
    expect(doc.items.map((i) => i.id)).toEqual(["M-001", "M-002", "M-003"]);
    expect(doc.mintedIds).toBe(true);
  });

  it("never reuses an id", () => {
    const doc = parseMatrix(NOTE);
    expect(nextItemId(doc.items)).toBe("M-004");
    expect(nextItemId([])).toBe("M-001");
  });

  it("keeps lines it cannot read, without counting them as items", () => {
    const doc = parseMatrix(
      "---\ntype: matrix2x2\n---\n\n## Items\n\n- M-001 a\nsome prose\n- N-007 a mindmap line\n- M-002 b\n",
    );
    expect(doc.items.map((i) => i.id)).toEqual(["M-001", "M-002"]);
    expect(doc.rawItems).toEqual(["some prose", "- N-007 a mindmap line"]);
    expect(warningCount(doc)).toBe(2);
  });

  it("counts a sticky whose item is gone as a warning, and keeps it", () => {
    const doc = parseMatrix(
      "---\ntype: matrix2x2\n---\n\n## Items\n\n- M-001 a\n\n## Stickies\n\n- S-001 node:M-404 lost\n",
    );
    expect(doc.stickies).toHaveLength(1);
    expect(warningCount(doc)).toBe(1);
  });

  it("reads a CRLF file", () => {
    const doc = parseMatrix(NOTE.replace(/\n/g, "\r\n"));
    expect(doc.items).toHaveLength(3);
    expect(doc.items[1].note).toBe("メモ行。\n二行目。");
  });
});

describe("serializeMatrix", () => {
  it("round-trips an untouched note, apart from `updated`", () => {
    const out = save(NOTE);
    expect(out).toBe(NOTE.replace("updated: 2026-10-09", "updated: 2026-10-10"));
  });

  it("parses back to the same model", () => {
    const once = parseMatrix(NOTE);
    const twice = parseMatrix(save(NOTE));
    expect(twice).toEqual(once);
  });

  it("leaves ## Memo and unknown sections byte-for-byte", () => {
    const out = save(NOTE, (d) => ({
      ...d,
      items: [...d.items, { id: "M-004", title: "new", x: 0.5, y: 0.5 }],
    }));
    const tail = NOTE.slice(NOTE.indexOf("## Notes"));
    expect(out.endsWith(tail)).toBe(true);
    expect(out).toContain("- M-004 new @0.50,0.50");
  });

  it("keeps unknown sections where they were, even before ## Items", () => {
    const content = "---\ntype: matrix2x2\n---\n\n## Context\n\nwhy\n\n## Items\n\n- M-001 a\n\n## Memo\n\nm\n";
    const out = save(content, (d) => ({ ...d, items: [{ ...d.items[0], title: "b" }] }));
    expect(out.indexOf("## Context")).toBeLessThan(out.indexOf("## Items"));
    expect(out).toContain("## Context\n\nwhy\n\n## Items\n\n- M-001 b\n\n## Memo\n\nm\n");
  });

  it("writes only the dragged item's position", () => {
    const out = save(NOTE, (d) => ({
      ...d,
      items: d.items.map((i) => (i.id === "M-003" ? { ...i, x: 0.333, y: 0.8 } : i)),
    }));
    expect(out).toContain("- M-003 置き場の整理 @0.33,0.80");
    expect(out).toContain("- M-001 タブの並び替え @0.20,0.85 #green task:T-0684");
  });

  it("writes coordinates with two decimals", () => {
    expect(formatUnit(0.7)).toBe("0.70");
    expect(formatUnit(0)).toBe("0.00");
    expect(formatUnit(1.4)).toBe("1.00");
    expect(clampUnit(Number.NaN)).toBe(0.5);
    const out = save(NOTE, (d) => ({ ...d, items: [{ id: "M-001", title: "a", x: 0.7, y: 0.1 }] }));
    expect(out).toContain("- M-001 a @0.70,0.10");
  });

  it("preserves a line it could not read, after the items", () => {
    const content =
      "---\ntype: matrix2x2\n---\n\n## Items\n\n- M-001 a\nstray prose\n- F-002 not mine\n\n## Memo\n\nm\n";
    const out = save(content, (d) => ({ ...d, items: [{ ...d.items[0], title: "b" }] }));
    expect(out).toContain("- M-001 b\nstray prose\n- F-002 not mine\n");
    expect(out.endsWith("## Memo\n\nm\n")).toBe(true);
  });

  it("keeps a sticky that points nowhere", () => {
    const content =
      "---\ntype: matrix2x2\n---\n\n## Items\n\n- M-001 a\n\n## Stickies\n\n- S-001 node:M-404 @1,2 lost\n- not a sticky\n\n## Memo\n";
    const out = save(content);
    expect(out).toContain("- S-001 node:M-404 @1,2 lost\n- not a sticky\n");
  });

  it("removes an item's stickies only when the caller does", () => {
    const out = save(NOTE, (d) => ({
      ...d,
      items: d.items.filter((i) => i.id !== "M-002"),
      stickies: d.stickies.filter((s) => s.targetId !== "M-002"),
    }));
    expect(out).not.toContain("## Stickies");
    expect(out).not.toContain("M-002");
  });

  it("writes a hidden-stickies setting as a frontmatter key, and the default as no key", () => {
    const hidden = save(NOTE, (d) => ({ ...d, stickiesHidden: true }));
    expect(hidden).toContain("stickies: hidden");
    expect(parseMatrix(hidden).stickiesHidden).toBe(true);
    const shown = save(hidden, (d) => ({ ...d, stickiesHidden: false }));
    expect(shown).not.toContain("stickies:");
  });

  it("rewrites a changed label and leaves untouched ones as spelled", () => {
    const content = NOTE.replace("x_axis: 工数", 'x_axis: "工数"');
    const out = save(content, (d) => ({ ...d, yAxis: "インパクト" }));
    expect(out).toContain('x_axis: "工数"');
    expect(out).toContain("y_axis: インパクト");
  });

  it("drops the key when a label is emptied, and quotes a risky one", () => {
    const emptied = save(NOTE, (d) => ({ ...d, qBr: "" }));
    expect(emptied).not.toContain("q_br:");
    const risky = save(NOTE, (d) => ({ ...d, xLow: "easy: cheap" }));
    expect(risky).toContain('x_low: "easy: cheap"');
    expect(parseMatrix(risky).xLow).toBe("easy: cheap");
  });

  it("fills a skeleton's empty label keys in place", () => {
    const skeleton =
      "---\ntype: matrix2x2\ntitle: T\ncreated: 2026-10-09\nupdated: 2026-10-09\nx_axis:\nx_low:\n---\n\n## Items\n\n## Memo\n\n";
    const out = save(skeleton, (d) => ({ ...d, xAxis: "Effort" }));
    expect(out).toContain("x_axis: Effort\nx_low:\n---");
  });

  it("inserts a missing ## Items before ## Memo, not after it", () => {
    const content = "---\ntype: matrix2x2\ntitle: T\n---\n\n## Memo\n\nmine\n";
    const out = save(content, (d) => ({ ...d, items: [{ id: "M-001", title: "a" }] }));
    expect(out.indexOf("## Items")).toBeLessThan(out.indexOf("## Memo"));
    expect(out.endsWith("## Memo\n\nmine\n")).toBe(true);
  });

  it("leaves a ## Stickies that sits before ## Items where it is", () => {
    const content =
      "---\ntype: matrix2x2\nupdated: 2026-10-10\n---\n\n## Stickies\n\n- S-001 node:M-001 @1,1 #red x\n\n## Items\n\n- M-001 a\n\n## Memo\n\nm\n";
    expect(save(content)).toBe(content);
  });

  it("keeps the file's line endings", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    const out = save(crlf);
    expect(out).not.toMatch(/[^\r]\n/);
    expect(out).toBe(crlf.replace("updated: 2026-10-09", "updated: 2026-10-10"));
  });

  it("flattens a multi-line title to its first line", () => {
    const out = save(NOTE, (d) => ({ ...d, items: [{ id: "M-001", title: "one\ntwo" }] }));
    expect(out).toContain("- M-001 one\n");
    expect(out).not.toContain("two");
  });
});
