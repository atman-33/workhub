import { describe, expect, it } from "vitest";
import { COLOR_HEX, STICKY_FILL_HEX } from "../../colors";
import { layoutPfd, type PfdLayout } from "../../pfd/layout";
import { parsePfd } from "../../pfd/parse";
import { hexToMiroRgb } from "../palette";
import { encodePayload } from "../encode";
import { pfdShapeToMiro, pfdToMiro } from "./pfd";

/**
 * The PFD adapter on a real PFD sample model: processes become wide circles,
 * deliverables rectangles, arrows bound connectors, stickies Miro stickies -
 * all recentered so the drawing's middle lands on the origin.
 */
const doc = parsePfd(`---
type: pfd
title: 開発の流れ
---

## Nodes

- P-001 要件を整理する
- D-001 要件定義書 task:T-0100 #green
  行のメモ
- P-002 設計する @400,260
- D-002 設計書

## Edges

- P-001 -> D-001
- D-001 -> P-002
- P-002 -> D-002
- P-001 -> P-002

## Stickies

- S-001 node:D-001 @40,-20 #red 要確認
`);

function layoutWithStickies(): PfdLayout {
  return layoutPfd(doc, doc.stickies);
}

describe("pfdToMiro", () => {
  it("maps ellipses to wide circles and documents to rectangles", () => {
    const layout = layoutWithStickies();
    const scene = pfdToMiro(layout);
    expect(scene.shapes.map((s) => s.key)).toEqual(["P-001", "D-001", "P-002", "D-002"]);
    expect(scene.shapes.map((s) => s.shape)).toEqual(["circle", "rect", "circle", "rect"]);
    // A circle keeps the ellipse's own width and height, so it stays wide.
    const process = scene.shapes[0];
    const laid = layout.byId.get("P-001")!;
    expect([process.width, process.height]).toEqual([laid.width, laid.height]);
    expect(process.width).toBeGreaterThan(process.height);
    expect(scene.frames).toEqual([]);
  });

  it("recenters the drawing on the origin without moving nodes apart", () => {
    const layout = layoutWithStickies();
    const scene = pfdToMiro(layout);
    const byKey = new Map(scene.shapes.map((s) => [s.key, s]));
    // Pairwise distances are layout distances.
    const dxScene = byKey.get("D-001")!.cx - byKey.get("P-001")!.cx;
    expect(dxScene).toBeCloseTo(layout.byId.get("D-001")!.cx - layout.byId.get("P-001")!.cx, 9);
    // Every element is shifted by the same vector: the bounds centre lands on
    // the origin (the bounds also hold stickies and arrow curves, so the
    // shape centres alone need not sit symmetric about it).
    const bcx = layout.bounds.x + layout.bounds.width / 2;
    const bcy = layout.bounds.y + layout.bounds.height / 2;
    for (const shape of scene.shapes) {
      const node = layout.byId.get(shape.key)!;
      expect(shape.cx).toBeCloseTo(node.cx - bcx, 9);
      expect(shape.cy).toBeCloseTo(node.cy - bcy, 9);
    }
  });

  it("binds arrows to their nodes with 0..1 end points and no labels", () => {
    const scene = pfdToMiro(layoutWithStickies());
    expect(scene.connectors).toHaveLength(4);
    for (const connector of scene.connectors) {
      for (const end of [connector.from, connector.to]) {
        expect(end.x).toBeGreaterThanOrEqual(0);
        expect(end.x).toBeLessThanOrEqual(1);
        expect(end.y).toBeGreaterThanOrEqual(0);
        expect(end.y).toBeLessThanOrEqual(1);
      }
      expect(connector.label).toBeUndefined();
    }
    // The linkage survives encoding: each connector points at its shapes' ids
    // (PFD scenes have no frames, so shape i is object i).
    const payload = encodePayload(scene);
    const shapeId = new Map(scene.shapes.map((s, i) => [s.key, i]));
    const lines = payload.data.objects.filter((o) => o.widgetData.type === "line");
    expect(lines).toHaveLength(scene.connectors.length);
    lines.forEach((line, i) => {
      const json = line.widgetData.json as {
        primary: { widgetIndex: number };
        secondary: { widgetIndex: number };
      };
      expect(json.primary.widgetIndex).toBe(shapeId.get(scene.connectors[i].from.key));
      expect(json.secondary.widgetIndex).toBe(shapeId.get(scene.connectors[i].to.key));
    });
  });

  it("keeps titles verbatim and leaves memo, task and colour words out of the text", () => {
    const scene = pfdToMiro(layoutWithStickies());
    const deliverable = scene.shapes.find((s) => s.key === "D-001")!;
    expect(deliverable.text).toBe("要件定義書");
    // The colour rides the border, as on the canvas and in the exports.
    expect(deliverable.border).toBe(hexToMiroRgb(COLOR_HEX.green));
    expect(scene.shapes.find((s) => s.key === "P-001")!.border).toBeNull();
  });

  it("puts visible stickies on the board with the app's paper colours", () => {
    const scene = pfdToMiro(layoutWithStickies());
    expect(scene.stickers).toHaveLength(1);
    const [sticker] = scene.stickers;
    expect(sticker.key).toBe("S-001");
    expect(sticker.text).toBe("要確認");
    expect(sticker.background).toBe(hexToMiroRgb(STICKY_FILL_HEX.red));
    // The sticker centre is its layout centre, shifted with everything else.
    const layout = layoutWithStickies();
    const placed = layout.stickies[0];
    const centreX = layout.bounds.x + layout.bounds.width / 2;
    expect(sticker.cx).toBeCloseTo(placed.x + placed.width / 2 - centreX, 9);
  });

  it("lays out nothing as an empty scene", () => {
    const scene = pfdToMiro(layoutPfd({ nodes: [], edges: [] }));
    expect(scene).toEqual({ shapes: [], stickers: [], texts: [], frames: [], connectors: [] });
    expect(encodePayload(scene).data.objects).toEqual([]);
  });

  it("falls back to a rectangle for figure shapes without a Miro id", () => {
    expect(pfdShapeToMiro("ellipse")).toBe("circle");
    expect(pfdShapeToMiro("document")).toBe("rect");
    expect(pfdShapeToMiro("rect")).toBe("rect");
    expect(pfdShapeToMiro("parallelogram")).toBe("rect");
    const node = {
      id: "P-001",
      shape: "parallelogram",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      title: "x",
      lines: ["x"],
      prefix: "P",
      placed: true,
      cx: 50,
      cy: 25,
    };
    const layout: PfdLayout = {
      nodes: [node],
      edges: [],
      stickies: [],
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      byId: new Map([[node.id, node]]),
    };
    expect(pfdToMiro(layout).shapes[0].shape).toBe("rect");
  });
});
