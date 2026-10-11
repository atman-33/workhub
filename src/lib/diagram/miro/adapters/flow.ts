/**
 * The business-flow adapter: a laid-out flow diagram to the Miro scene
 * (T-0722, lanes as background rectangles since T-0733).
 *
 * The mapping follows the design's flow row: each lane becomes a plain
 * rectangle the size of the lane, pushed first so it pastes behind everything
 * (a Miro frame would own its steps and make them awkward to move, copy and
 * drag out of the lane, so lanes are background only). Every step inside a
 * lane is an independent top-level figure in absolute canvas coordinates -
 * the encoder writes `_parent: null` with `canvasOffsetPx`, so a step moves
 * freely on the board. The step still names its lane rectangle (`lane`, never
 * `frame`) so the selection copy can keep the lanes that hold a selected step
 * and drop the rest. The lane's name cannot sit inside the rectangle - a
 * figure's text is centre-aligned in every sample (`ta: "c"`, `tav: "m"`) and
 * no sample shows a top-left figure text - so it pastes as a separate
 * left-aligned Miro text at the rectangle's top-left. A step's kind maps as
 * start/end to rounded figures, decisions to diamonds and processes to
 * rectangles. Arrows become bound connectors with their labels, including
 * arrows across lanes. Sticky notes keep their layout spots as independent
 * Miro stickies; node memo lines, `## Memo` and `task:` links are left out.
 * The adapter reads the layout result only - never the file.
 */
import {
  LANE_FONT_SIZE,
  STEP_FONT_SIZE,
  UNASSIGNED,
  type FlowLayout,
} from "../../flow/layout";
import { LINE_HEIGHT, textWidth, truncateText } from "../../text";
import { colorToMiroRgb, stickyToMiroRgb } from "../palette";
import { emptyScene, type MiroScene, type MiroShapeKind } from "../model";
import { MIRO_SCALE, relativePoint, type MiroAdapterOptions } from "./shared";

export interface FlowToMiroOptions extends MiroAdapterOptions {}

/**
 * A flow step kind to a Miro figure: starts and ends stay rounded, decisions
 * stay diamonds, processes are rectangles.
 */
export function flowShapeToMiro(kind: string): MiroShapeKind {
  if (kind === "start" || kind === "end") return "round";
  if (kind === "decision") return "diamond";
  return "rect";
}

/** Scene key of the background rectangle a lane maps to. Prefixed so a lane
 * id can never collide with a step id in the encoder's shared key space. */
export function flowLaneKey(bandKey: string): string {
  return `lane:${bandKey}`;
}

/** Scene key of a lane rectangle, under the name the frame era used
 * (T-0722). Kept so existing imports keep working; new code uses
 * `flowLaneKey`. */
export const flowFrameKey = flowLaneKey;

/** Scene key of the free text naming a lane rectangle: the lane key plus a
 * suffix, so the selection copy can keep a surviving lane's label with it
 * (see `selection.ts`). */
export function flowLaneLabelKey(bandKey: string): string {
  return `${flowLaneKey(bandKey)}:label`;
}

/** Inset of a lane label from its rectangle's top-left, in layout pixels. */
const LANE_LABEL_PAD = 8;

export function flowToMiro(layout: FlowLayout, options: FlowToMiroOptions = {}): MiroScene {
  const scale = options.scale ?? MIRO_SCALE;
  const scene = emptyScene();
  // The selection centres on the origin in Miro; the whole drawing is shifted
  // so its bounds centre lands there.
  const centreX = layout.bounds.x + layout.bounds.width / 2;
  const centreY = layout.bounds.y + layout.bounds.height / 2;
  const px = (x: number) => (x - centreX) * scale;
  const py = (y: number) => (y - centreY) * scale;

  // A single unassigned band means the note defines no lanes: the whole
  // diagram is one plain row, and drawing a rectangle round everything would
  // only add a pointless box. Otherwise every band - lanes and the unassigned
  // band alike - becomes a background rectangle, as drawn. Rectangles come
  // first so they paste behind the steps (the encoder keeps scene order).
  const frameless = layout.bands.length === 1 && layout.bands[0].key === UNASSIGNED;
  if (!frameless) {
    const labelFontSize = Math.max(1, Math.round(LANE_FONT_SIZE * scale));
    for (const band of layout.bands) {
      scene.shapes.push({
        kind: "shape",
        key: flowLaneKey(band.key),
        shape: "rect",
        cx: px(band.x + band.width / 2),
        cy: py(band.y + band.height / 2),
        width: band.width * scale,
        height: band.height * scale,
        // Unfilled with the default thin outline: a visual guide only. A
        // lane colour becomes its border, like a step colour becomes its
        // step's border.
        text: "",
        border: band.color ? colorToMiroRgb(band.color) : null,
        fontSize: labelFontSize,
      });
      if (!band.title.trim()) continue;
      // The label is cut to the lane so a long name never spills over the
      // steps; it sits at the rectangle's top-left.
      const title = truncateText(band.title, Math.max(0, band.width - LANE_LABEL_PAD * 3), LANE_FONT_SIZE);
      if (!title.trim()) continue;
      const w = Math.ceil(textWidth(title, LANE_FONT_SIZE));
      const h = Math.ceil(LANE_FONT_SIZE * LINE_HEIGHT);
      scene.texts.push({
        kind: "text",
        key: flowLaneLabelKey(band.key),
        cx: px(band.x + LANE_LABEL_PAD + w / 2),
        cy: py(band.y + LANE_LABEL_PAD + h / 2),
        width: Math.max(1, w * scale),
        height: Math.max(1, h * scale),
        text: title,
      });
    }
  }

  for (const step of layout.steps) {
    scene.shapes.push({
      kind: "shape",
      key: step.id,
      shape: flowShapeToMiro(step.kind),
      cx: px(step.cx),
      cy: py(step.cy),
      width: step.width * scale,
      height: step.height * scale,
      text: step.title,
      border: step.color ? colorToMiroRgb(step.color) : null,
      fontSize: Math.max(1, Math.round(STEP_FONT_SIZE * scale)),
      // Grouping only, never parenting: the encoder ignores `lane`, so the
      // step pastes top-level (`_parent: null`, `canvasOffsetPx`) and stays
      // freely movable, while the selection copy keeps this step's lane.
      ...(!frameless ? { lane: flowLaneKey(step.band) } : {}),
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
    });
  }
  return scene;
}
