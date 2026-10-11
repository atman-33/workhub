import { describe, expect, it } from "vitest";
import { COLOR_HEX, STICKY_FILL_HEX } from "../../colors";
import { DEFAULT_CAPTIONS } from "../../ifdam/export";
import { layoutIfdam, type IfdamLayout } from "../../ifdam/layout";
import { parseIfdam } from "../../ifdam/parse";
import { hexToMiroRgb } from "../palette";
import { encodePayload } from "../encode";
import { ifdamShapeToMiro, ifdamToMiro, screenText } from "./ifdam";

/**
 * The IFDAM adapter on a real IFDAM sample model: screens become rectangles
 * listing their sections, triggers rectangles, processes wide circles, stores
 * cylinders and messages rounded figures; arrows are bound connectors with
 * labels, store links bidirectional; stickies become Miro stickies - all
 * recentered so the drawing's middle lands on the origin.
 */
const doc = parseIfdam(`---
type: ifdam
title: 予約登録
---

## Nodes

- V-001 予約一覧 ^screen #green
  show: 登録済みの予約の一覧
  input: 検索語
  action: 追加ボタン
  行のメモ
- V-002 追加ボタン ^trigger
- V-003 予約を登録する
- V-004 予約 ^store
- V-005 登録しました ^message

## Edges

- V-001 -> V-002
- V-002 -> V-003 "押す"
- V-003 -> V-004 "保存"
- V-003 -> V-005
- V-005 -> V-001

## Stickies

- S-001 node:V-003 @40,-20 #red 要確認
`);

function layoutWithStickies(): IfdamLayout {
  return layoutIfdam(doc, doc.stickies);
}

describe("ifdamToMiro", () => {
  it("maps screens and triggers to rectangles, processes to circles, stores to cylinders, messages to rounded", () => {
    const scene = ifdamToMiro(layoutWithStickies());
    expect(scene.shapes.map((s) => s.key)).toEqual(["V-001", "V-002", "V-003", "V-004", "V-005"]);
    expect(scene.shapes.map((s) => s.shape)).toEqual([
      "rect",
      "rect",
      "circle",
      "cylinder",
      "round",
    ]);
    expect(scene.frames).toEqual([]);
  });

  it("lists a screen's sections under their headings and grows the rectangle", () => {
    const scene = ifdamToMiro(layoutWithStickies());
    const screen = scene.shapes.find((s) => s.key === "V-001")!;
    expect(screen.text).toBe(
      ["予約一覧", "表示項目", "・登録済みの予約の一覧", "入力項目", "・検索語", "操作項目", "・追加ボタン"].join(
        "\n",
      ),
    );
    // The memo line stays out of the pasted text.
    expect(screen.text).not.toContain("行のメモ");
    const layout = layoutWithStickies();
    expect(screen.width).toBe(layout.byId.get("V-001")!.width);
    expect(screen.height).toBeGreaterThanOrEqual(layout.byId.get("V-001")!.height);
    // Other nodes keep their title alone.
    expect(scene.shapes.find((s) => s.key === "V-003")!.text).toBe("予約を登録する");
  });

  it("builds screen text from wrapped section lines without losing words", () => {
    expect(
      screenText(
        ["予約一覧"],
        [
          { key: "show", items: [{ lines: ["登録済みの予約の一覧"] }] },
          { key: "input", items: [{ lines: ["検索語"] }] },
        ],
        DEFAULT_CAPTIONS,
      ),
    ).toBe("予約一覧\n表示項目\n・登録済みの予約の一覧\n入力項目\n・検索語");
    expect(screenText(["空の画面"], [], DEFAULT_CAPTIONS)).toBe("空の画面");
  });

  it("binds arrows with 0..1 end points, keeps labels, and doubles store links", () => {
    const scene = ifdamToMiro(layoutWithStickies());
    expect(scene.connectors).toHaveLength(5);
    for (const connector of scene.connectors) {
      for (const end of [connector.from, connector.to]) {
        expect(end.x).toBeGreaterThanOrEqual(0);
        expect(end.x).toBeLessThanOrEqual(1);
        expect(end.y).toBeGreaterThanOrEqual(0);
        expect(end.y).toBeLessThanOrEqual(1);
      }
    }
    const byKey = new Map(scene.connectors.map((c) => [c.key, c]));
    expect(byKey.get("V-002->V-003")!.label).toBe("押す");
    expect(byKey.get("V-001->V-002")!.label).toBeUndefined();
    expect(byKey.get("V-001->V-002")!.arrowStart).toBeUndefined();
    // The store link reads and writes: heads on both ends.
    expect(byKey.get("V-003->V-004")!.arrowStart).toBe(true);
    expect(byKey.get("V-003->V-005")!.arrowStart).toBeUndefined();
    // The linkage survives encoding.
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
      const style = JSON.parse(json.style) as { a_start: number; a_end: number };
      expect(style.a_end).toBe(9);
      expect(style.a_start).toBe(scene.connectors[i].arrowStart ? 9 : 0);
    });
  });

  it("recenters the drawing on the origin without moving nodes apart", () => {
    const layout = layoutWithStickies();
    const scene = ifdamToMiro(layout);
    const bcx = layout.bounds.x + layout.bounds.width / 2;
    const bcy = layout.bounds.y + layout.bounds.height / 2;
    for (const shape of scene.shapes) {
      const node = layout.byId.get(shape.key)!;
      expect(shape.cx).toBeCloseTo(node.cx - bcx, 9);
      expect(shape.cy).toBeCloseTo(node.cy - bcy, 9);
    }
  });

  it("keeps titles verbatim and carries the colour on the border", () => {
    const scene = ifdamToMiro(layoutWithStickies());
    expect(scene.shapes.find((s) => s.key === "V-001")!.border).toBe(
      hexToMiroRgb(COLOR_HEX.green),
    );
    expect(scene.shapes.find((s) => s.key === "V-003")!.border).toBeNull();
  });

  it("puts visible stickies on the board with the app's paper colours", () => {
    const scene = ifdamToMiro(layoutWithStickies());
    expect(scene.stickers).toHaveLength(1);
    const [sticker] = scene.stickers;
    expect(sticker.key).toBe("S-001");
    expect(sticker.text).toBe("要確認");
    expect(sticker.background).toBe(hexToMiroRgb(STICKY_FILL_HEX.red));
  });

  it("lays out nothing as an empty scene", () => {
    const scene = ifdamToMiro(layoutIfdam({ nodes: [], edges: [] }));
    expect(scene).toEqual({ shapes: [], stickers: [], texts: [], frames: [], connectors: [] });
    expect(encodePayload(scene).data.objects).toEqual([]);
  });

  it("falls back to a rectangle for figure shapes without a Miro id", () => {
    expect(ifdamShapeToMiro("screen")).toBe("rect");
    expect(ifdamShapeToMiro("trigger")).toBe("rect");
    expect(ifdamShapeToMiro("process")).toBe("circle");
    expect(ifdamShapeToMiro("store")).toBe("cylinder");
    expect(ifdamShapeToMiro("message")).toBe("round");
    expect(ifdamShapeToMiro("hexagon")).toBe("rect");
  });
});
