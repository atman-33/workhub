import { describe, expect, it } from "vitest";
import { STICKY_FILL_HEX } from "../../colors";
import { layoutArchitecture, type ArchitectureLayout } from "../../architecture/layout";
import { parseArchitecture } from "../../architecture/parse";
import { hexToMiroRgb } from "../palette";
import { encodePayload } from "../encode";
import { architectureFrameKey, architectureShapeToMiro, architectureToMiro } from "./architecture";

/**
 * The architecture adapter on a real sample model: each frame becomes a Miro
 * frame at the rectangle the layout drew, every block inside one becomes that
 * frame's child (offsets from the frame's top-left), blocks map to figures by
 * kind, `<->` arrows carry both heads, labels survive, and stickies stay
 * independent - even one pinned to a frame. All recentered so the drawing's
 * middle lands on the origin.
 */
const doc = parseArchitecture(
  `---
type: architecture
title: Booking
---

## Frames

- G-001 Client
- G-002 Server
- G-003 Empty

## Nodes

- C-001 User ^user
- C-002 Screen frame:G-001
  Hover memo.
- C-003 Check frame:G-001 ^round
- C-004 API frame:G-002 task:T-0100
- C-005 DB frame:G-002 ^db @640,260
- C-006 Mailer ^cloud

## Edges

- C-001 -> C-002 "Uses"
- C-002 -> C-003
- C-003 <-> C-004 "HTTPS"
- C-004 -> C-005 "Saves"
- C-004:E -> C-006:W "Pinned"

## Stickies

- S-001 node:G-002 @40,-30 #amber What stack?
`,
  "Booking",
);

function layoutWithStickies(): ArchitectureLayout {
  return layoutArchitecture(doc, doc.stickies);
}

