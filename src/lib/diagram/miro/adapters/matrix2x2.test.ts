import { describe, expect, it } from "vitest";
import { STICKY_FILL_HEX } from "../../colors";
import { layoutMatrix, type MatrixLayout } from "../../matrix2x2/layout";
import { parseMatrix } from "../../matrix2x2/parse";
import { hexToMiroRgb } from "../palette";
import { encodePayload } from "../encode";
import { matrixItemToMiro, matrixToMiro } from "./matrix2x2";

/**
 * The matrix adapter on a real 2x2 matrix sample model: the cross becomes
 * two free-floating lines with no arrowheads, axis labels and quadrant names
 * become Miro texts, coloured items become stickers and plain ones
 * rectangles, and stickies stay Miro stickies - all recentered so the
 * drawing's middle lands on the origin.
 */
const doc = parseMatrix(`---
type: matrix2x2
title: 優先度マトリクス
x_axis: 工数
x_low: 少ない
x_high: 多い
y_axis: 効果
y_low: 小さい
y_high: 大きい
q_tl: やる
q_tr: まずやる
q_bl: やらない
q_br: 後でやる
---

## Items

- M-001 タブの並び替え @0.20,0.85 #green task:T-0684
  補足メモ
- M-002 色なしアイテム @0.80,0.20
- M-003 真ん中

## Quadrants

- q_tl 前向きのメモ

## Stickies

- S-001 node:M-001 @40,-20 #red 要確認
`);

function layoutWithStickies(): MatrixLayout {
  return layoutMatrix(doc, doc.stickiesHidden ? [] : doc.stickies);
}

