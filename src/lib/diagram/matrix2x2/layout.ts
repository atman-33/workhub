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
import { clampUnit, type LabelField, type MatrixItem } from "./parse";

/** The plot rectangle, in diagram pixels. */
export const PLOT: Box = { x: 0, y: 0, width: 720, height: 520 };

export const ITEM_FONT_SIZE = 13;
export const ITEM_PAD_Y = 6;
export const ITEM_MIN_WIDTH = 56;
/** Wrap width of an item's title; the box grows to its text up to this. */
export const ITEM_MAX_WIDTH = 190;
export const AXIS_FONT_SIZE = 12;
export const QUADRANT_FONT_SIZE = 13;

export type QuadrantKey = "tl" | "tr" | "bl" | "br";

export interface PositionedQuadrant {
  key: QuadrantKey;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where the label is drawn, and which way it anchors. */
  textX: number;
  textY: number;
  anchor: "start" | "end";
}

/** A piece of axis text. `rotate` draws it quarter-turned, reading upward. */
export interface AxisText {
  id: "x_axis" | "x_low" | "x_high" | "y_axis" | "y_low" | "y_high";
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  rotate: boolean;
  /** The axis name, drawn heavier than the end names. */
  strong: boolean;
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

function quadrantsOf(labels: MatrixLabels): PositionedQuadrant[] {
  const w = PLOT.width / 2;
  const h = PLOT.height / 2;
  const inset = 12;
  const at = (
    key: QuadrantKey,
    label: string,
    col: 0 | 1,
    row: 0 | 1,
  ): PositionedQuadrant => ({
    key,
    label,
    x: PLOT.x + col * w,
    y: PLOT.y + row * h,
    width: w,
    height: h,
    textX: col === 0 ? PLOT.x + inset : PLOT.x + PLOT.width - inset,
    textY: row === 0 ? PLOT.y + inset + QUADRANT_FONT_SIZE : PLOT.y + PLOT.height - inset,
    anchor: col === 0 ? "start" : "end",
  });
  return [
    at("tl", labels.qTl, 0, 0),
    at("tr", labels.qTr, 1, 0),
    at("bl", labels.qBl, 0, 1),
    at("br", labels.qBr, 1, 1),
  ];
}

function axisTextsOf(labels: MatrixLabels): AxisText[] {
  const belowY = PLOT.y + PLOT.height + 18;
  const leftX = PLOT.x - 10;
  const all: AxisText[] = [
    { id: "x_low", text: labels.xLow, x: PLOT.x, y: belowY, anchor: "start", rotate: false, strong: false },
    {
      id: "x_axis",
      text: labels.xAxis,
      x: PLOT.x + PLOT.width / 2,
      y: belowY,
      anchor: "middle",
      rotate: false,
      strong: true,
    },
    {
      id: "x_high",
      text: labels.xHigh,
      x: PLOT.x + PLOT.width,
      y: belowY,
      anchor: "end",
      rotate: false,
      strong: false,
    },
    { id: "y_high", text: labels.yHigh, x: leftX, y: PLOT.y + 12, anchor: "end", rotate: false, strong: false },
    {
      id: "y_axis",
      text: labels.yAxis,
      x: PLOT.x - 34,
      y: PLOT.y + PLOT.height / 2,
      anchor: "middle",
      rotate: true,
      strong: true,
    },
    {
      id: "y_low",
      text: labels.yLow,
      x: leftX,
      y: PLOT.y + PLOT.height,
      anchor: "end",
      rotate: false,
      strong: false,
    },
  ];
  // An empty label is not drawn at all.
  return all.filter((a) => a.text.trim());
}

/** The box a piece of axis text covers, for the bounds. */
function axisTextBox(a: AxisText): Box {
  const w = textWidth(a.text, AXIS_FONT_SIZE);
  const up = AXIS_FONT_SIZE;
  const down = AXIS_FONT_SIZE * 0.3;
  if (a.rotate) return { x: a.x - up, y: a.y - w / 2, width: up + down, height: w };
  const x = a.anchor === "start" ? a.x : a.anchor === "end" ? a.x - w : a.x - w / 2;
  return { x, y: a.y - up, width: w, height: up + down };
}

export function layoutMatrix(
  doc: { items: MatrixItem[] } & MatrixLabels,
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

  const quadrants = quadrantsOf(doc);
  const axisTexts = axisTextsOf(doc);
  // The plot is always in frame - an empty matrix still shows its grid - and
  // so are the axis names and anything dropped outside it.
  const bounds = boundsOfBoxes([PLOT, ...axisTexts.map(axisTextBox), ...items, ...placedStickies]);
  return { plot: PLOT, quadrants, axisTexts, items, stickies: placedStickies, bounds, byId };
}
