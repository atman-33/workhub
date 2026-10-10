/**
 * Nodes and arrows, the base of every diagram that connects boxes (T-0682).
 *
 * The business flow uses it now; the PFD (T-0683) sits on the same pieces. The
 * module is geometry only - no notation, no file format - so a kind brings its
 * own shapes (`shapes.ts`), its own connection rule and its own arrow style and
 * gets the rest.
 *
 * - `boundaryPoint` finds where an arrow meets a node by bisecting along a line
 *   from the node's centre with the shape's `contains`;
 * - `edgeGeometry` turns two nodes into a drawable arrow in one of three
 *   styles (straight, orthogonal, curve), with the head aimed along the final
 *   tangent and a spot for the label;
 * - `connectEdges` / `reattachEdge` are what the end-point drag does to the
 *   edge list.
 */
import { shapeOf } from "./shapes";
import type { Box } from "./sticky-layout";

export interface Point {
  x: number;
  y: number;
}

/** A node as geometry: its box and the id of its shape. */
export interface DiagramNode extends Box {
  id: string;
  shape: string;
}

/** An arrow between two nodes. `(from, to)` is its identity. */
export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export function edgeKey(edge: { from: string; to: string }): string {
  return `${edge.from}->${edge.to}`;
}

export function centerOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// ---------------------------------------------------------------------------
// where an arrow meets a node
// ---------------------------------------------------------------------------

/** Bisection steps. 30 halvings of a few hundred pixels is far below a pixel. */
export const BOUNDARY_ITERATIONS = 30;

/** True when `p` is inside the node's shape. */
export function nodeContains(node: DiagramNode, p: Point): boolean {
  const c = centerOf(node);
  return shapeOf(node.shape).contains(p.x - c.x, p.y - c.y, node);
}

/**
 * The point on the node's boundary toward `toward`: the line from the node's
 * centre to that point, cut where it leaves the shape. Works for any shape
 * that is star-shaped about its centre, whatever its outline looks like.
 *
 * A target at the centre has no direction; the centre itself comes back.
 */
export function boundaryPoint(
  node: DiagramNode,
  toward: Point,
  iterations = BOUNDARY_ITERATIONS,
): Point {
  const c = centerOf(node);
  const vx = toward.x - c.x;
  const vy = toward.y - c.y;
  const len = Math.hypot(vx, vy);
  if (len === 0) return c;
  const ux = vx / len;
  const uy = vy / len;
  const shape = shapeOf(node.shape);
  // Past the farthest corner is outside any shape that fits its box.
  let lo = 0;
  let hi = Math.hypot(node.width, node.height);
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (shape.contains(ux * mid, uy * mid, node)) lo = mid;
    else hi = mid;
  }
  const r = (lo + hi) / 2;
  return { x: c.x + ux * r, y: c.y + uy * r };
}

