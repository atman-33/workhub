import { describe, expect, it } from "vitest";
import { isAttrKey, parseMindmap, serializeMindmap } from "./parse";

/**
 * The attribute key rule (T-0224).
 *
 * Kept in its own file because these are all one question — what a key may
 * look like, and what a title is therefore still safe to contain — and because
 * the guards are the interesting half: widening the rule is only correct if
 * everything it used to refuse is still refused.
 */

const note = (nodes: string, frontmatter = "") =>
  `---\ntype: mindmap\ntitle: ideas\n${frontmatter}created: 2026-09-03\nupdated: 2026-09-03\n---\n\n` +
  `## Nodes\n\n${nodes}\n\n## Memo\n\nhuman prose\n`;

describe("isAttrKey", () => {
  it("accepts a key written in Japanese", () => {
    expect(isAttrKey("優先度")).toBe(true);
    expect(isAttrKey("状態")).toBe(true);
    expect(isAttrKey("ステータス2")).toBe(true);
    expect(isAttrKey("要確認")).toBe(true);
  });

  it("still accepts the ASCII keys the feature shipped with", () => {
    expect(isAttrKey("prio")).toBe(true);
    expect(isAttrKey("tags")).toBe(true);
    expect(isAttrKey("a-b_c")).toBe(true);
  });

  it("still refuses everything the ASCII rule refused", () => {
    expect(isAttrKey("Prio")).toBe(false);
    expect(isAttrKey("15")).toBe(false);
    expect(isAttrKey("")).toBe(false);
    // Over the 24-character cap.
    expect(isAttrKey("日".repeat(25))).toBe(false);
    // Full-width ASCII reads as a title, exactly as its half-width form does.
    expect(isAttrKey("Ｑ３")).toBe(false);
    // Punctuation is never part of a key, in either script.
    expect(isAttrKey("優先度。")).toBe(false);
    expect(isAttrKey("a.b")).toBe(false);
  });
});

describe("a node labelled in Japanese", () => {
  it("reads its attributes and keeps its title", () => {
    const doc = parseMindmap(note("- N-001 root\n  - N-002 タスク tags:検討中,要調査 優先度:高"));
    const node = doc.roots[0].children[0];
    expect(node.title).toBe("タスク");
    expect(node.attrs).toEqual({ tags: "検討中,要調査", 優先度: "高" });
  });

  it("round-trips through the file", () => {
    const src = note("- N-001 root\n  - N-002 タスク tags:検討中 優先度:高");
    const doc = parseMindmap(src);
    const out = serializeMindmap(src, doc, "2026-09-03");
    expect(parseMindmap(out).roots[0].children[0].attrs).toEqual(doc.roots[0].children[0].attrs);
  });

  it("carries a Japanese key through the view frontmatter", () => {
    const doc = parseMindmap(
      note("- N-001 root 優先度:高", "attr_chips: 優先度,tags\nattr_color: 優先度\nattr_filter: 優先度=高\n"),
    );
    expect(doc.attrView.chips).toEqual(["優先度", "tags"]);
    expect(doc.attrView.color).toBe("優先度");
    expect(doc.attrView.filter).toEqual({ key: "優先度", value: "高" });
  });
});

describe("titles the widened rule must not eat", () => {
  it("leaves a full-width colon alone", () => {
    // The colon a Japanese IME produces is not the separator, so an ordinary
    // Japanese title stays a title however it is worded.
    const root = parseMindmap(note("- N-001 目標：達成")).roots[0];
    expect(root.title).toBe("目標：達成");
    expect(root.attrs).toBeUndefined();
  });

  it("keeps the guards that made the key rule narrow", () => {
    const roots = parseMindmap(
      note(
        [
          "- N-001 進捗 15:00",
          "  - N-002 参考 https://example.com",
          "  - N-003 Q3:目標",
          "  - N-004 Prio:high",
        ].join("\n"),
      ),
    ).roots;
    expect(roots[0].title).toBe("進捗 15:00");
    expect(roots[0].attrs).toBeUndefined();
    expect(roots[0].children.map((n) => [n.title, n.attrs])).toEqual([
      ["参考 https://example.com", undefined],
      ["Q3:目標", undefined],
      ["Prio:high", undefined],
    ]);
  });
});
