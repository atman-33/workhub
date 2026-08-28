/**
 * Static exports of a mindmap: standalone SVG, a single-file HTML page, and
 * the SVG that the PNG export rasterizes.
 *
 * Two hard requirements, the same ones the schedule export answers to:
 *
 * 1. **Single file, no external references.** No CDN stylesheet, no webfont,
 *    no image, no script. The export is emailed and opened on machines with no
 *    network and no relationship to this app.
 * 2. **Same picture as the screen.** It renders `layoutMindmap`'s output — the
 *    same call the canvas makes — so what was exported is what was seen.
 *
 * The PNG path goes through this SVG rather than through a second renderer:
 * rasterizing the exact markup is what keeps three outputs from drifting into
 * three slightly different pictures.
 */

import {
  DEFAULT_LAYOUT,
  layoutMindmap,
  STICKY_FONT_SIZE,
  STICKY_PAD,
  type MindmapLayout,
  type PositionedNode,
  type PositionedSticky,
} from "./layout";
import {
  COLOR_HEX,
  STICKY_FILL_HEX,
  STICKY_INK,
  type MindmapNode,
  type NodeWidth,
  type Sticky,
} from "./parse";

/** Minimal escaping for the user-authored strings that go into the markup.
 * Kept local rather than pulled from a library: the export must stay
 * dependency-free at runtime, and this is the entire surface. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Padding around the drawing, so nothing touches the edge of the image. */
const MARGIN = 32;

const FONT_STACK =
  "ui-sans-serif, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif";

/** Ink and paper for the export. Fixed rather than theme-derived: the file is
 * a hand-out, and a dark-mode export would print as a black page. */
const INK = "#1f2937";
const PAPER = "#ffffff";
const MUTED = "#9ca3af";
const ROOT_FILL = "#111827";

function nodeStroke(node: PositionedNode): string {
  const color = node.color ?? node.branchColor;
  return color ? COLOR_HEX[color] : MUTED;
}

function renderNode(node: PositionedNode, fontSize: number): string {
  const stroke = nodeStroke(node);
  const isRoot = node.depth === 0;
  const fill = isRoot ? ROOT_FILL : PAPER;
  const textFill = isRoot ? PAPER : INK;
  const radius = isRoot ? node.height / 2 : 8;
  const lineHeight = fontSize * 1.45;
  // First baseline: centre the block of lines in the box, then drop to the
  // baseline of the first one.
  const firstBaseline =
    node.y + node.height / 2 - ((node.lines.length - 1) * lineHeight) / 2 + fontSize * 0.36;

  const lines = node.lines
    .map(
      (line, i) =>
        `<text x="${node.x + node.width / 2}" y="${firstBaseline + i * lineHeight}" ` +
        `text-anchor="middle" font-size="${fontSize}" fill="${textFill}"${isRoot ? ' font-weight="600"' : ""}>` +
        `${esc(line)}</text>`,
    )
    .join("");

  const collapsed = node.collapsed
    ? `<circle cx="${node.side === "right" ? node.x + node.width + 7 : node.x - 7}" ` +
      `cy="${node.y + node.height / 2}" r="6" fill="${PAPER}" stroke="${stroke}" stroke-width="1.5" />` +
      `<text x="${node.side === "right" ? node.x + node.width + 7 : node.x - 7}" ` +
      `y="${node.y + node.height / 2 + 3.5}" text-anchor="middle" font-size="9" fill="${INK}">` +
      `${node.childCount}</text>`
    : "";

  return (
    `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" ` +
    `rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${isRoot ? 0 : 1.5}" />` +
    `${lines}${collapsed}</g>`
  );
}

function renderEdges(layout: MindmapLayout): string {
  return layout.edges
    .map(
      (edge) =>
        `<path d="${edge.path}" fill="none" stroke="${edge.color ? COLOR_HEX[edge.color] : MUTED}" ` +
        `stroke-width="1.75" stroke-linecap="round" />`,
    )
    .join("");
}

/** One sticky, drawn exactly as the canvas draws it — the leader line, the
 * paper, the text. The export and the screen share the layout, so sharing the
 * rendering rules is what stops the two pictures from drifting apart. */
function renderSticky(sticky: PositionedSticky): string {
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

export interface SvgOptions {
  /** Title drawn above the map. Omit for a bare diagram. */
  title?: string;
  fontSize?: number;
  /** The note's box-width setting, so the export matches the screen. */
  nodeWidth?: NodeWidth;
  /** Stickies to draw. The caller passes none when the note hides them, which
   * is what makes the export match what was on screen. */
  stickies?: Sticky[];
}

/**
 * Renders the tree as a standalone `<svg>` element.
 *
 * The viewBox is the drawing's own bounds plus a margin, so the image is
 * exactly as large as the map — an export is not a screenshot of a window.
 */
export function toSvg(roots: MindmapNode[], options: SvgOptions = {}): string {
  const fontSize = options.fontSize ?? DEFAULT_LAYOUT.fontSize;
  const layout = layoutMindmap(roots, {
    fontSize,
    nodeWidth: options.nodeWidth ?? DEFAULT_LAYOUT.nodeWidth,
    stickies: options.stickies ?? [],
  });
  const titleHeight = options.title ? fontSize * 2.5 : 0;

  const { bounds } = layout;
  const width = Math.max(bounds.width, 1) + MARGIN * 2;
  const height = Math.max(bounds.height, 1) + MARGIN * 2 + titleHeight;
  const minX = bounds.x - MARGIN;
  const minY = bounds.y - MARGIN - titleHeight;

  const heading = options.title
    ? `<text x="${bounds.x}" y="${minY + fontSize * 1.6}" font-size="${fontSize * 1.3}" ` +
      `font-weight="600" fill="${INK}">${esc(options.title)}</text>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" ` +
    `viewBox="${minX} ${minY} ${width} ${height}" font-family="${FONT_STACK}">` +
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${PAPER}" />` +
    `${heading}${renderEdges(layout)}` +
    `${layout.nodes.map((n) => renderNode(n, fontSize)).join("")}` +
    `${layout.stickies.map(renderSticky).join("")}` +
    `</svg>`
  );
}

/**
 * Wraps the SVG in a single-file HTML page.
 *
 * Deliberately inert: no JavaScript at all, so it opens under any policy and
 * "Print → Save as PDF" is the whole distribution story. The mermaid source is
 * included as text below the diagram, because the reason to hand this file to
 * someone is often so they can lift the diagram into their own document.
 */
export function toHtml(
  roots: MindmapNode[],
  options: {
    title: string;
    exportedOn: string;
    mermaid?: string;
    nodeWidth?: NodeWidth;
    stickies?: Sticky[];
  },
): string {
  const svg = toSvg(roots, {
    ...(options.nodeWidth ? { nodeWidth: options.nodeWidth } : {}),
    ...(options.stickies ? { stickies: options.stickies } : {}),
  });
  const mermaid = options.mermaid
    ? `<h2>mermaid</h2><pre><code>${esc(options.mermaid)}</code></pre>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(options.title)}</title>
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
  <h1>${esc(options.title)}</h1>
  <div class="meta">exported ${esc(options.exportedOn)}</div>
</header>
<div class="map">${svg}</div>
${mermaid}
</body>
</html>
`;
}
