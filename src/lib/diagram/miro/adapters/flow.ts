/**
 * The business-flow adapter: a laid-out flow diagram to the Miro scene
 * (T-0722).
 *
 * The mapping follows the design's flow row: each lane becomes a Miro frame
 * (stacked vertically, as drawn), and every step inside a lane becomes that
 * frame's child - the encoder writes the `_parent` link and the offsets from
 * the frame's top-left, so moving the frame on the board moves its steps. A
 * step's kind maps as start/end to rounded figures, decisions to diamonds and
 * processes to rectangles. Arrows become bound connectors with their labels,
 * including arrows across lanes (a connector across two frames). Sticky notes
 * keep their layout spots as independent Miro stickies; node memo lines,
 * `## Memo` and `task:` links are left out. The adapter reads the layout
 * result only - never the file.
 */
import { STEP_FONT_SIZE, UNASSIGNED, type FlowLayout } from "../../flow/layout";
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

/** Scene key of the frame a lane maps to. Prefixed so a lane id can never
 * collide with a step id in the encoder's shared key space. */
export function flowFrameKey(bandKey: string): string {
  return `lane:${bandKey}`;
}

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
  // diagram is one plain row, and wrapping it in a frame would only add a
  // pointless box around everything. Otherwise every band - lanes and the
  // unassigned band alike - becomes a frame, as drawn.
  const frameless = layout.bands.length === 1 && layout.bands[0].key === UNASSIGNED;
  if (!frameless) {
    for (const band of layout.bands) {
      scene.frames.push({
        kind: "frame",
        key: flowFrameKey(band.key),
        cx: px(band.x + band.width / 2),
        cy: py(band.y + band.height / 2),
        width: band.width * scale,
        height: band.height * scale,
        title: band.title,
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
      ...(!frameless ? { frame: flowFrameKey(step.band) } : {}),
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
