/**
 * The PFD adapter: a laid-out PFD to the Miro scene (T-0720, the first
 * vertical slice).
 *
 * The mapping follows the design's PFD row: an ellipse (process) becomes a
 * wide circle, a document (deliverable) a flowchart stencil, arrows become
 * bound connectors without labels, and there are no frames. Sticky notes
 * keep their layout spots as Miro stickies; node memo lines, `## Memo` and
 * `task:` links are left out (they would only get in the way on the board).
 * The adapter reads the layout result only - never the file.
 */
import { edgeKey } from "../../node-edge";
import { NODE_FONT_SIZE, type PfdLayout } from "../../pfd/layout";
import { colorToMiroRgb, stickyToMiroRgb } from "../palette";
import { emptyScene, type MiroScene, type MiroShapeKind } from "../model";
import { resolveMiroShape } from "../model";
import {
  MIRO_SCALE,
  relativePoint,
  type MiroAdapterOptions,
} from "./shared";

export interface PfdToMiroOptions extends MiroAdapterOptions {}

/**
 * A PFD shape to a Miro figure: processes (ellipses) stay wide ellipses via
 * a stretched circle, documents stay documents (a flowchart stencil); the rest
 * falls back to a rectangle until samples pin down more figure ids.
 */
export function pfdShapeToMiro(shape: string): MiroShapeKind {
  if (shape === "ellipse") return "circle";
  if (shape === "document") return "document";
  return resolveMiroShape(shape);
}

export function pfdToMiro(layout: PfdLayout, options: PfdToMiroOptions = {}): MiroScene {
  const scale = options.scale ?? MIRO_SCALE;
  const scene = emptyScene();
  // The selection centres on the origin in Miro; the whole drawing is shifted
  // so its bounds centre lands there.
  const centreX = layout.bounds.x + layout.bounds.width / 2;
  const centreY = layout.bounds.y + layout.bounds.height / 2;
  const px = (x: number) => (x - centreX) * scale;
  const py = (y: number) => (y - centreY) * scale;

  for (const node of layout.nodes) {
    scene.shapes.push({
      kind: "shape",
      key: node.id,
      shape: pfdShapeToMiro(node.shape),
      cx: px(node.cx),
      cy: py(node.cy),
      width: node.width * scale,
      height: node.height * scale,
      text: node.title,
      border: node.color ? colorToMiroRgb(node.color) : null,
      fontSize: Math.max(1, Math.round(NODE_FONT_SIZE * scale)),
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
      key: edgeKey(edge),
      from: { key: edge.from, ...relativePoint(from, edge.geometry.start) },
      to: { key: edge.to, ...relativePoint(to, edge.geometry.end) },
    });
  }
  return scene;
}
