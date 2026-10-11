/**
 * The IFDAM adapter: a laid-out IFDAM diagram to the Miro scene (T-0721).
 *
 * The mapping follows the design's IFDAM row: a screen becomes a rectangle
 * whose text lists the Display / Input / Operation sections under their
 * headings (the rectangle grows with the line count), a trigger a rectangle
 * for now (the hexagon has no sampled Miro id), a process a wide circle, a
 * data store a cylinder and a message a rounded figure. Arrows become bound
 * connectors with their labels; a link touching a data store is bidirectional.
 * A loop's detour is left to Miro's own routing (only the end points are
 * bound). Sticky notes keep their layout spots as Miro stickies; hover memos,
 * `## Memo` and `task:` links are left out. The adapter reads the layout
 * result only - never the file.
 */
import { LINE_HEIGHT } from "../../text";
import { DEFAULT_CAPTIONS, type SectionCaptions } from "../../ifdam/export";
import { NODE_FONT_SIZE, type IfdamLayout } from "../../ifdam/layout";
import type { SectionKey } from "../../ifdam/parse";
import { colorToMiroRgb, stickyToMiroRgb } from "../palette";
import { emptyScene, type MiroScene, type MiroShapeKind } from "../model";
import { MIRO_SCALE, relativePoint, type MiroAdapterOptions } from "./shared";

export interface IfdamToMiroOptions extends MiroAdapterOptions {
  /** Names of a screen's sections; the view passes the display language's. */
  captions?: SectionCaptions;
}

/**
 * An IFDAM kind to a Miro figure: processes (ellipses) stay wide ellipses via
 * a stretched circle, stores stay cylinders, messages stay rounded; screens
 * and triggers are rectangles until samples pin down more figure ids.
 */
export function ifdamShapeToMiro(kind: string): MiroShapeKind {
  if (kind === "process") return "circle";
  if (kind === "store") return "cylinder";
  if (kind === "message") return "round";
  return "rect";
}

/** A screen's rectangle text: the title, then each section with items under
 * its heading. Wrapped item lines hang under their bullet; the layout's own
 * wrapping is kept, so no text is lost rejoining lines. */
export function screenText(
  titleLines: readonly string[],
  sections: readonly { key: SectionKey; items: { lines: string[] }[] }[],
  captions: SectionCaptions,
): string {
  const lines = [...titleLines];
  for (const section of sections) {
    lines.push(captions[section.key]);
    for (const item of section.items) {
      item.lines.forEach((line, i) => lines.push(i === 0 ? `・${line}` : `  ${line}`));
    }
  }
  return lines.join("\n");
}

export function ifdamToMiro(
  layout: IfdamLayout,
  options: IfdamToMiroOptions = {},
): MiroScene {
  const scale = options.scale ?? MIRO_SCALE;
  const captions = options.captions ?? DEFAULT_CAPTIONS;
  const scene = emptyScene();
  // The selection centres on the origin in Miro; the whole drawing is shifted
  // so its bounds centre lands there.
  const centreX = layout.bounds.x + layout.bounds.width / 2;
  const centreY = layout.bounds.y + layout.bounds.height / 2;
  const px = (x: number) => (x - centreX) * scale;
  const py = (y: number) => (y - centreY) * scale;
  const fontSize = Math.max(1, Math.round(NODE_FONT_SIZE * scale));

  for (const node of layout.nodes) {
    let text = node.title;
    let height = node.height * scale;
    if (node.kind === "screen") {
      text = screenText(node.lines, node.sections, captions);
      const rows = text.split("\n").length;
      height = Math.max(
        height,
        Math.ceil(rows * NODE_FONT_SIZE * LINE_HEIGHT * scale) + 16 * scale,
      );
    }
    scene.shapes.push({
      kind: "shape",
      key: node.id,
      shape: ifdamShapeToMiro(node.kind),
      cx: px(node.cx),
      cy: py(node.cy),
      width: node.width * scale,
      height,
      text,
      border: node.color ? colorToMiroRgb(node.color) : null,
      fontSize,
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
    // A link touching a data store reads and writes: heads on both ends.
    const storeLink = from.kind === "store" || to.kind === "store";
    scene.connectors.push({
      kind: "connector",
      key: edge.key,
      from: { key: edge.from, ...relativePoint(from, edge.geometry.start) },
      to: { key: edge.to, ...relativePoint(to, edge.geometry.end) },
      ...(edge.label ? { label: edge.label } : {}),
      ...(storeLink ? { arrowStart: true } : {}),
    });
  }
  return scene;
}
