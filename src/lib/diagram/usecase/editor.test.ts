import { describe, expect, it } from "vitest";
import { layoutUsecase } from "./layout";
import { addAction, setAction } from "./ops";
import { actionsOf, parseUsecase } from "./parse";
import { newStickyOffset } from "./sticky-spot";
import { placeSticky, type Box } from "../sticky-layout";

const NOTE = `---
type: usecase
title: t
updated: 2026-10-10
---

## Nodes

- U-001 システム ^system
- U-002 客
  見る
  買う
- U-003 管理者
- U-004 決済 ^ext

## Edges

- U-002 -- U-001
- U-003 -- U-001
- U-001 -- U-004

## Stickies
`;
const docOf = () => parseUsecase(NOTE);

describe("a person's actions", () => {
  it("adds an action at the end, trimmed, and ignores blank text", () => {
    const doc = addAction(docOf(), "U-002", "  返す ");
    expect(actionsOf(doc.nodes[1])).toEqual(["見る", "買う", "返す"]);
    
    expect(actionsOf(addAction(docOf(), "U-003", "承認").nodes[2])).toEqual(["承認"]);
  });

  it("changes one action by its index", () => {
    const doc = setAction(docOf(), "U-002", 1, "選ぶ");
    expect(actionsOf(doc.nodes[1])).toEqual(["見る", "選ぶ"]);
  });

  it("deletes an action when set to blank, and the note when the last one goes", () => {
    const one = setAction(docOf(), "U-002", 0, "");
    expect(actionsOf(one.nodes[1])).toEqual(["買う"]);
    const none = setAction(one, "U-002", 0, " ");
    expect(none.nodes[1].note).toBeUndefined();
  });

  it("returns the same document when the index is out of range or nothing changes", () => {
    const doc = docOf();
    expect(setAction(doc, "U-002", 5, "x")).toBe(doc);
    expect(setAction(doc, "U-002", 0, "見る")).toBe(doc);
    expect(addAction(doc, "U-002", "")).toBe(doc);
  });

  it("keeps an action that contains a line break as one item (the break becomes a space)", () => {
    const doc = addAction(docOf(), "U-003", "a\nb");
    expect(actionsOf(doc.nodes[2])).toEqual(["a b"]);
  });
});

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("the default spot of a new sticky", () => {
  it("is on the side of a person opposite to the speech bubble, whichever side that is", () => {
    // Different layouts put the bubble on different sides: vary the number of people.
    const sides = new Set<string>();
    for (const extra of [0, 1, 2, 3, 4, 5]) {
      let text = NOTE;
      for (let i = 0; i < extra; i++) {
        text = text.replace("## Edges", `- U-1${i} 客${i}\n  やる\n\n## Edges`).replace("\n\n\n## Edges", "\n\n## Edges");
        text = text.replace("## Stickies", `- U-1${i} -- U-001\n\n## Stickies`);
      }
      const doc = parseUsecase(text);
      const layout = layoutUsecase(doc);
      for (const node of layout.nodes) {
        const bubble = layout.bubbleOf.get(node.id);
        if (!bubble) continue;
        sides.add(bubble.side);
        for (const existing of [0, 1, 2]) {
          const { dx, dy } = newStickyOffset(layout, node.id, existing);
          const placed = placeSticky({ id: "S-001", targetId: node.id, dx, dy, text: "メモ" }, node)!;
          expect(overlaps(placed, bubble), `${node.id} bubble ${bubble.side} #${existing}`).toBe(false);
          expect(overlaps(placed, node), `${node.id} itself`).toBe(false);
        }
      }
    }
    expect(sides.size).toBeGreaterThan(1);
  });

  it("falls back to the shared default for a node without a bubble, staggered", () => {
    const layout = layoutUsecase(docOf());
    expect(newStickyOffset(layout, "U-004", 0)).toEqual({ dx: 96, dy: 24 });
    expect(newStickyOffset(layout, "U-004", 2)).toEqual({ dx: 96 + 28, dy: 24 + 36 });
    expect(newStickyOffset(layout, "nope", 0)).toEqual({ dx: 96, dy: 24 });
  });
});
