import { describe, expect, it } from "vitest";
import { copyFlowSteps, FLOW_PASTE_DX, pasteFlowSteps } from "./clipboard";
import { parseFlow } from "./parse";

const NOTE = `---
type: flow
title: t
created: 2026-10-09
updated: 2026-10-09
---

## Lanes

- L-001 営業 #blue
- L-002 経理 #green

## Steps

- F-001 受注 ^start lane:L-001 @100,0
- F-002 見積 lane:L-001 task:T-0100 @300,-10
- F-003 承認 lane:L-002 @640,0
- F-004 まだ lane:L-002

## Edges

- F-001 -> F-002 "ok"
- F-002 -> F-003
- F-003 -> F-004

## Stickies

- S-001 node:F-002 @10,10 memo
`;

const docOf = () => parseFlow(NOTE);

describe("copyFlowSteps", () => {
  it("copies a lone step with no arrows", () => {
    const c = copyFlowSteps(docOf(), ["F-002"]);
    expect(c.steps.map((s) => s.id)).toEqual(["F-002"]);
    expect(c.edges).toEqual([]);
  });

  it("copies only the arrows between selected steps", () => {
    const c = copyFlowSteps(docOf(), ["F-001", "F-002"]);
    expect(c.edges).toEqual([{ from: "F-001", to: "F-002", label: "ok" }]);
  });

  it("drops the arrows to steps outside a multi-select", () => {
    const c = copyFlowSteps(docOf(), ["F-002", "F-003"]);
    expect(c.steps.map((s) => s.id)).toEqual(["F-002", "F-003"]);
    // F-002 -> F-003 is inside; F-001 -> F-002 and F-003 -> F-004 stay behind.
    expect(c.edges).toEqual([{ from: "F-002", to: "F-003" }]);
  });
});

describe("pasteFlowSteps", () => {
  it("allocates fresh F- ids and keeps the lane", () => {
    const doc = docOf();
    const out = pasteFlowSteps(doc, copyFlowSteps(doc, ["F-002"]), 1);
    expect(out.ids).toEqual(["F-005"]);
    const copy = out.doc.steps.find((s) => s.id === "F-005")!;
    expect(copy).toMatchObject({ title: "見積", lane: "L-001", task: "T-0100", kind: "process" });
  });

  it("shifts x along the same lane and keeps the vertical offset", () => {
    const doc = docOf();
    const out = pasteFlowSteps(doc, copyFlowSteps(doc, ["F-002"]), 1);
    const copy = out.doc.steps.find((s) => s.id === out.ids[0])!;
    expect(copy.x).toBe(300 + FLOW_PASTE_DX);
    expect(copy.y).toBe(-10);
    const third = pasteFlowSteps(doc, copyFlowSteps(doc, ["F-002"]), 3);
    expect(third.doc.steps.find((s) => s.id === third.ids[0])!.x).toBe(300 + 3 * FLOW_PASTE_DX);
  });

  it("leaves an auto-placed step to the layout", () => {
    const doc = docOf();
    const out = pasteFlowSteps(doc, copyFlowSteps(doc, ["F-004"]), 1);
    const copy = out.doc.steps.find((s) => s.id === out.ids[0])!;
    expect(copy.x).toBeUndefined();
    expect(copy.y).toBeUndefined();
    expect(copy.lane).toBe("L-002");
  });

  it("re-creates the arrows inside the selection on the new ids", () => {
    const doc = docOf();
    const out = pasteFlowSteps(doc, copyFlowSteps(doc, ["F-001", "F-002", "F-003"]), 1);
    expect(out.ids).toEqual(["F-005", "F-006", "F-007"]);
    expect(out.doc.edges.slice(doc.edges.length)).toEqual([
      { from: "F-005", to: "F-006", label: "ok" },
      { from: "F-006", to: "F-007" },
    ]);
  });

  it("keeps every pasted step in its own lane with its own offset", () => {
    const doc = docOf();
    const out = pasteFlowSteps(doc, copyFlowSteps(doc, ["F-002", "F-003"]), 1);
    const [second, third] = out.ids.map((id) => out.doc.steps.find((s) => s.id === id)!);
    expect(second).toMatchObject({ lane: "L-001", x: 300 + FLOW_PASTE_DX, y: -10 });
    expect(third).toMatchObject({ lane: "L-002", x: 640 + FLOW_PASTE_DX, y: 0 });
  });

  it("leaves the original arrows, lanes and stickies alone", () => {
    const doc = docOf();
    const out = pasteFlowSteps(doc, copyFlowSteps(doc, ["F-002"]), 1);
    expect(out.doc.edges).toEqual(doc.edges);
    expect(out.doc.lanes).toEqual(doc.lanes);
    expect(out.doc.stickies).toEqual(doc.stickies);
  });
});
