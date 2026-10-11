/**
 * The architecture adapter: a laid-out architecture diagram to the Miro scene
 * (T-0722).
 *
 * The mapping follows the design's architecture row: each frame becomes a
 * Miro frame at the rectangle the layout already drew (its position and size
 * come straight from `layout.frames`), and every block inside one becomes
 * that frame's child - the encoder writes the `_parent` link and the offsets
 * from the frame's top-left, so moving the frame on the board moves its
 * blocks. Blocks map as plain/rounded to rectangle/rounded figures, databases
 * to cylinders, and people and clouds to rectangles for now (those shapes
 * have no sampled Miro id). Arrows become bound connectors with their labels;
 * a `<->` arrow carries a head on both ends (`a_start`). Pinned ends (T-0712)
 * need no extra work: the layout's geometry endpoints already sit on the
 * pinned sides, and the relative points keep them. Sticky notes keep their
 * layout spots as independent Miro stickies - even one pinned to a frame.
 * Hover memos, `## Memo` and `task:` links are left out. The adapter reads
 * the layout result only - never the file.
 */
import { colorToMiroRgb, stickyToMiroRgb } from "../palette";
import { emptyScene, type MiroScene, type MiroShapeKind } from "../model";
import { type ArchitectureLayout } from "../../architecture/layout";
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

/** Scene key of the frame an architecture frame maps to. Prefixed so a frame
 * id can never collide with a block id in the encoder's shared key space. */
export function architectureFrameKey(frameId: string): string {
  return `frame:${frameId}`;
}

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

  for (const frame of layout.frames) {
    scene.frames.push({
      kind: "frame",
      key: architectureFrameKey(frame.id),
      cx: px(frame.x + frame.width / 2),
      cy: py(frame.y + frame.height / 2),
      width: frame.width * scale,
      height: frame.height * scale,
      title: frame.title,
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
      ...(node.frame !== undefined && layout.frameById.has(node.frame)
        ? { frame: architectureFrameKey(node.frame) }
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
