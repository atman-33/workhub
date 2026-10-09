import { describe, expect, it } from "vitest";
import {
  formatSticky,
  formatStickySection,
  nextStickyId,
  parseStickies,
  stickiesOf,
  strayStickies,
} from "./sticky";
import { placeSticky, wrapStickyText } from "./sticky-layout";
import { frontmatterScalar, nextId, splitSections } from "./note";

describe("parseStickies", () => {
  it("reads the grammar the Mindmap already writes", () => {
    const out = parseStickies(
      "## Stickies\n\n- S-001 node:N-004 @24,-36 #red 見積りは仮\n  二行目\n- S-002 node:M-001 plain\n",
    );
    expect(out.stickies).toEqual([
      { id: "S-001", targetId: "N-004", dx: 24, dy: -36, color: "red", text: "見積りは仮\n二行目" },
      { id: "S-002", targetId: "M-001", dx: 32, dy: 24, text: "plain" },
    ]);
    expect(out.minted).toBe(false);
  });

  it("accepts any kind of target id and never looks at the prefix", () => {
    const out = parseStickies("- S-001 node:F-002 a\n- S-002 node:P-003 b\n- S-003 node:D-004 c\n");
    expect(out.stickies.map((s) => s.targetId)).toEqual(["F-002", "P-003", "D-004"]);
  });

  it("keeps a line with no target verbatim", () => {
    const out = parseStickies("- S-001 no target here\nfree text\n- S-002 node:M-001 ok\n");
    expect(out.stickies).toHaveLength(1);
    expect(out.raw).toEqual(["- S-001 no target here", "free text"]);
  });

  it("mints missing and duplicate ids", () => {
    const out = parseStickies("- node:M-001 a\n- S-001 node:M-001 b\n- S-001 node:M-001 c\n");
    expect(out.stickies.map((s) => s.id)).toEqual(["S-002", "S-001", "S-003"]);
    expect(out.minted).toBe(true);
  });
});

describe("formatSticky", () => {
  it("round-trips through the parser", () => {
    const sticky = { id: "S-001", targetId: "M-002", dx: 10.6, dy: -20.2, color: "blue" as const, text: "a\nb" };
    const lines = formatSticky(sticky);
    expect(lines).toEqual(["- S-001 node:M-002 @11,-20 #blue a", "  b"]);
    expect(parseStickies(lines.join("\n")).stickies[0]).toEqual({ ...sticky, dx: 11, dy: -20 });
  });

  it("writes nothing for no stickies and keeps the stray lines when there are some", () => {
    expect(formatStickySection([], [])).toBe("");
    expect(formatStickySection([], ["kept"])).toBe("## Stickies\n\nkept\n\n");
  });
});

describe("helpers", () => {
  it("allocates the next sticky and element ids without reuse", () => {
    expect(nextStickyId([])).toBe("S-001");
    expect(nextStickyId([{ id: "S-007", targetId: "x", dx: 0, dy: 0, text: "" }])).toBe("S-008");
    expect(nextId("M", ["M-003", "M-010", "X-099"])).toBe("M-011");
  });

  it("finds a target's stickies and the ones nothing accounts for", () => {
    const list = [
      { id: "S-001", targetId: "M-001", dx: 0, dy: 0, text: "" },
      { id: "S-002", targetId: "M-404", dx: 0, dy: 0, text: "" },
    ];
    expect(stickiesOf(list, "M-001")).toHaveLength(1);
    expect(strayStickies(list, new Set(["M-001"])).map((s) => s.id)).toEqual(["S-002"]);
  });

  it("places a sticky against any box and not at all without one", () => {
    const sticky = { id: "S-001", targetId: "x", dx: 50, dy: 10, text: "hi" };
    expect(placeSticky(sticky, undefined)).toBeNull();
    const placed = placeSticky(sticky, { x: 100, y: 100, width: 40, height: 20 })!;
    expect(placed.x).toBe(120 + 50);
    expect(placed.y).toBe(110 + 10);
    expect(wrapStickyText("a\n\nb")).toEqual(["a", "", "b"]);
  });
});

describe("note helpers", () => {
  it("splits the primary section from stickies and the tail", () => {
    const s = splitSections(
      "---\ntype: x\n---\n\nintro\n\n## Items\n\n- a\n\n## Stickies\n\n- s\n\n## Memo\n\nm\n",
      "Items",
    );
    expect(s.preamble).toBe("\nintro\n\n");
    expect(s.managed).toBe("## Items\n\n- a\n\n");
    expect(s.stickies).toBe("## Stickies\n\n- s\n\n");
    expect(s.tail).toBe("## Memo\n\nm\n");
  });

  it("quotes only the frontmatter values that need it", () => {
    expect(frontmatterScalar("plain 名前")).toBe("plain 名前");
    expect(frontmatterScalar("a: b")).toBe('"a: b"');
    expect(frontmatterScalar("# tag")).toBe('"# tag"');
    expect(frontmatterScalar("  multi\nline ")).toBe("multi line");
    expect(frontmatterScalar("say \"hi\": ok")).toBe("'say \"hi\": ok'");
  });
});
