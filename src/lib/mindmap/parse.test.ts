import { describe, expect, it } from "vitest";
import {
  cloneNodes,
  findNode,
  findParent,
  freezeRootChildSides,
  moveNode,
  nextNodeId,
  nextStickyId,
  parseMindmap,
  rootChildSide,
  serializeMindmap,
  stickiesOf,
  subtreeIds,
} from "./parse";

const note = (nodes: string, extra = "") =>
  `---\ntype: mindmap\ntitle: ideas\ncreated: 2026-08-26\nupdated: 2026-08-26\n---\n\n` +
  `## Nodes\n\n${nodes}\n\n## Memo\n\nhuman prose\n${extra}`;

describe("parseMindmap", () => {
  it("reads the tree, its nesting and its modifiers", () => {
    const doc = parseMindmap(
      note(
        [
          "- N-001 workhub #blue",
          "  - N-002 tasks #green task:T-0042",
          "    - N-003 kanban ^collapsed",
          "  - N-004 schedule",
        ].join("\n"),
      ),
    );

    expect(doc.title).toBe("ideas");
    expect(doc.roots).toHaveLength(1);
    const root = doc.roots[0];
    expect(root.id).toBe("N-001");
    expect(root.title).toBe("workhub");
    expect(root.color).toBe("blue");
    expect(root.children.map((n) => n.id)).toEqual(["N-002", "N-004"]);

    const tasks = root.children[0];
    expect(tasks.task).toBe("T-0042");
    expect(tasks.children[0].collapsed).toBe(true);
    expect(tasks.children[0].title).toBe("kanban");
  });

  it("keeps an unrecognized colour as part of the title", () => {
    const doc = parseMindmap(note("- N-001 release #v2"));
    expect(doc.roots[0].title).toBe("release #v2");
    expect(doc.roots[0].color).toBeUndefined();
  });

  it("collects indented continuation lines as the node's note", () => {
    const doc = parseMindmap(
      note(["- N-001 root", "  some detail", "  and more", "  - N-002 child"].join("\n")),
    );
    expect(doc.roots[0].note).toBe("some detail\nand more");
    expect(doc.roots[0].children).toHaveLength(1);
  });

  it("mints ids for a tree typed by hand in Obsidian", () => {
    const doc = parseMindmap(note(["- root", "  - child", "  - N-007 kept"].join("\n")));
    expect(doc.mintedIds).toBe(true);
    expect(doc.roots[0].id).toBe("N-008");
    expect(doc.roots[0].children.map((n) => n.id)).toEqual(["N-009", "N-007"]);
  });

  it("repairs duplicate ids from a pasted subtree", () => {
    const doc = parseMindmap(note(["- N-001 a", "  - N-001 b"].join("\n")));
    const ids = [doc.roots[0].id, doc.roots[0].children[0].id];
    expect(new Set(ids).size).toBe(2);
  });

  it("attaches an over-indented line to the deepest open node", () => {
    const doc = parseMindmap(note(["- N-001 root", "      - N-002 deep"].join("\n")));
    expect(doc.roots[0].children.map((n) => n.id)).toEqual(["N-002"]);
  });

  it("keeps a line it cannot parse", () => {
    const doc = parseMindmap(note(["- N-001 root", "not a list item"].join("\n")));
    expect(doc.rawNodes).toEqual(["not a list item"]);
  });

  it("parses a note that has no `## Nodes` section yet", () => {
    const doc = parseMindmap("---\ntype: mindmap\ntitle: empty\n---\n");
    expect(doc.roots).toEqual([]);
    expect(doc.title).toBe("empty");
  });

  it("falls back to the file name when the frontmatter has no title", () => {
    expect(parseMindmap("---\ntype: mindmap\n---\n\n## Nodes\n", "from file").title).toBe(
      "from file",
    );
  });
});

