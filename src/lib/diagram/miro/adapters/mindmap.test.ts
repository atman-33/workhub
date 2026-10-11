import { describe, expect, it } from "vitest";
import { COLOR_HEX, STICKY_FILL_HEX } from "../../colors";
import { layoutMindmap, type MindmapLayout } from "../../../mindmap/layout";
import { parseMindmap } from "../../../mindmap/parse";
import { hexToMiroRgb } from "../palette";
import { encodePayload } from "../encode";
import { mindmapShapeToMiro, mindmapToMiro } from "./mindmap";

/**
 * The mindmap adapter on a real parsed and laid-out sample map: every node
 * becomes a rounded rectangle at its layout spot, every branch a bound
 * connector with no arrowheads, and stickies become Miro stickies - all
 * recentered so the drawing's middle lands on the origin. Titles stay
 * verbatim while notes, `task:` links and attribute chips stay out.
 */
const doc = parseMindmap(`---
type: mindmap
title: リリース計画
created: 2026-10-01
updated: 2026-10-01
---

## Nodes

- N-001 リリース計画 #blue
  - N-002 機能A task:T-0100 priority:high
    機能Aの補足メモ
  - N-003 機能B ^right
    - N-004 詳細
    - N-005 隠れた子 ^collapsed
  - N-006 機能C ^left #green

## Stickies

- S-001 node:N-002 @40,-20 #red 要確認
`);

function layoutWithStickies(): MindmapLayout {
  return layoutMindmap(doc.roots, {
    nodeWidth: doc.nodeWidth,
    attrView: doc.attrView,
    showIds: doc.nodeIdsShown,
    stickies: doc.stickiesHidden ? [] : doc.stickies,
  });
}

