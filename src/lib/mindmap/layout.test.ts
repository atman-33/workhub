import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, layoutMindmap, textWidth, wrapTitle } from "./layout";
import { parseMindmap } from "./parse";

const tree = (lines: string[]) =>
  parseMindmap(`---\ntype: mindmap\ntitle: t\n---\n\n## Nodes\n\n${lines.join("\n")}\n`).roots;

describe("wrapTitle", () => {
  it("keeps a short title on one line", () => {
    expect(wrapTitle("hello", 220, 14)).toEqual(["hello"]);
  });

  it("wraps on spaces when it can", () => {
    const lines = wrapTitle("the quick brown fox jumps over the lazy dog", 160, 14);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 14)).toBeLessThanOrEqual(160 - 24);
  });

  it("breaks mid-word when a single word cannot fit", () => {
    const lines = wrapTitle("supercalifragilisticexpialidocious", 100, 14);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("supercalifragilisticexpialidocious");
  });

  it("wraps unspaced Japanese text", () => {
    const lines = wrapTitle("マインドマップ機能の追加とレイアウト検証", 120, 14);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("マインドマップ機能の追加とレイアウト検証");
  });

  it("gives an empty title one empty line", () => {
    expect(wrapTitle("", 220, 14)).toEqual([""]);
  });
});

describe("layoutMindmap", () => {
  it("puts the root in the middle and splits its branches both ways", () => {
    const layout = layoutMindmap(
      tree(["- N-001 root", "  - N-002 a", "  - N-003 b", "  - N-004 c", "  - N-005 d"]),
    );
    const sides = ["N-002", "N-003", "N-004", "N-005"].map((id) => layout.byId.get(id)!.side);
    expect(sides.filter((s) => s === "right")).toHaveLength(2);
    expect(sides.filter((s) => s === "left")).toHaveLength(2);

    const root = layout.byId.get("N-001")!;
    for (const id of ["N-002", "N-003", "N-004", "N-005"]) {
      const node = layout.byId.get(id)!;
      if (node.side === "right") expect(node.x).toBeGreaterThan(root.x + root.width);
      else expect(node.x + node.width).toBeLessThan(root.x);
    }
  });

  it("balances by subtree size rather than alternating", () => {
    // One heavy branch, then three light ones: the heavy one takes a side by
    // itself.
    const layout = layoutMindmap(
      tree([
        "- N-001 root",
        "  - N-002 heavy",
        "    - N-006 x",
        "    - N-007 y",
        "    - N-008 z",
        "  - N-003 a",
        "  - N-004 b",
      ]),
    );
    const heavy = layout.byId.get("N-002")!.side;
    expect(layout.byId.get("N-003")!.side).not.toBe(heavy);
    expect(layout.byId.get("N-004")!.side).not.toBe(heavy);
  });

  it("never overlaps two siblings vertically", () => {
    const layout = layoutMindmap(
      tree([
        "- N-001 root",
        "  - N-002 a",
        "    - N-005 a1",
        "    - N-006 a2",
        "  - N-003 b",
        "    - N-007 b1",
        "  - N-004 c",
      ]),
    );
    const bySide = layout.nodes.filter((n) => n.depth === 1 && n.side === "right");
    const sorted = [...bySide].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].height);
    }
  });

  it("centres a parent on its children", () => {
    const layout = layoutMindmap(
      tree(["- N-001 root", "  - N-002 p", "    - N-003 c1", "    - N-004 c2"]),
    );
    const parent = layout.byId.get("N-002")!;
    const c1 = layout.byId.get("N-003")!;
    const c2 = layout.byId.get("N-004")!;
    const mid = (c1.y + c1.height / 2 + (c2.y + c2.height / 2)) / 2;
    expect(Math.abs(parent.y + parent.height / 2 - mid)).toBeLessThan(0.51);
  });

  it("hides the children of a collapsed node but keeps the flag", () => {
    const layout = layoutMindmap(tree(["- N-001 root", "  - N-002 p ^collapsed", "    - N-003 hidden"]));
    expect(layout.byId.has("N-003")).toBe(false);
    const p = layout.byId.get("N-002")!;
    expect(p.collapsed).toBe(true);
    expect(p.childCount).toBe(1);
  });

  it("does not mark a childless node as collapsed", () => {
    const layout = layoutMindmap(tree(["- N-001 root", "  - N-002 leaf ^collapsed"]));
    expect(layout.byId.get("N-002")!.collapsed).toBe(false);
  });

  it("inherits the branch colour down a branch but not from the root", () => {
    const layout = layoutMindmap(
      tree(["- N-001 root #red", "  - N-002 a #green", "    - N-003 a1", "  - N-004 b"]),
    );
    expect(layout.byId.get("N-002")!.branchColor).toBe("green");
    expect(layout.byId.get("N-003")!.branchColor).toBe("green");
    expect(layout.byId.get("N-004")!.branchColor).toBeUndefined();
    expect(layout.byId.get("N-001")!.branchColor).toBeUndefined();
  });

  it("emits one edge per drawn parent/child pair", () => {
    const layout = layoutMindmap(tree(["- N-001 root", "  - N-002 a", "    - N-003 a1"]));
    expect(layout.edges).toHaveLength(2);
    expect(layout.edges[0].path.startsWith("M ")).toBe(true);
    expect(layout.edges.map((e) => e.to)).toEqual(["N-002", "N-003"]);
  });

  it("stacks several roots instead of drawing them on top of each other", () => {
    const layout = layoutMindmap(tree(["- N-001 one", "- N-002 two"]));
    const a = layout.byId.get("N-001")!;
    const b = layout.byId.get("N-002")!;
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  });

  it("reports the bounding box of everything drawn", () => {
    const layout = layoutMindmap(tree(["- N-001 root", "  - N-002 a", "  - N-003 b"]));
    const { bounds } = layout;
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(bounds.x);
      expect(node.y).toBeGreaterThanOrEqual(bounds.y);
      expect(node.x + node.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(node.y + node.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });

  it("is deterministic", () => {
    const nodes = tree(["- N-001 root", "  - N-002 a", "    - N-003 a1", "  - N-004 b"]);
    expect(JSON.stringify(layoutMindmap(nodes).nodes)).toBe(
      JSON.stringify(layoutMindmap(nodes).nodes),
    );
  });

  it("handles an empty document", () => {
    const layout = layoutMindmap([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("respects a wider gap setting", () => {
    const nodes = tree(["- N-001 root", "  - N-002 a"]);
    const tight = layoutMindmap(nodes, { hGap: 20 });
    const loose = layoutMindmap(nodes, { hGap: DEFAULT_LAYOUT.hGap * 2 });
    expect(loose.byId.get("N-002")!.x).toBeGreaterThan(tight.byId.get("N-002")!.x);
  });
});
