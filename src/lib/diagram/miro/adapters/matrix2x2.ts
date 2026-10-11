/**
 * The 2x2 matrix adapter: a laid-out matrix to the Miro scene (T-0723).
 *
 * The mapping follows the design's matrix2x2 row: the central cross becomes
 * two free-floating lines with no arrowheads (both ends unbound, so the
 * encoder writes `widgetIndex: -1` with absolute positions), the axis labels
 * and the quadrant names become Miro texts at their layout positions, and
 * there are no frames and no bound connectors. An item with a colour becomes
 * a Miro sticker in that colour (the canvas draws every item as a small card
 * with a coloured border, so a coloured item already reads as a sticky); a
 * colourless item becomes a rectangle. Quadrant note texts, `## Memo`, memo
 * lines and `task:` links are left out (they would only get in the way on
 * the board). The adapter reads the layout result only - never the file.
 */
import { ITEM_FONT_SIZE, type AxisText, type MatrixLayout } from "../../matrix2x2/layout";
import { LINE_HEIGHT, textWidth } from "../../text";
import { stickyToMiroRgb } from "../palette";
import { emptyScene, type MiroScene } from "../model";
import { MIRO_SCALE, type MiroAdapterOptions } from "./shared";

export interface MatrixToMiroOptions extends MiroAdapterOptions {}

/**
 * A matrix item to a Miro element: coloured items become stickers, plain ones
 * rectangles. The sticker/rectangle split is by colour only - the canvas
 * gives every item the same card shape, so colour is what tells a sticky
 * look apart.
 */
export function matrixItemToMiro(color: string | undefined): "sticker" | "rect" {
  return color ? "sticker" : "rect";
}

/**
 * Centre of a non-rotated axis text: the canvas draws it at `(x, y)` with an
 * anchor and a baseline, while a Miro text is centred on its box. The
 * baseline sits `0.35 * fontSize` below the box centre (the same offset the
 * layout uses to centre quadrant names on their glyphs).
 */
function axisTextCentre(a: AxisText): { cx: number; cy: number; w: number; h: number } {
  const w = Math.ceil(textWidth(a.text, a.fontSize));
  const h = Math.ceil(a.fontSize * LINE_HEIGHT);
  if (a.rotate) {
    // The y axis name reads upward along the plot's left edge, anchored at
    // the top. Miro texts are horizontal, so the text is laid with its right
    // end at the anchor and its top at the anchor's height - just outside the
    // plot's top-left, where the vertical label starts.
    return { cx: a.x - w / 2, cy: a.y + h / 2, w, h };
  }
  const cx = a.anchor === "start" ? a.x + w / 2 : a.anchor === "end" ? a.x - w / 2 : a.x;
  return { cx, cy: a.y - a.fontSize * 0.35, w, h };
}

export function matrixToMiro(layout: MatrixLayout, options: MatrixToMiroOptions = {}): MiroScene {
  const scale = options.scale ?? MIRO_SCALE;
  const scene = emptyScene();
  // The selection centres on the origin in Miro; the whole drawing is shifted
  // so its bounds centre lands there.
  const centreX = layout.bounds.x + layout.bounds.width / 2;
  const centreY = layout.bounds.y + layout.bounds.height / 2;
  const px = (x: number) => (x - centreX) * scale;
  const py = (y: number) => (y - centreY) * scale;

  // The central cross: two free-floating lines with no arrowheads, from the
  // layout's own geometry. Always present - even an empty matrix shows its
  // grid on the canvas.
  layout.cross.forEach((line, i) => {
    (scene.freeLines ??= []).push({
      kind: "freeLine",
      key: `axis:${i}`,
      x1: px(line.x1),
      y1: py(line.y1),
      x2: px(line.x2),
      y2: py(line.y2),
    });
  });

  for (const a of layout.axisTexts) {
    const box = axisTextCentre(a);
    scene.texts.push({
      kind: "text",
      key: `axis-text:${a.id}`,
      cx: px(box.cx),
      cy: py(box.cy),
      width: Math.max(1, box.w * scale),
      height: Math.max(1, box.h * scale),
      text: a.text,
    });
  }
  for (const q of layout.quadrants) {
    if (!q.label.trim()) continue;
    const w = Math.ceil(textWidth(q.label, q.fontSize));
    const h = Math.ceil(q.fontSize * LINE_HEIGHT);
    scene.texts.push({
      kind: "text",
      key: `quadrant:${q.key}`,
      cx: px(q.textX),
      // `textY` is the baseline that centres the glyphs on the quadrant;
      // the Miro box centre sits above it by the same offset.
      cy: py(q.textY - q.fontSize * 0.35),
      width: Math.max(1, w * scale),
      height: Math.max(1, h * scale),
      text: q.label,
    });
  }

  for (const item of layout.items) {
    const cx = px(item.x + item.width / 2);
    const cy = py(item.y + item.height / 2);
    if (matrixItemToMiro(item.color) === "sticker") {
      scene.stickers.push({
        kind: "sticker",
        key: item.id,
        cx,
        cy,
        // The title only: memo lines, `## Memo` and `task:` links stay out.
        text: item.title,
        background: stickyToMiroRgb(item.color!),
      });
    } else {
      scene.shapes.push({
        kind: "shape",
        key: item.id,
        shape: "rect",
        cx,
        cy,
        width: item.width * scale,
        height: item.height * scale,
        text: item.title,
        border: null,
        fontSize: Math.max(1, Math.round(ITEM_FONT_SIZE * scale)),
      });
    }
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
  return scene;
}
