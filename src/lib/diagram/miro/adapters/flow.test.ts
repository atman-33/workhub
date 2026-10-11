import { describe, expect, it } from "vitest";
import { COLOR_HEX, STICKY_FILL_HEX } from "../../colors";
import { layoutFlow, UNASSIGNED, type FlowLayout } from "../../flow/layout";
import { parseFlow } from "../../flow/parse";
import { hexToMiroRgb } from "../palette";
import { encodePayload } from "../encode";
import { flowLaneKey, flowLaneLabelKey, flowShapeToMiro, flowToMiro } from "./flow";

/**
 * The flow adapter on a real business-flow sample model: each lane becomes a
 * background rectangle stacked vertically (not a Miro frame, so steps stay
 * freely movable), every step is an independent top-level figure in absolute
 * coordinates, the lane names become free texts at their rectangles'
 * top-left, arrows stay bound connectors with labels - including arrows
 * across lanes - and stickies stay independent. All recentered so the
 * drawing's middle lands on the origin.
 */
const doc = parseFlow(`---
type: flow
title: 受注フロー
---

## Lanes

- L-001 営業 #blue
- L-002 経理

## Steps

- F-001 受注 ^start lane:L-001
- F-002 見積を作る lane:L-001 task:T-0100
  行のメモ
- F-003 金額 1 万円超? ^decision lane:L-001
- F-004 承認する lane:L-002 #green
- F-005 完了 ^end lane:L-002
- F-006 予備の対応

## Edges

- F-001 -> F-002
- F-002 -> F-003
- F-003 -> F-004 "はい"
- F-003 -> F-005 "いいえ"
- F-004 -> F-005

## Stickies

- S-001 node:F-004 @40,-20 #red 要確認
`);

function layoutWithStickies(): FlowLayout {
  return layoutFlow(doc, doc.stickies, { unassignedLabel: "Unassigned" });
}

