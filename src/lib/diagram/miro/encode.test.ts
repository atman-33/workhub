import { describe, expect, it } from "vitest";
import { decodeMiroData } from "./decode";
import {
  buildPlainText,
  encodeMiroData,
  encodePayload,
  escapeMiroAttr,
  escapeMiroText,
  miroText,
  toMiroHtml,
} from "./encode";
import { emptyScene, type MiroScene } from "./model";
import connectorLabel from "./fixtures/connector-label.json";
import frameWithRect from "./fixtures/frame-with-rect.json";
import rectText from "./fixtures/rect-text.json";
import shapeRounded from "./fixtures/shape-rounded.json";
import stickyText from "./fixtures/sticky-text.json";
import textOnly from "./fixtures/text-only.json";

function sceneWithRect(): MiroScene {
  const scene = emptyScene();
  scene.shapes.push({
    kind: "shape",
    key: "P-001",
    shape: "rect",
    cx: 0,
    cy: 0,
    width: 240,
    height: 120,
    text: "テスト",
    border: null,
    fontSize: 13,
  });
  return scene;
}

describe("miro encode golden output", () => {
  it("produces the golden payload for a single rectangle", () => {
    const payload = encodePayload(sceneWithRect());
    expect(payload.isProtected).toBe(false);
    expect(payload.boardId).toBe("");
    expect(payload.version).toBe(2);
    expect(payload.host).toBe("miro.com");
    expect(payload.asPortalAmount).toBe(0);
    expect(payload.copierType).toBe("COPY");
    expect(payload.data.meta).toEqual({});
    expect(payload.data.objects).toHaveLength(1);
    const [object] = payload.data.objects;
    expect(object.type).toBe(14);
    expect(object.id).toBe(0);
    expect(object.initialId).toBe("6100000000000000000");
    expect(object.meta).toEqual({});
    expect(object.widgetData.type).toBe("shape");
    const json = object.widgetData.json as Record<string, unknown>;
    expect(json._position).toEqual({ offsetPx: { x: 0, y: 0 }, schema: "canvasOffsetPx" });
    expect(json.size).toEqual({ width: 240, height: 120 });
    expect(json._parent).toBeNull();
    expect(json.text).toBe("<p>テスト</p>");
    expect(json.shape).toBe("3");
    expect(JSON.parse(json.style as string)).toEqual({
      st: 3,
      ss: 2,
      sc: 1710618,
      bc: -1,
      bo: 1,
      brc: 1710618,
      brw: 2,
      bro: 1,
      brs: 2,
      ffn: "Noto Sans",
      tc: 1710618,
      tsc: 1,
      ta: "c",
      tav: "m",
      fs: 13,
      b: 0,
      i: 0,
      u: 0,
      s: 0,
      bsc: 1,
      VER: 2.1,
      hl: 0,
      brr: 0,
    });
  });

  it("round-trips every scene shape through base64", () => {
    const scene = sceneWithRect();
    scene.shapes.push({
      kind: "shape",
      key: "D-001",
      shape: "diamond",
      cx: 300,
      cy: -40,
      width: 160,
      height: 100,
      text: "a & b",
      border: 0x3b82f6,
      fontSize: 13,
    });
    scene.stickers.push({
      kind: "sticker",
      key: "S-001",
      cx: 10,
      cy: 20,
      text: "メモ",
      background: 16774103,
    });
    scene.connectors.push({
      kind: "connector",
      key: "P-001->D-001",
      from: { key: "P-001", x: 1, y: 0.5 },
      to: { key: "D-001", x: 0, y: 0.5 },
      label: "はい",
    });
    const payload = encodePayload(scene);
    expect(decodeMiroData(encodeMiroData(payload))).toEqual(payload);
  });

  it("orders frames first, children after, with sequential ids", () => {
    const scene = emptyScene();
    scene.connectors.push({
      kind: "connector",
      key: "a->b",
      from: { key: "a", x: 1, y: 0.5 },
      to: { key: "b", x: 0, y: 0.5 },
    });
    scene.shapes.push(
      {
        kind: "shape",
        key: "a",
        shape: "rect",
        cx: 0,
        cy: 0,
        width: 10,
        height: 10,
        text: "",
        border: null,
        fontSize: 13,
      },
      {
        kind: "shape",
        key: "b",
        shape: "rect",
        cx: 50,
        cy: 0,
        width: 10,
        height: 10,
        text: "",
        border: null,
        fontSize: 13,
      },
    );
    scene.frames.push({ kind: "frame", key: "f", cx: 25, cy: 0, width: 200, height: 100, title: "g" });
    const payload = encodePayload(scene);
    expect(payload.data.objects.map((o) => o.widgetData.type)).toEqual([
      "frame",
      "shape",
      "shape",
      "line",
    ]);
    expect(payload.data.objects.map((o) => o.id)).toEqual([0, 1, 2, 3]);
    expect(payload.data.objects.map((o) => o.initialId)).toEqual([
      "6100000000000000000",
      "6100000000000000001",
      "6100000000000000002",
      "6100000000000000003",
    ]);
    const line = payload.data.objects[3].widgetData.json as {
      primary: { widgetIndex: number };
      secondary: { widgetIndex: number };
    };
    expect(line.primary.widgetIndex).toBe(1);
    expect(line.secondary.widgetIndex).toBe(2);
  });

  it("falls back to a rectangle for unknown figure shapes", () => {
    const scene = sceneWithRect();
    scene.shapes[0].shape = "document" as MiroScene["shapes"][number]["shape"];
    const payload = encodePayload(scene);
    const json = payload.data.objects[0].widgetData.json as Record<string, unknown>;
    // "document" is no Miro kind: the encoder writes a rectangle id.
    expect(json.shape).toBe("3");
    expect((JSON.parse(json.style as string) as { st: number }).st).toBe(3);
  });

  it("writes connector labels as captions with an arrow head", () => {
    const scene = sceneWithRect();
    scene.shapes.push({
      kind: "shape",
      key: "D-001",
      shape: "rect",
      cx: 400,
      cy: 0,
      width: 100,
      height: 50,
      text: "",
      border: null,
      fontSize: 13,
    });
    scene.connectors.push({
      kind: "connector",
      key: "P-001->D-001",
      from: { key: "P-001", x: 1, y: 0.5 },
      to: { key: "D-001", x: 0, y: 0.5 },
      label: "はい",
    });
    const json = encodePayload(scene).data.objects[2].widgetData.json as Record<string, unknown>;
    const style = JSON.parse(json.style as string) as Record<string, unknown>;
    expect(style).toMatchObject({ t: 2, lt: 1, a_start: 0, a_end: 9 });
    expect(json.line).toEqual({
      captions: [
        {
          id: "P-001->D-001:00001",
          text: "<p>はい</p>",
          fontSize: 14,
          width: 29,
          position: { x: 0.5, y: 0.5 },
          rotated: false,
          color: 3355443,
        },
      ],
    });
  });

  it("drops a connector whose end names nothing in the payload", () => {
    const scene = sceneWithRect();
    scene.connectors.push({
      kind: "connector",
      key: "P-001->ghost",
      from: { key: "P-001", x: 1, y: 0.5 },
      to: { key: "ghost", x: 0, y: 0.5 },
    });
    expect(encodePayload(scene).data.objects).toHaveLength(1);
  });

  it("escapes text and attribute values", () => {
    expect(miroText("")).toBe("");
    expect(miroText("a & <b>\nline")).toBe("<p>a &amp; &lt;b&gt;<br/>line</p>");
    expect(escapeMiroText(`a"b`)).toBe(`a"b`);
    expect(escapeMiroAttr(`<--"a&b"-->`)).toBe("&lt;--&quot;a&amp;b&quot;--&gt;");
  });

  it("wraps the payload as clipboard html with plain text", () => {
    const scene = sceneWithRect();
    const plain = buildPlainText(scene);
    expect(plain).toBe("テスト");
    const html = toMiroHtml(encodePayload(scene), plain);
    expect(html.startsWith('<meta charset="utf-8"><span data-meta="')).toBe(true);
    expect(html).toContain("&lt;--(miro-data-v1)");
    expect(html.endsWith("<div><div><div>テスト</div></div></div>")).toBe(true);
    // No plain text, no divs.
    expect(toMiroHtml(encodePayload(emptyScene()), "").endsWith("</span>")).toBe(true);
  });

  it("joins every visible text for text/plain", () => {
    const scene = emptyScene();
    scene.frames.push({ kind: "frame", key: "f", cx: 0, cy: 0, width: 1, height: 1, title: "g" });
    scene.shapes.push({
      kind: "shape",
      key: "a",
      shape: "rect",
      cx: 0,
      cy: 0,
      width: 1,
      height: 1,
      text: "A",
      border: null,
      fontSize: 13,
    });
    scene.stickers.push({ kind: "sticker", key: "s", cx: 0, cy: 0, text: "note", background: 1 });
    expect(buildPlainText(scene)).toBe("g\nA\nnote");
    expect(buildPlainText(emptyScene())).toBe("");
  });
});

