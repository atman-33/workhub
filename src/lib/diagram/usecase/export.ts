/**
 * Static exports of a use case diagram: the SVG that the HTML page embeds and
 * the PNG rasterizes (T-0706). The frame (page, margins, stickies) is shared in
 * `export-frame.ts`; this file draws what is specific to the use case diagram.
 *
 * It renders `layoutUsecase`'s output - the same call the canvas makes - so
 * what was exported is what was seen: the people's speech bubbles and the
 * stickies included (the caller passes none when the note hides them).
 */
import { COLOR_HEX } from "../colors";
import {
  esc,
  EXPORT_FONT_SIZE,
  htmlPage,
  INK,
  MUTED,
  PAPER,
  renderStickySvg,
  svgFrame,
} from "../export-frame";
import { arrowHeadPath } from "../node-edge";
import { shapeMarkup, shapeOf, speechBubbleOutline } from "../shapes";
import type { Sticky } from "../sticky";
import {
  BUBBLE_BULLET,
  BUBBLE_BULLET_WIDTH,
  BUBBLE_FONT_SIZE,
  BUBBLE_LINE_HEIGHT,
  BUBBLE_PAD,
  EDGE_LABEL_FONT_SIZE,
  layoutUsecase,
  nodeTextY,
  type PositionedBubble,
  type PositionedEdge,
  type PositionedNode,
  type UsecaseLayout,
} from "./layout";
import type { UsecaseDocModel } from "./parse";
import { symbolOfKind } from "./symbols";

const EDGE_INK = "#4b5563";
/** Fill of a person's icon and of a system's box. */
const SOFT_FILL = "#f3f4f6";
const BUBBLE_STROKE = "#6b7280";

function renderEdge(edge: PositionedEdge): string {
  const { geometry, labelBox } = edge;
  const line =
    `<path d="${geometry.d}" fill="none" stroke="${EDGE_INK}" stroke-width="1.5" />` +
    (edge.head ? `<path d="${arrowHeadPath(geometry.end, geometry.headAngle)}" fill="${EDGE_INK}" />` : "");
  if (!edge.label || !labelBox) return `<g>${line}</g>`;
  return (
    `<g>${line}<rect x="${labelBox.x}" y="${labelBox.y}" width="${labelBox.width}" ` +
    `height="${labelBox.height}" rx="3" fill="${PAPER}" fill-opacity="0.92" />` +
    `<text x="${labelBox.x + labelBox.width / 2}" y="${labelBox.y + labelBox.height / 2 + EDGE_LABEL_FONT_SIZE * 0.36}" ` +
    `text-anchor="middle" font-size="${EDGE_LABEL_FONT_SIZE}" fill="${INK}">${esc(edge.label)}</text></g>`
  );
}

function renderNode(node: PositionedNode): string {
  const symbol = symbolOfKind(node.kind);
  const stroke = node.color ? COLOR_HEX[node.color] : symbol.centre ? INK : MUTED;
  const fill = symbol.text === "middle" ? PAPER : SOFT_FILL;
  const dash = node.dash ? ` stroke-dasharray="${node.dash}"` : "";
  // A person's outline is the icon only; the name is written under it.
  const outline = shapeMarkup(
    shapeOf(node.shape).outline(node),
    `fill="${fill}" stroke="${stroke}" stroke-width="${node.strokeWidth}"${dash}`,
  );
  const weight = node.bold ? ` font-weight="600"` : "";
  const lines = node.lines
    .map(
      (line, i) =>
        `<text x="${node.cx}" y="${nodeTextY(node, i)}" text-anchor="middle" ` +
        `font-size="${node.fontSize}"${weight} fill="${INK}">${esc(line)}</text>`,
    )
    .join("");
  const task = node.task
    ? `<text x="${node.cx}" y="${node.y + node.height + 13}" text-anchor="middle" font-size="10" fill="${MUTED}" ` +
      `stroke="${PAPER}" stroke-width="3" paint-order="stroke">${esc(node.task)}</text>`
    : "";
  return `<g>${outline}${lines}${task}</g>`;
}

/** A person's speech bubble: the outline with its tail towards the person, and
 * the actions as a bulleted list (the bullet is drawn, not written in the file). */
function renderBubble(bubble: PositionedBubble): string {
  const outline = shapeMarkup(
    speechBubbleOutline(bubble, bubble.tailSide),
    `fill="${PAPER}" stroke="${BUBBLE_STROKE}" stroke-width="1.2"`,
  );
  const textX = bubble.x + BUBBLE_PAD + BUBBLE_BULLET_WIDTH;
  const text = bubble.items
    .map((item) => {
      const y = bubble.y + item.y;
      const bullet =
        `<text x="${bubble.x + BUBBLE_PAD}" y="${y}" font-size="${BUBBLE_FONT_SIZE}" fill="${INK}">${BUBBLE_BULLET}</text>`;
      const rows = item.lines
        .map(
          (line, i) =>
            `<text x="${textX}" y="${y + i * BUBBLE_LINE_HEIGHT}" font-size="${BUBBLE_FONT_SIZE}" fill="${INK}">${esc(line)}</text>`,
        )
        .join("");
      return bullet + rows;
    })
    .join("");
  return `<g>${outline}${text}</g>`;
}

/** The drawing of a laid-out use case diagram, without the frame. Lines go under
 * the nodes, and a label sits on its line. */
export function renderBody(layout: UsecaseLayout): string {
  return (
    layout.edges.map(renderEdge).join("") +
    layout.nodes.map(renderNode).join("") +
    layout.bubbles.map(renderBubble).join("") +
    layout.stickies.map(renderStickySvg).join("")
  );
}

export type UsecaseExportModel = Pick<UsecaseDocModel, "nodes" | "edges">;

export interface RenderOptions {
  /** Title drawn above the diagram. Omit for a bare diagram. */
  title?: string;
  fontSize?: number;
  /** Stickies to draw. The caller passes none when the note hides them. */
  stickies?: Sticky[];
}

/** Renders the use case diagram as a standalone `<svg>` element (pure). */
export function renderSvg(model: UsecaseExportModel, options: RenderOptions = {}): string {
  const layout = layoutUsecase(model, options.stickies ?? []);
  return svgFrame({
    ...(options.title ? { title: options.title } : {}),
    fontSize: options.fontSize ?? EXPORT_FONT_SIZE,
    bounds: layout.bounds,
    body: renderBody(layout),
  });
}

/** Wraps the SVG in a single-file HTML page. */
export function renderHtml(
  model: UsecaseExportModel,
  options: { title: string; exportedOn: string; stickies?: Sticky[] },
): string {
  const svg = renderSvg(model, {
    ...(options.stickies ? { stickies: options.stickies } : {}),
  });
  return htmlPage({ title: options.title, exportedOn: options.exportedOn, svg });
}
