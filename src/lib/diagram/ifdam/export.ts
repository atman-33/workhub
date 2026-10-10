/**
 * Static exports of an IFDAM diagram: the SVG that the HTML page embeds and the
 * PNG rasterizes (T-0703). The frame (page, margins, stickies) is shared in
 * `export-frame.ts`; this file draws what is specific to IFDAM.
 *
 * It renders `layoutIfdam`'s output - the same call the canvas makes - so what
 * was exported is what was seen, stickies included (the caller passes none when
 * the note hides them). The names of a screen's sections ("Show", "Input",
 * "Action") depend on the display language and the file does not carry them, so
 * the caller passes them in; `renderSvg` stays a pure function of its arguments.
 */
import { COLOR_HEX, STICKY_FILL_HEX } from "../colors";
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
  ITEM_LINE_HEIGHT,
  layoutIfdam,
  NODE_FONT_SIZE,
  nodeTextY,
  SCREEN_BULLET_WIDTH,
  SCREEN_CAPTION_FONT_SIZE,
  SCREEN_ITEM_FONT_SIZE,
  SCREEN_PAD_X,
  SCREEN_TITLE_FONT_SIZE,
  type IfdamLayout,
  type PositionedEdge,
  type PositionedNode,
} from "./layout";
import type { IfdamDocModel, SectionKey } from "./parse";

const EDGE_INK = "#4b5563";
const CAPTION_INK = "#6b7280";
const BAND_FILL = "#f3f4f6";

/** Names of a screen's sections. */
export type SectionCaptions = Record<SectionKey, string>;

/** Japanese, the app's default language; the view passes the current language's. */
export const DEFAULT_CAPTIONS: SectionCaptions = {
  show: "表示項目",
  input: "入力項目",
  action: "操作項目",
};

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

function renderScreen(node: PositionedNode, captions: SectionCaptions, stroke: string): string {
  const outline = shapeMarkup(
    shapeOf(node.shape).outline({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rules: node.rules,
    }),
    `fill="${PAPER}" stroke="${stroke}" stroke-width="1.5"`,
  );
  // A light band behind the title, inside the frame and above the first rule.
  const band =
    node.band > 0
      ? `<rect x="${node.x + 1}" y="${node.y + 1}" width="${node.width - 2}" height="${node.band - 1}" ` +
        `fill="${node.color ? STICKY_FILL_HEX[node.color] : BAND_FILL}" />`
      : "";
  const title = node.lines
    .map(
      (line, i) =>
        `<text x="${node.x + SCREEN_PAD_X}" y="${nodeTextY(node, i)}" font-size="${SCREEN_TITLE_FONT_SIZE}" ` +
        `font-weight="600" fill="${INK}">${esc(line)}</text>`,
    )
    .join("");
  const sections = node.sections
    .map((section) => {
      const caption =
        `<text x="${node.x + SCREEN_PAD_X}" y="${node.y + section.captionY}" ` +
        `font-size="${SCREEN_CAPTION_FONT_SIZE}" fill="${CAPTION_INK}">${esc(captions[section.key])}</text>`;
      const items = section.items
        .map((item) => {
          const top = node.y + item.y;
          const bullet =
            `<text x="${node.x + SCREEN_PAD_X}" y="${top}" font-size="${SCREEN_ITEM_FONT_SIZE}" fill="${INK}">・</text>`;
          const text = item.lines
            .map(
              (line, i) =>
                `<text x="${node.x + SCREEN_PAD_X + SCREEN_BULLET_WIDTH}" y="${top + i * ITEM_LINE_HEIGHT}" ` +
                `font-size="${SCREEN_ITEM_FONT_SIZE}" fill="${INK}">${esc(line)}</text>`,
            )
            .join("");
          return bullet + text;
        })
        .join("");
      return caption + items;
    })
    .join("");
  return outline + band + title + sections;
}

function renderNode(node: PositionedNode, captions: SectionCaptions): string {
  const stroke = node.color ? COLOR_HEX[node.color] : MUTED;
  let inner: string;
  if (node.kind === "screen") {
    inner = renderScreen(node, captions, stroke);
  } else {
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
    inner = outline + lines;
  }
  // Above the node, not below: a data store hangs under its process, and the
  // line between them would run through the text.
  const task = node.task
    ? `<text x="${node.cx}" y="${node.y - 5}" text-anchor="middle" font-size="10" fill="${MUTED}">${esc(node.task)}</text>`
    : "";
  return `<g>${inner}${task}</g>`;
}

/** The drawing of a laid-out diagram, without the frame. Arrows go under the
 * nodes, and a label sits on its arrow. */
export function renderBody(
  layout: IfdamLayout,
  captions: SectionCaptions = DEFAULT_CAPTIONS,
): string {
  return (
    layout.edges.map(renderEdge).join("") +
    layout.nodes.map((n) => renderNode(n, captions)).join("") +
    layout.stickies.map(renderStickySvg).join("")
  );
}

export type IfdamExportModel = Pick<IfdamDocModel, "nodes" | "edges">;

export interface RenderOptions {
  /** Title drawn above the diagram. Omit for a bare diagram. */
  title?: string;
  fontSize?: number;
  /** Stickies to draw. The caller passes none when the note hides them. */
  stickies?: Sticky[];
  /** Names of the screen's sections in the display language. Defaults to Japanese. */
  captions?: SectionCaptions;
}

/** Renders the diagram as a standalone `<svg>` element (pure). */
export function renderSvg(model: IfdamExportModel, options: RenderOptions = {}): string {
  const layout = layoutIfdam(model, options.stickies ?? []);
  return svgFrame({
    ...(options.title ? { title: options.title } : {}),
    fontSize: options.fontSize ?? EXPORT_FONT_SIZE,
    bounds: layout.bounds,
    body: renderBody(layout, options.captions ?? DEFAULT_CAPTIONS),
  });
}

/** Wraps the SVG in a single-file HTML page. */
export function renderHtml(
  model: IfdamExportModel,
  options: { title: string; exportedOn: string; stickies?: Sticky[]; captions?: SectionCaptions },
): string {
  const svg = renderSvg(model, {
    ...(options.stickies ? { stickies: options.stickies } : {}),
    ...(options.captions ? { captions: options.captions } : {}),
  });
  return htmlPage({ title: options.title, exportedOn: options.exportedOn, svg });
}
