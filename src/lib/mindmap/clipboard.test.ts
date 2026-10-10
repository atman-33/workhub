import { describe, expect, it } from "vitest";
import { copyMindmapNode, pasteMindmapNode } from "./clipboard";
import { parseMindmap, type MindmapNode } from "./parse";

const NOTE = `---
type: mindmap
title: t
created: 2026-10-09
updated: 2026-10-09
---

## Nodes

- N-001 root
  - N-002 left ^left
    - N-003 leaf #red task:T-0001 prio:high
      note text
  - N-004 right ^right
  - N-007 folded ^collapsed

## Stickies

- S-001 node:N-003 @10,10 memo
`;

const docOf = () => parseMindmap(NOTE);
const titles = (n: MindmapNode): string[] => [n.title, ...n.children.flatMap(titles)];

describe("copyMindmapNode", () => {
  it("takes the node with its whole subtree as an independent copy", () => {
    const doc = docOf();
    const clip = copyMindmapNode(doc.roots, "N-002")!;
    expect(titles(clip)).toEqual(["left", "leaf"]);
    clip.children[0].title = "mutated";
    expect(doc.roots[0].children[0].children[0].title).toBe("leaf");
  });

  it("returns null for an unknown id", () => {
    expect(copyMindmapNode(docOf().roots, "N-099")).toBeNull();
  });
});

describe("pasteMindmapNode", () => {
  it("pastes under the target as its last child, with fresh ids all through the subtree", () => {
    const doc = docOf();
    const clip = copyMindmapNode(doc.roots, "N-002")!;
    const out = pasteMindmapNode(doc.roots, clip, "N-004", "child")!;
    const target = out.roots[0].children[1];
    expect(target.children.map((c) => c.id)).toEqual([out.id]);
    expect(out.id).toBe("N-008");
    expect(target.children[0].children[0].id).toBe("N-009");
    expect(target.children[0].children[0]).toMatchObject({
      title: "leaf",
      color: "red",
      task: "T-0001",
      attrs: { prio: "high" },
      note: "note text",
    });
  });

  it("does not touch the original tree", () => {
    const doc = docOf();
    const before = structuredClone(doc.roots);
    pasteMindmapNode(doc.roots, copyMindmapNode(doc.roots, "N-002")!, "N-004", "child");
    expect(doc.roots).toEqual(before);
  });

  it("expands a collapsed target so the paste is visible", () => {
    const doc = docOf();
    const out = pasteMindmapNode(doc.roots, copyMindmapNode(doc.roots, "N-004")!, "N-007", "child")!;
    expect(out.roots[0].children[2].collapsed).toBeUndefined();
    expect(out.roots[0].children[2].children).toHaveLength(1);
  });

  it("duplicates as the sibling right after the source, on the same side", () => {
    const doc = docOf();
    const clip = copyMindmapNode(doc.roots, "N-002")!;
    const out = pasteMindmapNode(doc.roots, clip, "N-002", "sibling")!;
    const kids = out.roots[0].children;
    expect(kids.map((c) => c.id)).toEqual(["N-002", out.id, "N-004", "N-007"]);
    expect(kids[1].side).toBe("left");
    // Every branch of the root now states its side, so none jumps across.
    expect(kids.every((k) => k.side)).toBe(true);
  });

  it("treats a sibling of the root as a new branch of it", () => {
    const doc = docOf();
    const out = pasteMindmapNode(doc.roots, copyMindmapNode(doc.roots, "N-004")!, "N-001", "sibling")!;
    expect(out.roots).toHaveLength(1);
    expect(out.roots[0].children.at(-1)!.id).toBe(out.id);
  });

  it("pastes as a new top-level node when there is no target", () => {
    const doc = docOf();
    const out = pasteMindmapNode(doc.roots, copyMindmapNode(doc.roots, "N-004")!, null, "child")!;
    expect(out.roots).toHaveLength(2);
    expect(out.roots[1].id).toBe(out.id);
  });

  it("gives up when the target is gone", () => {
    const doc = docOf();
    expect(pasteMindmapNode(doc.roots, copyMindmapNode(doc.roots, "N-004")!, "N-099", "child")).toBeNull();
  });
});
