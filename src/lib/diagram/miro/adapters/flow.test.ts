import { describe, expect, it } from "vitest";
import { COLOR_HEX, STICKY_FILL_HEX } from "../../colors";
import { layoutFlow, UNASSIGNED, type FlowLayout } from "../../flow/layout";
import { parseFlow } from "../../flow/parse";
import { hexToMiroRgb } from "../palette";
import { encodePayload } from "../encode";
import { flowFrameKey, flowShapeToMiro, flowToMiro } from "./flow";

/**
 * The flow adapter on a real business-flow sample model: each lane becomes a
 * Miro frame stacked vertically, every step inside a lane becomes that
 * frame's child (offsets from the frame's top-left), arrows stay bound
 * connectors with labels - including arrows across lanes - and stickies stay
 * independent. All recentered so the drawing's middle lands on the origin.
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
    expect(scene.shapes.map((s) => s.key)).toEqual([
      "F-001",
      "F-002",
      "F-003",
      "F-004",
      "F-005",
      "F-006",
    ]);
    expect(scene.shapes.map((s) => s.shape)).toEqual([
      "round",
      "rect",
      "diamond",
      "rect",
      "round",
      "rect",
    ]);
  });

  it("makes one frame per band, stacked vertically as drawn", () => {
    const layout = layoutWithStickies();
    const scene = flowToMiro(layout);
    expect(scene.frames.map((f) => f.title)).toEqual(["営業", "経理", "Unassigned"]);
    expect(scene.frames.map((f) => f.key)).toEqual([
      flowFrameKey("L-001"),
      flowFrameKey("L-002"),
      flowFrameKey(UNASSIGNED),
    ]);
    // The frames sit where the bands sit, recentered: same order top to bottom.
    const centreX = layout.bounds.x + layout.bounds.width / 2;
    const centreY = layout.bounds.y + layout.bounds.height / 2;
    layout.bands.forEach((band, i) => {
      const frame = scene.frames[i];
      expect(frame.cx).toBeCloseTo(band.x + band.width / 2 - centreX, 9);
      expect(frame.cy).toBeCloseTo(band.y + band.height / 2 - centreY, 9);
      expect(frame.width).toBeCloseTo(band.width, 9);
      expect(frame.height).toBeCloseTo(band.height, 9);
    });
    const [first, second, third] = scene.frames;
    expect(first.cy).toBeLessThan(second.cy);
    expect(second.cy).toBeLessThan(third.cy);
  });

  it("parents every step to its lane's frame with offsets from the frame's top-left", () => {
    const layout = layoutWithStickies();
    const scene = flowToMiro(layout);
    for (const shape of scene.shapes) {
      const step = layout.byId.get(shape.key)!;
      expect(shape.frame).toBe(flowFrameKey(step.band));
    }
    // The linkage survives encoding: each child points at its frame's id and
    // carries offsets measured from the frame's top-left corner.
    const payload = encodePayload(scene);
    const objects = payload.data.objects;
    expect(objects.map((o) => o.widgetData.type)).toEqual([
      "frame",
      "frame",
      "frame",
      "shape",
      "shape",
      "shape",
      "shape",
      "shape",
      "shape",
      "sticker",
      "line",
      "line",
      "line",
      "line",
      "line",
    ]);
    const frameId = new Map(scene.frames.map((f, i) => [f.key, i]));
    const byKey = new Map(scene.shapes.map((s) => [s.key, s]));
    objects.slice(3, 9).forEach((object, i) => {
      const shape = scene.shapes[i];
      const frame = scene.frames.find((f) => f.key === shape.frame)!;
      const json = object.widgetData.json as {
        _parent: { index: number };
        _position: { offsetPx: { x: number; y: number }; schema: string; containerType: string };
      };
      expect(json._parent).toEqual({ index: frameId.get(shape.frame!) });
      expect(json._position.schema).toBe("parentOffsetPx");
      expect(json._position.containerType).toBe("FRAME");
      expect(json._position.offsetPx.x).toBeCloseTo(shape.cx - (frame.cx - frame.width / 2), 9);
      expect(json._position.offsetPx.y).toBeCloseTo(shape.cy - (frame.cy - frame.height / 2), 9);
      // The child sits inside its frame's rectangle.
      expect(byKey.get(shape.key)!.cx).toBeGreaterThanOrEqual(frame.cx - frame.width / 2);
      expect(byKey.get(shape.key)!.cx).toBeLessThanOrEqual(frame.cx + frame.width / 2);
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
    // The cross-lane arrow names steps of two different frames, and the
    // linkage survives encoding: it points at its shapes' ids.
    const cross = scene.connectors.find((c) => c.key === "F-003->F-004")!;
    expect(byFrame(scene, cross.from.key)).not.toBe(byFrame(scene, cross.to.key));
    const payload = encodePayload(scene);
    const shapeId = new Map(scene.shapes.map((s, i) => [s.key, i + scene.frames.length]));
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

  it("wraps a laneless diagram in no frame: every step stays top-level", () => {
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
    expect(scene.shapes).toHaveLength(2);
    for (const shape of scene.shapes) expect(shape.frame).toBeUndefined();
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

function byFrame(
  scene: { shapes: { key: string; frame?: string }[] },
  key: string,
): string | undefined {
  return scene.shapes.find((s) => s.key === key)?.frame;
}