describe("matrixToMiro", () => {
  it("turns the cross into two free-floating lines with no arrowheads", () => {
    const layout = layoutWithStickies();
    const scene = matrixToMiro(layout);
    expect(layout.cross).toHaveLength(2);
    expect(scene.freeLines).toHaveLength(2);
    expect(scene.freeLines!.map((l) => l.key)).toEqual(["axis:0", "axis:1"]);
    expect(scene.connectors).toEqual([]);
    // The lines follow the layout's own geometry, shifted with everything else.
    const centreX = layout.bounds.x + layout.bounds.width / 2;
    const centreY = layout.bounds.y + layout.bounds.height / 2;
    scene.freeLines!.forEach((line, i) => {
      const cross = layout.cross[i];
      expect(line.x1).toBeCloseTo(cross.x1 - centreX, 9);
      expect(line.y1).toBeCloseTo(cross.y1 - centreY, 9);
      expect(line.x2).toBeCloseTo(cross.x2 - centreX, 9);
      expect(line.y2).toBeCloseTo(cross.y2 - centreY, 9);
    });
    // The encoding is a free line: both ends unbound, `lt: 0`, no heads.
    const payload = encodePayload(scene);
    const lines = payload.data.objects.filter((o) => o.widgetData.type === "line");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const json = line.widgetData.json as {
        primary: { point: { x: number; y: number }; widgetIndex: number };
        secondary: { point: { x: number; y: number }; widgetIndex: number };
        style: string;
        line: { captions: unknown[] };
      };
      expect(json.primary.widgetIndex).toBe(-1);
      expect(json.secondary.widgetIndex).toBe(-1);
      expect(JSON.parse(json.style)).toMatchObject({ lt: 0, a_start: 0, a_end: 0, t: 2 });
      expect(json.line.captions).toEqual([]);
    }
  });

  it("puts axis labels and quadrant names on the board as texts", () => {
    const layout = layoutWithStickies();
    const scene = matrixToMiro(layout);
    // Six axis texts (every label is filled in) plus four quadrant names.
    expect(scene.texts.map((t) => t.key).sort()).toEqual(
      [
        "axis-text:x_axis",
        "axis-text:x_high",
        "axis-text:x_low",
        "axis-text:y_axis",
        "axis-text:y_high",
        "axis-text:y_low",
        "quadrant:bl",
        "quadrant:br",
        "quadrant:tl",
        "quadrant:tr",
      ].sort(),
    );
    const byKey = new Map(scene.texts.map((t) => [t.key, t]));
    expect(byKey.get("axis-text:x_low")!.text).toBe("少ない");
    expect(byKey.get("quadrant:tr")!.text).toBe("まずやる");
    for (const text of scene.texts) {
      expect(text.width).toBeGreaterThan(0);
      expect(text.height).toBeGreaterThan(0);
    }
    // The texts ride the same recentering as everything else.
    const centreX = layout.bounds.x + layout.bounds.width / 2;
    const laid = layout.axisTexts.find((a) => a.id === "x_high")!;
    const text = byKey.get("axis-text:x_high")!;
    // A start-anchored label's centre sits half its width past its anchor.
    expect(text.cx).toBeGreaterThan(laid.x - centreX);
    expect(byKey.get("quadrant:tl")!.text).toBe("やる");
  });

  it("makes coloured items stickers and plain items rectangles, without memo or task", () => {
    expect(matrixItemToMiro("green")).toBe("sticker");
    expect(matrixItemToMiro(undefined)).toBe("rect");
    const scene = matrixToMiro(layoutWithStickies());
    expect(scene.stickers.map((s) => s.key)).toContain("M-001");
    expect(scene.shapes.map((s) => s.key).sort()).toEqual(["M-002", "M-003"]);
    expect(scene.shapes.map((s) => s.shape)).toEqual(["rect", "rect"]);
    const coloured = scene.stickers.find((s) => s.key === "M-001")!;
    expect(coloured.text).toBe("タブの並び替え");
    expect(coloured.background).toBe(hexToMiroRgb(STICKY_FILL_HEX.green));
    // The memo line, the `task:` link and the colour word stay out of the text.
    const plain = scene.shapes.find((s) => s.key === "M-002")!;
    expect(plain.text).toBe("色なしアイテム");
    expect(plain.border).toBeNull();
    expect(scene.frames).toEqual([]);
  });

  it("leaves quadrant notes out of the scene", () => {
    const scene = matrixToMiro(layoutWithStickies());
    const plain = scene.stickers
      .map((s) => s.text)
      .concat(scene.shapes.map((s) => s.text), scene.texts.map((t) => t.text))
      .join("\n");
    expect(plain).not.toContain("前向きのメモ");
    expect(plain).not.toContain("task:");
  });

  it("puts visible stickies on the board with the app's paper colours", () => {
    const scene = matrixToMiro(layoutWithStickies());
    const sticky = scene.stickers.find((s) => s.key === "S-001")!;
    expect(sticky.text).toBe("要確認");
    expect(sticky.background).toBe(hexToMiroRgb(STICKY_FILL_HEX.red));
    // The sticker centre is its layout centre, shifted with everything else.
    const layout = layoutWithStickies();
    const placed = layout.stickies[0];
    const centreX = layout.bounds.x + layout.bounds.width / 2;
    const centreY = layout.bounds.y + layout.bounds.height / 2;
    expect(sticky.cx).toBeCloseTo(placed.x + placed.width / 2 - centreX, 9);
    expect(sticky.cy).toBeCloseTo(placed.y + placed.height / 2 - centreY, 9);
  });

  it("recenters the drawing on the origin without moving items apart", () => {
    const layout = layoutWithStickies();
    const scene = matrixToMiro(layout);
    const centres = new Map<string, { cx: number; cy: number }>();
    for (const s of scene.shapes) centres.set(s.key, s);
    for (const s of scene.stickers) {
      if (!centres.has(s.key)) centres.set(s.key, s);
    }
    const dxScene = centres.get("M-002")!.cx - centres.get("M-003")!.cx;
    const laidDx =
      layout.byId.get("M-002")!.x +
      layout.byId.get("M-002")!.width / 2 -
      (layout.byId.get("M-003")!.x + layout.byId.get("M-003")!.width / 2);
    expect(dxScene).toBeCloseTo(laidDx, 9);
  });

  it("keeps the axes of an empty matrix and drops everything else", () => {
    const empty = parseMatrix(`---\ntype: matrix2x2\ntitle: 空\n---\n\n## Items\n`);
    const scene = matrixToMiro(layoutMatrix(empty, []));
    // Even an empty matrix shows its grid on the canvas, so the axes paste.
    expect(scene.freeLines).toHaveLength(2);
    expect(scene.shapes).toEqual([]);
    expect(scene.stickers).toEqual([]);
    expect(scene.texts).toEqual([]);
    expect(scene.frames).toEqual([]);
    expect(scene.connectors).toEqual([]);
  });
});
