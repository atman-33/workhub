import { describe, expect, it } from "vitest";
import { parseMatrix, serializeMatrix, warningCount } from "./parse";
import { shouldCoalesce, normalizeQuadrantNote } from "./quadrant-notes";

const HEAD = "---\ntype: matrix2x2\ntitle: T\nupdated: 2026-10-10\nq_tl: 先にやる\n---\n\n";
const ITEMS = "## Items\n\n- M-001 a @0.20,0.80\n\n";
const MEMO = "## Memo\n\n- q_tl メモの中は読まない\n";

const save = (content: string, edit = (d: ReturnType<typeof parseMatrix>) => d) =>
  serializeMatrix(content, edit(parseMatrix(content)), "2026-10-10");

const withNotes = (notes: Partial<ReturnType<typeof parseMatrix>["quadrantNotes"]>) => (d: ReturnType<typeof parseMatrix>) => ({
  ...d,
  quadrantNotes: { ...d.quadrantNotes, ...notes },
});

describe("parseMatrix: ## Quadrants", () => {
  it("reads the first line and the indented continuation", () => {
    const d = parseMatrix(`${HEAD}${ITEMS}## Quadrants\n\n- q_tl 先に前提を確認する。\n  二行目。\n- q_br やらない理由\n\n${MEMO}`);
    expect(d.quadrantNotes.tl).toBe("先に前提を確認する。\n二行目。");
    expect(d.quadrantNotes.br).toBe("やらない理由");
    expect(d.quadrantNotes.tr).toBe("");
    expect(d.quadrantNotes.bl).toBe("");
    expect(warningCount(d)).toBe(0);
  });

  it("reads a note whose first line is empty", () => {
    const d = parseMatrix(`${HEAD}${ITEMS}## Quadrants\n\n- q_tr\n  本文だけ\n  続き\n`);
    expect(d.quadrantNotes.tr).toBe("本文だけ\n続き");
  });

  it("keeps paragraph breaks and nested bullets, relative indentation included", () => {
    const d = parseMatrix(
      `${HEAD}${ITEMS}## Quadrants\n\n- q_tl 段落一\n\n  段落二\n  - 入れ子\n    - さらに\n\n- q_tr x\n`,
    );
    expect(d.quadrantNotes.tl).toBe("段落一\n\n段落二\n- 入れ子\n  - さらに");
    expect(d.quadrantNotes.tr).toBe("x");
  });

  it("accepts 4-space and tab indentation", () => {
    const d = parseMatrix(`${HEAD}${ITEMS}## Quadrants\n\n- q_tl a\n    b\n    c\n- q_tr a\n\tb\n`);
    expect(d.quadrantNotes.tl).toBe("a\nb\nc");
    expect(d.quadrantNotes.tr).toBe("a\nb");
  });

  it("reads a CRLF file and writes it back as CRLF", () => {
    const lf = `${HEAD}${ITEMS}## Quadrants\n\n- q_tl a\n  b\n\n${MEMO}`;
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(parseMatrix(crlf).quadrantNotes.tl).toBe("a\nb");
    const out = save(crlf);
    expect(out).not.toMatch(/[^\r]\n/);
    expect(out).toBe(crlf);
  });

  it("normalizes: leading blank lines, first-line indentation and trailing space go", () => {
    const d = parseMatrix(`${HEAD}${ITEMS}## Quadrants\n\n- q_tl    a  \n  b   \n\n\n- q_tr\n\n  c\n`);
    expect(d.quadrantNotes.tl).toBe("a\nb");
    expect(d.quadrantNotes.tr).toBe("c");
  });

  it("reads a file with no section as four empty notes", () => {
    const d = parseMatrix(`${HEAD}${ITEMS}${MEMO}`);
    expect(d.quadrantNotes).toEqual({ tl: "", tr: "", bl: "", br: "" });
    expect(d.rawQuadrants).toEqual([]);
  });

  it("never reads a ## Memo line, and leaves a second ## Quadrants verbatim", () => {
    const content = `${HEAD}${ITEMS}## Quadrants\n\n- q_tl 本物\n\n${MEMO}\n## Quadrants\n\n- q_tr 二つ目\n`;
    const d = parseMatrix(content);
    expect(d.quadrantNotes.tl).toBe("本物");
    expect(d.quadrantNotes.tr).toBe("");
    const out = save(content);
    expect(out.endsWith(`${MEMO}\n## Quadrants\n\n- q_tr 二つ目\n`)).toBe(true);
  });
});