describe("mindmapToMiro", () => {
  it("turns every laid-out node into a rounded rectangle at its layout spot", () => {
    const layout = layoutWithStickies();
    const scene = mindmapToMiro(layout);
    expect(scene.shapes.map((s) => s.key)).toEqual(layout.nodes.map((n) => n.id));
    expect(scene.shapes.map((s) => s.shape)).toEqual(layout.nodes.map(() => "round"));
    expect(mindmapShapeToMiro()).toBe("round");
    expect(scene.frames).toEqual([]);
    expect(scene.texts).toEqual([]);
  });

  it("recenters the drawing on the origin without moving nodes apart", () => {
    const layout = layoutWithStickies();
    const scene = mindmapToMiro(layout);
    const byKey = new Map(scene.shapes.map((s) => [s.key, s]));
    const first = layout.nodes[0];
    const second = layout.nodes[1];
    expect(byKey.get(second.id)!.cx - byKey.get(first.id)!.cx).toBeCloseTo(
      second.x + second.width / 2 - (first.x + first.width / 2),
      9,
    );
    const bcx = layout.bounds.x + layout.bounds.width / 2;
    const bcy = layout.bounds.y + layout.bounds.height / 2;
    for (const shape of scene.shapes) {
      const node = layout.byId.get(shape.key)!;
      expect(shape.cx).toBeCloseTo(node.x + node.width / 2 - bcx, 9);
      expect(shape.cy).toBeCloseTo(node.y + node.height / 2 - bcy, 9);
      expect(shape.width).toBeCloseTo(node.width, 9);
      expect(shape.height).toBeCloseTo(node.height, 9);
    }
  });

  it("binds every branch to its nodes with no arrowheads and no labels", () => {
    const layout = layoutWithStickies();
    const scene = mindmapToMiro(layout);
    expect(scene.connectors).toHaveLength(layout.edges.length);
    expect(layout.edges.length).toBeGreaterThan(0);
    for (const connector of scene.connectors) {
      expect(connector.arrowEnd).toBe(false);
      expect(connector.arrowStart).toBeUndefined();
      expect(connector.label).toBeUndefined();
      for (const end of [connector.from, connector.to]) {
        expect(end.x).toBeGreaterThanOrEqual(0);
        expect(end.x).toBeLessThanOrEqual(1);
        expect(end.y).toBeGreaterThanOrEqual(0);
        expect(end.y).toBeLessThanOrEqual(1);
      }
    }
    // A right branch leaves through the middles of the facing sides: the
    // parent's right middle and the child's left middle.
    const rightEdge = layout.edges.find((e) => layout.byId.get(e.to)!.side === "right")!;
    const rightConnector = scene.connectors.find((c) => c.key === `${rightEdge.from}->${rightEdge.to}`)!;
    expect(rightConnector.from).toMatchObject({ x: 1, y: 0.5 });
    expect(rightConnector.to).toMatchObject({ x: 0, y: 0.5 });
    // A left branch is mirrored.
    const leftEdge = layout.edges.find((e) => layout.byId.get(e.to)!.side === "left")!;
    const leftConnector = scene.connectors.find((c) => c.key === `${leftEdge.from}->${leftEdge.to}`)!;
    expect(leftConnector.from).toMatchObject({ x: 0, y: 0.5 });
    expect(leftConnector.to).toMatchObject({ x: 1, y: 0.5 });
    // The linkage survives encoding: bound on both ends, `lt: 1`, no heads.
    const payload = encodePayload(scene);
    const shapeId = new Map(scene.shapes.map((s, i) => [s.key, i]));
    const lines = payload.data.objects.filter((o) => o.widgetData.type === "line");
    expect(lines).toHaveLength(scene.connectors.length);
    lines.forEach((line, i) => {
      const json = line.widgetData.json as {
        primary: { widgetIndex: number };
        secondary: { widgetIndex: number };
        style: string;
        line: { captions: unknown[] };
      };
      expect(json.primary.widgetIndex).toBe(shapeId.get(scene.connectors[i].from.key));
      expect(json.secondary.widgetIndex).toBe(shapeId.get(scene.connectors[i].to.key));
      const style = JSON.parse(json.style) as { lt: number; a_start: number; a_end: number };
      expect(style.lt).toBe(1);
      expect(style.a_start).toBe(0);
      expect(style.a_end).toBe(0);
      expect(json.line.captions).toEqual([]);
    });
  });

  it("keeps titles verbatim and leaves notes, tasks, chips and colours-as-text out", () => {
    const scene = mindmapToMiro(layoutWithStickies());
    const feature = scene.shapes.find((s) => s.key === "N-002")!;
    expect(feature.text).toBe("機能A");
    expect(feature.text).not.toContain("T-0100");
    expect(feature.text).not.toContain("priority");
    expect(feature.text).not.toContain("補足メモ");
    // The node's own colour rides on the border, as on the canvas.
    expect(scene.shapes.find((s) => s.key === "N-001")!.border).toBe(
      hexToMiroRgb(COLOR_HEX.blue),
    );
    expect(scene.shapes.find((s) => s.key === "N-006")!.border).toBe(
      hexToMiroRgb(COLOR_HEX.green),
    );
    expect(scene.shapes.find((s) => s.key === "N-004")!.border).toBeNull();
  });

  it("puts visible stickies on the board with the app's paper colours", () => {
    const scene = mindmapToMiro(layoutWithStickies());
    expect(scene.stickers).toHaveLength(1);
    const [sticker] = scene.stickers;
    expect(sticker.key).toBe("S-001");
    expect(sticker.text).toBe("要確認");
    expect(sticker.background).toBe(hexToMiroRgb(STICKY_FILL_HEX.red));
    const layout = layoutWithStickies();
    const placed = layout.stickies[0];
    const centreX = layout.bounds.x + layout.bounds.width / 2;
    const centreY = layout.bounds.y + layout.bounds.height / 2;
    expect(sticker.cx).toBeCloseTo(placed.x + placed.width / 2 - centreX, 9);
    expect(sticker.cy).toBeCloseTo(placed.y + placed.height / 2 - centreY, 9);
  });

  it("lays out nothing as an empty scene", () => {
    const scene = mindmapToMiro(layoutMindmap([]));
    expect(scene).toEqual({ shapes: [], stickers: [], texts: [], frames: [], connectors: [] });
    expect(encodePayload(scene).data.objects).toEqual([]);
  });
});
