import { describe, expect, it } from "vitest";
import {
  cloneNodes,
  findNode,
  findParent,
  freezeRootChildSides,
  moveNode,
  nextNodeId,
  parseMindmap,
  rootChildSide,
  serializeMindmap,
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