describe("serializeMatrix: ## Quadrants", () => {
  it("does not add a section to a note that has none", () => {
    const content = `${HEAD}${ITEMS}${MEMO}`;
    expect(save(content)).toBe(content);
  });

  it("round-trips a canonical note byte for byte, and re-parses to the same model", () => {
    const content = `${HEAD}${ITEMS}## Quadrants\n\n- q_tl 一行目\n  二行目\n\n  段落\n  - 入れ子\n- q_br 最後\n\n${MEMO}`;
    expect(save(content)).toBe(content);
    expect(parseMatrix(save(content))).toEqual(parseMatrix(content));
  });

  it("writes the first note right after ## Items, before ## Stickies", () => {
    const content = `${HEAD}${ITEMS}## Stickies\n\n- S-001 node:M-001 @1,1 #red x\n\n${MEMO}`;
    const out = save(content, withNotes({ tr: "新規" }));
    expect(out).toContain("## Items\n\n- M-001 a @0.20,0.80\n\n## Quadrants\n\n- q_tr 新規\n\n## Stickies");
    expect(out.endsWith(MEMO)).toBe(true);
  });

  it("writes before ## Memo when nothing else is there", () => {
    const out = save(`${HEAD}${ITEMS}${MEMO}`, withNotes({ bl: "x" }));
    expect(out.indexOf("## Quadrants")).toBeLessThan(out.indexOf("## Memo"));
    expect(out.endsWith(MEMO)).toBe(true);
  });

  it("always writes tl, tr, bl, br, and indents continuation by two spaces", () => {
    const out = save(`${HEAD}${ITEMS}${MEMO}`, withNotes({ br: "d", tl: "a\nb\n\nc", bl: "c" }));
    expect(out).toContain("## Quadrants\n\n- q_tl a\n  b\n\n  c\n- q_bl c\n- q_br d\n\n");
  });

  it("drops the section when every note is emptied, and keeps it when a raw line remains", () => {
    const content = `${HEAD}${ITEMS}## Quadrants\n\n- q_tl a\n\n${MEMO}`;
    const cleared = save(content, withNotes({ tl: "  \n " }));
    expect(cleared).toBe(`${HEAD}${ITEMS}${MEMO}`);
    const raw = `${HEAD}${ITEMS}## Quadrants\n\n- q_tl a\n- q_zz 謎\n\n${MEMO}`;
    const kept = save(raw, withNotes({ tl: "" }));
    expect(kept).toContain("## Quadrants\n\n- q_zz 謎\n\n");
  });

  it("keeps a memo body that looks like items or headings from splitting anything", () => {
    const body = "- q_tr 偽物\n## 見出し\n### 小見出し\n- M-099 偽の項目";
    const out = save(`${HEAD}${ITEMS}${MEMO}`, withNotes({ tl: body }));
    const d = parseMatrix(out);
    expect(d.quadrantNotes.tl).toBe(body);
    expect(d.quadrantNotes.tr).toBe("");
    expect(d.items.map((i) => i.id)).toEqual(["M-001"]);
    expect(d.rawQuadrants).toEqual([]);
    expect(out.endsWith(MEMO)).toBe(true);
    expect(save(out)).toBe(out);
  });

  it("leaves the items and labels alone when only a note changes", () => {
    const out = save(`${HEAD}${ITEMS}${MEMO}`, withNotes({ tl: "x" }));
    expect(out.startsWith(HEAD)).toBe(true);
    expect(parseMatrix(out).items).toEqual(parseMatrix(`${HEAD}${ITEMS}${MEMO}`).items);
  });
});

describe("## Quadrants: lines the grammar cannot read", () => {
  const BROKEN =
    `${HEAD}${ITEMS}## Quadrants\n\n- q_tl 本物\n  続き\n- q_zz 未知キー\n  未知の続き\n- q_tl 重複\n  重複の続き\n` +
    "メモ書き\n- ただの箇条書き\n- q_br 最後\n\n" +
    MEMO;

  it("keeps unknown keys, duplicates (first wins), plain lines and un-indented text", () => {
    const d = parseMatrix(BROKEN);
    expect(d.quadrantNotes.tl).toBe("本物\n続き");
    expect(d.quadrantNotes.br).toBe("最後");
    expect(d.rawQuadrants).toEqual([
      "- q_zz 未知キー",
      "  未知の続き",
      "- q_tl 重複",
      "  重複の続き",
      "メモ書き",
      "- ただの箇条書き",
    ]);
  });

  it("counts them as warnings", () => {
    expect(warningCount(parseMatrix(BROKEN))).toBe(6);
  });

  it("writes them back after the notes, verbatim", () => {
    const out = save(BROKEN);
    expect(out).toContain(
      "## Quadrants\n\n- q_tl 本物\n  続き\n- q_br 最後\n- q_zz 未知キー\n  未知の続き\n- q_tl 重複\n  重複の続き\nメモ書き\n- ただの箇条書き\n\n",
    );
    expect(out.endsWith(MEMO)).toBe(true);
    // stable: a second pass changes nothing
    expect(save(out)).toBe(out);
  });
});

describe("quadrant-notes helpers", () => {
  it("normalizes a note the way the file will carry it", () => {
    expect(normalizeQuadrantNote("\n\n  a  \n b \n\n")).toBe("a\n b");
    expect(normalizeQuadrantNote("   \n ")).toBe("");
  });

  it("coalesces edits of the same quadrant within 1.5 s only", () => {
    expect(shouldCoalesce("tl", { key: "tl", at: 1000 }, 2000)).toBe(true);
    expect(shouldCoalesce("tl", { key: "tl", at: 1000 }, 2600)).toBe(false);
    expect(shouldCoalesce("tr", { key: "tl", at: 1000 }, 1100)).toBe(false);
    expect(shouldCoalesce("tl", null, 1000)).toBe(false);
  });
});
