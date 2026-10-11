/**
 * The architecture adapter: a laid-out architecture diagram to the Miro scene
 * (T-0722, frames as background rectangles since T-0735).
 *
 * The mapping follows the design's architecture row: each frame becomes a
 * plain rectangle the size of the frame, pushed first so it pastes behind
 * everything (a Miro frame would own its blocks and make them awkward to
 * move, copy and drag out of the frame, so frames are background only).
 * Every block inside a frame is an independent top-level figure in absolute
 * canvas coordinates - the encoder writes `_parent: null` with
 * `canvasOffsetPx`, so a block moves freely on the board. The block still
 * names its frame rectangle (`lane`, never `frame`) so the selection copy can
 * keep the frames that hold a selected block and drop the rest. The frame's
 * name cannot sit inside the rectangle - a figure's text is centre-aligned in
 * every sample (`ta: "c"`, `tav: "m"`) and no sample shows a top-left figure
 * text - so it pastes as a separate left-aligned Miro text at the
 * rectangle's top-left. Blocks map as plain/rounded to rectangle/rounded
 * figures, databases to cylinders, and people and clouds to rectangles for
 * now (those shapes have no sampled Miro id). Arrows become bound connectors
 * with their labels; a `<->` arrow carries a head on both ends (`a_start`).
 * Pinned ends (T-0712) need no extra work: the layout's geometry endpoints
 * already sit on the pinned sides, and the relative points keep them. Sticky
 * notes keep their layout spots as independent Miro stickies - even one
 * pinned to a frame. Hover memos, `## Memo` and `task:` links are left out.
 * The adapter reads the layout result only - never the file.
 */
import { colorToMiroRgb, stickyToMiroRgb } from "../palette";
import { emptyScene, type MiroScene, type MiroShapeKind } from "../model";
import { FRAME_TITLE_FONT_SIZE, type ArchitectureLayout } from "../../architecture/layout";
import { LINE_HEIGHT, textWidth, truncateText } from "../../text";
import { MIRO_SCALE, relativePoint, type MiroAdapterOptions } from "./shared";

export interface ArchitectureToMiroOptions extends MiroAdapterOptions {}

/**
 * An architecture block kind to a Miro figure: rounded blocks stay rounded,
 * databases stay cylinders; people and clouds are rectangles until samples
 * pin down their figure ids.
 */
export function architectureShapeToMiro(kind: string): MiroShapeKind {
  if (kind === "round") return "round";
  if (kind === "db") return "cylinder";
  return "rect";
}

/** Scene key of the background rectangle a frame maps to. Prefixed so a frame
 * id can never collide with a block id in the encoder's shared key space. */
export function architectureFrameKey(frameId: string): string {
  return `frame:${frameId}`;
}

/** Scene key of the free text naming a frame rectangle: the frame key plus a
 * suffix, so the selection copy can keep a surviving frame's label with it
 * (see `selection.ts`). */
export function architectureFrameLabelKey(frameId: string): string {
  return `${architectureFrameKey(frameId)}:label`;
}

/** Inset of a frame label from its rectangle's top-left, in layout pixels. */
const FRAME_LABEL_PAD = 8;

export function architectureToMiro(
  layout: ArchitectureLayout,
  options: ArchitectureToMiroOptions = {},
): MiroScene {
  const scale = options.scale ?? MIRO_SCALE;
  const scene = emptyScene();
  // The selection centres on the origin in Miro; the whole drawing is shifted
  // so its bounds centre lands there.
  const centreX = layout.bounds.x + layout.bounds.width / 2;
  const centreY = layout.bounds.y + layout.bounds.height / 2;
  const px = (x: number) => (x - centreX) * scale;
  const py = (y: number) => (y - centreY) * scale;

  // Every frame - with members or empty - becomes a background rectangle, as
  // drawn (an empty frame keeps the minimal box the layout gave it, at its
  // own `@x,y` when the file names one - see T-0734). Rectangles come first
  // so they paste behind the blocks (the encoder keeps scene order). A
  // diagram with no frames emits nothing extra.
  const labelFontSize = Math.max(1, Math.round(FRAME_TITLE_FONT_SIZE * scale));
  for (const frame of layout.frames) {
    scene.shapes.push({
      kind: "shape",
      key: architectureFrameKey(frame.id),
      shape: "rect",
      cx: px(frame.x + frame.width / 2),
      cy: py(frame.y + frame.height / 2),
      width: frame.width * scale,
      height: frame.height * scale,
      // Unfilled with the default thin outline: a visual guide only. A
      // frame colour becomes its border, like a block colour becomes its
      // block's border.
      text: "",
      border: frame.color ? colorToMiroRgb(frame.color) : null,
      fontSize: labelFontSize,
    });
    if (!frame.title.trim()) continue;
    // The label is cut to the frame so a long name never spills over the
    // blocks; it sits at the rectangle's top-left.
    const title = truncateText(
      frame.title,
      Math.max(0, frame.width - FRAME_LABEL_PAD * 3),
      FRAME_TITLE_FONT_SIZE,
    );
    if (!title.trim()) continue;
    const w = Math.ceil(textWidth(title, FRAME_TITLE_FONT_SIZE));
    const h = Math.ceil(FRAME_TITLE_FONT_SIZE * LINE_HEIGHT);
    scene.texts.push({
      kind: "text",
      key: architectureFrameLabelKey(frame.id),
      cx: px(frame.x + FRAME_LABEL_PAD + w / 2),
      cy: py(frame.y + FRAME_LABEL_PAD + h / 2),
      width: Math.max(1, w * scale),
      height: Math.max(1, h * scale),
      text: title,
    });
  }
  for (const node of layout.nodes) {
    scene.shapes.push({
      kind: "shape",
      key: node.id,
      shape: architectureShapeToMiro(node.kind),
      cx: px(node.cx),
      cy: py(node.cy),
      width: node.width * scale,
      height: node.height * scale,
      text: node.title,
      border: node.color ? colorToMiroRgb(node.color) : null,
      fontSize: Math.max(1, Math.round(node.fontSize * scale)),
      // Grouping only, never parenting: the encoder ignores `lane`, so the
      // block pastes top-level (`_parent: null`, `canvasOffsetPx`) and stays
      // freely movable, while the selection copy keeps this block's frame.
      ...(node.frame !== undefined && layout.frameById.has(node.frame)
        ? { lane: architectureFrameKey(node.frame) }
        : {}),
    });
  }
  for (const sticky of layout.stickies) {
    scene.stickers.push({
      kind: "sticker",
      key: sticky.id,
      cx: px(sticky.x + sticky.width / 2),
      cy: py(sticky.y + sticky.height / 2),
      text: sticky.text,
      background: stickyToMiroRgb(sticky.color),
    });
  }
  for (const edge of layout.edges) {
    const from = layout.byId.get(edge.from);
    const to = layout.byId.get(edge.to);
    if (!from || !to) continue;
    scene.connectors.push({
      kind: "connector",
      key: edge.key,
      from: { key: edge.from, ...relativePoint(from, edge.geometry.start) },
      to: { key: edge.to, ...relativePoint(to, edge.geometry.end) },
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.bidi ? { arrowStart: true } : {}),
    });
  }
  return scene;
}
