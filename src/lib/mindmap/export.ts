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
  CHIP_FONT_SIZE,
  CHIP_GAP,
  CHIP_HEIGHT,
  CHIP_TOP_GAP,
  chipWidth,
  DEFAULT_LAYOUT,
  DIMMED_OPACITY,
  ID_BASELINE,
  ID_FONT_SIZE,
  layoutMindmap,
  type MindmapLayout,
  type PositionedNode,
} from "./layout";
import {
  esc,
  htmlPage,
  INK,
  MUTED,
  PAPER,
  renderStickySvg,
  svgFrame,
} from "../diagram/export-frame";
import {
  COLOR_HEX,
  DEFAULT_ATTR_VIEW,
  STICKY_FILL_HEX,
  STICKY_INK,
  type AttrView,
  type MindmapNode,
  type NodeWidth,
  type Sticky,
} from "./parse";

const ROOT_FILL = "#111827";
const ROOT_ID_INK = "#d1d5db";

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
  // First baseline: centre the block of lines in the box *above* the chip
  // band, then drop to the baseline of the first one.
  const titleHeight = node.height - node.chipsHeight;
  const firstBaseline =
    node.y +
    node.idHeight +
    (titleHeight - node.idHeight) / 2 -
    ((node.lines.length - 1) * lineHeight) / 2 +
    fontSize * 0.36;

  const id = node.idHeight
    ? `<text x="${node.x + node.width / 2}" y="${node.y + ID_BASELINE}" text-anchor="middle" ` +
      `font-size="${ID_FONT_SIZE}" fill="${isRoot ? ROOT_ID_INK : MUTED}">${esc(node.id)}</text>`
    : "";

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
    `<g${node.dimmed ? ` opacity="${DIMMED_OPACITY}"` : ""}>` +
    `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" ` +
    `rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${isRoot ? 0 : 1.5}" />` +
    `${id}${lines}${renderChips(node, titleHeight)}${collapsed}</g>`
  );
}

/**
 * The attribute chips at the bottom of a box.
 *
 * Reads the rows the layout already packed rather than packing its own, which
 * is the whole reason `chipRows` is part of the layout output: an export that
 * wrapped chips differently from the screen would be a different picture of
 * the same map.
 */
function renderChips(node: PositionedNode, titleHeight: number): string {
  if (!node.chipRows.length) return "";
  const out: string[] = [];
  node.chipRows.forEach((row, rowIndex) => {
    const rowWidth =
      row.reduce((sum, c) => sum + chipWidth(c), 0) + Math.max(0, row.length - 1) * CHIP_GAP;
    const y = node.y + titleHeight + CHIP_TOP_GAP + rowIndex * (CHIP_HEIGHT + CHIP_GAP);
    let cursor = node.x + (node.width - rowWidth) / 2;
    for (const chip of row) {
      const w = chipWidth(chip);
      out.push(
        `<rect x="${cursor}" y="${y}" width="${w}" height="${CHIP_HEIGHT}" ` +
          `rx="${CHIP_HEIGHT / 2}" ry="${CHIP_HEIGHT / 2}" fill="${STICKY_FILL_HEX[chip.color]}" ` +
          `stroke="${COLOR_HEX[chip.color]}" stroke-width="1" />`,
        `<text x="${cursor + w / 2}" y="${y + CHIP_HEIGHT / 2 + CHIP_FONT_SIZE * 0.36}" ` +
          `text-anchor="middle" font-size="${CHIP_FONT_SIZE}" fill="${STICKY_INK}">` +
          `${esc(chip.label)}</text>`,
      );
      cursor += w + CHIP_GAP;
    }
  });
  return out.join("");
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

export interface SvgOptions {
  /** Title drawn above the map. Omit for a bare diagram. */
  title?: string;
  fontSize?: number;
  /** The note's box-width setting, so the export matches the screen. */
  nodeWidth?: NodeWidth;
  /** The note's attribute view, for the same reason: an export made while the
   * map was filtered has to come out filtered. */
  attrView?: AttrView;
  /** Draw each node's id, as the note's `node_ids: show` does on screen. */
  showIds?: boolean;
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
    attrView: options.attrView ?? DEFAULT_ATTR_VIEW,
    showIds: options.showIds ?? false,
    stickies: options.stickies ?? [],
  });

  return svgFrame({
    ...(options.title ? { title: options.title } : {}),
    fontSize,
    bounds: layout.bounds,
    body:
      `${renderEdges(layout)}` +
      `${layout.nodes.map((n) => renderNode(n, fontSize)).join("")}` +
      `${layout.stickies.map(renderStickySvg).join("")}`,
  });
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
    attrView?: AttrView;
    showIds?: boolean;
    stickies?: Sticky[];
  },
): string {
  const svg = toSvg(roots, {
    ...(options.nodeWidth ? { nodeWidth: options.nodeWidth } : {}),
    ...(options.attrView ? { attrView: options.attrView } : {}),
    ...(options.showIds ? { showIds: true } : {}),
    ...(options.stickies ? { stickies: options.stickies } : {}),
  });
  const mermaid = options.mermaid
    ? `<h2>mermaid</h2><pre><code>${esc(options.mermaid)}</code></pre>`
    : "";
  return htmlPage({ title: options.title, exportedOn: options.exportedOn, svg, extra: mermaid });
}