describe("serializeMindmap", () => {
  it("round-trips a note byte-for-byte apart from `updated`", () => {
    const content = note(
      [
        "- N-001 workhub #blue",
        "  - N-002 tasks #green task:T-0042",
        "    detail line",
        "    - N-003 kanban ^collapsed",
      ].join("\n"),
    );
    const doc = parseMindmap(content);
    const out = serializeMindmap(content, doc, "2026-08-26");
    expect(out).toBe(content);
  });

  it("preserves `## Memo`, unmanaged frontmatter and unknown sections", () => {
    const content =
      "---\ntype: mindmap\ntitle: ideas\nowner: someone\nupdated: 2026-01-01\n---\n\n" +
      "## Nodes\n\n- N-001 root\n\n## Memo\n\nhuman prose\n\n## Scratch\n\nkeep me\n";
    const out = serializeMindmap(content, parseMindmap(content), "2026-08-26");
    expect(out).toContain("owner: someone");
    expect(out).toContain("human prose");
    expect(out).toContain("## Scratch\n\nkeep me\n");
    expect(out).toContain("updated: 2026-08-26");
    expect(out).not.toContain("updated: 2026-01-01");
  });

  it("writes minted ids back so the file only needs repairing once", () => {
    const content = note(["- root", "  - child"].join("\n"));
    const out = serializeMindmap(content, parseMindmap(content), "2026-08-26");
    expect(out).toContain("- N-001 root");
    expect(out).toContain("  - N-002 child");
    expect(parseMindmap(out).mintedIds).toBe(false);
  });

  it("keeps a multi-line title on one line", () => {
    const content = note("- N-001 root");
    const doc = parseMindmap(content);
    doc.roots[0].title = "first\nsecond";
    const out = serializeMindmap(content, doc, "2026-08-26");
    expect(out).toContain("- N-001 first\n");
    expect(out).not.toContain("second");
  });
});

describe("branch sides", () => {
  const roots = () =>
    parseMindmap(
      note(
        [
          "- N-001 root",
          "  - N-002 a ^left",
          "  - N-003 b",
          "  - N-004 c ^right",
          "  - N-005 d",
        ].join("\n"),
      ),
    ).roots;

  it("reads an explicit side and round-trips it", () => {
    const content = note(["- N-001 root", "  - N-002 a ^left", "  - N-003 b ^right"].join("\n"));
    const doc = parseMindmap(content);
    expect(doc.roots[0].children.map((n) => n.side)).toEqual(["left", "right"]);
    expect(serializeMindmap(content, doc, "2026-08-26")).toBe(content);
  });

  it("alternates by position when no side is stated", () => {
    const children = roots()[0].children;
    expect(rootChildSide(children[1], 1)).toBe("left");
    expect(rootChildSide(children[3], 3)).toBe("left");
    // Position 2 would be "right" by default anyway; position 0 proves it.
    expect(rootChildSide({ id: "x", title: "", children: [] }, 0)).toBe("right");
    expect(rootChildSide({ id: "x", title: "", children: [] }, 1)).toBe("left");
  });

  it("lets an explicit side win over the position default", () => {
    const children = roots()[0].children;
    // Position 0 defaults to right, but this one says left.
    expect(rootChildSide(children[0], 0)).toBe("left");
  });

  it("freezes the sides every branch is currently drawn on", () => {
    const tree = roots();
    freezeRootChildSides(tree[0]);
    expect(tree[0].children.map((n) => n.side)).toEqual(["left", "left", "right", "left"]);
  });

  it("keeps frozen sides put when a branch is inserted in the middle", () => {
    const tree = roots();
    freezeRootChildSides(tree[0]);
    const before = tree[0].children.map((n) => [n.id, n.side] as const);
    tree[0].children.splice(1, 0, { id: "N-009", title: "new", children: [], side: "left" });
    for (const [id, side] of before) {
      expect(findNode(tree, id)!.side).toBe(side);
    }
  });
});

describe("tree edits", () => {
  const build = () =>
    parseMindmap(
      note(
        [
          "- N-001 root",
          "  - N-002 a",
          "    - N-003 a1",
          "  - N-004 b",
        ].join("\n"),
      ),
    ).roots;

  it("finds nodes and their parents", () => {
    const roots = build();
    expect(findNode(roots, "N-003")?.title).toBe("a1");
    expect(findParent(roots, "N-003")?.id).toBe("N-002");
    expect(findParent(roots, "N-001")).toBeNull();
    expect(findNode(roots, "N-999")).toBeNull();
  });

  it("mints the next free id", () => {
    expect(nextNodeId(build())).toBe("N-005");
    expect(nextNodeId([])).toBe("N-001");
  });

  it("moves a subtree under a new parent", () => {
    const moved = moveNode(build(), "N-002", "N-004");
    expect(moved).not.toBeNull();
    expect(findParent(moved!, "N-002")?.id).toBe("N-004");
    // The subtree travels with it.
    expect(findParent(moved!, "N-003")?.id).toBe("N-002");
  });

  it("refuses to move a node into its own subtree", () => {
    expect(moveNode(build(), "N-002", "N-003")).toBeNull();
    expect(moveNode(build(), "N-002", "N-002")).toBeNull();
    expect(moveNode(build(), "N-999", "N-001")).toBeNull();
  });

  it("honours the drop index", () => {
    const moved = moveNode(build(), "N-004", "N-001", 0);
    expect(moved![0].children.map((n) => n.id)).toEqual(["N-004", "N-002"]);
  });

  it("does not mutate the tree it was given", () => {
    const roots = build();
    const before = JSON.stringify(roots);
    moveNode(roots, "N-002", "N-004");
    expect(JSON.stringify(roots)).toBe(before);
  });

  it("clones deeply", () => {
    const roots = build();
    const copy = cloneNodes(roots);
    copy[0].children[0].title = "changed";
    expect(roots[0].children[0].title).toBe("a");
  });

  it("lists a subtree's ids", () => {
    const roots = build();
    expect(subtreeIds(findNode(roots, "N-002")!)).toEqual(new Set(["N-002", "N-003"]));
  });
});

