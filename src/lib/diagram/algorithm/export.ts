/**
 * Static exports of a program flow: the SVG that the HTML page embeds and the
 * PNG rasterizes (T-0698). The frame (page, margins, stickies) is shared in
 * `export-frame.ts`; this file draws what is specific to the program flow.
 *
 * It renders `layoutAlgorithm`'s output - the same call the canvas makes - so
 * what was exported is what was seen, stickies included (the caller passes none
 * when the note hides them).
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
import {
  EDGE_LABEL_FONT_SIZE,
  layoutAlgorithm,
  NODE_FONT_SIZE,
  nodeTextY,
  type AlgorithmLayout,
  type PositionedEdge,
  type PositionedNode,
} from "./layout";
import type { AlgorithmDocModel } from "./parse";

const EDGE_INK = "#4b5563";

function renderEdge(edge: PositionedEdge): string {
  const { geometry, labelBox } = edge;
  const line =
    `<path d="${geometry.d}" fill="none" stroke="${EDGE_INK}" stroke-width="1.5" />` +
    `<path d="${arrowHeadPath(geometry.end, geometry.headAngle)}" fill="${EDGE_INK}" />`;
  if (!edge.label || !labelBox) return `<g>${line}</g>`;
  return (
    `<g>${line}<rect x="${labelBox.x}" y="${labelBox.y}" width="${labelBox.width}" ` +
    `height="${labelBox.height}" rx="3" fill="${PAPER}" fill-opacity="0.92" />` +
    `<text x="${labelBox.x + labelBox.width / 2}" y="${labelBox.y + labelBox.height / 2 + EDGE_LABEL_FONT_SIZE * 0.36}" ` +
    `text-anchor="middle" font-size="${EDGE_LABEL_FONT_SIZE}" fill="${INK}">${esc(edge.label)}</text></g>`
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

/** The drawing of a laid-out program flow, without the frame. Arrows go under
 * the nodes, and a label sits on its arrow. */
export function renderBody(layout: AlgorithmLayout): string {
  return (
    layout.edges.map(renderEdge).join("") +
    layout.nodes.map(renderNode).join("") +
    layout.stickies.map(renderStickySvg).join("")
  );
}

export type AlgorithmExportModel = Pick<AlgorithmDocModel, "nodes" | "edges">;

export interface RenderOptions {
  /** Title drawn above the diagram. Omit for a bare diagram. */
  title?: string;
  fontSize?: number;
  /** Stickies to draw. The caller passes none when the note hides them. */
  stickies?: Sticky[];
}

/** Renders the program flow as a standalone `<svg>` element (pure). */
export function renderSvg(model: AlgorithmExportModel, options: RenderOptions = {}): string {
  const layout = layoutAlgorithm(model, options.stickies ?? []);
  return svgFrame({
    ...(options.title ? { title: options.title } : {}),
    fontSize: options.fontSize ?? EXPORT_FONT_SIZE,
    bounds: layout.bounds,
    body: renderBody(layout),
  });
}

/** Wraps the SVG in a single-file HTML page. */
export function renderHtml(
  model: AlgorithmExportModel,
  options: { title: string; exportedOn: string; stickies?: Sticky[] },
): string {
  const svg = renderSvg(model, {
    ...(options.stickies ? { stickies: options.stickies } : {}),
  });
  return htmlPage({ title: options.title, exportedOn: options.exportedOn, svg });
}