describe("architectureToMiro", () => {
  it("maps blocks by kind, with people and clouds as provisional rectangles", () => {
    const scene = architectureToMiro(layoutWithStickies());
    expect(scene.shapes.map((s) => s.key)).toEqual([
      "C-001",
      "C-002",
      "C-003",
      "C-004",
      "C-005",
      "C-006",
    ]);
    expect(scene.shapes.map((s) => s.shape)).toEqual([
      "rect",
      "rect",
      "round",
      "rect",
      "cylinder",
      "rect",
    ]);
  });

  it("makes one frame per layout rectangle, empty frames included", () => {
    const layout = layoutWithStickies();
    const scene = architectureToMiro(layout);
    expect(scene.frames.map((f) => f.key)).toEqual([
      architectureFrameKey("G-001"),
      architectureFrameKey("G-002"),
      architectureFrameKey("G-003"),
    ]);
    expect(scene.frames.map((f) => f.title)).toEqual(["Client", "Server", "Empty"]);
    // The frames sit where the layout drew them, recentered.
    const centreX = layout.bounds.x + layout.bounds.width / 2;
    const centreY = layout.bounds.y + layout.bounds.height / 2;
    layout.frames.forEach((frame, i) => {
      const out = scene.frames[i];
      expect(out.cx).toBeCloseTo(frame.x + frame.width / 2 - centreX, 9);
      expect(out.cy).toBeCloseTo(frame.y + frame.height / 2 - centreY, 9);
      expect(out.width).toBeCloseTo(frame.width, 9);
      expect(out.height).toBeCloseTo(frame.height, 9);
    });
  });

  it("parents members to their frame with offsets from the frame's top-left", () => {
    const scene = architectureToMiro(layoutWithStickies());
    const frameOf = new Map([
      ["C-001", undefined],
      ["C-002", architectureFrameKey("G-001")],
      ["C-003", architectureFrameKey("G-001")],
      ["C-004", architectureFrameKey("G-002")],
      ["C-005", architectureFrameKey("G-002")],
      ["C-006", undefined],
    ]);
    for (const shape of scene.shapes) expect(shape.frame).toBe(frameOf.get(shape.key));
    // The linkage survives encoding: children point at their frame's id, come
    // after it in the objects array, and carry frame-relative offsets.
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
    scene.shapes.forEach((shape, i) => {
      const json = objects[3 + i].widgetData.json as {
        _parent: { index: number } | null;
        _position: { offsetPx: { x: number; y: number }; schema: string; containerType?: string };
      };
      if (shape.frame === undefined) {
        expect(json._parent).toBeNull();
        expect(json._position.schema).toBe("canvasOffsetPx");
        return;
      }
      const frame = scene.frames.find((f) => f.key === shape.frame)!;
      expect(json._parent).toEqual({ index: frameId.get(shape.frame!) });
      expect(json._position.schema).toBe("parentOffsetPx");
      expect(json._position.containerType).toBe("FRAME");
      expect(json._position.offsetPx.x).toBeCloseTo(shape.cx - (frame.cx - frame.width / 2), 9);
      expect(json._position.offsetPx.y).toBeCloseTo(shape.cy - (frame.cy - frame.height / 2), 9);
    });
  });

  it("binds arrows to their blocks with 0..1 end points and keeps labels", () => {
    const scene = architectureToMiro(layoutWithStickies());
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
    expect(labels.get("C-001->C-002")).toBe("Uses");
    expect(labels.get("C-003<>C-004<>")).toBe("HTTPS");
    expect(labels.get("C-002->C-003")).toBeUndefined();
    // A `<->` arrow carries both heads; a one-way arrow only the far one.
    expect(scene.connectors.find((c) => c.key === "C-003<>C-004<>")!.arrowStart).toBe(true);
    expect(scene.connectors.find((c) => c.key === "C-001->C-002")!.arrowStart).toBeUndefined();
    const payload = encodePayload(scene);
    const lines = payload.data.objects.filter((o) => o.widgetData.type === "line");
    expect(lines).toHaveLength(scene.connectors.length);
    const byKey = new Map(lines.map((line, i) => [scene.connectors[i].key, line]));
    const bidiStyle = JSON.parse(
      (byKey.get("C-003<>C-004<>")!.widgetData.json as { style: string }).style,
    ) as { a_start: number; a_end: number };
    expect(bidiStyle).toMatchObject({ a_start: 9, a_end: 9 });
    const oneWayStyle = JSON.parse(
      (byKey.get("C-001->C-002")!.widgetData.json as { style: string }).style,
    ) as { a_start: number; a_end: number };
    expect(oneWayStyle).toMatchObject({ a_start: 0, a_end: 9 });
  });

  it("keeps pinned ends on their sides as relative points", () => {
    const layout = layoutWithStickies();
    const scene = architectureToMiro(layout);
    const pinned = scene.connectors.find((c) => c.key === "C-004->C-006")!;
    expect(pinned.label).toBe("Pinned");
    // Out the east side halfway down, in the west side: the relative points
    // sit on those sides of their blocks.
    expect(pinned.from.x).toBeCloseTo(1, 6);
    expect(pinned.to.x).toBeCloseTo(0, 6);
  });

  it("keeps titles verbatim and leaves memo, task and colour words out of the text", () => {
    const scene = architectureToMiro(layoutWithStickies());
    expect(scene.shapes.find((s) => s.key === "C-002")!.text).toBe("Screen");
    expect(scene.shapes.find((s) => s.key === "C-004")!.text).toBe("API");
    expect(scene.shapes.find((s) => s.key === "C-004")!.border).toBeNull();
  });

  it("puts a frame-pinned sticky on the board as an independent note", () => {
    const scene = architectureToMiro(layoutWithStickies());
    expect(scene.stickers).toHaveLength(1);
    const [sticker] = scene.stickers;
    expect(sticker.key).toBe("S-001");
    expect(sticker.text).toBe("What stack?");
    expect(sticker.background).toBe(hexToMiroRgb(STICKY_FILL_HEX.amber));
    const layout = layoutWithStickies();
    const placed = layout.stickies[0];
    const centreX = layout.bounds.x + layout.bounds.width / 2;
    const centreY = layout.bounds.y + layout.bounds.height / 2;
    expect(sticker.cx).toBeCloseTo(placed.x + placed.width / 2 - centreX, 9);
    expect(sticker.cy).toBeCloseTo(placed.y + placed.height / 2 - centreY, 9);
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
    const scene = architectureToMiro(layoutArchitecture({ frames: [], nodes: [], edges: [] }, []));
    expect(scene).toEqual({ shapes: [], stickers: [], texts: [], frames: [], connectors: [] });
    expect(encodePayload(scene).data.objects).toEqual([]);
  });

  it("falls back to a rectangle for block kinds without a Miro id", () => {
    expect(architectureShapeToMiro("block")).toBe("rect");
    expect(architectureShapeToMiro("round")).toBe("round");
    expect(architectureShapeToMiro("db")).toBe("cylinder");
    expect(architectureShapeToMiro("user")).toBe("rect");
    expect(architectureShapeToMiro("cloud")).toBe("rect");
    expect(architectureShapeToMiro("queue")).toBe("rect");
  });
});
