/**
 * Static exports of a PFD: the SVG that the HTML page embeds and the PNG
 * rasterizes (T-0683). The frame (page, margins, stickies) is shared in
 * `export-frame.ts`; this file draws what is specific to the PFD.
 *
 * It renders `layoutPfd`'s output - the same call the canvas makes - so what
 * was exported is what was seen, stickies included (the caller passes none when
 * the note hides them).
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
import { shapeMarkup, shapeOf } from "../shapes";
import type { Sticky } from "../sticky";
import { layoutPfd, NODE_FONT_SIZE, nodeTextY, type PfdLayout, type PositionedEdge, type PositionedNode } from "./layout";
import type { PfdDocModel } from "./parse";

const EDGE_INK = "#4b5563";

function renderEdge(edge: PositionedEdge): string {
  const { geometry } = edge;
  return (
    `<g><path d="${geometry.d}" fill="none" stroke="${EDGE_INK}" stroke-width="1.5" />` +
    `<path d="${arrowHeadPath(geometry.end, geometry.headAngle)}" fill="${EDGE_INK}" /></g>`
  );
}

function renderNode(node: PositionedNode): string {
  const stroke = node.color ? COLOR_HEX[node.color] : MUTED;
  const outline = shapeMarkup(
    shapeOf(node.shape).outline(node),
    `fill="${PAPER}" stroke="${stroke}" stroke-width="1.5"`,
  );
  const lines = node.lines
    .map(
      (line, i) =>
        `<text x="${node.cx}" y="${nodeTextY(node, i)}" text-anchor="middle" ` +
        `font-size="${NODE_FONT_SIZE}" fill="${INK}">${esc(line)}</text>`,
    )
    .join("");
  const task = node.task
    ? `<text x="${node.cx}" y="${node.y + node.height + 12}" text-anchor="middle" font-size="10" fill="${MUTED}">${esc(node.task)}</text>`
    : "";
  return `<g>${outline}${lines}${task}</g>`;
}

/** The drawing of a laid-out PFD, without the frame. */
export function renderBody(layout: PfdLayout): string {
  return (
    layout.edges.map(renderEdge).join("") +
    layout.nodes.map(renderNode).join("") +
    layout.stickies.map(renderStickySvg).join("")
  );
}

export type PfdExportModel = Pick<PfdDocModel, "nodes" | "edges">;

export interface RenderOptions {
  /** Title drawn above the diagram. Omit for a bare diagram. */
  title?: string;
  fontSize?: number;
  /** Stickies to draw. The caller passes none when the note hides them. */
  stickies?: Sticky[];
}

/** Renders the PFD as a standalone `<svg>` element (pure). */
export function renderSvg(model: PfdExportModel, options: RenderOptions = {}): string {
  const layout = layoutPfd(model, options.stickies ?? []);
  return svgFrame({
    ...(options.title ? { title: options.title } : {}),
    fontSize: options.fontSize ?? EXPORT_FONT_SIZE,
    bounds: layout.bounds,
    body: renderBody(layout),
  });
}

/** Wraps the SVG in a single-file HTML page. */
export function renderHtml(
  model: PfdExportModel,
  options: { title: string; exportedOn: string; stickies?: Sticky[] },
): string {
  const svg = renderSvg(model, {
    ...(options.stickies ? { stickies: options.stickies } : {}),
  });
  return htmlPage({ title: options.title, exportedOn: options.exportedOn, svg });
}
