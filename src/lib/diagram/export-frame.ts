/**
 * The frame every diagram export is built in.
 *
 * Each kind supplies a pure `renderSvg(model, options)` that draws its own
 * geometry; this module wraps that body in the standalone `<svg>` and the
 * single-file HTML page, and draws the stickies, so the kinds only differ in
 * what they put inside.
 *
 * Two hard requirements, the same ones the schedule export answers to:
 *
 * 1. **Single file, no external references.** No CDN stylesheet, no webfont,
 *    no image, no script. The export is emailed and opened on machines with no
 *    network and no relationship to this app.
 * 2. **Same picture as the screen.** A kind's `renderSvg` is fed the layout
 *    the canvas draws from, so what was exported is what was seen. The PNG goes
 *    through the same SVG (`raster.ts`) rather than a second renderer.
 */
import { COLOR_HEX, STICKY_FILL_HEX, STICKY_INK } from "./colors";
import {
  STICKY_FONT_SIZE,
  STICKY_PAD,
  type Box,
  type PositionedSticky,
} from "./sticky-layout";

/** Minimal escaping for the user-authored strings that go into the markup.
 * Kept local rather than pulled from a library: the export must stay
 * dependency-free at runtime, and this is the entire surface. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Padding around the drawing, so nothing touches the edge of the image. */
export const MARGIN = 32;

export const FONT_STACK =
  "ui-sans-serif, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif";

/** Ink and paper for the export. Fixed rather than theme-derived: the file is
 * a hand-out, and a dark-mode export would print as a black page. */
export const INK = "#1f2937";
export const PAPER = "#ffffff";
export const MUTED = "#9ca3af";

/** Default body font size of an export. */
export const EXPORT_FONT_SIZE = 14;

/** One sticky, drawn exactly as the canvas draws it - the leader line, the
 * paper, the text. The export and the screen share the layout, so sharing the
 * rendering rules is what stops the two pictures from drifting apart. */
export function renderStickySvg(sticky: PositionedSticky): string {
  const lineHeight = STICKY_FONT_SIZE * 1.45;
  const firstBaseline = sticky.y + STICKY_PAD + STICKY_FONT_SIZE * 0.9;
  const lines = sticky.lines
    .map(
      (line, i) =>
        `<text x="${sticky.x + STICKY_PAD}" y="${firstBaseline + i * lineHeight}" ` +
        `font-size="${STICKY_FONT_SIZE}" fill="${STICKY_INK}">${esc(line)}</text>`,
    )
    .join("");

  return (
    `<g><path d="M ${sticky.anchorX} ${sticky.anchorY} L ${sticky.x + sticky.width / 2} ` +
    `${sticky.y + sticky.height / 2}" fill="none" stroke="${COLOR_HEX[sticky.color]}" ` +
    `stroke-opacity="0.5" stroke-width="1" stroke-dasharray="3 3" />` +
    `<rect x="${sticky.x}" y="${sticky.y}" width="${sticky.width}" height="${sticky.height}" ` +
    `rx="3" ry="3" fill="${STICKY_FILL_HEX[sticky.color]}" stroke="${COLOR_HEX[sticky.color]}" ` +
    `stroke-width="1" />${lines}</g>`
  );
}

export interface SvgFrameOptions {
  /** Title drawn above the drawing. Omit for a bare diagram. */
  title?: string;
  fontSize?: number;
  /** Bounds of everything drawn, before the margin. */
  bounds: Box;
  /** The kind's own markup: elements first, stickies last. */
  body: string;
}

/**
 * Wraps a kind's drawing in a standalone `<svg>` element.
 *
 * The viewBox is the drawing's own bounds plus a margin, so the image is
 * exactly as large as the diagram - an export is not a screenshot of a window.
 */
export function svgFrame({ title, fontSize = EXPORT_FONT_SIZE, bounds, body }: SvgFrameOptions): string {
  const titleHeight = title ? fontSize * 2.5 : 0;
  const width = Math.max(bounds.width, 1) + MARGIN * 2;
  const height = Math.max(bounds.height, 1) + MARGIN * 2 + titleHeight;
  const minX = bounds.x - MARGIN;
  const minY = bounds.y - MARGIN - titleHeight;

  const heading = title
    ? `<text x="${bounds.x}" y="${minY + fontSize * 1.6}" font-size="${fontSize * 1.3}" ` +
      `font-weight="600" fill="${INK}">${esc(title)}</text>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" ` +
    `viewBox="${minX} ${minY} ${width} ${height}" font-family="${FONT_STACK}">` +
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${PAPER}" />` +
    `${heading}${body}` +
    `</svg>`
  );
}

export interface HtmlPageOptions {
  title: string;
  exportedOn: string;
  /** The `<svg>` from `svgFrame`. */
  svg: string;
  /** Extra markup below the diagram (a kind's text rendition), already escaped. */
  extra?: string;
}

/**
 * Wraps the SVG in a single-file HTML page.
 *
 * Deliberately inert: no JavaScript at all, so it opens under any policy and
 * "Print -> Save as PDF" is the whole distribution story.
 */
export function htmlPage({ title, exportedOn, svg, extra = "" }: HtmlPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: ${PAPER}; color: ${INK};
         font-family: ${FONT_STACK}; }
  header { margin-bottom: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 12px; }
  .map { overflow-x: auto; }
  svg { max-width: 100%; height: auto; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em;
       color: #6b7280; margin: 32px 0 8px; }
  pre { background: #f3f4f6; border-radius: 8px; padding: 12px 16px;
        overflow-x: auto; font-size: 12px; line-height: 1.5; }
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <div class="meta">exported ${esc(exportedOn)}</div>
</header>
<div class="map">${svg}</div>
${extra}
</body>
</html>
`;
}

/** File-name safe form of a title for an export (`<title>.html` / `.png`). */
export function exportFileName(title: string, fallback: string, ext: string): string {
  return `${(title || fallback).replace(/[\\/:*?"<>|]/g, "-")}.${ext}`;
}
