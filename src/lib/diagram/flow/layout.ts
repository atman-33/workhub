/**
 * Business-flow layout: the one geometry the canvas and the exports both draw.
 *
 * Lanes are horizontal bands stacked top to bottom. A step with no `@` is put
 * in a column by rank (`layerLayout`: the arrows decide the column, the lane
 * decides the row); a step with `@x,y` sits at that absolute x and at y from
 * the middle of its lane, kept inside the lane. Everything is computed here
 * with fixed text metrics, so an export rendered on another machine puts every
 * box where the app did.
 */
import type { Color } from "../colors";
import { layerLayout, LAYER_MIN_ROW_HEIGHT } from "../graph-layout";
import {
  edgeGeometry,
  edgeKey,
  type DiagramNode,
  type EdgeGeometry,
  type Segment,
} from "../node-edge";
import {
  boundsOfBoxes,
  placeSticky,
  type Box,
  type PositionedSticky,
} from "../sticky-layout";
import type { Sticky } from "../sticky";
import { LINE_HEIGHT, NODE_PAD_X, textWidth, truncateText, wrapTitle } from "../text";
import type { FlowEdge, FlowLane, FlowStep, StepKind } from "./parse";

/** Key of the band for steps with no (or an unknown) lane. */
export const UNASSIGNED = "";

/** Width of the strip at the left of a band that carries the lane's name. */
export const HEADER_WIDTH = 32;
export const STEP_FONT_SIZE = 13;
export const STEP_PAD_Y = 8;
export const STEP_MIN_WIDTH = 88;
export const STEP_MIN_HEIGHT = 40;
/** Wrap width of a step's title. */
export const STEP_MAX_WIDTH = 180;
export const LANE_FONT_SIZE = 12;
export const EDGE_LABEL_FONT_SIZE = 11;
/** Space between the header strip and the first column. */
export const ORIGIN_PAD = 40;
/** Space between the last step of a band and its right edge. */
const BAND_TAIL = 48;
const BAND_MIN_WIDTH = 560;

export interface PositionedStep extends DiagramNode {
  title: string;
  /** Title split into the lines the shape renders. */
  lines: string[];
  kind: StepKind;
  color?: Color;
  task?: string;
  note?: string;
  /** Band the step is drawn in (`UNASSIGNED` for none). */
  band: string;
  /** False when the layout chose the spot, true when the file gave a `@`. */
  placed: boolean;
  cx: number;
  cy: number;
}

export interface PositionedBand {
  /** The lane id, or `UNASSIGNED`. */
  key: string;
  title: string;
  color?: Color;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Width of the name strip at the band's left. */
  headerWidth: number;
}

export interface PositionedEdge {
  key: string;
  from: string;
  to: string;
  label?: string;
  /** A loop: the arrow goes against the flow. */
  back: boolean;
  geometry: EdgeGeometry;
  /** Where the label is drawn, when there is one. */
  labelBox?: Box;
}

export interface FlowLayout {
  bands: PositionedBand[];
  steps: PositionedStep[];
  edges: PositionedEdge[];
  /** Sticky notes, empty when the note hides them. */
  stickies: PositionedSticky[];
  /** Bounding box of everything drawn, before any padding the view adds. */
  bounds: Box;
  byId: Map<string, PositionedStep>;
  /** The band a diagram y falls in (the nearest one past either end). */
  bandAt: (y: number) => PositionedBand;
}

