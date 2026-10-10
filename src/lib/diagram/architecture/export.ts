/**
 * Static exports of an architecture diagram: the SVG that the HTML page embeds
 * and the PNG rasterizes (T-0709). The frame (page, margins, stickies) is shared
 * in `export-frame.ts`; this file draws what is specific to the architecture
 * diagram.
 *
 * It renders `layoutArchitecture`'s output - the same call the canvas makes -
 * so what was exported is what was seen: the frames around their members and
 * the stickies included (the caller passes none when the note hides them).
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
import { arrowHeadPath, startHeadAngle } from "../node-edge";
import { shapeMarkup, shapeOf } from "../shapes";
import type { Sticky } from "../sticky";
import {
  FRAME_HEADER,
  FRAME_TITLE_FONT_SIZE,
  layoutArchitecture,
  nodeTextY,
  type ArchitectureLayout,
  type PositionedEdge,
  type PositionedFrame,
  type PositionedNode,
} from "./layout";
import type { ArchitectureDocModel } from "./parse";

const EDGE_INK = "#4b5563";
const BLOCK_FILL = "#ffffff";
const FRAME_FILL_OPACITY = 0.08;

function renderEdge(edge: PositionedEdge): string {
  const { geometry, labelBox } = edge;
  const near = `<path d="${arrowHeadPath(geometry.end, geometry.headAngle)}" fill="${EDGE_INK}" />`;
  const far =
    edge.bidi &&
    `<path d="${arrowHeadPath(geometry.start, startHeadAngle(geometry.points))}" fill="${EDGE_INK}" />`;
  const line =
    `<path d="${geometry.d}" fill="none" stroke="${EDGE_INK}" stroke-width="1.5" />` + near + (far || "");
  if (!edge.label || !labelBox) return `<g>${line}</g>`;
  return (
    `<g>${line}<rect x="${labelBox.x}" y="${labelBox.y}" width="${labelBox.width}" ` +
    `height="${labelBox.height}" rx="3" fill="${PAPER}" fill-opacity="0.92" />` +
    `<text x="${labelBox.x + labelBox.width / 2}" y="${labelBox.y + labelBox.height / 2 + 11 * 0.36}" ` +
    `text-anchor="middle" font-size="11" fill="${INK}">${esc(edge.label)}</text></g>`
  );
}

function renderFrame(frame: PositionedFrame): string {
  const stroke = frame.color ? COLOR_HEX[frame.color] : MUTED;
  const fill = frame.color ? COLOR_HEX[frame.color] : MUTED;
  return (
    `<g><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" ` +
    `fill="${fill}" fill-opacity="${FRAME_FILL_OPACITY}" stroke="${stroke}" stroke-width="1" />` +
    `<text x="${frame.x + 10}" y="${frame.y + FRAME_HEADER / 2 + FRAME_TITLE_FONT_SIZE * 0.36}" ` +
    `font-size="${FRAME_TITLE_FONT_SIZE}" fill="${INK}">${esc(frame.title)}</text></g>`
  );
}

function renderNode(node: PositionedNode): string {
  const stroke = node.color ? COLOR_HEX[node.color] : INK;
  const outline = shapeMarkup(
    shapeOf(node.shape).outline(node),
    `fill="${BLOCK_FILL}" stroke="${stroke}" stroke-width="${node.strokeWidth}"`,
  );
  const lines = node.lines
    .map(
      (line, i) =>
        `<text x="${node.cx}" y="${nodeTextY(node, i)}" text-anchor="middle" ` +
        `font-size="${node.fontSize}" fill="${INK}">${esc(line)}</text>`,
    )
    .join("");
  const task = node.task
    ? `<text x="${node.cx}" y="${node.y + node.height + 13}" text-anchor="middle" font-size="10" fill="${MUTED}" ` +
      `stroke="${PAPER}" stroke-width="3" paint-order="stroke">${esc(node.task)}</text>`
    : "";
  return `<g>${outline}${lines}${task}</g>`;
}

/** The drawing of a laid-out architecture diagram, without the frame. Frames go
 * under the arrows, arrows under the blocks, and a label sits on its arrow. */
export function renderBody(layout: ArchitectureLayout): string {
  return (
    layout.frames.map(renderFrame).join("") +
    layout.edges.map(renderEdge).join("") +
    layout.nodes.map(renderNode).join("") +
    layout.stickies.map(renderStickySvg).join("")
  );
}

export type ArchitectureExportModel = Pick<ArchitectureDocModel, "frames" | "nodes" | "edges">;

export interface RenderOptions {
  /** Title drawn above the diagram. Omit for a bare diagram. */
  title?: string;
  fontSize?: number;
  /** Stickies to draw. The caller passes none when the note hides them. */
  stickies?: Sticky[];
}

/** Renders the architecture diagram as a standalone `<svg>` element (pure). */
export function renderSvg(model: ArchitectureExportModel, options: RenderOptions = {}): string {
  const layout = layoutArchitecture(model, options.stickies ?? []);
  return svgFrame({
    ...(options.title ? { title: options.title } : {}),
    fontSize: options.fontSize ?? EXPORT_FONT_SIZE,
    bounds: layout.bounds,
    body: renderBody(layout),
  });
}

/** Wraps the SVG in a single-file HTML page. */
export function renderHtml(
  model: ArchitectureExportModel,
  options: { title: string; exportedOn: string; stickies?: Sticky[] },
): string {
  const svg = renderSvg(model, {
    ...(options.stickies ? { stickies: options.stickies } : {}),
  });
  return htmlPage({ title: options.title, exportedOn: options.exportedOn, svg });
}
