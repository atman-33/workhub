/**
 * Static exports of a business flow: the SVG that the HTML page embeds and the
 * PNG rasterizes (T-0682). The frame (page, margins, stickies) is shared in
 * `export-frame.ts`; this file draws what is specific to the flow.
 *
 * It renders `layoutFlow`'s output - the same call the canvas makes - so what
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
import {
  bandHeaderText,
  EDGE_LABEL_FONT_SIZE,
  LANE_FONT_SIZE,
  layoutFlow,
  STEP_FONT_SIZE,
  stepTextY,
  type FlowLayout,
  type PositionedBand,
  type PositionedEdge,
  type PositionedStep,
} from "./layout";
import type { FlowDocModel } from "./parse";

const GRID = "#d1d5db";
const BAND_FILL = "#f9fafb";
const HEADER_FILL = "#f3f4f6";
const EDGE_INK = "#4b5563";

function renderBand(band: PositionedBand): string {
  const accent = band.color ? COLOR_HEX[band.color] : MUTED;
  const header = bandHeaderText(band);
  const strip = band.headerWidth
    ? `<rect x="${band.x}" y="${band.y}" width="${band.headerWidth}" height="${band.height}" ` +
      `fill="${HEADER_FILL}" stroke="${GRID}" stroke-width="1" />` +
      `<rect x="${band.x}" y="${band.y}" width="3" height="${band.height}" fill="${accent}" />`
    : "";
  const title = header
    ? `<text x="${header.x}" y="${header.y}" text-anchor="middle" font-size="${LANE_FONT_SIZE}" ` +
      `font-weight="600" fill="${INK}" transform="rotate(-90 ${header.x} ${header.y})">${esc(header.text)}</text>`
    : "";
  return (
    `<rect x="${band.x}" y="${band.y}" width="${band.width}" height="${band.height}" ` +
    `fill="${BAND_FILL}" stroke="${GRID}" stroke-width="1" />${strip}${title}`
  );
}

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

function renderStep(step: PositionedStep): string {
  const stroke = step.color ? COLOR_HEX[step.color] : MUTED;
  const outline = shapeMarkup(
    shapeOf(step.shape).outline(step),
    `fill="${PAPER}" stroke="${stroke}" stroke-width="1.5"`,
  );
  const lines = step.lines
    .map(
      (line, i) =>
        `<text x="${step.cx}" y="${stepTextY(step, i)}" text-anchor="middle" ` +
        `font-size="${STEP_FONT_SIZE}" fill="${INK}">${esc(line)}</text>`,
    )
    .join("");
  const task = step.task
    ? `<text x="${step.cx}" y="${step.y + step.height + 12}" text-anchor="middle" font-size="10" fill="${MUTED}">${esc(step.task)}</text>`
    : "";
  return `<g>${outline}${lines}${task}</g>`;
}

/** The drawing of a laid-out flow, without the frame. */
export function renderBody(layout: FlowLayout): string {
  return (
    layout.bands.map(renderBand).join("") +
    layout.edges.map(renderEdge).join("") +
    layout.steps.map(renderStep).join("") +
    layout.stickies.map(renderStickySvg).join("")
  );
}

export type FlowExportModel = Pick<FlowDocModel, "lanes" | "steps" | "edges">;

export interface RenderOptions {
  /** Title drawn above the flow. Omit for a bare diagram. */
  title?: string;
  fontSize?: number;
  /** Stickies to draw. The caller passes none when the note hides them. */
  stickies?: Sticky[];
  /** Name of the band for unassigned steps. */
  unassignedLabel?: string;
}

/** Renders the flow as a standalone `<svg>` element (pure). */
export function renderSvg(model: FlowExportModel, options: RenderOptions = {}): string {
  const layout = layoutFlow(model, options.stickies ?? [], {
    ...(options.unassignedLabel ? { unassignedLabel: options.unassignedLabel } : {}),
  });
  return svgFrame({
    ...(options.title ? { title: options.title } : {}),
    fontSize: options.fontSize ?? EXPORT_FONT_SIZE,
    bounds: layout.bounds,
    body: renderBody(layout),
  });
}

/** Wraps the SVG in a single-file HTML page. */
export function renderHtml(
  model: FlowExportModel,
  options: { title: string; exportedOn: string; stickies?: Sticky[]; unassignedLabel?: string },
): string {
  const svg = renderSvg(model, {
    ...(options.stickies ? { stickies: options.stickies } : {}),
    ...(options.unassignedLabel ? { unassignedLabel: options.unassignedLabel } : {}),
  });
  return htmlPage({ title: options.title, exportedOn: options.exportedOn, svg });
}