describe("flowToMiro", () => {
  it("maps start/end to rounded, decisions to diamonds, processes to rectangles", () => {
    const scene = flowToMiro(layoutWithStickies());
    // Lane rectangles come first (so they paste behind), then the steps.
    expect(scene.shapes.map((s) => s.key)).toEqual([
      flowLaneKey("L-001"),
      flowLaneKey("L-002"),
      flowLaneKey(UNASSIGNED),
      "F-001",
      "F-002",
      "F-003",
      "F-004",
      "F-005",
      "F-006",
    ]);
    expect(scene.shapes.slice(3).map((s) => s.shape)).toEqual([
      "round",
      "rect",
      "diamond",
      "rect",
      "round",
      "rect",
    ]);
    expect(scene.shapes.slice(0, 3).map((s) => s.shape)).toEqual(["rect", "rect", "rect"]);
  });

  it("makes one background rectangle per band, stacked vertically as drawn", () => {
    const layout = layoutWithStickies();
    const scene = flowToMiro(layout);
    // No frames: lanes are plain rectangles, so Miro never owns the steps.
    expect(scene.frames).toEqual([]);
    const lanes = scene.shapes.slice(0, 3);
    expect(lanes.map((s) => s.key)).toEqual([
      flowLaneKey("L-001"),
      flowLaneKey("L-002"),
      flowLaneKey(UNASSIGNED),
    ]);
    for (const lane of lanes) {
      expect(lane.shape).toBe("rect");
      // A visual guide only: no text of its own (the name is a free text),
      // no parent link.
      expect(lane.text).toBe("");
      expect(lane.frame).toBeUndefined();
      expect(lane.lane).toBeUndefined();
    }
    // The rectangles sit where the bands sit, recentered: same order top to bottom.
    const centreX = layout.bounds.x + layout.bounds.width / 2;
    const centreY = layout.bounds.y + layout.bounds.height / 2;
    layout.bands.forEach((band, i) => {
      const lane = lanes[i];
      expect(lane.cx).toBeCloseTo(band.x + band.width / 2 - centreX, 9);
      expect(lane.cy).toBeCloseTo(band.y + band.height / 2 - centreY, 9);
      expect(lane.width).toBeCloseTo(band.width, 9);
      expect(lane.height).toBeCloseTo(band.height, 9);
    });
    const [first, second, third] = lanes;
    expect(first.cy).toBeLessThan(second.cy);
    expect(second.cy).toBeLessThan(third.cy);
    // A lane colour becomes its rectangle's border; a plain lane keeps the default.
    expect(lanes[0].border).toBe(hexToMiroRgb(COLOR_HEX.blue));
    expect(lanes[1].border).toBeNull();
  });

  it("names each lane with a free text at its rectangle's top-left", () => {
    const layout = layoutWithStickies();
    const scene = flowToMiro(layout);
    expect(scene.texts.map((t) => t.key)).toEqual([
      flowLaneLabelKey("L-001"),
      flowLaneLabelKey("L-002"),
      flowLaneLabelKey(UNASSIGNED),
    ]);
    expect(scene.texts.map((t) => t.text)).toEqual(["営業", "経理", "Unassigned"]);
    const lanes = scene.shapes.slice(0, 3);
    scene.texts.forEach((label, i) => {
      const lane = lanes[i];
      const left = lane.cx - lane.width / 2;
      const top = lane.cy - lane.height / 2;
      // Inside the rectangle, near its top-left corner.
      expect(label.cx - label.width / 2).toBeGreaterThanOrEqual(left);
      expect(label.cx - label.width / 2).toBeLessThan(left + lane.width / 2);
      expect(label.cy - label.height / 2).toBeGreaterThanOrEqual(top);
      expect(label.cy - label.height / 2).toBeLessThan(top + lane.height / 2);
    });
  });

  it("leaves every step parentless in absolute coordinates, grouped by lane", () => {
    const layout = layoutWithStickies();
    const scene = flowToMiro(layout);
    const steps = scene.shapes.slice(3);
    expect(steps).toHaveLength(6);
    for (const shape of steps) {
      const step = layout.byId.get(shape.key)!;
      // No frame link: the step is a free figure. The `lane` link is grouping
      // only (the encoder ignores it) for the selection copy.
      expect(shape.frame).toBeUndefined();
      expect(shape.lane).toBe(flowLaneKey(step.band));
    }
    // The independence survives encoding: lane rectangles and steps all write
    // `_parent: null` with canvas offsets, lanes before steps so they land
    // behind them, and the lane labels follow as texts.
    const payload = encodePayload(scene);
    const objects = payload.data.objects;
    expect(objects.map((o) => o.widgetData.type)).toEqual([
      "shape",
      "shape",
      "shape",
      "shape",
      "shape",
      "shape",
      "shape",
      "shape",
      "shape",
      "sticker",
      "text",
      "text",
      "text",
      "line",
      "line",
      "line",
      "line",
      "line",
    ]);
    const lanes = scene.shapes.slice(0, 3);
    objects.slice(0, 9).forEach((object, i) => {
      const shape = scene.shapes[i];
      const json = object.widgetData.json as {
        _parent: null;
        _position: { offsetPx: { x: number; y: number }; schema: string };
      };
      expect(json._parent).toBeNull();
      expect(json._position.schema).toBe("canvasOffsetPx");
      expect(json._position.offsetPx.x).toBeCloseTo(shape.cx, 9);
      expect(json._position.offsetPx.y).toBeCloseTo(shape.cy, 9);
      if (i >= 3) {
        // Each step sits inside its lane's rectangle.
        const lane = lanes.find((l) => l.key === shape.lane)!;
        expect(shape.cx).toBeGreaterThanOrEqual(lane.cx - lane.width / 2);
        expect(shape.cx).toBeLessThanOrEqual(lane.cx + lane.width / 2);
      }
    });
  });

  it("binds arrows to their steps with 0..1 end points, across lanes too", () => {
    const scene = flowToMiro(layoutWithStickies());
    expect(scene.connectors).toHaveLength(5);
    for (const connector of scene.connectors) {
      for (const end of [connector.from, connector.to]) {
        expect(end.x).toBeGreaterThanOrEqual(0);
        expect(end.x).toBeLessThanOrEqual(1);
        expect(end.y).toBeGreaterThanOrEqual(0);
        expect(end.y).toBeLessThanOrEqual(1);
      }
    }
    const labels = new Map(scene.connectors.map((c) => [c.key, c.label]));
    expect(labels.get("F-003->F-004")).toBe("はい");
    expect(labels.get("F-003->F-005")).toBe("いいえ");
    expect(labels.get("F-001->F-002")).toBeUndefined();
    // The cross-lane arrow names steps of two different lanes, and the
    // linkage survives encoding: it points at its shapes' ids (lanes first,
    // then steps).
    const cross = scene.connectors.find((c) => c.key === "F-003->F-004")!;
    expect(byLane(scene, cross.from.key)).not.toBe(byLane(scene, cross.to.key));
    const payload = encodePayload(scene);
    const shapeId = new Map(scene.shapes.map((s, i) => [s.key, i]));
    const lines = payload.data.objects.filter((o) => o.widgetData.type === "line");
    expect(lines).toHaveLength(scene.connectors.length);
    lines.forEach((line, i) => {
      const json = line.widgetData.json as {
        primary: { widgetIndex: number };
        secondary: { widgetIndex: number };
        line: { captions: { text: string }[] };
      };
      expect(json.primary.widgetIndex).toBe(shapeId.get(scene.connectors[i].from.key));
      expect(json.secondary.widgetIndex).toBe(shapeId.get(scene.connectors[i].to.key));
      if (scene.connectors[i].label) expect(json.line.captions).toHaveLength(1);
      else expect(json.line.captions).toEqual([]);
    });
  });

  it("keeps titles verbatim and leaves memo, task and colour words out of the text", () => {
    const scene = flowToMiro(layoutWithStickies());
    const quoted = scene.shapes.find((s) => s.key === "F-002")!;
    expect(quoted.text).toBe("見積を作る");
    expect(quoted.border).toBeNull();
    const green = scene.shapes.find((s) => s.key === "F-004")!;
    expect(green.text).toBe("承認する");
    expect(green.border).toBe(hexToMiroRgb(COLOR_HEX.green));
    expect(scene.shapes.find((s) => s.key === "F-001")!.border).toBeNull();
  });

  it("puts visible stickies on the board as independent notes", () => {
    const scene = flowToMiro(layoutWithStickies());
    expect(scene.stickers).toHaveLength(1);
    const [sticker] = scene.stickers;
    expect(sticker.key).toBe("S-001");
    expect(sticker.text).toBe("要確認");
    expect(sticker.background).toBe(hexToMiroRgb(STICKY_FILL_HEX.red));
    const layout = layoutWithStickies();
    const placed = layout.stickies[0];
    const centreX = layout.bounds.x + layout.bounds.width / 2;
    expect(sticker.cx).toBeCloseTo(placed.x + placed.width / 2 - centreX, 9);
    // Independent: no frame, canvas offsets even though its step has one.
    const json = encodePayload(scene).data.objects.find(
      (o) => o.widgetData.type === "sticker",
    )!.widgetData.json as {
      _parent: null;
      _position: { schema: string };
    };
    expect(json._parent).toBeNull();
    expect(json._position.schema).toBe("canvasOffsetPx");
  });

  it("lays out nothing as an empty scene", () => {
    const scene = flowToMiro(layoutFlow({ lanes: [], steps: [], edges: [] }, []));
    expect(scene).toEqual({ shapes: [], stickers: [], texts: [], frames: [], connectors: [] });
    expect(encodePayload(scene).data.objects).toEqual([]);
  });

  it("wraps a laneless diagram in no rectangle: every step stays top-level", () => {
    const laneless = parseFlow(`---
type: flow
title: t
---

## Steps

- F-001 はじめる ^start
- F-002 おわる ^end

## Edges

- F-001 -> F-002
`);
    const scene = flowToMiro(layoutFlow(laneless, laneless.stickies));
    expect(scene.frames).toEqual([]);
    expect(scene.texts).toEqual([]);
    expect(scene.shapes).toHaveLength(2);
    for (const shape of scene.shapes) {
      expect(shape.frame).toBeUndefined();
      expect(shape.lane).toBeUndefined();
    }
    const objects = encodePayload(scene).data.objects;
    expect(objects.map((o) => o.widgetData.type)).toEqual(["shape", "shape", "line"]);
    for (const object of objects.filter((o) => o.widgetData.type === "shape")) {
      const json = object.widgetData.json as { _parent: null; _position: { schema: string } };
      expect(json._parent).toBeNull();
      expect(json._position.schema).toBe("canvasOffsetPx");
    }
  });

  it("falls back to a rectangle for step kinds without a Miro id", () => {
    expect(flowShapeToMiro("start")).toBe("round");
    expect(flowShapeToMiro("end")).toBe("round");
    expect(flowShapeToMiro("decision")).toBe("diamond");
    expect(flowShapeToMiro("process")).toBe("rect");
    expect(flowShapeToMiro("wait")).toBe("rect");
  });
});

function byLane(
  scene: { shapes: { key: string; lane?: string }[] },
  key: string,
): string | undefined {
  return scene.shapes.find((s) => s.key === key)?.lane;
}
