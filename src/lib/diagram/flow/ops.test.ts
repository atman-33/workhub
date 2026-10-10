import { describe, expect, it } from "vitest";
import { layoutFlow } from "./layout";
import { connect, moveStepsBy, reattach } from "./ops";
import { parseFlow } from "./parse";

describe("edge ports (T-0719)", () => {
  const NOTE = `---
type: flow
title: t
---

## Lanes

- L-001 Team

## Steps

- F-001 First lane:L-001
- F-002 Second lane:L-001
- F-003 Third lane:L-001

## Edges

## Stickies
`;

  it("connects with pins, and reattaching pins the moved end anew", () => {
    const doc = parseFlow(NOTE);
    const pinned = connect(doc, "F-001", "F-002", undefined, {
      fromPort: { side: "E" },
      toPort: { side: "W", at: 0.25 },
    });
    expect(pinned.edges).toEqual([
      { from: "F-001", to: "F-002", fromPort: { side: "E" }, toPort: { side: "W", at: 0.25 } },
    ]);
    const moved = reattach(pinned, { from: "F-001", to: "F-002" }, "to", "F-003", undefined, {
      side: "N",
    });
    expect(moved.edges).toEqual([
      { from: "F-001", to: "F-003", fromPort: { side: "E" }, toPort: { side: "N" } },
    ]);
    const cleared = reattach(moved, { from: "F-001", to: "F-003" }, "to", "F-003", undefined, null);
    expect(cleared.edges).toEqual([{ from: "F-001", to: "F-003", fromPort: { side: "E" } }]);
  });
});

describe("moveStepsBy (T-0716 group drag)", () => {
  const NOTE = `---
type: flow
title: t
---

## Lanes

- L-001 Sales
- L-002 Books

## Steps

- F-001 Order ^start lane:L-001 @100,0
- F-002 Quote lane:L-001 @300,-10
- F-003 Approve lane:L-002 @640,0
- F-004 Later lane:L-002

## Edges

- F-001 -> F-002
- F-002 -> F-003

## Stickies
`;

  const laidOut = () => {
    const doc = parseFlow(NOTE);
    return { doc, layout: layoutFlow(doc, []) };
  };

  it("moves every selected step by the same delta in one update", () => {
    const { doc, layout } = laidOut();
    const moved = moveStepsBy(doc, layout, ["F-001", "F-002"], 20, 8);
    expect(moved.steps.find((s) => s.id === "F-001")).toMatchObject({ x: 120, lane: "L-001" });
    expect(moved.steps.find((s) => s.id === "F-002")).toMatchObject({ x: 320, lane: "L-001" });
    // Untouched steps keep their exact model objects.
    expect(moved.steps.find((s) => s.id === "F-003")).toBe(doc.steps.find((s) => s.id === "F-003"));
    expect(moved.edges).toBe(doc.edges);
    expect(moved.lanes).toBe(doc.lanes);
    expect(moved.stickies).toBe(doc.stickies);
  });

  it("keeps each step's lane on a diagonal drag instead of rewriting it", () => {
    const { doc, layout } = laidOut();
    // Far enough down to land in the other band under single-drag rules.
    const moved = moveStepsBy(doc, layout, ["F-001", "F-002"], 0, 500);
    for (const id of ["F-001", "F-002"]) {
      expect(moved.steps.find((s) => s.id === id)).toMatchObject({ lane: "L-001" });
    }
  });

  it("clamps the vertical offset to the step's own band", () => {
    const { doc, layout } = laidOut();
    const moved = moveStepsBy(doc, layout, ["F-001"], 0, 500);
    const laid = layout.byId.get("F-001")!;
    const band = layout.bandAt(laid.cy);
    const limit = Math.max(0, Math.floor(band.height / 2 - laid.height / 2));
    expect(moved.steps.find((s) => s.id === "F-001")!.y).toBe(limit);
  });

  it("gives an auto-placed step a position, like a single drag does", () => {
    const { doc, layout } = laidOut();
    const before = doc.steps.find((s) => s.id === "F-004")!;
    expect(before.x).toBeUndefined();
    const moved = moveStepsBy(doc, layout, ["F-004"], 10, 0);
    const laid = layout.byId.get("F-004")!;
    expect(moved.steps.find((s) => s.id === "F-004")).toMatchObject({
      x: Math.round(laid.cx + 10),
      lane: "L-002",
    });
  });

  it("skips unknown ids and returns the same model for an empty group", () => {
    const { doc, layout } = laidOut();
    expect(moveStepsBy(doc, layout, ["F-009"], 10, 10)).toBe(doc);
    expect(moveStepsBy(doc, layout, [], 10, 10)).toBe(doc);
  });
});
