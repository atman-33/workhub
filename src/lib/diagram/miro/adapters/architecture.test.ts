import { describe, expect, it } from "vitest";
import { COLOR_HEX, STICKY_FILL_HEX } from "../../colors";
import { layoutArchitecture, type ArchitectureLayout } from "../../architecture/layout";
import { parseArchitecture } from "../../architecture/parse";
import { hexToMiroRgb } from "../palette";
import { encodePayload } from "../encode";
import {
  architectureFrameKey,
  architectureFrameLabelKey,
  architectureShapeToMiro,
  architectureToMiro,
} from "./architecture";

/**
 * The architecture adapter on a real sample model: each frame becomes a
 * background rectangle stacked in scene order (not a Miro frame, so blocks
 * stay freely movable), every block is an independent top-level figure in
 * absolute coordinates, the frame names become free texts at their
 * rectangles' top-left, `<->` arrows carry both heads, labels survive, and
 * stickies stay independent - even one pinned to a frame. All recentered so
 * the drawing's middle lands on the origin.
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
    // Frame rectangles come first (so they paste behind), then the blocks.
    expect(scene.shapes.map((s) => s.key)).toEqual([
      architectureFrameKey("G-001"),
      architectureFrameKey("G-002"),
      architectureFrameKey("G-003"),
      "C-001",
      "C-002",
      "C-003",
      "C-004",
      "C-005",
      "C-006",
    ]);
    expect(scene.shapes.slice(3).map((s) => s.shape)).toEqual([
      "rect",
      "rect",
      "round",
      "rect",
      "cylinder",
      "rect",
    ]);
    expect(scene.shapes.slice(0, 3).map((s) => s.shape)).toEqual(["rect", "rect", "rect"]);
  });

  it("makes one background rectangle per layout rectangle, empty frames included", () => {
    const layout = layoutWithStickies();
    const scene = architectureToMiro(layout);
    // No frames: members are plain rectangles, so Miro never owns the blocks.
    expect(scene.frames).toEqual([]);
    const rects = scene.shapes.slice(0, 3);
    expect(rects.map((s) => s.key)).toEqual([
      architectureFrameKey("G-001"),
      architectureFrameKey("G-002"),
      architectureFrameKey("G-003"),
    ]);
    for (const rect of rects) {
      expect(rect.shape).toBe("rect");
      // A visual guide only: no text of its own (the name is a free text),
      // no parent link.
      expect(rect.text).toBe("");
      expect(rect.frame).toBeUndefined();
      expect(rect.lane).toBeUndefined();
    }
    // The rectangles sit where the layout drew them, recentered - the empty
    // frame keeps the minimal box the layout gave it.
    const centreX = layout.bounds.x + layout.bounds.width / 2;
    const centreY = layout.bounds.y + layout.bounds.height / 2;
    layout.frames.forEach((frame, i) => {
      const out = rects[i];
      expect(out.cx).toBeCloseTo(frame.x + frame.width / 2 - centreX, 9);
      expect(out.cy).toBeCloseTo(frame.y + frame.height / 2 - centreY, 9);
      expect(out.width).toBeCloseTo(frame.width, 9);
      expect(out.height).toBeCloseTo(frame.height, 9);
    });
    // A plain frame keeps the default border.
    expect(rects.map((r) => r.border)).toEqual([null, null, null]);
  });

  it("names each frame with a free text at its rectangle's top-left", () => {
    const layout = layoutWithStickies();
    const scene = architectureToMiro(layout);
    expect(scene.texts.map((t) => t.key)).toEqual([
      architectureFrameLabelKey("G-001"),
      architectureFrameLabelKey("G-002"),
      architectureFrameLabelKey("G-003"),
    ]);
    expect(scene.texts.map((t) => t.text)).toEqual(["Client", "Server", "Empty"]);
    const rects = scene.shapes.slice(0, 3);
    scene.texts.forEach((label, i) => {
      const rect = rects[i];
      const left = rect.cx - rect.width / 2;
      const top = rect.cy - rect.height / 2;
      // Inside the rectangle, near its top-left corner.
      expect(label.cx - label.width / 2).toBeGreaterThanOrEqual(left);
      expect(label.cx - label.width / 2).toBeLessThan(left + rect.width / 2);
      expect(label.cy - label.height / 2).toBeGreaterThanOrEqual(top);
      expect(label.cy - label.height / 2).toBeLessThan(top + rect.height / 2);
    });
  });

  it("leaves every block parentless in absolute coordinates, grouped by frame", () => {
    const layout = layoutWithStickies();
    const scene = architectureToMiro(layout);
    const blocks = scene.shapes.slice(3);
    expect(blocks).toHaveLength(6);
    const frameOf = new Map([
      ["C-001", undefined],
      ["C-002", architectureFrameKey("G-001")],
      ["C-003", architectureFrameKey("G-001")],
      ["C-004", architectureFrameKey("G-002")],
      ["C-005", architectureFrameKey("G-002")],
      ["C-006", undefined],
    ]);
    for (const shape of blocks) {
      // No frame link: the block is a free figure. The `lane` link is grouping
      // only (the encoder ignores it) for the selection copy.
      expect(shape.frame).toBeUndefined();
      expect(shape.lane).toBe(frameOf.get(shape.key));
    }
    // The independence survives encoding: frame rectangles and blocks all
    // write `_parent: null` with canvas offsets, rectangles before blocks so
    // they land behind them, and the frame labels follow as texts.
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
    const rects = scene.shapes.slice(0, 3);
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
      if (i >= 3 && shape.lane !== undefined) {
        // Each grouped block sits inside its frame's rectangle.
        const rect = rects.find((r) => r.key === shape.lane)!;
        expect(shape.cx).toBeGreaterThanOrEqual(rect.cx - rect.width / 2);
        expect(shape.cx).toBeLessThanOrEqual(rect.cx + rect.width / 2);
      }
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

  it("paints a frame colour as its rectangle's border", () => {
    const colored = parseArchitecture(
      `---
type: architecture
title: t
---

## Frames

- G-001 Store #blue

## Nodes

- C-001 Box frame:G-001

## Edges
`,
      "t",
    );
    const scene = architectureToMiro(layoutArchitecture(colored, colored.stickies));
    expect(scene.frames).toEqual([]);
    expect(scene.shapes.map((s) => s.key)).toEqual([architectureFrameKey("G-001"), "C-001"]);
    expect(scene.shapes[0].border).toBe(hexToMiroRgb(COLOR_HEX.blue));
    expect(scene.texts.map((t) => t.text)).toEqual(["Store"]);
    expect(scene.shapes[1].lane).toBe(architectureFrameKey("G-001"));
    expect(scene.shapes[1].frame).toBeUndefined();
  });

  it("wraps a frameless diagram in no rectangle: every block stays top-level", () => {
    const frameless = parseArchitecture(
      `---
type: architecture
title: t
---

## Nodes

- C-001 Box
- C-002 Screen

## Edges

- C-001 -> C-002
`,
      "t",
    );
    const scene = architectureToMiro(layoutArchitecture(frameless, frameless.stickies));
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
