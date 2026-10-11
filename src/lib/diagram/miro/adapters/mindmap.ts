/**
 * The mindmap adapter: a laid-out mindmap to the Miro scene (T-0724).
 *
 * The mapping follows the design's mindmap row: every node becomes a rounded
 * rectangle at its layout coordinates, and every branch a bound connector
 * with no arrowheads. The label is the node title only: node notes, `## Memo`
 * prose, `task:` links and attribute chips stay out (they would only get in
 * the way on the board). Stickies keep their layout spots as Miro stickies.
 * The adapter reads the layout result only - never the file.
 */
import { edgeKey } from "../../node-edge";
import { DEFAULT_LAYOUT, type MindmapLayout, type PositionedNode } from "../../../mindmap/layout";
import { colorToMiroRgb, stickyToMiroRgb } from "../palette";
import { emptyScene, type MiroScene } from "../model";
import { MIRO_SCALE, relativePoint, type MiroAdapterOptions } from "./shared";

export interface MindmapToMiroOptions extends MiroAdapterOptions {}

/** A mindmap node to a Miro figure: always a rounded rectangle. */
export function mindmapShapeToMiro(): "round" {
  return "round";
}

/**
 * The point where a branch meets a node's box: the middle of one side. Which
 * side is the branch's direction, taken from the child: a left branch leaves
 * its parent through the left middle and enters the child through the right
 * middle, and the other way round on the right. Branches leave and arrive
 * horizontally, so the bound connector in Miro starts and ends where the
 * drawn curve does.
 */
function branchPoint(
  node: PositionedNode,
  side: "left" | "right",
  end: "from" | "to",
): { x: number; y: number } {
  const y = node.y + node.height / 2;
  const exitLeft = end === "from" ? side === "left" : side === "right";
  return exitLeft ? { x: node.x, y } : { x: node.x + node.width, y };
}

export function mindmapToMiro(layout: MindmapLayout, options: MindmapToMiroOptions = {}): MiroScene {
  const scale = options.scale ?? MIRO_SCALE;
  const scene = emptyScene();
  // The selection centres on the origin in Miro; the whole drawing is shifted
  // so its bounds centre lands there.
  const centreX = layout.bounds.x + layout.bounds.width / 2;
  const centreY = layout.bounds.y + layout.bounds.height / 2;
  const px = (x: number) => (x - centreX) * scale;
  const py = (y: number) => (y - centreY) * scale;

  for (const node of layout.nodes) {
    // The stroke on screen is the node's own colour, else its branch colour.
    const accent = node.color ?? node.branchColor;
    scene.shapes.push({
      kind: "shape",
      key: node.id,
      shape: mindmapShapeToMiro(),
      cx: px(node.x + node.width / 2),
      cy: py(node.y + node.height / 2),
      width: node.width * scale,
      height: node.height * scale,
      // The title only: notes, `task:` links and attribute chips stay out.
      text: node.title,
      border: accent ? colorToMiroRgb(accent) : null,
      fontSize: Math.max(1, Math.round(DEFAULT_LAYOUT.fontSize * scale)),
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
      from: { key: edge.from, ...relativePoint(from, branchPoint(from, to.side, "from")) },
      to: { key: edge.to, ...relativePoint(to, branchPoint(to, to.side, "to")) },
      // Branches carry no arrowheads on the board either.
      arrowEnd: false,
    });
  }
  return scene;
}
