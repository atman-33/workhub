/**
 * Static exports of a 2x2 matrix: the SVG that the HTML page embeds and the
 * PNG rasterizes (T-0681). The frame (page, margins, stickies) is shared in
 * `export-frame.ts`; this file draws what is specific to the matrix.
 *
 * It renders `layoutMatrix`'s output - the same call the canvas makes - so
 * what was exported is what was seen, stickies included (the caller passes
 * none when the note hides them).
 */
import { COLOR_HEX } from "../colors";
import {
  ITEM_FONT_SIZE,
  CROSS_STROKE_WIDTH,
  QUADRANT_LABEL_OPACITY,
  layoutMatrix,
  type AxisText,
  type MatrixLayout,
  type MatrixLabels,
  type PositionedItem,
} from "./layout";
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
import { LINE_HEIGHT } from "../text";
import type { Sticky } from "../sticky";
import type { MatrixItem } from "./parse";

const GRID = "#d1d5db";
const CROSS = "#6b7280";
const QUADRANT_FILL = "#f9fafb";

function renderPlot(layout: MatrixLayout): string {
  const quadrants = layout.quadrants
    .map(
      (q) =>
        `<rect x="${q.x}" y="${q.y}" width="${q.width}" height="${q.height}" ` +
        `fill="${QUADRANT_FILL}" stroke="${GRID}" stroke-width="1" />`,
    )
    .join("");
  const labels = layout.quadrants
    .filter((q) => q.label.trim())
    .map(
      (q) =>
        `<text x="${q.textX}" y="${q.textY}" text-anchor="middle" ` +
        `font-size="${q.fontSize}" font-weight="700" fill="${MUTED}" ` +
        `fill-opacity="${QUADRANT_LABEL_OPACITY}">${esc(q.label)}</text>`,
    )
    .join("");
  const cross = layout.cross
    .map(
      (l) =>
        `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" ` +
        `stroke="${CROSS}" stroke-width="${CROSS_STROKE_WIDTH}" />`,
    )
    .join("");
  // Order matters: the rectangles, the cross, then the faint names, so the items drawn after cover all three.
  return quadrants + cross + labels;
}

function renderAxisText(a: AxisText): string {
  const transform = a.rotate ? ` transform="rotate(-90 ${a.x} ${a.y})"` : "";
  return (
    `<text x="${a.x}" y="${a.y}" text-anchor="${a.anchor}" font-size="${a.fontSize}"` +
    `${a.strong ? ' font-weight="600"' : ""} fill="${a.strong ? INK : MUTED}"${transform}>${esc(a.text)}</text>`
  );
}

function renderItem(item: PositionedItem): string {
  const stroke = item.color ? COLOR_HEX[item.color] : MUTED;
  const lineHeight = ITEM_FONT_SIZE * LINE_HEIGHT;
  const firstBaseline =
    item.y + item.height / 2 - ((item.lines.length - 1) * lineHeight) / 2 + ITEM_FONT_SIZE * 0.36;
  const lines = item.lines
    .map(
      (line, i) =>
        `<text x="${item.x + item.width / 2}" y="${firstBaseline + i * lineHeight}" ` +
        `text-anchor="middle" font-size="${ITEM_FONT_SIZE}" fill="${INK}">${esc(line)}</text>`,
    )
    .join("");
  return (
    `<g><rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" ` +
    `rx="8" ry="8" fill="${PAPER}" stroke="${stroke}" stroke-width="1.5" />${lines}</g>`
  );
}

/** The drawing of a laid-out matrix, without the frame. */
export function renderBody(layout: MatrixLayout): string {
  return (
    renderPlot(layout) +
    layout.axisTexts.map(renderAxisText).join("") +
    layout.items.map(renderItem).join("") +
    layout.stickies.map(renderStickySvg).join("")
  );
}

export interface MatrixExportModel extends MatrixLabels {
  items: MatrixItem[];
}

export interface RenderOptions {
  /** Title drawn above the matrix. Omit for a bare diagram. */
  title?: string;
  fontSize?: number;
  /** Stickies to draw. The caller passes none when the note hides them. */
  stickies?: Sticky[];
}

/** Renders the matrix as a standalone `<svg>` element (pure). */
export function renderSvg(model: MatrixExportModel, options: RenderOptions = {}): string {
  const layout = layoutMatrix(model, options.stickies ?? []);
  return svgFrame({
    ...(options.title ? { title: options.title } : {}),
    fontSize: options.fontSize ?? EXPORT_FONT_SIZE,
    bounds: layout.bounds,
    body: renderBody(layout),
  });
}

/** Wraps the SVG in a single-file HTML page. */
export function renderHtml(
  model: MatrixExportModel,
  options: { title: string; exportedOn: string; stickies?: Sticky[] },
): string {
  const svg = renderSvg(model, { ...(options.stickies ? { stickies: options.stickies } : {}) });
  return htmlPage({ title: options.title, exportedOn: options.exportedOn, svg });
}