describe("node_width", () => {
  it("defaults to `auto` and does not write the key", () => {
    const content = note("- N-001 root");
    expect(parseMindmap(content).nodeWidth).toBe("auto");
    expect(serializeMindmap(content, parseMindmap(content), "2026-08-26")).not.toContain(
      "node_width",
    );
  });

  it("round-trips a changed setting through the frontmatter", () => {
    const content = note("- N-001 root");
    const doc = { ...parseMindmap(content), nodeWidth: "depth" as const };
    const out = serializeMindmap(content, doc, "2026-08-26");
    expect(out).toContain("node_width: depth");
    expect(parseMindmap(out).nodeWidth).toBe("depth");
  });

  it("drops the key again when the setting goes back to `auto`", () => {
    const content =
      "---\n" + "type: mindmap\n" + "node_width: siblings\n" + "updated: 2026-01-01\n---\n\n" +
      "## Nodes\n\n- N-001 root\n";
    const doc = parseMindmap(content);
    expect(doc.nodeWidth).toBe("siblings");
    const out = serializeMindmap(content, { ...doc, nodeWidth: "auto" }, "2026-08-26");
    expect(out).not.toContain("node_width");
    expect(out).toContain("type: mindmap");
  });

  it("falls back to `auto` on a value it does not know", () => {
    const content = "---\ntype: mindmap\nnode_width: huge\n---\n\n## Nodes\n\n- N-001 root\n";
    expect(parseMindmap(content).nodeWidth).toBe("auto");
  });
});

