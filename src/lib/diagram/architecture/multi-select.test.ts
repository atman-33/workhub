import { describe, expect, it } from "vitest";
import { idsInRect, normalizeRect, shiftPositions } from "../multi-select";
import { FRAME_HEADER, layoutArchitecture } from "./layout";
import { parseArchitecture } from "./parse";

const NOTE = `---
type: architecture
title: t
---

## Frames

- G-001 Left
- G-002 Right

## Nodes

- C-001 A frame:G-001 @100,100
- C-002 B frame:G-001 @300,100
- C-003 C frame:G-002 @600,100
- C-004 D @900,100

## Edges

## Stickies
`;

const docOf = () => parseArchitecture(NOTE);

describe("marquee over the laid-out blocks (T-0716)", () => {
  it("catches the blocks a rectangle touches, in layout order", () => {
    const layout = layoutArchitecture(docOf());
    const a = layout.byId.get("C-001")!;
    const caught = idsInRect(
      layout.nodes,
      normalizeRect({ x: a.x - 1, y: a.y - 1 }, { x: a.x + 1, y: a.y + 1 }),
    );
    expect(caught).toEqual(["C-001"]);
    const both = idsInRect(layout.nodes, normalizeRect({ x: 0, y: 0 }, { x: 500, y: 200 }));
    expect(both).toEqual(["C-001", "C-002"]);
  });

  it("selects blocks only, never frames", () => {
    const layout = layoutArchitecture(docOf());
    const g1 = layout.frameById.get("G-001")!;
    const caught = idsInRect(
      layout.nodes,
      normalizeRect({ x: g1.x, y: g1.y }, { x: g1.x + g1.width, y: g1.y + g1.height }),
    );
    // The whole frame rectangle catches its member blocks - and no frame id:
    // frames are not nodes, so the marquee input carries blocks only.
    expect(caught).toEqual(["C-001", "C-002"]);
    expect(caught).not.toContain("G-001");
    expect(caught).not.toContain("G-002");
  });

  it("a press on a frame header catches nothing", () => {
    const layout = layoutArchitecture(docOf());
    const g1 = layout.frameById.get("G-001")!;
    // The header band sits above the members, so a click (or a tiny drag)
    // starting on the frame's title touches no block box.
    const headerBand = normalizeRect(
      { x: g1.x, y: g1.y },
      { x: g1.x + g1.width, y: g1.y + FRAME_HEADER },
    );
    expect(idsInRect(layout.nodes, headerBand)).toEqual([]);
    const headerPoint = normalizeRect(
      { x: g1.x + 10, y: g1.y + 4 },
      { x: g1.x + 11, y: g1.y + 5 },
    );
    expect(idsInRect(layout.nodes, headerPoint)).toEqual([]);
  });

  it("moves a group from its laid-out centres, rounded to whole pixels", () => {
    const layout = layoutArchitecture(docOf());
    const origins = new Map(
      ["C-001", "C-003"].map((id) => {
        const at = layout.byId.get(id)!;
        return [id, { x: at.cx, y: at.cy }] as const;
      }),
    );
    const moves = shiftPositions(origins, ["C-001", "C-003"], 10.6, -20.4, (x, y) => ({
      x: Math.round(x),
      y: Math.round(y),
    }));
    expect(moves.get("C-001")).toEqual({ x: 111, y: 80 });
    expect(moves.get("C-003")).toEqual({ x: 611, y: 80 });
    expect(moves.has("C-002")).toBe(false);
  });
});