export interface FlowLayoutOptions {
  /** Name of the band for unassigned steps (translated by the caller). */
  unassignedLabel?: string;
  /**
   * A step held at an exact spot - the one being dragged. The bands are still
   * those of the unchanged document, so the picture does not reflow under the
   * pointer; the step is neither clamped to its lane nor re-ranked.
   */
  pinned?: { id: string; cx: number; cy: number };
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

/** Shape id of each step kind. */
export function shapeOfKind(kind: StepKind): string {
  if (kind === "decision") return "diamond";
  if (kind === "start" || kind === "end") return "pill";
  return "rect";
}

/** Box size and text lines of a step, from its title and kind. */
export function measureStep(step: Pick<FlowStep, "title" | "kind">): {
  width: number;
  height: number;
  lines: string[];
} {
  const decision = step.kind === "decision";
  const lines = wrapTitle(step.title, decision ? 150 : STEP_MAX_WIDTH, STEP_FONT_SIZE);
  const widest = Math.max(...lines.map((l) => textWidth(l, STEP_FONT_SIZE)));
  const textHeight = lines.length * STEP_FONT_SIZE * LINE_HEIGHT;
  if (decision) {
    // The text must fit the rectangle inscribed in the diamond: it fits when
    // textW / W + textH / H <= 1, so the width is chosen and the height follows.
    const tw = Math.ceil(widest) + 12;
    const th = Math.ceil(textHeight) + 8;
    const width = Math.max(120, Math.ceil(tw * 1.7));
    const height = Math.max(64, Math.ceil(th / (1 - tw / width)));
    return { width, height, lines };
  }
  const extra = step.kind === "process" ? 0 : 8;
  return {
    width: Math.max(STEP_MIN_WIDTH, Math.ceil(widest) + NODE_PAD_X * 2 + extra),
    height: Math.max(STEP_MIN_HEIGHT, Math.ceil(textHeight) + STEP_PAD_Y * 2),
    lines,
  };
}

/** The band key a step belongs in: its lane when that lane exists. */
export function bandKeyOf(step: Pick<FlowStep, "lane">, lanes: FlowLane[]): string {
  return step.lane && lanes.some((l) => l.id === step.lane) ? step.lane : UNASSIGNED;
}

/** How far a step's centre may sit from the middle of its band. */
export function maxOffset(bandHeight: number, stepHeight: number): number {
  return Math.max(0, Math.floor(bandHeight / 2 - stepHeight / 2));
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

export function layoutFlow(
  doc: { lanes: FlowLane[]; steps: FlowStep[]; edges: FlowEdge[] },
  stickies: Sticky[] = [],
  options: FlowLayoutOptions = {},
): FlowLayout {
  const hasLanes = doc.lanes.length > 0;
  const headerWidth = hasLanes ? HEADER_WIDTH : 0;
  const unassignedLabel = options.unassignedLabel ?? "Unassigned";

  const sized = doc.steps.map((step) => ({ step, ...measureStep(step), band: bandKeyOf(step, doc.lanes) }));
  const bandKeys = doc.lanes.map((l) => l.id);
  if (!hasLanes || sized.some((s) => s.band === UNASSIGNED)) bandKeys.push(UNASSIGNED);

  const layered = layerLayout(
    sized.map((s) => ({ id: s.step.id, width: s.width, height: s.height, row: s.band })),
    doc.edges,
    { rows: bandKeys, originX: headerWidth + ORIGIN_PAD, minRowHeight: LAYER_MIN_ROW_HEIGHT },
  );

  const steps: PositionedStep[] = sized.map(({ step, width, height, lines, band }) => {
    const auto = layered.nodes.get(step.id)!;
    const row = layered.rows.find((r) => r.key === auto.row)!;
    const pinned = options.pinned?.id === step.id ? options.pinned : null;
    const placed = pinned !== null || (step.x !== undefined && step.y !== undefined);
    const middle = row.y + row.height / 2;
    const limit = maxOffset(row.height, height);
    const cx = pinned ? pinned.cx : placed ? step.x! : auto.cx;
    const cy = pinned
      ? pinned.cy
      : placed
        ? middle + Math.max(-limit, Math.min(limit, step.y!))
        : auto.cy;
    return {
      id: step.id,
      shape: shapeOfKind(step.kind),
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
      title: step.title,
      lines,
      kind: step.kind,
      ...(step.color ? { color: step.color } : {}),
      ...(step.task ? { task: step.task } : {}),
      ...(step.note ? { note: step.note } : {}),
      band,
      placed,
      cx,
      cy,
    };
  });
  const byId = new Map(steps.map((s) => [s.id, s]));

  // Every band is as wide as the widest content, so the lanes line up.
  const left = Math.min(0, ...steps.map((s) => s.x - 24));
  const right = Math.max(
    BAND_MIN_WIDTH,
    ...steps.map((s) => s.x + s.width + BAND_TAIL),
    ...layered.columns.map((c) => c.x + c.width + BAND_TAIL),
  );
  const bands: PositionedBand[] = layered.rows.map((row) => {
    const lane = doc.lanes.find((l) => l.id === row.key);
    return {
      key: row.key,
      title: lane ? lane.title : hasLanes ? unassignedLabel : "",
      ...(lane?.color ? { color: lane.color } : {}),
      x: left,
      y: row.y,
      width: right - left,
      height: row.height,
      headerWidth,
    };
  });

  // Arrows are routed one after another, each avoiding the boxes of the other
  // steps and the lines already laid. Forward arrows go first so that a loop
  // finds its way round them rather than the other way about.
  const slots: (PositionedEdge | null)[] = doc.edges.map(() => null);
  const used: Segment[] = [];
  const order = doc.edges
    .map((_, i) => i)
    .sort((x, y) => Number(layered.back[x]) - Number(layered.back[y]) || x - y);
  for (const i of order) {
    const edge = doc.edges[i];
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const back = layered.back[i];
    const geometry = edgeGeometry(from, to, "orthogonal", {
      obstacles: steps.filter((s) => s.id !== from.id && s.id !== to.id),
      used,
    });
    if (!geometry) continue; // an arrow from a step to itself is kept, not drawn
    for (let k = 1; k < geometry.points.length; k++) {
      used.push({ a: geometry.points[k - 1], b: geometry.points[k] });
    }
    const positioned: PositionedEdge = {
      key: edgeKey(edge),
      from: edge.from,
      to: edge.to,
      ...(edge.label ? { label: edge.label } : {}),
      back,
      geometry,
    };
    if (edge.label) {
      const width = textWidth(edge.label, EDGE_LABEL_FONT_SIZE) + 10;
      const height = EDGE_LABEL_FONT_SIZE * LINE_HEIGHT + 4;
      positioned.labelBox = {
        x: geometry.mid.x - width / 2,
        y: geometry.mid.y - height / 2,
        width,
        height,
      };
    }
    slots[i] = positioned;
  }
  const edges = slots.filter((e): e is PositionedEdge => e !== null);

  const placedStickies = stickies
    .map((sticky) => placeSticky(sticky, byId.get(sticky.targetId)))
    .filter((s): s is PositionedSticky => s !== null);

  const bounds = boundsOfBoxes([
    ...bands,
    ...placedStickies,
    ...edges.flatMap((e) => (e.labelBox ? [e.labelBox] : [])),
    ...edges.map((e) => boundsOfBoxes(e.geometry.points.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })))),
  ]);

  const bandAt = (y: number): PositionedBand => {
    for (const band of bands) if (y < band.y + band.height) return band;
    return bands[bands.length - 1];
  };

  return { bands, steps, edges, stickies: placedStickies, bounds, byId, bandAt };
}

// ---------------------------------------------------------------------------
// text placement (shared by the canvas and the export)
// ---------------------------------------------------------------------------

/** Baseline of line `i` of a step's title, centred on the step. */
export function stepTextY(step: PositionedStep, i: number): number {
  const lineHeight = STEP_FONT_SIZE * LINE_HEIGHT;
  return step.cy - ((step.lines.length - 1) * lineHeight) / 2 + i * lineHeight + STEP_FONT_SIZE * 0.36;
}

/** The lane name as drawn in its strip: quarter-turned, reading upward, centred. */
export function bandHeaderText(band: PositionedBand): { text: string; x: number; y: number } | null {
  if (!band.headerWidth || !band.title.trim()) return null;
  return {
    text: truncateText(band.title, band.height - 16, LANE_FONT_SIZE),
    x: band.x + band.headerWidth / 2 + LANE_FONT_SIZE * 0.36,
    y: band.y + band.height / 2,
  };
}