describe("stickies", () => {
  const withStickies = (stickies: string) =>
    `---\ntype: mindmap\ntitle: ideas\ncreated: 2026-08-26\nupdated: 2026-08-26\n---\n\n` +
    `## Nodes\n\n- N-001 workhub\n  - N-002 schedule\n\n` +
    `## Stickies\n\n${stickies}\n\n## Memo\n\nhuman prose\n`;

  it("reads a sticky's node, offset, colour and text", () => {
    const doc = parseMindmap(withStickies("- S-001 node:N-002 @24,-36 #amber 見積りは仮"));

    expect(doc.stickies).toHaveLength(1);
    const sticky = doc.stickies[0];
    expect(sticky.id).toBe("S-001");
    expect(sticky.nodeId).toBe("N-002");
    expect(sticky.dx).toBe(24);
    expect(sticky.dy).toBe(-36);
    expect(sticky.color).toBe("amber");
    expect(sticky.text).toBe("見積りは仮");
  });

  it("reads the modifiers in any order and keeps the rest as text", () => {
    const doc = parseMindmap(withStickies("- S-002 #red @0,0 node:N-001 a #b c"));
    expect(doc.stickies[0].nodeId).toBe("N-001");
    expect(doc.stickies[0].color).toBe("red");
    expect(doc.stickies[0].text).toBe("a #b c");
  });

  it("collects continuation lines into the sticky's text", () => {
    const doc = parseMindmap(
      withStickies(["- S-001 node:N-002 @10,10 first line", "  second line"].join("\n")),
    );
    expect(doc.stickies[0].text).toBe("first line\nsecond line");
  });

  it("defaults the offset when the file gives none", () => {
    const doc = parseMindmap(withStickies("- S-001 node:N-002 hand written"));
    expect(doc.stickies[0].dx).toBe(32);
    expect(doc.stickies[0].dy).toBe(24);
  });

  it("mints ids for stickies written without one", () => {
    const doc = parseMindmap(
      withStickies(["- node:N-001 @0,0 one", "- S-004 node:N-002 @0,0 two"].join("\n")),
    );
    expect(doc.mintedIds).toBe(true);
    expect(doc.stickies.map((s) => s.id)).toEqual(["S-005", "S-004"]);
  });

  it("keeps a line with no node as an unrecognized line rather than dropping it", () => {
    const content = withStickies("- S-001 @0,0 who am I pinned to?");
    const doc = parseMindmap(content);
    expect(doc.stickies).toHaveLength(0);
    expect(doc.rawStickies).toEqual(["- S-001 @0,0 who am I pinned to?"]);
    expect(serializeMindmap(content, doc, "2026-08-28")).toContain(
      "- S-001 @0,0 who am I pinned to?",
    );
  });

  it("keeps a sticky whose node no longer exists", () => {
    const content = withStickies("- S-001 node:N-999 @0,0 orphan");
    const doc = parseMindmap(content);
    expect(doc.stickies[0].nodeId).toBe("N-999");
    expect(serializeMindmap(content, doc, "2026-08-28")).toContain(
      "- S-001 node:N-999 @0,0 orphan",
    );
  });

  it("round-trips the section and leaves the memo alone", () => {
    const content = withStickies(
      [
        "- S-001 node:N-002 @24,-36 #amber 見積りは仮",
        "  次回確認",
        "- S-002 node:N-001 @0,8 メモ",
      ].join("\n"),
    );
    const out = serializeMindmap(content, parseMindmap(content), "2026-08-28");

    expect(out).toContain(
      "## Stickies\n\n- S-001 node:N-002 @24,-36 #amber 見積りは仮\n  次回確認\n- S-002 node:N-001 @0,8 メモ",
    );
    expect(out).toContain("## Memo\n\nhuman prose");
    expect(out).toContain("updated: 2026-08-28");
    expect(parseMindmap(out).stickies).toEqual(parseMindmap(content).stickies);
  });

  it("writes no section at all when the note has no stickies", () => {
    const content = note("- N-001 root");
    const out = serializeMindmap(content, parseMindmap(content), "2026-08-28");
    expect(out).not.toContain("## Stickies");
  });

  it("adds the section to a note that never had one", () => {
    const content = note("- N-001 root");
    const doc = parseMindmap(content);
    doc.stickies.push({ id: "S-001", nodeId: "N-001", dx: 10, dy: 20, text: "new" });
    const out = serializeMindmap(content, doc, "2026-08-28");

    expect(out).toContain("## Stickies\n\n- S-001 node:N-001 @10,20 new");
    expect(out.indexOf("## Nodes")).toBeLessThan(out.indexOf("## Stickies"));
    expect(out.indexOf("## Stickies")).toBeLessThan(out.indexOf("## Memo"));
    expect(parseMindmap(out).stickies).toHaveLength(1);
  });

  it("rounds a fractional offset on the way out", () => {
    const content = note("- N-001 root");
    const doc = parseMindmap(content);
    doc.stickies.push({ id: "S-001", nodeId: "N-001", dx: 10.6, dy: -20.2, text: "x" });
    expect(serializeMindmap(content, doc, "2026-08-28")).toContain("@11,-20");
  });

  it("carries the hidden flag through the frontmatter", () => {
    const content = note("- N-001 root");
    const doc = parseMindmap(content);
    expect(doc.stickiesHidden).toBe(false);

    const hidden = serializeMindmap(content, { ...doc, stickiesHidden: true }, "2026-08-28");
    expect(hidden).toContain("stickies: hidden");
    expect(parseMindmap(hidden).stickiesHidden).toBe(true);

    const shown = serializeMindmap(hidden, parseMindmap(content), "2026-08-28");
    expect(shown).not.toContain("stickies: hidden");
  });

  it("numbers the next sticky above the highest used", () => {
    expect(nextStickyId([])).toBe("S-001");
    expect(nextStickyId([{ id: "S-007", nodeId: "N-001", dx: 0, dy: 0, text: "" }])).toBe("S-008");
  });

  it("lists the stickies of one node in file order", () => {
    const doc = parseMindmap(
      withStickies(
        [
          "- S-001 node:N-002 @0,0 a",
          "- S-002 node:N-001 @0,0 b",
          "- S-003 node:N-002 @0,0 c",
        ].join("\n"),
      ),
    );
    expect(stickiesOf(doc.stickies, "N-002").map((s) => s.id)).toEqual(["S-001", "S-003"]);
  });
});