describe("miro encode against the real samples", () => {
  const sortedKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortedKeys);
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort()
        .map((k) => [k, sortedKeys((value as Record<string, unknown>)[k])]);
    }
    return typeof value;
  };

  it("uses the same field shapes as the samples", () => {
    const scene = emptyScene();
    scene.frames.push({ kind: "frame", key: "f", cx: 0, cy: 0, width: 800, height: 400, title: "g" });
    scene.shapes.push({
      kind: "shape",
      key: "a",
      shape: "round",
      cx: 0,
      cy: 0,
      width: 200,
      height: 100,
      text: "test",
      border: null,
      fontSize: 24,
    });
    scene.shapes.push({
      kind: "shape",
      key: "b",
      shape: "rect",
      cx: 300,
      cy: 0,
      width: 200,
      height: 100,
      text: "test",
      border: null,
      fontSize: 24,
    });
    scene.stickers.push({ kind: "sticker", key: "s", cx: 900, cy: 100, text: "note", background: 16775070 });
    scene.texts.push({ kind: "text", key: "t", cx: 0, cy: 0, width: 26, height: 20, text: "text" });
    scene.connectors.push({
      kind: "connector",
      key: "a->b",
      from: { key: "a", x: 1, y: 0.5 },
      to: { key: "b", x: 0, y: 0.5 },
      label: "はい",
    });
    const objects = encodePayload(scene).data.objects;
    const byType = (type: string) => objects.find((o) => o.widgetData.type === type)!.widgetData.json;
    const fixtureObjects = (fixture: { data: { objects: { widgetData: { json: unknown; type: string } }[] } }) =>
      fixture.data.objects;
    const fixtureByType = (
      fixture: { data: { objects: { widgetData: { json: unknown; type: string } }[] } },
      type: string,
    ) => fixtureObjects(fixture).find((o) => o.widgetData.type === type)!.widgetData.json;

    // The envelope and every widget carry the same fields as what Miro wrote.
    expect(Object.keys(encodePayload(scene)).sort()).toEqual(Object.keys(rectText).sort());
    expect(sortedKeys(objects[0])).toEqual(sortedKeys(fixtureObjects(frameWithRect)[0]));
    expect(sortedKeys(byType("shape"))).toEqual(sortedKeys(fixtureByType(rectText, "shape")));
    expect(sortedKeys(byType("sticker"))).toEqual(sortedKeys(fixtureByType(stickyText, "sticker")));
    expect(sortedKeys(byType("text"))).toEqual(sortedKeys(fixtureByType(textOnly, "text")));
    expect(sortedKeys(byType("frame"))).toEqual(sortedKeys(fixtureByType(frameWithRect, "frame")));
    expect(sortedKeys(byType("line"))).toEqual(sortedKeys(fixtureByType(connectorLabel, "line")));
    // Style blobs are doubly-encoded JSON with the same keys Miro writes.
    const styleKeys = (json: unknown) =>
      Object.keys(JSON.parse((json as { style: string }).style as string)).sort();
    expect(styleKeys(byType("shape"))).toEqual(styleKeys(fixtureByType(shapeRounded, "shape")));
    expect(styleKeys(byType("sticker"))).toEqual(styleKeys(fixtureByType(stickyText, "sticker")));
    expect(styleKeys(byType("text"))).toEqual(styleKeys(fixtureByType(textOnly, "text")));
    expect(styleKeys(byType("frame"))).toEqual(styleKeys(fixtureByType(frameWithRect, "frame")));
    expect(styleKeys(byType("line"))).toEqual(styleKeys(fixtureByType(connectorLabel, "line")));
    // Spot values Miro must see: figure ids, sticker size, frame type, caption text.
    expect((byType("shape") as { shape: string }).shape).toBe("7");
    expect((byType("sticker") as { size: { width: number; height: number } }).size).toEqual({
      width: 199,
      height: 228,
    });
    expect((byType("frame") as { type: number }).type).toBe(12);
    expect(
      ((byType("line") as { line: { captions: { text: string }[] } }).line.captions[0] ?? {}).text,
    ).toBe("<p>はい</p>");
  });
});
