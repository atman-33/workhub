import { describe, expect, it } from "vitest";
import { layoutAlgorithm } from "../algorithm/layout";
import { parseAlgorithm } from "../algorithm/parse";
import { layoutArchitecture } from "../architecture/layout";
import { parseArchitecture } from "../architecture/parse";
import { layoutFlow } from "../flow/layout";
import { parseFlow } from "../flow/parse";
import { encodePayload } from "./encode";
import { algorithmToMiro } from "./adapters/algorithm";
import { architectureFrameKey, architectureFrameLabelKey, architectureToMiro } from "./adapters/architecture";
import { flowLaneKey, flowLaneLabelKey, flowToMiro } from "./adapters/flow";
import { filterMiroSceneForSelection } from "./selection";

/**
 * The selection filter on real sample models (T-0725 part B): only selected
 * shapes survive, connectors need both ends selected, layout stickies are
 * left out, frames survive only with a selected member, flow lane rectangles
 * and architecture frame rectangles survive only with a selected member (with
 * their labels), and the survivor is
 * recentred. The whole-diagram adapters are untouched.
 */

const algorithmDoc = parseAlgorithm(`---
type: algorithm
title: Selection sample
---

## Nodes

- A-001 Start ^start
- A-002 Work
- A-003 Ask? ^decision
- A-004 End ^end

## Edges

- A-001 -> A-002
- A-002 -> A-003
- A-003 -> A-004 "yes"
- A-003 -> A-002 "no"

## Stickies

- S-001 node:A-002 @40,-20 #red Check this
`);

const flowDoc = parseFlow(`---
type: flow
title: Selection lanes
---

## Lanes

- L-001 Sales
- L-002 Books

## Steps

- F-001 Take order ^start lane:L-001
- F-002 Quote lane:L-001
- F-003 Approve lane:L-002
- F-004 Done ^end lane:L-002

## Edges

- F-001 -> F-002
- F-002 -> F-003 "over"
- F-003 -> F-004

## Stickies

- S-001 node:F-003 @40,-20 #red Check this
`);

const architectureDoc = parseArchitecture(
  `---
type: architecture
title: Selection frames
---

## Frames

- G-001 Client
- G-002 Server

## Nodes

- C-001 User
- C-002 Screen frame:G-001
- C-003 API frame:G-002
- C-004 DB frame:G-002 ^db

## Edges

- C-001 -> C-002
- C-002 -> C-003
- C-003 -> C-004

## Stickies

- S-001 node:G-002 @40,-30 #amber What stack?
`,
  "Selection frames",
);

