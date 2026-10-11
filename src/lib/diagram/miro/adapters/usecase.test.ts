import { describe, expect, it } from "vitest";
import { COLOR_HEX, STICKY_FILL_HEX } from "../../colors";
import { layoutUsecase, type UsecaseLayout } from "../../usecase/layout";
import { parseUsecase } from "../../usecase/parse";
import { hexToMiroRgb } from "../palette";
import { encodePayload } from "../encode";
import { personText, SYSTEM_BORDER_WIDTH, usecaseShapeToMiro, usecaseToMiro } from "./usecase";

/**
 * The use case adapter on a real use case sample model: every element becomes
 * a rectangle (the system with a thick outline), a person's actions are
 * listed in that person's rectangle text, lines are bound connectors whose
 * heads follow `--` / `->`, stickies become Miro stickies - all recentered so
 * the drawing's middle lands on the origin.
 */
const doc = parseUsecase(`---
type: usecase
title: 予約の利用
---

## Nodes

- U-001 予約者 #green
  空きを探す
  予約を入れる
- U-002 予約システム ^system
- U-003 決済サービス ^ext

## Edges

- U-001 -- U-002 "利用する"
- U-001 -> U-003
- U-002 -> U-003

## Stickies

- S-001 node:U-002 @40,-20 #red 要確認
`);

function layoutWithStickies(): UsecaseLayout {
  return layoutUsecase(doc, doc.stickies);
}

describe("usecaseToMiro", () => {
  it("maps every element to a rectangle, the system with a thick outline", () => {
    const scene = usecaseToMiro(layoutWithStickies());
    expect(scene.shapes.map((s) => s.key)).toEqual(["U-001", "U-002", "U-003"]);
    expect(scene.shapes.map((s) => s.shape)).toEqual(["rect", "rect", "rect"]);
    const system = scene.shapes.find((s) => s.key === "U-002")!;
    expect(system.borderWidth).toBe(SYSTEM_BORDER_WIDTH);
    expect(system.borderWidth).toBeGreaterThan(2);
    expect(scene.shapes.find((s) => s.key === "U-001")!.borderWidth).toBeUndefined();
    expect(scene.frames).toEqual([]);
    expect(scene.texts).toEqual([]);
  });

  it("lists a person's actions in that person's rectangle text", () => {
    const scene = usecaseToMiro(layoutWithStickies());
    const person = scene.shapes.find((s) => s.key === "U-001")!;
    expect(person.text).toBe("予約者\n・空きを探す\n・予約を入れる");
    // The rectangle grows past the layout box, which holds the name only.
    const layout = layoutWithStickies();
    expect(person.height).toBeGreaterThan(layout.byId.get("U-001")!.height);
    expect(person.width).toBe(layout.byId.get("U-001")!.width);
    // Systems and services keep their title alone.
    expect(scene.shapes.find((s) => s.key === "U-002")!.text).toBe("予約システム");
    expect(scene.shapes.find((s) => s.key === "U-003")!.text).toBe("決済サービス");
  });

  it("builds person text from wrapped bubble lines without losing words", () => {
    expect(personText(["予約者"], [["空きを探す"], ["予約を入れる"]])).toBe(
      "予約者\n・空きを探す\n・予約を入れる",
    );
    expect(personText(["予約者"], [])).toBe("予約者");
  });

  it("draws the head only for `->` and keeps labels on both kinds", () => {
    const scene = usecaseToMiro(layoutWithStickies());
    expect(scene.connectors).toHaveLength(3);
    const byKey = new Map(scene.connectors.map((c) => [c.key, c]));
    expect(byKey.get("U-001->U-002")!.arrowEnd).toBe(false);
    expect(byKey.get("U-001->U-002")!.label).toBe("利用する");
    expect(byKey.get("U-001->U-003")!.arrowEnd).toBe(true);
    expect(byKey.get("U-002->U-003")!.arrowEnd).toBe(true);
    for (const connector of scene.connectors) {
      for (const end of [connector.from, connector.to]) {
        expect(end.x).toBeGreaterThanOrEqual(0);
        expect(end.x).toBeLessThanOrEqual(1);
        expect(end.y).toBeGreaterThanOrEqual(0);
        expect(end.y).toBeLessThanOrEqual(1);
      }
    }
    // The linkage survives encoding: each connector points at its shapes' ids,
    // and only the `->` lines carry heads.
    const payload = encodePayload(scene);
    const shapeId = new Map(scene.shapes.map((s, i) => [s.key, i]));
    const lines = payload.data.objects.filter((o) => o.widgetData.type === "line");
    expect(lines).toHaveLength(scene.connectors.length);
    lines.forEach((line, i) => {
      const json = line.widgetData.json as {
        primary: { widgetIndex: number };
        secondary: { widgetIndex: number };
        style: string;
      };
      expect(json.primary.widgetIndex).toBe(shapeId.get(scene.connectors[i].from.key));
      expect(json.secondary.widgetIndex).toBe(shapeId.get(scene.connectors[i].to.key));
      const style = JSON.parse(json.style) as { a_end: number };
      expect(style.a_end).toBe(scene.connectors[i].arrowEnd === false ? 0 : 9);
    });
  });

  it("recenters the drawing on the origin without moving nodes apart", () => {
    const layout = layoutWithStickies();
    const scene = usecaseToMiro(layout);
    const bcx = layout.bounds.x + layout.bounds.width / 2;
    const bcy = layout.bounds.y + layout.bounds.height / 2;
    for (const shape of scene.shapes) {
      const node = layout.byId.get(shape.key)!;
      expect(shape.cx).toBeCloseTo(node.cx - bcx, 9);
      expect(shape.cy).toBeCloseTo(node.cy - bcy, 9);
    }
  });

  it("keeps titles verbatim and leaves colour words out of the text", () => {
    const scene = usecaseToMiro(layoutWithStickies());
    const person = scene.shapes.find((s) => s.key === "U-001")!;
    expect(person.border).toBe(hexToMiroRgb(COLOR_HEX.green));
    expect(scene.shapes.find((s) => s.key === "U-002")!.border).toBeNull();
  });

  it("puts visible stickies on the board with the app's paper colours", () => {
    const scene = usecaseToMiro(layoutWithStickies());
    expect(scene.stickers).toHaveLength(1);
    const [sticker] = scene.stickers;
    expect(sticker.key).toBe("S-001");
    expect(sticker.text).toBe("要確認");
    expect(sticker.background).toBe(hexToMiroRgb(STICKY_FILL_HEX.red));
  });

  it("lays out nothing as an empty scene", () => {
    const scene = usecaseToMiro(layoutUsecase({ nodes: [], edges: [] }));
    expect(scene).toEqual({ shapes: [], stickers: [], texts: [], frames: [], connectors: [] });
    expect(encodePayload(scene).data.objects).toEqual([]);
  });

  it("falls back to a rectangle for figure shapes without a Miro id", () => {
    expect(usecaseShapeToMiro("person")).toBe("rect");
    expect(usecaseShapeToMiro("system")).toBe("rect");
    expect(usecaseShapeToMiro("ext")).toBe("rect");
    expect(usecaseShapeToMiro("rounded")).toBe("rect");
  });
});
