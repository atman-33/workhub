/**
 * `MiroScene` to the `miro-data-v1` clipboard format (T-0720).
 *
 * This is the only module that knows the format: JSON to UTF-8 bytes, each
 * byte minus 197 (mod 256), base64, wrapped in a `data-meta` span as
 * `text/html`. The shapes below mirror the hand-built payloads that pasted
 * into a real Miro board; anything Miro never showed us (frames aside) is
 * left at the values those payloads used.
 */
import {
  MIRO_SHAPE_IDS,
  resolveMiroShape,
  type MiroConnector,
  type MiroFrameNode,
  type MiroScene,
  type MiroShapeNode,
  type MiroSticker,
  type MiroTextNode,
} from "./model";

/** Dark ink of figure borders and text in the verified payloads (`0x1A1A1A`). */
export const MIRO_INK = 1710618;
/** Connector and caption ink in the verified payloads (`0x333333`). */
export const MIRO_LINE = 3355443;
/** Corner radius of a rounded figure, as in the verified test page. */
export const MIRO_ROUND_RADIUS = 40;
/** Caption font size of a connector label, as in the verified test page. */
export const MIRO_CAPTION_FONT_SIZE = 14;

/** Base of the generated widget ids. Miro does not validate them; a fixed
 * base keeps the output deterministic so golden tests hold. */
const INITIAL_ID_BASE = 6100000000000000000n;

function initialId(id: number): string {
  return (INITIAL_ID_BASE + BigInt(id)).toString();
}

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

/** Escapes user text for the `<p>` bodies Miro reads. */
export function escapeMiroText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A body string to Miro's paragraph HTML. Empty stays empty (Miro writes
 * `""` for textless figures); line breaks become `<br/>`, which is a guess -
 * no sample showed a multi-line body.
 */
export function miroText(text: string): string {
  if (!text) return "";
  return `<p>${escapeMiroText(text).replace(/\r\n|\r|\n/g, "<br/>")}</p>`;
}

/** Escapes a string for the `data-meta` attribute value. */
export function escapeMiroAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// payload
// ---------------------------------------------------------------------------

/** The outer envelope, as Miro writes it. `boardId` stays empty and each
 * object carries an empty `meta`: board and org ids are not validated (the
 * owner pasted such a payload), and the app has no real ids to put there. */
export interface MiroPayload {
  isProtected: false;
  boardId: "";
  data: { objects: MiroObject[]; meta: Record<string, never> };
  version: 2;
  host: "miro.com";
  asPortalAmount: 0;
  copierType: "COPY";
}

export interface MiroObject {
  widgetData: { json: Record<string, unknown>; type: string };
  type: 14;
  id: number;
  initialId: string;
  meta: Record<string, never>;
}

function shapeStyle(node: MiroShapeNode): string {
  const id = MIRO_SHAPE_IDS[resolveMiroShape(node.shape)];
  const style: Record<string, unknown> = {
    st: Number(id),
    ss: 2,
    sc: MIRO_INK,
    bc: -1,
    bo: 1,
    brc: node.border ?? MIRO_INK,
    brw: 2,
    bro: 1,
    brs: 2,
    ffn: "Noto Sans",
    tc: MIRO_INK,
    tsc: 1,
    ta: "c",
    tav: "m",
    fs: node.fontSize,
    b: 0,
    i: 0,
    u: 0,
    s: 0,
    bsc: 1,
    VER: 2.1,
    hl: 0,
    // Miro always writes the corner radius (0 for square figures).
    brr: resolveMiroShape(node.shape) === "round" ? MIRO_ROUND_RADIUS : 0,
  };
  return JSON.stringify(style);
}

function encodeShape(node: MiroShapeNode): Record<string, unknown> {
  const id = MIRO_SHAPE_IDS[resolveMiroShape(node.shape)];
  return {
    _position: { offsetPx: { x: node.cx, y: node.cy }, schema: "canvasOffsetPx" },
    scale: { scale: 1 },
    relativeScale: 1,
    rotation: { rotation: 0 },
    relativeRotation: 0,
    size: { width: node.width, height: node.height },
    _parent: null,
    text: miroText(node.text),
    style: shapeStyle(node),
    shape: id,
  };
}

function encodeSticker(sticker: MiroSticker): Record<string, unknown> {
  return {
    _position: { offsetPx: { x: sticker.cx, y: sticker.cy }, schema: "canvasOffsetPx" },
    scale: { scale: 0.54 },
    relativeScale: 0.54,
    rotation: { rotation: 0 },
    relativeRotation: 0,
    size: { width: 199, height: 228 },
    _parent: null,
    text: miroText(sticker.text),
    style: JSON.stringify({
      fs: 0,
      fsa: 1,
      ffn: "Noto Sans",
      ta: "c",
      tav: "m",
      taw: 0,
      tah: 0,
      lh: 1.36,
      sbc: sticker.background,
    }),
    // Copied from the samples' shape (its `enabled` is false); kept because
    // the verified payloads carry it.
    "ns:author": { id: "3074457347823878357", enabled: false },
  };
}

function encodeText(node: MiroTextNode): Record<string, unknown> {
  return {
    _position: { offsetPx: { x: node.cx, y: node.cy }, schema: "canvasOffsetPx" },
    scale: { scale: 1 },
    relativeScale: 1,
    rotation: { rotation: 0 },
    relativeRotation: 0,
    size: { width: node.width, height: node.height },
    _parent: null,
    text: miroText(node.text),
    style: JSON.stringify({
      st: 14,
      bc: -1,
      bo: 1,
      bsc: 0,
      ta: "l",
      tc: MIRO_INK,
      tsc: 1,
      ffn: "Noto Sans",
      p: 0,
      b: 0,
      u: 0,
      i: 0,
      s: 0,
      fw: 0,
      brc: -1,
      bro: 1,
      brw: 0,
      brs: 2,
      hl: 0,
    }),
  };
}

