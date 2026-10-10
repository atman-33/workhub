import { describe, expect, it } from "vitest";
import { connect, reattach } from "./ops";
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
