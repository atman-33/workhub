/**
 * The use case adapter: a laid-out use case diagram to the Miro scene
 * (T-0721).
 *
 * The mapping follows the design's use case row: a system becomes a rectangle
 * with a thick outline, people and external services rectangles for now (the
 * person icon and the dashed rounded service have no sampled Miro id). A
 * person's actions are not speech bubbles on the board - they are listed in
 * that person's rectangle text, under the person's name, so the rectangle
 * grows with the line count. Lines become bound connectors with their labels;
 * the arrowhead is drawn only for `->` (a `--` line has none). Sticky notes
 * keep their layout spots as Miro stickies; hover memos, `## Memo` and
 * `task:` links are left out. The adapter reads the layout result only -
 * never the file.
 */
import { LINE_HEIGHT } from "../../text";
import {
  BUBBLE_BULLET,
  type UsecaseLayout,
} from "../../usecase/layout";
import { colorToMiroRgb, stickyToMiroRgb } from "../palette";
import { emptyScene, type MiroScene, type MiroShapeKind } from "../model";
import { MIRO_SCALE, relativePoint, type MiroAdapterOptions } from "./shared";

export interface UsecaseToMiroOptions extends MiroAdapterOptions {}

/** Outline width of a system: thick on the canvas, thicker than the default 2. */
export const SYSTEM_BORDER_WIDTH = 4;

/**
 * A use case kind to a Miro figure: everything is a rectangle for now - the
 * person icon and the external service's dashed rounded box have no sampled
 * Miro id - and the system is told apart by its thick outline.
 */
export function usecaseShapeToMiro(_kind: string): MiroShapeKind {
  return "rect";
}

/** A person's rectangle text: the name, then one bulleted line per action.
 * Wrapped action lines hang under their bullet; the bubble's own wrapping is
 * kept, so no text is lost rejoining lines. */
export function personText(nameLines: readonly string[], actionLines: string[][]): string {
  const lines = [...nameLines];
  for (const item of actionLines) {
    item.forEach((line, i) => lines.push(i === 0 ? `${BUBBLE_BULLET}${line}` : `  ${line}`));
  }
  return lines.join("\n");
}

export function usecaseToMiro(
  layout: UsecaseLayout,
  options: UsecaseToMiroOptions = {},
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
    const fontSize = Math.max(1, Math.round(node.fontSize * scale));
    let text = node.title;
    let height = node.height * scale;
    let borderWidth: number | undefined;
    if (node.kind === "system") {
      borderWidth = SYSTEM_BORDER_WIDTH;
    }
    if (node.kind === "person") {
      const bubble = layout.bubbleOf.get(node.id);
      const actions = (bubble?.items ?? []).map((item) => item.lines);
      text = personText(node.lines, actions);
      const rows = text.split("\n").length;
      // The layout box holds the name only; the text underneath needs the room.
      height = Math.max(
        height,
        Math.ceil(rows * node.fontSize * LINE_HEIGHT * scale) + 16 * scale,
      );
    }
    scene.shapes.push({
      kind: "shape",
      key: node.id,
      shape: usecaseShapeToMiro(node.kind),
      cx: px(node.cx),
      cy: py(node.cy),
      width: node.width * scale,
      height,
      text,
      border: node.color ? colorToMiroRgb(node.color) : null,
      fontSize,
      ...(borderWidth !== undefined ? { borderWidth } : {}),
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
      // A `--` line has no head; a `->` arrow keeps the encoder's head.
      arrowEnd: edge.head,
    });
  }
  return scene;
}