function encodeFrame(frame: MiroFrameNode): Record<string, unknown> {
  return {
    type: 12,
    prevFrameIndex: -1,
    x: frame.cx,
    y: frame.cy,
    width: frame.width,
    height: frame.height,
    style: JSON.stringify({
      fs: 14,
      tc: 6052956,
      ta: "l",
      ff: 5,
      ss: 4,
      sc: 16777215,
      bc: 16777215,
      fo: 2,
      fd: 0,
    }),
    text: frame.title,
    boardId: "",
    isClusteringContainer: false,
    speakerNotes: null,
    coldStartType: null,
    _parent: null,
    _position: { offsetPx: { x: frame.cx, y: frame.cy }, schema: "canvasOffsetPx" },
    rotation: { rotation: 0 },
    scale: { scale: 1 },
    relativeRotation: 0,
    relativeScale: 1,
    size: { width: frame.width, height: frame.height },
  };
}

function captionWidth(label: string): number {
  return 12 * [...label].length + 5;
}

function encodeConnector(
  connector: MiroConnector,
  keyToId: Map<string, number>,
): Record<string, unknown> | null {
  const fromId = keyToId.get(connector.from.key);
  const toId = keyToId.get(connector.to.key);
  // Both ends of a bound connector name an element of this payload; a
  // connector pointing nowhere is dropped rather than guessed at.
  if (fromId === undefined || toId === undefined) return null;
  return {
    points: [],
    primary: {
      point: { x: connector.from.x, y: connector.from.y },
      positionType: 0,
      widgetIndex: fromId,
    },
    secondary: {
      point: { x: connector.to.x, y: connector.to.y },
      positionType: 0,
      widgetIndex: toId,
    },
    _position: null,
    _parent: null,
    style: JSON.stringify({
      lc: MIRO_LINE,
      ls: 2,
      t: 2,
      lt: 1,
      a_start: connector.arrowStart ? 9 : 0,
      a_end: connector.arrowEnd === false ? 0 : 9,
      VER: 2,
      jump: 0,
    }),
    line: {
      captions: connector.label
        ? [
            {
              id: `${connector.key}:00001`,
              text: miroText(connector.label),
              fontSize: MIRO_CAPTION_FONT_SIZE,
              width: captionWidth(connector.label),
              position: { x: 0.5, y: 0.5 },
              rotated: false,
              color: MIRO_LINE,
            },
          ]
        : [],
    },
  };
}

/**
 * A scene to the payload Miro reads. Object order is frames first, then
 * figures, stickies and texts, connectors last: frames own the z-order base
 * and connectors point at the ids above them.
 */
export function encodePayload(scene: MiroScene): MiroPayload {
  const objects: MiroObject[] = [];
  const keyToId = new Map<string, number>();
  const push = (key: string, type: string, json: Record<string, unknown>) => {
    const id = objects.length;
    keyToId.set(key, id);
    objects.push({ widgetData: { json, type }, type: 14, id, initialId: initialId(id), meta: {} });
  };
  for (const frame of scene.frames) push(frame.key, "frame", encodeFrame(frame));
  for (const node of scene.shapes) push(node.key, "shape", encodeShape(node));
  for (const sticker of scene.stickers) push(sticker.key, "sticker", encodeSticker(sticker));
  for (const node of scene.texts) push(node.key, "text", encodeText(node));
  for (const connector of scene.connectors) {
    const json = encodeConnector(connector, keyToId);
    if (json) push(connector.key, "line", json);
  }
  return {
    isProtected: false,
    boardId: "",
    data: { objects, meta: {} },
    version: 2,
    host: "miro.com",
    asPortalAmount: 0,
    copierType: "COPY",
  };
}

// ---------------------------------------------------------------------------
// base64 and clipboard HTML
// ---------------------------------------------------------------------------

/** A payload to the base64 in `data-meta`: UTF-8 bytes, each minus 197 (mod 256). */
export function encodeMiroData(payload: MiroPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode((byte - 197 + 256) & 255);
  return btoa(bin);
}

/** The figure texts for `text/plain`: everything the payload shows, or nothing. */
export function buildPlainText(scene: MiroScene): string {
  const lines = [
    ...scene.frames.map((f) => f.title),
    ...scene.shapes.map((s) => s.text),
    ...scene.stickers.map((s) => s.text),
    ...scene.texts.map((s) => s.text),
    ...scene.connectors.map((c) => c.label ?? ""),
  ]
    .flatMap((text) => text.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.join("\n");
}

/**
 * The `text/html` body for the clipboard, in the shape of the verified test
 * page: a `data-meta` span plus the plain text as inert divs. Miro reads the
 * span; the divs are what a text-only paste target sees.
 */
export function toMiroHtml(payload: MiroPayload, plain: string): string {
  const meta = `<--(miro-data-v1)${encodeMiroData(payload)}(/miro-data-v1)-->`;
  const body = plain ? `<div><div><div>${escapeMiroText(plain)}</div></div></div>` : "";
  return `<meta charset="utf-8"><span data-meta="${escapeMiroAttr(meta)}"></span>${body}`;
}