describe("filterMiroSceneForSelection", () => {
  it("keeps connectors whose ends are both selected and drops those reaching outside", () => {
    const scene = algorithmToMiro(layoutAlgorithm(algorithmDoc, algorithmDoc.stickies));
    const filtered = filterMiroSceneForSelection(scene, ["A-002", "A-003"]);
    expect(filtered.shapes.map((s) => s.key)).toEqual(["A-002", "A-003"]);
    const keys = filtered.connectors.map((c) => c.key).sort();
    expect(keys).toEqual(["A-002->A-003", "A-003->A-002"]);
    // No arrow to the unselected start or end survives.
    expect(keys).not.toContain("A-001->A-002");
    expect(keys).not.toContain("A-003->A-004");
  });

  it("copies a single node with no connectors", () => {
    const scene = algorithmToMiro(layoutAlgorithm(algorithmDoc, algorithmDoc.stickies));
    const filtered = filterMiroSceneForSelection(scene, ["A-001"]);
    expect(filtered.shapes.map((s) => s.key)).toEqual(["A-001"]);
    expect(filtered.connectors).toEqual([]);
    // The lone survivor sits on the origin.
    expect(filtered.shapes[0].cx).toBeCloseTo(0, 9);
    expect(filtered.shapes[0].cy).toBeCloseTo(0, 9);
  });

  it("leaves layout stickies out even when their target is selected", () => {
    const scene = algorithmToMiro(layoutAlgorithm(algorithmDoc, algorithmDoc.stickies));
    expect(scene.stickers.map((s) => s.key)).toEqual(["S-001"]);
    const filtered = filterMiroSceneForSelection(scene, ["A-001", "A-002", "A-003", "A-004"]);
    expect(filtered.stickers).toEqual([]);
  });

  it("is a no-op for an empty selection", () => {
    const scene = algorithmToMiro(layoutAlgorithm(algorithmDoc, algorithmDoc.stickies));
    expect(filterMiroSceneForSelection(scene, [])).toBe(scene);
  });

  it("keeps flow lanes with a selected member and drops the rest", () => {
    const layout = layoutFlow(flowDoc, flowDoc.stickies, { unassignedLabel: "Unassigned" });
    const scene = flowToMiro(layout);
    const laneBefore = scene.shapes.find((s) => s.key === flowLaneKey("L-001"))!;
    const stepBefore = scene.shapes.find((s) => s.key === "F-001")!;
    const filtered = filterMiroSceneForSelection(scene, ["F-001", "F-002"]);
    // The steps stay top-level, and their lane rectangle comes first (behind
    // them), with its label; the other lane is gone, and no frame is ever
    // involved.
    expect(filtered.frames).toEqual([]);
    expect(filtered.shapes.map((s) => s.key)).toEqual([flowLaneKey("L-001"), "F-001", "F-002"]);
    expect(filtered.texts.map((t) => t.key)).toEqual([flowLaneLabelKey("L-001")]);
    expect(filtered.texts[0].text).toBe("Sales");
    // The surviving arrow stays inside the selection; the lane-crossing one drops.
    expect(filtered.connectors.map((c) => c.key)).toEqual(["F-001->F-002"]);
    for (const shape of filtered.shapes) {
      expect(shape.frame).toBeUndefined();
    }
    expect(
      filtered.shapes.filter((s) => s.key.startsWith("F-")).map((s) => s.lane),
    ).toEqual([flowLaneKey("L-001"), flowLaneKey("L-001")]);
    // The lane keeps its full geometry (not shrunk to the selection) and the
    // steps keep their offsets from it: everything shifts by one delta.
    const laneAfter = filtered.shapes[0];
    const stepAfter = filtered.shapes.find((s) => s.key === "F-001")!;
    expect(laneAfter.width).toBeCloseTo(laneBefore.width, 9);
    expect(laneAfter.height).toBeCloseTo(laneBefore.height, 9);
    expect(stepAfter.cx - laneAfter.cx).toBeCloseTo(stepBefore.cx - laneBefore.cx, 9);
    expect(stepAfter.cy - laneAfter.cy).toBeCloseTo(stepBefore.cy - laneBefore.cy, 9);
    // The independence survives encoding: rectangles then steps, all
    // top-level, then the label as a text.
    const payload = encodePayload(filtered);
    expect(payload.data.objects.map((o) => o.widgetData.type)).toEqual([
      "shape",
      "shape",
      "shape",
      "text",
      "line",
    ]);
    for (const object of payload.data.objects.filter((o) => o.widgetData.type === "shape")) {
      const json = object.widgetData.json as { _parent: null; _position: { schema: string } };
      expect(json._parent).toBeNull();
      expect(json._position.schema).toBe("canvasOffsetPx");
    }
  });

  it("keeps every lane holding a selected step, with only their labels", () => {
    const layout = layoutFlow(flowDoc, flowDoc.stickies, { unassignedLabel: "Unassigned" });
    const scene = flowToMiro(layout);
    const filtered = filterMiroSceneForSelection(scene, ["F-002", "F-003"]);
    expect(filtered.shapes.map((s) => s.key)).toEqual([
      flowLaneKey("L-001"),
      flowLaneKey("L-002"),
      "F-002",
      "F-003",
    ]);
    expect(filtered.texts.map((t) => t.key).sort()).toEqual(
      [flowLaneLabelKey("L-001"), flowLaneLabelKey("L-002")].sort(),
    );
    // The lane-crossing arrow survives: both ends are selected.
    expect(filtered.connectors.map((c) => c.key)).toEqual(["F-002->F-003"]);
  });

  it("keeps architecture frame rectangles with a selected member and drops the rest", () => {
    const scene = architectureToMiro(layoutArchitecture(architectureDoc, architectureDoc.stickies));
    const rectBefore = scene.shapes.find((s) => s.key === architectureFrameKey("G-002"))!;
    const blockBefore = scene.shapes.find((s) => s.key === "C-003")!;
    const filtered = filterMiroSceneForSelection(scene, ["C-003", "C-004"]);
    // The blocks stay top-level, and their frame rectangle comes first (behind
    // them), with its label; the other frame is gone, and no Miro frame is
    // ever involved.
    expect(filtered.frames).toEqual([]);
    expect(filtered.shapes.map((s) => s.key)).toEqual([
      architectureFrameKey("G-002"),
      "C-003",
      "C-004",
    ]);
    expect(filtered.texts.map((t) => t.key)).toEqual([architectureFrameLabelKey("G-002")]);
    expect(filtered.texts[0].text).toBe("Server");
    expect(filtered.connectors.map((c) => c.key)).toEqual(["C-003->C-004"]);
    for (const shape of filtered.shapes) {
      expect(shape.frame).toBeUndefined();
    }
    expect(
      filtered.shapes.filter((s) => s.key.startsWith("C-")).map((s) => s.lane),
    ).toEqual([architectureFrameKey("G-002"), architectureFrameKey("G-002")]);
    // The rectangle keeps its full geometry (not shrunk to the selection) and
    // the blocks keep their offsets from it: everything shifts by one delta.
    const rectAfter = filtered.shapes[0];
    const blockAfter = filtered.shapes.find((s) => s.key === "C-003")!;
    expect(rectAfter.width).toBeCloseTo(rectBefore.width, 9);
    expect(rectAfter.height).toBeCloseTo(rectBefore.height, 9);
    expect(blockAfter.cx - rectAfter.cx).toBeCloseTo(blockBefore.cx - rectBefore.cx, 9);
    expect(blockAfter.cy - rectAfter.cy).toBeCloseTo(blockBefore.cy - rectBefore.cy, 9);
    // The independence survives encoding: rectangles then blocks, all
    // top-level, then the label as a text.
    const payload = encodePayload(filtered);
    expect(payload.data.objects.map((o) => o.widgetData.type)).toEqual([
      "shape",
      "shape",
      "shape",
      "text",
      "line",
    ]);
    for (const object of payload.data.objects.filter((o) => o.widgetData.type === "shape")) {
      const json = object.widgetData.json as { _parent: null; _position: { schema: string } };
      expect(json._parent).toBeNull();
      expect(json._position.schema).toBe("canvasOffsetPx");
    }
  });

  it("keeps no frame rectangle for an ungrouped architecture block", () => {
    const scene = architectureToMiro(layoutArchitecture(architectureDoc, architectureDoc.stickies));
    const filtered = filterMiroSceneForSelection(scene, ["C-001"]);
    expect(filtered.frames).toEqual([]);
    expect(filtered.shapes.map((s) => s.key)).toEqual(["C-001"]);
    expect(filtered.texts).toEqual([]);
    // The arrow to the unselected block drops.
    expect(filtered.connectors).toEqual([]);
  });

  it("recentres the survivors on the origin without moving them apart", () => {
    const scene = algorithmToMiro(layoutAlgorithm(algorithmDoc, algorithmDoc.stickies));
    const filtered = filterMiroSceneForSelection(scene, ["A-002", "A-003"]);
    const byKey = new Map(filtered.shapes.map((s) => [s.key, s]));
    const before = new Map(scene.shapes.map((s) => [s.key, s]));
    const dxBefore = before.get("A-003")!.cx - before.get("A-002")!.cx;
    const dyBefore = before.get("A-003")!.cy - before.get("A-002")!.cy;
    expect(byKey.get("A-003")!.cx - byKey.get("A-002")!.cx).toBeCloseTo(dxBefore, 9);
    expect(byKey.get("A-003")!.cy - byKey.get("A-002")!.cy).toBeCloseTo(dyBefore, 9);
    // The bounding-box centre (shape extents, as the helper recentres) lands on
    // the origin - even when the survivors differ in height, so the midpoint
    // of their centres alone need not be exactly zero.
    const minX = Math.min(...filtered.shapes.map((s) => s.cx - s.width / 2));
    const maxX = Math.max(...filtered.shapes.map((s) => s.cx + s.width / 2));
    const minY = Math.min(...filtered.shapes.map((s) => s.cy - s.height / 2));
    const maxY = Math.max(...filtered.shapes.map((s) => s.cy + s.height / 2));
    expect((minX + maxX) / 2).toBeCloseTo(0, 9);
    expect((minY + maxY) / 2).toBeCloseTo(0, 9);
  });

  it("leaves the whole-diagram scene untouched", () => {
    const scene = algorithmToMiro(layoutAlgorithm(algorithmDoc, algorithmDoc.stickies));
    const snapshot = structuredClone(scene);
    filterMiroSceneForSelection(scene, ["A-002"]);
    expect(scene).toEqual(snapshot);
  });
});
