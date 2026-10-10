/**
 * 2x2 matrix layout: the one geometry the canvas and the exports both draw.
 *
 * The plot is a fixed rectangle; an item sits at `(x, y)` in unit coordinates
 * (x: left 0 to right 1, y: bottom 0 to top 1), so what moves with the window
 * is only the camera. Everything is computed here with fixed text metrics, so
 * an export rendered on another machine puts every box where the app did.
 */
import type { Color } from "../colors";
import {
  boundsOfBoxes,
  placeSticky,
  type Box,
  type PositionedSticky,
} from "../sticky-layout";
import type { Sticky } from "../sticky";
import { LINE_HEIGHT, NODE_PAD_X, textWidth, wrapTitle } from "../text";
import type { QuadrantKey } from "./quadrant-notes";
import { clampUnit, type LabelField, type MatrixItem } from "./parse";

export type { QuadrantKey };

/** The plot rectangle, in diagram pixels. */
export const PLOT: Box = { x: 0, y: 0, width: 720, height: 520 };

export const ITEM_FONT_SIZE = 13;
export const ITEM_PAD_Y = 6;
export const ITEM_MIN_WIDTH = 56;
/** Wrap width of an item's title; the box grows to its text up to this. */
export const ITEM_MAX_WIDTH = 190;
export const AXIS_FONT_SIZE = 12;
/** The axis names (`x_axis` / `y_axis`): small, so they never compete with the end labels. */
export const AXIS_NAME_FONT_SIZE = 11;
/** Gap between the plot edge and an end label. */
const AXIS_GAP = 12;
/** The largest a quadrant name is drawn; a longer name shrinks to fit its quadrant. */
export const QUADRANT_FONT_SIZE = 44;
/** The smallest a quadrant name shrinks to before it is left to overflow. */
const QUADRANT_MIN_FONT_SIZE = 16;
/** Opacity of the quadrant names: a watermark that never hinders placing nodes. A fixed constant, not a setting. */
export const QUADRANT_LABEL_OPACITY = 0.12;
/** Stroke width of the central cross lines. */
export const CROSS_STROKE_WIDTH = 2;

/** Side of the note mark a quadrant with a note carries, and its distance from the plot corner. */
export const NOTE_MARK_SIZE = 14;
export const NOTE_MARK_INSET = 10;

/** The box of a quadrant's note mark, top-left origin. */
export type NoteMark = Box;

export interface PositionedQuadrant {
  key: QuadrantKey;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where the label is drawn: its horizontal centre and its baseline. */
  textX: number;
  textY: number;
  /** The label's font size, shrunk from `QUADRANT_FONT_SIZE` to fit the quadrant. */
  fontSize: number;
  /** The mark of a quadrant that has a note, in its outer corner. Absent without a note. Never exported. */
  noteMark?: NoteMark;
}

/** A straight line of the plot's central cross. */
export interface CrossLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A piece of axis text. `rotate` draws it quarter-turned, reading upward. */
export interface AxisText {
  id: "x_axis" | "x_low" | "x_high" | "y_axis" | "y_low" | "y_high";
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  rotate: boolean;
  /** The axis name, drawn heavier (and smaller) than the end names. */
  strong: boolean;
  fontSize: number;
}

export interface PositionedItem {
  id: string;
  title: string;
  /** Title split into the lines the box renders. */
  lines: string[];
  color?: Color;
  task?: string;
  note?: string;
  /** Unit coordinates the item is drawn at (the file's, or the default). */
  fx: number;
  fy: number;
  /** False when the file gave no `@` and the layout chose the spot. */
  placed: boolean;
  /** The box, top-left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MatrixLayout {
  plot: Box;
  quadrants: PositionedQuadrant[];
  /** The vertical and horizontal lines through the plot's centre. */
  cross: CrossLine[];
  axisTexts: AxisText[];
  items: PositionedItem[];
  /** Sticky notes, empty when the note hides them. */
  stickies: PositionedSticky[];
  /** Bounding box of everything drawn, before any padding the view adds. */
  bounds: Box;
  byId: Map<string, PositionedItem>;
}

export type MatrixLabels = Record<LabelField, string>;

// ---------------------------------------------------------------------------
// coordinates
// ---------------------------------------------------------------------------

