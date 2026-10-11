import { describe, expect, it } from "vitest";
import { COLOR_HEX, STICKY_FILL_HEX } from "../../colors";
import { layoutAlgorithm, type AlgorithmLayout } from "../../algorithm/layout";
import { parseAlgorithm } from "../../algorithm/parse";
import { hexToMiroRgb } from "../palette";
import { encodePayload } from "../encode";
import { algorithmShapeToMiro, algorithmToMiro } from "./algorithm";

/**
 * The algorithm adapter on a real program-flow sample model: starts and ends
 * become rounded figures, decisions diamonds, everything else rectangles;
 * arrows are bound connectors with labels; stickies become Miro stickies -
 * all recentered so the drawing's middle lands on the origin.
 */
const doc = parseAlgorithm(`---
type: algorithm
title: 登録の流れ
---

## Nodes

- A-001 開始 ^start
- A-002 名前を入力する ^io task:T-0100 #green
  行のメモ
- A-003 登録する
- A-004 正しいか ^decision
- A-005 終了 ^end
- A-006 定型処理 ^sub
- A-007 帳票 ^doc

## Edges

- A-001 -> A-002
- A-002 -> A-003
- A-003 -> A-004
- A-004 -> A-005 "はい"
- A-004 -> A-003 "いいえ"
- A-003 -> A-006
- A-006 -> A-007

## Stickies

- S-001 node:A-002 @40,-20 #red 要確認
`);

function layoutWithStickies(): AlgorithmLayout {
  return layoutAlgorithm(doc, doc.stickies);
}

describe("algorithmToMiro", () => {
  it("maps start/end to rounded, decisions to diamonds, documents to stencils", () => {
    const layout = layoutWithStickies();
    const scene = algorithmToMiro(layout);
    expect(scene.shapes.map((s) => s.key)).toEqual([
      "A-001",
      "A-002",
      "A-003",
      "A-004",
      "A-005",
      "A-006",
      "A-007",
    ]);
    expect(scene.shapes.map((s) => s.shape)).toEqual([
      "round",
      "rect",
      "rect",
      "diamond",
      "round",
      "rect",
      "document",
    ]);
    expect(scene.frames).toEqual([]);
  });

  it("recenters the drawing on the origin without moving nodes apart", () => {
    const layout = layoutWithStickies();
    const scene = algorithmToMiro(layout);
    const byKey = new Map(scene.shapes.map((s) => [s.key, s]));
    const dxScene = byKey.get("A-002")!.cx - byKey.get("A-001")!.cx;
    expect(dxScene).toBeCloseTo(layout.byId.get("A-002")!.cx - layout.byId.get("A-001")!.cx, 9);
    const bcx = layout.bounds.x + layout.bounds.width / 2;
    const bcy = layout.bounds.y + layout.bounds.height / 2;
    for (const shape of scene.shapes) {
      const node = layout.byId.get(shape.key)!;
      expect(shape.cx).toBeCloseTo(node.cx - bcx, 9);
      expect(shape.cy).toBeCloseTo(node.cy - bcy, 9);
    }
  });

  it("binds arrows to their nodes with 0..1 end points and keeps labels", () => {
    const scene = algorithmToMiro(layoutWithStickies());
    expect(scene.connectors).toHaveLength(7);
    for (const connector of scene.connectors) {
      for (const end of [connector.from, connector.to]) {
        expect(end.x).toBeGreaterThanOrEqual(0);
        expect(end.x).toBeLessThanOrEqual(1);
        expect(end.y).toBeGreaterThanOrEqual(0);
        expect(end.y).toBeLessThanOrEqual(1);
      }
    }
    const labels = new Map(scene.connectors.map((c) => [c.key, c.label]));
    expect(labels.get("A-004->A-005")).toBe("はい");
    expect(labels.get("A-004->A-003")).toBe("いいえ");
    expect(labels.get("A-001->A-002")).toBeUndefined();
    // The linkage survives encoding: each connector points at its shapes' ids.
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
    const scene = algorithmToMiro(layoutWithStickies());
    const io = scene.shapes.find((s) => s.key === "A-002")!;
    expect(io.text).toBe("名前を入力する");
    expect(io.border).toBe(hexToMiroRgb(COLOR_HEX.green));
    expect(scene.shapes.find((s) => s.key === "A-001")!.border).toBeNull();
  });

  it("puts visible stickies on the board with the app's paper colours", () => {
    const scene = algorithmToMiro(layoutWithStickies());
    expect(scene.stickers).toHaveLength(1);
    const [sticker] = scene.stickers;
    expect(sticker.key).toBe("S-001");
    expect(sticker.text).toBe("要確認");
    expect(sticker.background).toBe(hexToMiroRgb(STICKY_FILL_HEX.red));
    const layout = layoutWithStickies();
    const placed = layout.stickies[0];
    const centreX = layout.bounds.x + layout.bounds.width / 2;
    expect(sticker.cx).toBeCloseTo(placed.x + placed.width / 2 - centreX, 9);
  });

  it("lays out nothing as an empty scene", () => {
    const scene = algorithmToMiro(layoutAlgorithm({ nodes: [], edges: [] }));
    expect(scene).toEqual({ shapes: [], stickers: [], texts: [], frames: [], connectors: [] });
    expect(encodePayload(scene).data.objects).toEqual([]);
  });

  it("encodes documents as flowchart stencils", () => {
    const scene = algorithmToMiro(layoutWithStickies());
    const payload = encodePayload(scene);
    const stencils = payload.data.objects.filter((o) => o.widgetData.type === "stencil");
    expect(stencils).toHaveLength(1);
    const json = stencils[0].widgetData.json as {
      schema: { id: string; data: { texts: { name: { text: string } } } };
    };
    expect(json.schema.id).toBe("flowchart-document");
    expect(json.schema.data.texts.name.text).toBe(
      '<p><span style="color: rgb(26, 26, 26);">帳票</span></p>',
    );
  });

  it("falls back to a rectangle for figure shapes without a Miro id", () => {
    expect(algorithmShapeToMiro("start")).toBe("round");
    expect(algorithmShapeToMiro("end")).toBe("round");
    expect(algorithmShapeToMiro("decision")).toBe("diamond");
    expect(algorithmShapeToMiro("process")).toBe("rect");
    expect(algorithmShapeToMiro("io")).toBe("rect");
    expect(algorithmShapeToMiro("sub")).toBe("rect");
    expect(algorithmShapeToMiro("doc")).toBe("document");
    expect(algorithmShapeToMiro("parallelogram")).toBe("rect");
  });
});