/** The topmost node under `p` (later nodes draw over earlier ones). */
export function hitNode(nodes: DiagramNode[], p: Point): DiagramNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodeContains(nodes[i], p)) return nodes[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// arrows
// ---------------------------------------------------------------------------

export type EdgeStyle = "straight" | "orthogonal" | "curve";

export interface EdgeGeometry {
  style: EdgeStyle;
  /** SVG path data of the line (the head is separate). */
  d: string;
  /** The line as a polyline (a curve is sampled): hit areas, label placement. */
  points: Point[];
  /** Where the line leaves the first node, and where its tip meets the second. */
  start: Point;
  end: Point;
  /** Direction the head points, in radians (`atan2(dy, dx)`). */
  headAngle: number;
  /** A point on the line, half way along it, for the label. */
  mid: Point;
}

/** A straight piece of a route. Orthogonal routes are made of horizontal and vertical ones. */
export interface Segment {
  a: Point;
  b: Point;
}

export interface EdgeOptions {
  /** Boxes an orthogonal route should not run through (the other nodes). */
  obstacles?: Box[];
  /** Segments of arrows already routed. A new route keeps off them where it
   * can, so arrows that share a gap do not lie on top of one another. */
  used?: Segment[];
  /**
   * Which way the chart runs. `"right"` (the default) is the horizontal chart of
   * the business flow and the PFD; `"down"` is the vertical one of the program
   * flow (T-0697), whose orthogonal arrows come from `verticalRoute`; `"free"`
   * is the architecture diagram (T-0708), whose arrows leave in any direction
   * and come from `freeRoute`. Only orthogonal arrows care.
   */
  flow?: "right" | "down" | "free";
  /**
   * Put the label (`mid`) this far along the line from its start instead of at
   * its middle, never past the end of the first segment. The program flow uses
   * it for the arrows leaving a decision, so the label sits next to the branch
   * and not on a corner.
   */
  labelOffset?: number;
}

/** Distance a loop keeps below the nodes it goes around. */
export const DETOUR_MARGIN = 28;
/** Spacing between the alternative lines a route may take. */
const LANE_STEP = 12;
/** Cost of a route segment running through a box (`routeCost`). */
const OBSTACLE_COST = 1000;
/** Least free space between two boxes for a route to run through the gap. */
const MIN_GAP = 16;
/** A route keeps this far from a box it is not joined to. */
const CLEARANCE = 6;
const CURVE_SAMPLES = 24;

/**
 * The arrow from `from` to `to`, or `null` for an arrow from a node to itself
 * (kept in the note, not drawn).
 */
export function edgeGeometry(
  from: DiagramNode,
  to: DiagramNode,
  style: EdgeStyle,
  options: EdgeOptions = {},
): EdgeGeometry | null {
  if (from.id === to.id) return null;
  if (style === "orthogonal") return orthogonalGeometry(from, to, options);
  if (style === "curve") return curveGeometry(from, to) ?? straightGeometry(from, to);
  return straightGeometry(from, to);
}

function polylinePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${round(p.x)} ${round(p.y)}`).join(" ");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Point half way along a polyline, measured by length. */
export function polylineMidpoint(points: Point[]): Point {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const seg = dist(points[i - 1], points[i]);
    if (seg >= left && seg > 0) {
      const k = left / seg;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * k,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * k,
      };
    }
    left -= seg;
  }
  return points[points.length - 1];
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function straightGeometry(from: DiagramNode, to: DiagramNode): EdgeGeometry {
  const start = boundaryPoint(from, centerOf(to));
  const end = boundaryPoint(to, centerOf(from));
  return {
    style: "straight",
    d: polylinePath([start, end]),
    points: [start, end],
    start,
    end,
    headAngle: Math.atan2(end.y - start.y, end.x - start.x),
    mid: polylineMidpoint([start, end]),
  };
}

function segmentsOf(points: Point[]): Segment[] {
  return points.slice(1).map((b, i) => ({ a: points[i], b }));
}

function hitsBox(s: Segment, box: Box): boolean {
  const x0 = Math.min(s.a.x, s.b.x);
  const x1 = Math.max(s.a.x, s.b.x);
  const y0 = Math.min(s.a.y, s.b.y);
  const y1 = Math.max(s.a.y, s.b.y);
  return (
    x1 > box.x - CLEARANCE &&
    x0 < box.x + box.width + CLEARANCE &&
    y1 > box.y - CLEARANCE &&
    y0 < box.y + box.height + CLEARANCE
  );
}

/** Two axis-aligned segments lying on the same line and sharing a stretch of it. */
function overlaps(a: Segment, b: Segment): boolean {
  const aVertical = Math.abs(a.a.x - a.b.x) < 0.5;
  const bVertical = Math.abs(b.a.x - b.b.x) < 0.5;
  const aHorizontal = Math.abs(a.a.y - a.b.y) < 0.5;
  const bHorizontal = Math.abs(b.a.y - b.b.y) < 0.5;
  const span = (lo: number, hi: number, lo2: number, hi2: number) =>
    Math.min(Math.max(lo, hi), Math.max(lo2, hi2)) - Math.max(Math.min(lo, hi), Math.min(lo2, hi2)) > 2;
  if (aVertical && bVertical) {
    return Math.abs(a.a.x - b.a.x) < 4 && span(a.a.y, a.b.y, b.a.y, b.b.y);
  }
  if (aHorizontal && bHorizontal) {
    return Math.abs(a.a.y - b.a.y) < 4 && span(a.a.x, a.b.x, b.a.x, b.b.x);
  }
  return false;
}

/** How bad a route is: running through a box is far worse than lying on another arrow. */
function routeCost(points: Point[], options: EdgeOptions): number {
  let cost = 0;
  for (const seg of segmentsOf(points)) {
    for (const box of options.obstacles ?? []) if (hitsBox(seg, box)) cost += OBSTACLE_COST;
    for (const other of options.used ?? []) if (overlaps(seg, other)) cost += 10;
  }
  return cost;
}

/** The candidate with the lowest cost; the earliest wins a tie, so the list's
 * order is the preference. */
function cheapest(candidates: Point[][], options: EdgeOptions): Point[] {
  let best = candidates[0];
  let bestCost = Infinity;
  for (const c of candidates) {
    const cost = routeCost(c, options);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return best;
}

/** `lo..hi` sampled outward from `preferred`: the preferred value first, then
 * alternately either side of it. */
function around(preferred: number, lo: number, hi: number): number[] {
  const out = [preferred];
  for (let d = LANE_STEP; preferred - d >= lo || preferred + d <= hi; d += LANE_STEP) {
    if (preferred - d >= lo) out.push(preferred - d);
    if (preferred + d <= hi) out.push(preferred + d);
  }
  return out;
}

/**
 * The corner points of an orthogonal route, centre to centre. Every segment
 * is horizontal or vertical.
 *
 * - `to` clear of `from` on the right: out of the right side, up or down in
 *   the gap, into the left side. The vertical leg takes the middle of the gap
 *   unless a box or another arrow is in the way, then the nearest free line;
 * - `to` clear on the left (a loop back): under both nodes and up into `to`,
 *   on the first line below them that is free;
 * - otherwise (stacked): through the gap between them, vertical first.
 */
export function orthogonalRoute(from: Box, to: Box, options: EdgeOptions = {}): Point[] {
  const a = centerOf(from);
  const b = centerOf(to);
  const gapRight = to.x - (from.x + from.width);
  const gapLeft = from.x - (to.x + to.width);
  if (gapRight >= MIN_GAP) {
    if (a.y === b.y && routeCost([a, b], options) === 0) return [a, b];
    const left = from.x + from.width;
    const xs = around(left + gapRight / 2, left + 8, to.x - 8);
    return cheapest(
      xs.map((x) => [a, { x, y: a.y }, { x, y: b.y }, b]),
      options,
    );
  }
  if (gapLeft >= MIN_GAP) {
    const base = Math.max(from.y + from.height, to.y + to.height) + DETOUR_MARGIN;
    const ys = Array.from({ length: 9 }, (_, k) => base + k * LANE_STEP);
    return cheapest(
      ys.map((y) => [a, { x: a.x, y }, { x: b.x, y }, b]),
      options,
    );
  }
  const gapBelow = to.y - (from.y + from.height);
  const gapAbove = from.y - (to.y + to.height);
  if (gapBelow >= MIN_GAP || gapAbove >= MIN_GAP) {
    if (a.x === b.x) return [a, b];
    const top = gapBelow >= MIN_GAP ? from.y + from.height : to.y + to.height;
    const gap = gapBelow >= MIN_GAP ? gapBelow : gapAbove;
    const ys = around(top + gap / 2, top + 8, top + gap - 8);
    return cheapest(
      ys.map((y) => [a, { x: a.x, y }, { x: b.x, y }, b]),
      options,
    );
  }
  return [a, b];
}

function orthogonalGeometry(
  from: DiagramNode,
  to: DiagramNode,
  options: EdgeOptions,
): EdgeGeometry {
  const route =
    options.flow === "down"
      ? verticalRoute(from, to, options)
      : options.flow === "free"
        ? freeRoute(from, to, options)
        : orthogonalRoute(from, to, options);
  const start = boundaryPoint(from, route[1]);
  const end = boundaryPoint(to, route[route.length - 2]);
  const points = [start, ...route.slice(1, -1), end];
  const last = points[points.length - 2];
  return {
    style: "orthogonal",
    d: polylinePath(points),
    points,
    start,
    end,
    headAngle: Math.atan2(end.y - last.y, end.x - last.x),
    mid:
      options.labelOffset !== undefined
        ? pointAlongFirstSegment(points, options.labelOffset)
        : polylineMidpoint(points),
  };
}

/** The point `offset` along the first segment of a polyline, held to that segment. */
function pointAlongFirstSegment(points: Point[], offset: number): Point {
  const length = dist(points[0], points[1]);
  if (length === 0) return points[0];
  const k = Math.min(Math.max(offset, 0), length) / length;
  return {
    x: points[0].x + (points[1].x - points[0].x) * k,
    y: points[0].y + (points[1].y - points[0].y) * k,
  };
}

/**
 * The corner points of an orthogonal route for a chart that runs downward
 * (T-0697), centre to centre like `orthogonalRoute`; the leg out of and into a
 * node is cut to its outline by `boundaryPoint`, so the first and last
 * segments decide which side of a shape (a diamond's vertex, a parallelogram's
 * slanted edge) an arrow uses. Candidates, best first:
 *
 * - `to` below `from`: a straight drop when they share a column; else an L
 *   (out of the side, across to the target's column, down into its top); else
 *   a Z (down, across in the gap above the target, down). The cheapest of
 *   these wins, the earliest on a tie;
 * - when all of those would run through a box (a skip arrow past the main
 *   line), or `to` is not below `from` (a loop's return arrow): the right-hand
 *   lane - out of the right side, across to a line past the rightmost box in
 *   between, along it, and back left into the right side of `to`. The line
 *   starts `DETOUR_MARGIN` out and moves outward in `LANE_STEP` steps to dodge
 *   other arrows;
 * - boxes side by side with no vertical gap (hand-placed): the horizontal
 *   router's route.
 */
export function verticalRoute(from: Box, to: Box, options: EdgeOptions = {}): Point[] {
  const a = centerOf(from);
  const b = centerOf(to);
  const gapBelow = to.y - (from.y + from.height);
  const gapAbove = from.y - (to.y + to.height);

  if (gapBelow >= MIN_GAP) {
    const direct: Point[][] = [];
    if (Math.abs(a.x - b.x) < 0.5) {
      direct.push([a, b]);
    } else {
      direct.push([a, { x: b.x, y: a.y }, b]);
      const top = from.y + from.height;
      const preferred = to.y - Math.min(gapBelow / 2, 24);
      for (const y of around(preferred, top + 8, to.y - 8)) {
        direct.push([a, { x: a.x, y }, { x: b.x, y }, b]);
      }
    }
    const best = cheapest(direct, options);
    if (routeCost(best, options) < OBSTACLE_COST) return best;
    return cheapest([best, ...laneRoutes(from, to, options)], options);
  }
  if (gapAbove >= MIN_GAP) {
    return cheapest(laneRoutes(from, to, options), options);
  }
  return orthogonalRoute(from, to, options);
}

/**
 * The corner points of an orthogonal route for a chart whose arrows leave in
 * any direction (T-0708), centre to centre like `orthogonalRoute`. Candidates,
 * best first:
 *
 * - **Across**: out of one side, along a vertical line in the gap, into one
 *   side - `orthogonalRoute`'s rightward leg mirrored to the left;
 * - **Up and down**: the same turned a quarter (out of the top or bottom edge,
 *   along a horizontal line in the gap, into the bottom or top edge);
 * - the axis the centres differ more along goes first; a level pair takes the
 *   straight line;
 * - when the best of those would run through a box (or the nodes overlap), an
 *   outer band around both nodes, innermost line first on each of the four
 *   sides (`laneRoutes` is the right-hand band alone).
 *
 * The earliest candidate wins a tie, so without obstacles or used segments the
 * route is the preferred axis through the middle of the gap. `flow: "right"`
 * and `flow: "down"` never reach this function, so their routes do not move.
 */
export function freeRoute(from: Box, to: Box, options: EdgeOptions = {}): Point[] {
  const a = centerOf(from);
  const b = centerOf(to);
  const acrossFirst = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const horizontal = horizontalFreeRoute(from, to, options);
  const vertical = verticalFreeRoute(from, to, options);
  const ordered: Point[][] = [];
  if (acrossFirst) {
    if (horizontal) ordered.push(horizontal);
    if (vertical) ordered.push(vertical);
  } else {
    if (vertical) ordered.push(vertical);
    if (horizontal) ordered.push(horizontal);
  }
  if (ordered.length > 0) {
    const best = cheapest(ordered, options);
    if (routeCost(best, options) === 0) return best;
    return cheapest([best, ...outerBandRoutes(from, to)], options);
  }
  return cheapest(outerBandRoutes(from, to), options);
}

/**
 * The direction a head on the START of a route points: `points[0] -> points[1]`
 * turned around. A bidirectional arrow's far head needs it; `EdgeGeometry`
 * only carries the near one (`headAngle`).
 */
export function startHeadAngle(points: Point[]): number {
  return Math.atan2(points[0].y - points[1].y, points[0].x - points[1].x);
}

/** Out of one side, down or up a line in the gap, into one side. `null` when
 * neither side has room. */
function horizontalFreeRoute(from: Box, to: Box, options: EdgeOptions): Point[] | null {
  const a = centerOf(from);
  const b = centerOf(to);
  const gapRight = to.x - (from.x + from.width);
  const gapLeft = from.x - (to.x + to.width);
  const candidates: Point[][] = [];
  const sides: ("right" | "left")[] = b.x >= a.x ? ["right", "left"] : ["left", "right"];
  for (const side of sides) {
    const gap = side === "right" ? gapRight : gapLeft;
    if (gap < MIN_GAP) continue;
    if (a.y === b.y) {
      candidates.push([a, b]);
      // A head-on pair (A -> B and B -> A) shares this line: the parallels a
      // lane each side keep the second off the first (`used`), nearest first.
      candidates.push([
        a,
        { x: a.x, y: a.y + LANE_STEP },
        { x: b.x, y: b.y + LANE_STEP },
        b,
      ]);
      candidates.push([
        a,
        { x: a.x, y: a.y - LANE_STEP },
        { x: b.x, y: b.y - LANE_STEP },
        b,
      ]);
      continue;
    }
    const edge = side === "right" ? from.x + from.width : to.x + to.width;
    const far = side === "right" ? to.x : from.x;
    const xs = around(edge + gap / 2, edge + 8, far - 8);
    candidates.push(...xs.map((x) => [a, { x, y: a.y }, { x, y: b.y }, b]));
  }
  return candidates.length > 0 ? cheapest(candidates, options) : null;
}

/** Out of the top or bottom edge, across a line in the gap, into an edge. `null`
 * when neither has room. */
function verticalFreeRoute(from: Box, to: Box, options: EdgeOptions): Point[] | null {
  const a = centerOf(from);
  const b = centerOf(to);
  const gapBelow = to.y - (from.y + from.height);
  const gapAbove = from.y - (to.y + to.height);
  const candidates: Point[][] = [];
  const sides: ("below" | "above")[] = b.y >= a.y ? ["below", "above"] : ["above", "below"];
  for (const side of sides) {
    const gap = side === "below" ? gapBelow : gapAbove;
    if (gap < MIN_GAP) continue;
    if (a.x === b.x) {
      candidates.push([a, b]);
      // As above, one lane each side for the head-on pair.
      candidates.push([
        a,
        { x: a.x + LANE_STEP, y: a.y },
        { x: b.x + LANE_STEP, y: b.y },
        b,
      ]);
      candidates.push([
        a,
        { x: a.x - LANE_STEP, y: a.y },
        { x: b.x - LANE_STEP, y: b.y },
        b,
      ]);
      continue;
    }
    const edge = side === "below" ? from.y + from.height : to.y + to.height;
    const far = side === "below" ? to.y : from.y;
    const ys = around(edge + gap / 2, edge + 8, far - 8);
    candidates.push(...ys.map((y) => [a, { x: a.x, y }, { x: b.x, y }, b]));
  }
  return candidates.length > 0 ? cheapest(candidates, options) : null;
}

/** Bands around both nodes, innermost line first: right, left, below, above. */
function outerBandRoutes(from: Box, to: Box): Point[][] {
  const a = centerOf(from);
  const b = centerOf(to);
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x + from.width, to.x + to.width);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y + from.height, to.y + to.height);
  const out: Point[][] = [];
  for (let k = 0; k < 9; k++) {
    const x = right + DETOUR_MARGIN + k * LANE_STEP;
    out.push([a, { x, y: a.y }, { x, y: b.y }, b]);
    const xl = left - DETOUR_MARGIN - k * LANE_STEP;
    out.push([a, { x: xl, y: a.y }, { x: xl, y: b.y }, b]);
    const y = bottom + DETOUR_MARGIN + k * LANE_STEP;
    out.push([a, { x: a.x, y }, { x: b.x, y }, b]);
    const yt = top - DETOUR_MARGIN - k * LANE_STEP;
    out.push([a, { x: a.x, y: yt }, { x: b.x, y: yt }, b]);
  }
  return out;
}

/** The routes around the right-hand side, innermost line first. */
function laneRoutes(from: Box, to: Box, options: EdgeOptions): Point[][] {  const a = centerOf(from);
  const b = centerOf(to);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y + from.height, to.y + to.height);
  let right = Math.max(from.x + from.width, to.x + to.width);
  for (const box of options.obstacles ?? []) {
    if (box.y < bottom && box.y + box.height > top) right = Math.max(right, box.x + box.width);
  }
  const base = right + DETOUR_MARGIN;
  return Array.from({ length: 9 }, (_, k) => {
    const x = base + k * LANE_STEP;
    return [a, { x, y: a.y }, { x, y: b.y }, b];
  });
}

// ---- curves -----------------------------------------------------------------

type Bezier = [Point, Point, Point, Point];

function bezierAt(b: Bezier, t: number): Point {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: w[0] * b[0].x + w[1] * b[1].x + w[2] * b[2].x + w[3] * b[3].x,
    y: w[0] * b[0].y + w[1] * b[1].y + w[2] * b[2].y + w[3] * b[3].y,
  };
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** De Casteljau split at `t`. */
function splitBezier(b: Bezier, t: number): [Bezier, Bezier] {
  const p01 = lerp(b[0], b[1], t);
  const p12 = lerp(b[1], b[2], t);
  const p23 = lerp(b[2], b[3], t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const p = lerp(p012, p123, t);
  return [
    [b[0], p01, p012, p],
    [p, p123, p23, b[3]],
  ];
}

/** The `[t0, t1]` part of a curve as a curve of its own. */
function subBezier(b: Bezier, t0: number, t1: number): Bezier {
  const [head] = splitBezier(b, t1);
  if (t1 === 0) return head;
  const [, tail] = splitBezier(head, t0 / t1);
  return tail;
}

/**
 * An S-shaped cubic from centre to centre, cut where it leaves the first node
 * and enters the second (the same `contains` bisection as a straight arrow,
 * run along the curve), with the head along the end tangent. `null` when the
 * nodes sit so close that the curve never clears them.
 */
function curveGeometry(from: DiagramNode, to: DiagramNode): EdgeGeometry | null {
  const a = centerOf(from);
  const b = centerOf(to);
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const curve: Bezier = horizontal
    ? [a, { x: mid.x, y: a.y }, { x: mid.x, y: b.y }, b]
    : [a, { x: a.x, y: mid.y }, { x: b.x, y: mid.y }, b];

  const inside = (node: DiagramNode, p: Point) => nodeContains(node, p);
  if (inside(from, bezierAt(curve, 0.5)) || inside(to, bezierAt(curve, 0.5))) return null;

  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < BOUNDARY_ITERATIONS; i++) {
    const m = (lo + hi) / 2;
    if (inside(from, bezierAt(curve, m))) lo = m;
    else hi = m;
  }
  const t0 = (lo + hi) / 2;
  lo = 0.5;
  hi = 1;
  for (let i = 0; i < BOUNDARY_ITERATIONS; i++) {
    const m = (lo + hi) / 2;
    if (inside(to, bezierAt(curve, m))) hi = m;
    else lo = m;
  }
  const t1 = (lo + hi) / 2;
  if (t1 <= t0) return null;

  const cut = subBezier(curve, t0, t1);
  const points = Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) =>
    bezierAt(cut, i / CURVE_SAMPLES),
  );
  const start = cut[0];
  const end = cut[3];
  // The head follows the curve's own direction at the tip: the tip minus a
  // point a little before it.
  const before = bezierAt(cut, 0.96);
  return {
    style: "curve",
    d: `M ${round(start.x)} ${round(start.y)} C ${round(cut[1].x)} ${round(cut[1].y)} ${round(cut[2].x)} ${round(cut[2].y)} ${round(end.x)} ${round(end.y)}`,
    points,
    start,
    end,
    headAngle: Math.atan2(end.y - before.y, end.x - before.x),
    mid: bezierAt(cut, 0.5),
  };
}

// ---------------------------------------------------------------------------
// arrow heads
// ---------------------------------------------------------------------------

export const ARROW_HEAD_LENGTH = 10;
export const ARROW_HEAD_HALF_WIDTH = 4.5;

/** The three corners of an arrow head whose tip is at `tip`, pointing along `angle`. */
export function arrowHeadPoints(
  tip: Point,
  angle: number,
  length = ARROW_HEAD_LENGTH,
  halfWidth = ARROW_HEAD_HALF_WIDTH,
): [Point, Point, Point] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const bx = tip.x - cos * length;
  const by = tip.y - sin * length;
  return [
    tip,
    { x: bx - sin * halfWidth, y: by + cos * halfWidth },
    { x: bx + sin * halfWidth, y: by - cos * halfWidth },
  ];
}

/** SVG path data of the head. */
export function arrowHeadPath(tip: Point, angle: number): string {
  const [a, b, c] = arrowHeadPoints(tip, angle);
  return `M ${round(a.x)} ${round(a.y)} L ${round(b.x)} ${round(b.y)} L ${round(c.x)} ${round(c.y)} Z`;
}

// ---------------------------------------------------------------------------
// editing the edge list (the end-point drag)
// ---------------------------------------------------------------------------

/**
 * A rule deciding whether an arrow may join two nodes. The default allows
 * everything but a node to itself; the PFD passes its own (process to
 * deliverable and back).
 */
export type ConnectionRule = (from: string, to: string) => boolean;

export const allowAnyConnection: ConnectionRule = (from, to) => from !== to;

/** Adds `from -> to`. Returns `null` when the drop does nothing (an arrow
 * already joins them, a node to itself, or the rule says no). */
export function connectEdges<E extends DiagramEdge>(
  edges: E[],
  from: string,
  to: string,
  make: (from: string, to: string) => E,
  rule: ConnectionRule = allowAnyConnection,
): E[] | null {
  if (from === to || !rule(from, to)) return null;
  if (edges.some((e) => e.from === from && e.to === to)) return null;
  return [...edges, make(from, to)];
}

/**
 * Moves one end of an arrow to another node. When the new pair already has an
 * arrow, the moved one merges into it (the existing arrow keeps its label,
 * unless it has none). Returns `null` when nothing changes.
 */
export function reattachEdge<E extends DiagramEdge>(
  edges: E[],
  edge: { from: string; to: string },
  end: "from" | "to",
  nodeId: string,
  rule: ConnectionRule = allowAnyConnection,
): E[] | null {
  const current = edges.find((e) => e.from === edge.from && e.to === edge.to);
  if (!current) return null;
  const from = end === "from" ? nodeId : current.from;
  const to = end === "to" ? nodeId : current.to;
  if (from === current.from && to === current.to) return null;
  if (from === to || !rule(from, to)) return null;
  const twin = edges.find((e) => e !== current && e.from === from && e.to === to);
  if (twin) {
    return edges
      .filter((e) => e !== current)
      .map((e) =>
        e === twin && !e.label && current.label ? { ...e, label: current.label } : e,
      );
  }
  return edges.map((e) => (e === current ? { ...e, from, to } : e));
}