/** The diagram point for unit coordinates. */
export function pointOf(fx: number, fy: number): { x: number; y: number } {
  return { x: PLOT.x + fx * PLOT.width, y: PLOT.y + (1 - fy) * PLOT.height };
}

/** Unit coordinates (rounded, clamped to the plot) for a diagram point. */
export function unitAt(x: number, y: number): { x: number; y: number } {
  return {
    x: clampUnit((x - PLOT.x) / PLOT.width),
    y: clampUnit(1 - (y - PLOT.y) / PLOT.height),
  };
}

/**
 * Where the `k`-th item of the note goes when it has no `@`: near the middle,
 * each a little apart from the last so a handful of new items do not stack into
 * one box.
 */
export function defaultUnit(k: number): { x: number; y: number } {
  const step = k % 7;
  const column = Math.floor(k / 7) % 3;
  return {
    x: clampUnit(0.5 + 0.02 * (step - 3) + 0.16 * (column - 1)),
    y: clampUnit(0.5 + 0.065 * (3 - step)),
  };
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

function measureItem(item: MatrixItem, fx: number, fy: number, placed: boolean): PositionedItem {
  const lines = wrapTitle(item.title, ITEM_MAX_WIDTH, ITEM_FONT_SIZE);
  const widest = Math.max(...lines.map((l) => textWidth(l, ITEM_FONT_SIZE)));
  const width = Math.max(ITEM_MIN_WIDTH, Math.ceil(widest) + NODE_PAD_X * 2);
  const height = Math.ceil(lines.length * ITEM_FONT_SIZE * LINE_HEIGHT) + ITEM_PAD_Y * 2;
  const p = pointOf(fx, fy);
  return {
    id: item.id,
    title: item.title,
    lines,
    ...(item.color ? { color: item.color } : {}),
    ...(item.task ? { task: item.task } : {}),
    ...(item.note ? { note: item.note } : {}),
    fx,
    fy,
    placed,
    x: p.x - width / 2,
    y: p.y - height / 2,
    width,
    height,
  };
}

/** Font size of a quadrant name: as large as allowed while it fits the quadrant's width. */
export function quadrantFontSize(label: string, width: number): number {
  const avail = width - 24;
  const natural = textWidth(label, QUADRANT_FONT_SIZE);
  if (natural <= avail) return QUADRANT_FONT_SIZE;
  return Math.max(QUADRANT_MIN_FONT_SIZE, Math.floor((QUADRANT_FONT_SIZE * avail) / natural));
}

function quadrantsOf(
  labels: MatrixLabels,
  notes: Partial<Record<QuadrantKey, string>>,
): PositionedQuadrant[] {
  const w = PLOT.width / 2;
  const h = PLOT.height / 2;
  const at = (
    key: QuadrantKey,
    label: string,
    col: 0 | 1,
    row: 0 | 1,
  ): PositionedQuadrant => {
    const fontSize = quadrantFontSize(label, w);
    const x = PLOT.x + col * w;
    const y = PLOT.y + row * h;
    // The outer corner: top-left for tl, bottom-right for br, and so on.
    const mark: NoteMark = {
      x: col === 0 ? x + NOTE_MARK_INSET : x + w - NOTE_MARK_INSET - NOTE_MARK_SIZE,
      y: row === 0 ? y + NOTE_MARK_INSET : y + h - NOTE_MARK_INSET - NOTE_MARK_SIZE,
      width: NOTE_MARK_SIZE,
      height: NOTE_MARK_SIZE,
    };
    return {
      key,
      label,
      x: PLOT.x + col * w,
      y: PLOT.y + row * h,
      width: w,
      height: h,
      textX: PLOT.x + col * w + w / 2,
      // The baseline that puts the glyphs' visual middle on the quadrant's centre.
      textY: PLOT.y + row * h + h / 2 + fontSize * 0.35,
      fontSize,
      ...((notes[key] ?? "").trim() ? { noteMark: mark } : {}),
    };
  };
  return [
    at("tl", labels.qTl, 0, 0),
    at("tr", labels.qTr, 1, 0),
    at("bl", labels.qBl, 0, 1),
    at("br", labels.qBr, 1, 1),
  ];
}

function crossOf(): CrossLine[] {
  const cx = PLOT.x + PLOT.width / 2;
  const cy = PLOT.y + PLOT.height / 2;
  return [
    { x1: cx, y1: PLOT.y, x2: cx, y2: PLOT.y + PLOT.height },
    { x1: PLOT.x, y1: cy, x2: PLOT.x + PLOT.width, y2: cy },
  ];
}

/**
 * The end labels sit at the middle of each edge, outside the plot, like a cross
 * axis diagram; the axis names are small and tucked in a corner where no end
 * label can reach (below the plot's right end, along the left edge's top).
 */
function axisTextsOf(labels: MatrixLabels): AxisText[] {
  const cx = PLOT.x + PLOT.width / 2;
  const cy = PLOT.y + PLOT.height / 2;
  const right = PLOT.x + PLOT.width;
  const bottom = PLOT.y + PLOT.height;
  const end = (
    id: AxisText["id"],
    text: string,
    x: number,
    y: number,
    anchor: AxisText["anchor"],
  ): AxisText => ({ id, text, x, y, anchor, rotate: false, strong: false, fontSize: AXIS_FONT_SIZE });
  const name = (
    id: AxisText["id"],
    text: string,
    x: number,
    y: number,
    anchor: AxisText["anchor"],
    rotate: boolean,
  ): AxisText => ({ id, text, x, y, anchor, rotate, strong: true, fontSize: AXIS_NAME_FONT_SIZE });
  const all: AxisText[] = [
    end("x_low", labels.xLow, PLOT.x - AXIS_GAP, cy + AXIS_FONT_SIZE * 0.35, "end"),
    end("x_high", labels.xHigh, right + AXIS_GAP, cy + AXIS_FONT_SIZE * 0.35, "start"),
    end("y_high", labels.yHigh, cx, PLOT.y - AXIS_GAP, "middle"),
    end("y_low", labels.yLow, cx, bottom + AXIS_GAP + AXIS_FONT_SIZE, "middle"),
    name("x_axis", labels.xAxis, right, bottom + AXIS_GAP + AXIS_NAME_FONT_SIZE + 22, "end", false),
    name("y_axis", labels.yAxis, PLOT.x - AXIS_GAP, PLOT.y, "end", true),
  ];
  // An empty label is not drawn at all.
  return all.filter((a) => a.text.trim());
}

/** The box a piece of axis text covers, for the bounds. */
function axisTextBox(a: AxisText): Box {
  const w = textWidth(a.text, a.fontSize);
  const up = a.fontSize;
  const down = a.fontSize * 0.3;
  // Rotated text reads upward and, anchored at its end, hangs below its point.
  if (a.rotate) return { x: a.x - up, y: a.y, width: up + down, height: w };
  const x = a.anchor === "start" ? a.x : a.anchor === "end" ? a.x - w : a.x - w / 2;
  return { x, y: a.y - up, width: w, height: up + down };
}

export function layoutMatrix(
  doc: { items: MatrixItem[]; quadrantNotes?: Partial<Record<QuadrantKey, string>> } & MatrixLabels,
  stickies: Sticky[] = [],
): MatrixLayout {
  const items = doc.items.map((item, index) => {
    if (item.x !== undefined && item.y !== undefined) {
      return measureItem(item, clampUnit(item.x), clampUnit(item.y), true);
    }
    // The slot follows the item's place in the note, not its rank among the
    // unplaced ones, so placing one item never makes the others jump.
    const at = defaultUnit(index);
    return measureItem(item, at.x, at.y, false);
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const placedStickies = stickies
    .map((sticky) => placeSticky(sticky, byId.get(sticky.targetId)))
    .filter((s): s is PositionedSticky => s !== null);

  const quadrants = quadrantsOf(doc, doc.quadrantNotes ?? {});
  const axisTexts = axisTextsOf(doc);
  // The plot is always in frame - an empty matrix still shows its grid - and
  // so are the axis names and anything dropped outside it.
  const bounds = boundsOfBoxes([PLOT, ...axisTexts.map(axisTextBox), ...items, ...placedStickies]);
  return { plot: PLOT, quadrants, cross: crossOf(), axisTexts, items, stickies: placedStickies, bounds, byId };
}
