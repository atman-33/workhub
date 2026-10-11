/**
 * The program-flow adapter: a laid-out algorithm diagram to the Miro scene
 * (T-0721).
 *
 * The mapping follows the design's algorithm row: start/end become rounded
 * figures, decisions diamonds, and everything else (process, I/O,
 * subroutine, document) a rectangle for now - those shapes have no sampled
 * Miro id. Arrows become bound connectors with their labels; a loop's detour
 * is left to Miro's own routing (only the end points are bound). Sticky notes
 * keep their layout spots as Miro stickies; node memo lines, `## Memo` and
 * `task:` links are left out. The adapter reads the layout result only -
 * never the file.
 */
import { edgeKey } from "../../node-edge";
import { NODE_FONT_SIZE, type AlgorithmLayout } from "../../algorithm/layout";
import { colorToMiroRgb, stickyToMiroRgb } from "../palette";
import { emptyScene, type MiroScene, type MiroShapeKind } from "../model";
import { MIRO_SCALE, relativePoint, type MiroAdapterOptions } from "./shared";

export interface AlgorithmToMiroOptions extends MiroAdapterOptions {}

/**
 * An algorithm kind to a Miro figure: start/end stay rounded, decisions stay
 * diamonds, everything else is a rectangle until samples pin down more
 * figure ids.
 */
export function algorithmShapeToMiro(kind: string): MiroShapeKind {
  if (kind === "start" || kind === "end") return "round";
  if (kind === "decision") return "diamond";
  return "rect";
}

export function algorithmToMiro(
  layout: AlgorithmLayout,
  options: AlgorithmToMiroOptions = {},
): MiroScene {
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
      shape: algorithmShapeToMiro(node.kind),
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
      ...(edge.label ? { label: edge.label } : {}),
    });
  }
  return scene;
}
