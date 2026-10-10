import { describe, expect, it } from "vitest";
import { layoutArchitecture } from "./layout";
import { parseArchitecture } from "./parse";
import { newStickyOffset } from "./sticky-spot";
import { placeSticky, type Box } from "../sticky-layout";
import { NEW_STICKY_OFFSET } from "../sticky";

const NOTE = `---
type: architecture
title: t
created: 2026-10-10
updated: 2026-10-10
---

## Frames

- G-001 Client

## Nodes

- C-001 Screen frame:G-001
- C-002 API frame:G-001

## Edges

## Stickies
`;

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("newStickyOffset (T-0711)", () => {
  it("puts a frame's sticky outside its upper right, clear of the frame", () => {
    const layout = layoutArchitecture(parseArchitecture(NOTE));
    const frame = layout.frameById.get("G-001")!;
    for (const existing of [0, 1, 2]) {
      const { dx, dy } = newStickyOffset(layout, "G-001", existing);
      const placed = placeSticky({ id: "S-001", targetId: "G-001", dx, dy, text: "x" }, frame)!;
      expect(overlaps(placed, frame), `sticky #${existing} overlaps the frame`).toBe(false);
      // Right of the frame's centre, above its centre.
      expect(placed.x).toBeGreaterThan(frame.x + frame.width / 2);
      expect(placed.y + 40).toBeLessThan(frame.y + frame.height / 2);
    }
  });

  it("staggers further stickies away from the frame", () => {
    const layout = layoutArchitecture(parseArchitecture(NOTE));
    const first = newStickyOffset(layout, "G-001", 0);
    const second = newStickyOffset(layout, "G-001", 1);
    expect(second.dx).toBeGreaterThan(first.dx);
    expect(second.dy).toBeLessThan(first.dy);
  });

  it("falls back to the shared default for a block or an unknown target", () => {
    const layout = layoutArchitecture(parseArchitecture(NOTE));
    expect(newStickyOffset(layout, "C-001", 0)).toEqual(NEW_STICKY_OFFSET);
    expect(newStickyOffset(layout, "nope", 2)).toEqual({
      dx: NEW_STICKY_OFFSET.dx + 28,
      dy: NEW_STICKY_OFFSET.dy + 36,
    });
  });
});
