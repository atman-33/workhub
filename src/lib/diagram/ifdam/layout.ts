/**
 * IFDAM layout: the one geometry the canvas and the exports both draw (T-0703).
 *
 * The diagram runs left to right. Two rows: `main` holds the screens, triggers,
 * processes and messages; `store` holds the data stores, each in the column of
 * the first process that touches it, so it hangs directly under that process.
 * The arrows that touch a store take no part in the ranking (a store is not a
 * step of the flow: reading from one would otherwise throw it into column 0).
 * A node with `@x,y` sits at that absolute centre, whatever the layout would
 * have said; placing one never moves another. Everything is computed here with
 * fixed text metrics, so an export rendered on another machine puts every box
 * where the app did.
 *
 * Arrows are orthogonal. Forward ones use the shared router (`edgeGeometry`);
 * an arrow that runs to the left - the loop back to the list screen - is routed
 * here, **under the whole diagram** and through the gaps between columns (see
 * `loopGeometry`), because the shared router's loop leaves the middle of the
 * node's underside, which is exactly where a data store hangs.
 *
 * A screen is a box with sections. Its geometry (the title band, the rules
 * between the sections and the baseline of every line) is part of the layout, so
 * the canvas and the export draw the same text in the same place. The text of
 * the section names is not: it depends on the display language, so the renderer
 * supplies it.
 */
import type { Color } from "../colors";
import { portsOption } from "../edge-ports";
import { layerLayout, rankNodes } from "../graph-layout";
import {
  DETOUR_MARGIN,
  edgeGeometry,
  edgeKey,
  nodeContains,
  type DiagramNode,
  type EdgeGeometry,
  type Point,
  type Segment,
} from "../node-edge";
import { CYLINDER_LID, HEXAGON_INSET } from "../shapes";
import { boundsOfBoxes, placeSticky, type Box, type PositionedSticky } from "../sticky-layout";
import type { Sticky } from "../sticky";
import { LINE_HEIGHT, textWidth, wrapTitle } from "../text";
import { memoOf, SECTION_KEYS, type IfdamEdge, type IfdamNode, type SectionKey } from "./parse";
import { shapeOfKind } from "./symbols";

export const NODE_FONT_SIZE = 13;
export const NODE_PAD_Y = 8;
export const NODE_MIN_WIDTH = 88;
export const NODE_MIN_HEIGHT = 40;
/** Wrap width of a trigger's, message's or store's title. */
export const NODE_MAX_WIDTH = 180;
/** Wrap width of a process's title (the ellipse needs the room round it). */
export const PROCESS_MAX_WIDTH = 190;
export const PROCESS_MIN_HEIGHT = 52;
export const EDGE_LABEL_FONT_SIZE = 11;
/** Left and top edge of the automatic layout. */
export const ORIGIN = 40;

// ---- screens ------------------------------------------------------------------

export const SCREEN_MIN_WIDTH = 160;
export const SCREEN_MAX_WIDTH = 260;
export const SCREEN_PAD_X = 12;
/** Title font; the title is bold, so it is measured a little wider than it is set. */
export const SCREEN_TITLE_FONT_SIZE = 13;
const TITLE_MEASURE_FONT_SIZE = 14;
export const SCREEN_CAPTION_FONT_SIZE = 10.5;
export const SCREEN_ITEM_FONT_SIZE = 12;
/** Width of the "・" in front of an item; wrapped lines hang under the text. */
export const SCREEN_BULLET_WIDTH = 12;
const BAND_PAD_Y = 7;
const SECTION_PAD_TOP = 4;
const SECTION_PAD_BOTTOM = 4;
const ITEM_GAP = 2;

export interface PositionedItem {
  /** The item's text, wrapped. */
  lines: string[];
  /** Baseline of the first line, from the top of the node. Later lines follow at `ITEM_LINE_HEIGHT`. */
  y: number;
}

export interface PositionedSection {
  key: SectionKey;
  /** Baseline of the section's name, from the top of the node. */
  captionY: number;
  items: PositionedItem[];
}

export const TITLE_LINE_HEIGHT = SCREEN_TITLE_FONT_SIZE * LINE_HEIGHT;
export const ITEM_LINE_HEIGHT = SCREEN_ITEM_FONT_SIZE * LINE_HEIGHT;
const CAPTION_LINE_HEIGHT = SCREEN_CAPTION_FONT_SIZE * LINE_HEIGHT;

export interface PositionedNode extends DiagramNode {
  title: string;
  /** Title split into the lines the shape renders. */
  lines: string[];
  kind: IfdamNode["kind"];
  color?: Color;
  task?: string;
  /** Hover text: the memo lines. */
  note?: string;
  /** False when the layout chose the spot, true when the file gave a `@`. */
  placed: boolean;
  cx: number;
  cy: number;
  /** A screen's horizontal rules, as distances from its top edge (empty for other nodes
   * and for a screen with no items). Hand it to the shape: `outline({ ...box, rules })`. */
  rules: number[];
  /** A screen's sections that have items, in drawing order (empty for other nodes). */
  sections: PositionedSection[];
  /** A screen's title band: its height from the top edge, 0 when there are no sections. */
  band: number;
  /** A screen's first title line: distance from the top edge to the top of the line. */
  titleTop: number;
}

export interface PositionedEdge {
  key: string;
  from: string;
  to: string;
  label?: string;
  /** A loop: the arrow goes against the flow, to the left. */
  back: boolean;
  geometry: EdgeGeometry;
  /** Where the label is drawn, when there is one. */
  labelBox?: Box;
}

export interface IfdamLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  /** Sticky notes, empty when the note hides them. */
  stickies: PositionedSticky[];
  /** Bounding box of everything drawn, before any padding the view adds. */
  bounds: Box;
  byId: Map<string, PositionedNode>;
}

export interface IfdamLayoutOptions {
  /** A node held at an exact spot - the one being dragged. It is not re-ranked. */
  pinned?: { id: string; cx: number; cy: number };
}

// ---------------------------------------------------------------------------
// node sizes
// ---------------------------------------------------------------------------

export interface Measured {
  width: number;
  height: number;
  lines: string[];
  rules: number[];
  sections: PositionedSection[];
  band: number;
  titleTop: number;
}

/** What `measureNode` needs of a node. */
export type Measurable = Pick<IfdamNode, "title" | "kind" | "lines">;

/** Box size, text lines and (for a screen) the section geometry of a node. */
export function measureNode(node: Measurable): Measured {
  switch (node.kind) {
    case "screen":
      return measureScreen(node);
    case "trigger": {
      const lines = wrapTitle(node.title, NODE_MAX_WIDTH, NODE_FONT_SIZE);
      const widest = Math.max(...lines.map((l) => textWidth(l, NODE_FONT_SIZE)));
      const textHeight = lines.length * NODE_FONT_SIZE * LINE_HEIGHT;
      return plain(
        Math.max(NODE_MIN_WIDTH, Math.ceil(widest) + 24 + 2 * HEXAGON_INSET),
        Math.max(NODE_MIN_HEIGHT, Math.ceil(textHeight) + NODE_PAD_Y * 2),
        lines,
      );
    }
    case "store": {
      const lines = wrapTitle(node.title, NODE_MAX_WIDTH, NODE_FONT_SIZE);
      const widest = Math.max(...lines.map((l) => textWidth(l, NODE_FONT_SIZE)));
      const textHeight = lines.length * NODE_FONT_SIZE * LINE_HEIGHT;
      // The lids take the top and bottom `CYLINDER_LID` each, outside the text.
      return plain(
        Math.max(96, Math.ceil(widest) + 32),
        Math.max(NODE_MIN_HEIGHT, Math.ceil(textHeight) + NODE_PAD_Y * 2) + 2 * CYLINDER_LID,
        lines,
      );
    }
    case "message": {
      const lines = wrapTitle(node.title, NODE_MAX_WIDTH, NODE_FONT_SIZE);
      const widest = Math.max(...lines.map((l) => textWidth(l, NODE_FONT_SIZE)));
      const textHeight = lines.length * NODE_FONT_SIZE * LINE_HEIGHT;
      return plain(
        Math.max(NODE_MIN_WIDTH, Math.ceil(widest) + 32),
        Math.max(NODE_MIN_HEIGHT, Math.ceil(textHeight) + NODE_PAD_Y * 2),
        lines,
      );
    }
    default: {
      // A process: an ellipse. The text must fit the rectangle inscribed in it,
      // which holds when (textW / W)^2 + (textH / H)^2 <= 1; the width is chosen
      // and the height follows (the same formula as the PFD's process).
      const lines = wrapTitle(node.title, PROCESS_MAX_WIDTH, NODE_FONT_SIZE);
      const widest = Math.max(...lines.map((l) => textWidth(l, NODE_FONT_SIZE)));
      const textHeight = lines.length * NODE_FONT_SIZE * LINE_HEIGHT;
      const tw = Math.ceil(widest) + 8;
      const th = Math.ceil(textHeight) + 6;
      const width = Math.max(120, Math.ceil(tw * 1.5));
      const height = Math.max(PROCESS_MIN_HEIGHT, Math.ceil(th / Math.sqrt(1 - (tw / width) ** 2)));
      return plain(width, height, lines);
    }
  }
}

function plain(width: number, height: number, lines: string[]): Measured {
  return { width, height, lines, rules: [], sections: [], band: 0, titleTop: 0 };
}

function measureScreen(node: Measurable): Measured {
  const titleLines = wrapTitle(node.title, SCREEN_MAX_WIDTH, TITLE_MEASURE_FONT_SIZE);
  let widest = Math.max(...titleLines.map((l) => textWidth(l, TITLE_MEASURE_FONT_SIZE)));

  // The items of each section, wrapped to the widest a screen may be.
  const wrapped = SECTION_KEYS.map((key) => ({
    key,
    items: node.lines
      .filter((l) => l.key === key)
      .map((l) => wrapTitle(l.text, SCREEN_MAX_WIDTH - SCREEN_BULLET_WIDTH, SCREEN_ITEM_FONT_SIZE)),
  })).filter((s) => s.items.length > 0);
  for (const s of wrapped) {
    for (const item of s.items) {
      for (const line of item) {
        widest = Math.max(widest, textWidth(line, SCREEN_ITEM_FONT_SIZE) + SCREEN_BULLET_WIDTH);
      }
    }
  }
  const width = Math.min(
    SCREEN_MAX_WIDTH,
    Math.max(SCREEN_MIN_WIDTH, Math.ceil(widest) + SCREEN_PAD_X * 2),
  );

  const titleBlock = titleLines.length * TITLE_LINE_HEIGHT;
  const titleBand = Math.ceil(titleBlock + BAND_PAD_Y * 2);
  if (wrapped.length === 0) {
    // Nothing to put in the box: a low box with the title in the middle.
    const height = Math.max(NODE_MIN_HEIGHT, titleBand);
    return {
      width,
      height,
      lines: titleLines,
      rules: [],
      sections: [],
      band: 0,
      titleTop: (height - titleBlock) / 2,
    };
  }

  const rules = [titleBand];
  const sections: PositionedSection[] = [];
  let y = titleBand;
  wrapped.forEach((section, index) => {
    if (index > 0) rules.push(y);
    const captionTop = y + SECTION_PAD_TOP;
    const captionY = captionTop + CAPTION_LINE_HEIGHT / 2 + SCREEN_CAPTION_FONT_SIZE * 0.36;
    y = captionTop + CAPTION_LINE_HEIGHT;
    const items: PositionedItem[] = section.items.map((lines) => {
      const itemY = y + ITEM_LINE_HEIGHT / 2 + SCREEN_ITEM_FONT_SIZE * 0.36;
      y += lines.length * ITEM_LINE_HEIGHT + ITEM_GAP;
      return { lines, y: itemY };
    });
    y += SECTION_PAD_BOTTOM;
    sections.push({ key: section.key, captionY, items });
  });
  return {
    width,
    height: Math.ceil(y),
    lines: titleLines,
    rules,
    sections,
    band: titleBand,
    titleTop: BAND_PAD_Y,
  };
}

/** Baseline of line `i` of a node's title. A screen's title sits at the top of
 * its band; any other node's is centred on the node (a data store's a little low,
 * clear of the lid). */
export function nodeTextY(node: PositionedNode, i: number): number {
  if (node.kind === "screen") {
    return (
      node.y + node.titleTop + i * TITLE_LINE_HEIGHT + TITLE_LINE_HEIGHT / 2 + SCREEN_TITLE_FONT_SIZE * 0.36
    );
  }
  const lineHeight = NODE_FONT_SIZE * LINE_HEIGHT;
  const shift = node.kind === "store" ? CYLINDER_LID / 2 : 0;
  return (
    node.cy + shift - ((node.lines.length - 1) * lineHeight) / 2 + i * lineHeight + NODE_FONT_SIZE * 0.36
  );
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

export function layoutIfdam(
  doc: { nodes: IfdamNode[]; edges: IfdamEdge[] },
  stickies: Sticky[] = [],
  options: IfdamLayoutOptions = {},
): IfdamLayout {
  const sized = doc.nodes.map((node) => ({ node, ...measureNode(node) }));
  const known = new Set(doc.nodes.map((n) => n.id));
  const isStore = new Set(doc.nodes.filter((n) => n.kind === "store").map((n) => n.id));

  // The arrows that take part in the ranking: those between two nodes that are
  // not data stores. `flowAt` maps their position in that list back to `doc.edges`.
  const flowEdges: IfdamEdge[] = [];
  const flowAt: number[] = [];
  doc.edges.forEach((edge, i) => {
    if (!known.has(edge.from) || !known.has(edge.to)) return;
    if (isStore.has(edge.from) || isStore.has(edge.to)) return;
    flowEdges.push(edge);
    flowAt.push(i);
  });

  // A data store sits in the column of the first node that touches it (the
  // first arrow, in the order written, whose other end is not a store), so it
  // hangs right under that node. One touched only by other stores follows them;
  // one touched by nothing takes column 0.
  const flowRank = rankNodes(
    doc.nodes.filter((n) => !isStore.has(n.id)).map((n) => n.id),
    flowEdges,
  ).rank;
  const ranks = new Map<string, number>();
  for (let pass = 0; pass <= isStore.size; pass++) {
    for (const id of isStore) {
      if (ranks.has(id)) continue;
      for (const edge of doc.edges) {
        const other = edge.from === id ? edge.to : edge.to === id ? edge.from : null;
        if (other === null || other === id || !known.has(other)) continue;
        const r = isStore.has(other) ? ranks.get(other) : flowRank.get(other);
        if (r !== undefined) {
          ranks.set(id, r);
          break;
        }
      }
    }
  }
  for (const id of isStore) if (!ranks.has(id)) ranks.set(id, 0);

  // Every node takes part, placed or not, so that placing one never moves the
  // spot another was given. `layerLayout` knows nothing of `@`; it is laid over
  // its result below.
  const layered = layerLayout(
    sized.map((s) => ({
      id: s.node.id,
      width: s.width,
      height: s.height,
      row: isStore.has(s.node.id) ? "store" : "main",
    })),
    flowEdges,
    { rows: ["main", "store"], ranks, originX: ORIGIN, originY: ORIGIN },
  );
  const back = doc.edges.map(() => false);
  flowAt.forEach((docIndex, k) => {
    back[docIndex] = layered.back[k];
  });

  const nodes: PositionedNode[] = sized.map(({ node, width, height, lines, rules, sections, band, titleTop }) => {
    const auto = layered.nodes.get(node.id)!;
    const pinned = options.pinned?.id === node.id ? options.pinned : null;
    const placed = pinned !== null || (node.x !== undefined && node.y !== undefined);
    const cx = pinned ? pinned.cx : placed ? node.x! : auto.cx;
    const cy = pinned ? pinned.cy : placed ? node.y! : auto.cy;
    const memo = memoOf(node);
    return {
      id: node.id,
      shape: shapeOfKind(node.kind),
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
      title: node.title,
      lines,
      kind: node.kind,
      ...(node.color ? { color: node.color } : {}),
      ...(node.task ? { task: node.task } : {}),
      ...(memo ? { note: memo } : {}),
      placed,
      cx,
      cy,
      rules,
      sections,
      band,
      titleTop,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Forward arrows first, so that a loop finds its way round them. An arrow
  // that runs to the left (a loop back to an earlier screen) is a loop: the
  // innermost - the shortest - gets the lane nearest the diagram.
  const leftward = doc.edges.map((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    return !!from && !!to && from.id !== to.id && to.x + to.width + MIN_GAP <= from.x;
  });
  const slots: (PositionedEdge | null)[] = doc.edges.map(() => null);
  const used: Segment[] = [];
  const lay = (i: number, geometry: EdgeGeometry | null) => {
    if (!geometry) return; // an arrow from a node to itself is kept, not drawn
    const edge = doc.edges[i];
    for (let k = 1; k < geometry.points.length; k++) {
      used.push({ a: geometry.points[k - 1], b: geometry.points[k] });
    }
    const positioned: PositionedEdge = {
      key: edgeKey(edge),
      from: edge.from,
      to: edge.to,
      ...(edge.label ? { label: edge.label } : {}),
      back: back[i] || leftward[i],
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
  };

  const ceiling = Math.min(Infinity, ...nodes.map((n) => n.y));
  let overTheTop = 0;
  for (let i = 0; i < doc.edges.length; i++) {
    if (leftward[i]) continue;
    const from = byId.get(doc.edges[i].from);
    const to = byId.get(doc.edges[i].to);
    if (!from || !to) continue;
    const others = nodes.filter((n) => n.id !== from.id && n.id !== to.id);
    // A pinned arrow skips the detours: it leaves and enters through its
    // ports, and the middle stays automatic.
    if (doc.edges[i].fromPort || doc.edges[i].toPort) {
      lay(
        i,
        edgeGeometry(from, to, "orthogonal", { obstacles: others, used, ...portsOption(doc.edges[i]) }),
      );
      continue;
    }
    // An arrow whose straight line would run through a box (a process to the
    // second of two stores under it; the first box of three in a row to the
    // third) goes round instead.
    const blocked = blockedStraight(from, to, others);
    lay(
      i,
      blocked === "column"
        ? columnDetour(from, to, nodes, used)
        : blocked === "row"
          ? rowDetour(from, to, ceiling - DETOUR_MARGIN - overTheTop++ * LANE_STEP)
          : edgeGeometry(from, to, "orthogonal", { obstacles: others, used }),
    );
  }
  const loops = doc.edges
    .map((_, i) => i)
    .filter((i) => leftward[i])
    .sort((a, b) => span(doc.edges[a], byId) - span(doc.edges[b], byId) || a - b);
  const floor = Math.max(0, ...nodes.map((n) => n.y + n.height));
  loops.forEach((i, lane) => {
    const from = byId.get(doc.edges[i].from)!;
    const to = byId.get(doc.edges[i].to)!;
    if (doc.edges[i].fromPort || doc.edges[i].toPort) {
      const others = nodes.filter((n) => n.id !== from.id && n.id !== to.id);
      lay(
        i,
        edgeGeometry(from, to, "orthogonal", { obstacles: others, used, ...portsOption(doc.edges[i]) }),
      );
      return;
    }
    lay(i, loopGeometry(from, to, nodes, used, floor + DETOUR_MARGIN + lane * LANE_STEP));
  });
  const edges = slots.filter((e): e is PositionedEdge => e !== null);

  const placedStickies = stickies
    .map((sticky) => placeSticky(sticky, byId.get(sticky.targetId)))
    .filter((s): s is PositionedSticky => s !== null);

  const bounds = boundsOfBoxes([
    ...nodes,
    ...placedStickies,
    ...edges.flatMap((e) => (e.labelBox ? [e.labelBox] : [])),
    ...edges.map((e) =>
      boundsOfBoxes(e.geometry.points.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 }))),
    ),
  ]);

  return { nodes, edges, stickies: placedStickies, bounds, byId };
}

function span(edge: IfdamEdge, byId: Map<string, PositionedNode>): number {
  return (byId.get(edge.from)?.cx ?? 0) - (byId.get(edge.to)?.cx ?? 0);
}

// ---------------------------------------------------------------------------
// loops: arrows that run to the left
// ---------------------------------------------------------------------------

/** Least free space between two boxes for a route to run through the gap. Same as the shared router's. */
const MIN_GAP = 16;
/** Spacing between the alternative lines a loop may take. Same as the shared router's. */
const LANE_STEP = 12;
/** How far outside its node a loop's vertical leg starts looking for a free line. */
const LEG_MARGIN = 18;
/** A leg keeps this far from a box it is not joined to. */
const CLEARANCE = 6;
const LEG_CANDIDATES = 9;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The arrow of a loop: out of the **left side** of `from`, a little below its
 * middle, along the gap between two columns and down to a lane under the whole
 * diagram (`laneY`), along the lane to the gap on the right of `to`, up it and
 * into the **right side** of `to`, a little below its middle.
 *
 * Why not the shared router's loop (out of the middle of the underside, along
 * the first free line under the two nodes, up into the underside of `to`): in
 * this diagram a data store hangs under the process, so that vertical leg runs
 * along the line between the process and its store, and into the store when the
 * lane is far enough down. Leaving by a side puts the vertical legs in the gaps
 * between columns, where there are no boxes; the lane under everything cannot
 * meet one either.
 *
 * A leg takes the first free line out of `LEG_CANDIDATES` (a box in the way costs
 * far more than another arrow lying on it), 18px out of the node and then 12px
 * further each time. The shapes' own outlines decide where the arrow meets the
 * node, so it works for the hexagon, the ellipse and the cylinder alike.
 */
function loopGeometry(
  from: PositionedNode,
  to: PositionedNode,
  nodes: PositionedNode[],
  used: Segment[],
  laneY: number,
): EdgeGeometry {
  const sy = from.cy + from.height * 0.25;
  const ey = to.cy + to.height * 0.25;
  const start = sidePoint(from, -1, sy);
  const end = sidePoint(to, 1, ey);

  const xA = freeLeg(
    Array.from({ length: LEG_CANDIDATES }, (_, k) => from.x - LEG_MARGIN - k * LANE_STEP),
    sy,
    laneY,
    nodes.filter((n) => n.id !== from.id),
    used,
    [],
  );
  const xB = freeLeg(
    Array.from({ length: LEG_CANDIDATES }, (_, k) => to.x + to.width + LEG_MARGIN + k * LANE_STEP),
    ey,
    laneY,
    nodes.filter((n) => n.id !== to.id),
    used,
    [xA],
  );
  return orthogonalOf(
    [start, { x: xA, y: sy }, { x: xA, y: laneY }, { x: xB, y: laneY }, { x: xB, y: ey }, end],
    { x: (xA + xB) / 2, y: laneY },
  );
}

/** What a straight arrow between two nodes would run through: the boxes in
 * between when they share a column (`"column"`) or a row (`"row"`), otherwise `null`. */
function blockedStraight(
  from: PositionedNode,
  to: PositionedNode,
  others: PositionedNode[],
): "column" | "row" | null {
  if (Math.abs(from.cx - to.cx) < 0.5) {
    const below = to.cy > from.cy;
    const gap = below ? to.y - (from.y + from.height) : from.y - (to.y + to.height);
    if (gap < MIN_GAP) return null;
    const lo = Math.min(from.cy, to.cy);
    const hi = Math.max(from.cy, to.cy);
    const hit = others.some(
      (n) => from.cx > n.x && from.cx < n.x + n.width && hi > n.y && lo < n.y + n.height,
    );
    return hit ? "column" : null;
  }
  if (Math.abs(from.cy - to.cy) < 0.5 && to.x - (from.x + from.width) >= MIN_GAP) {
    const hit = others.some(
      (n) => from.cy > n.y && from.cy < n.y + n.height && n.x < to.x && n.x + n.width > from.x + from.width,
    );
    return hit ? "row" : null;
  }
  return null;
}

/**
 * Round the right of a column: out of the right side of `from`, towards `to`,
 * along a line outside the widest box of the two, and into the right side of
 * `to`. The shared router would run the straight line through the box between.
 */
function columnDetour(
  from: PositionedNode,
  to: PositionedNode,
  nodes: PositionedNode[],
  used: Segment[],
): EdgeGeometry {
  const dir = to.cy > from.cy ? 1 : -1;
  const sy = from.cy + dir * from.height * 0.25;
  const ey = to.cy - dir * to.height * 0.25;
  const start = sidePoint(from, 1, sy);
  const end = sidePoint(to, 1, ey);
  const right = Math.max(from.x + from.width, to.x + to.width);
  const x = freeLeg(
    Array.from({ length: LEG_CANDIDATES }, (_, k) => right + LEG_MARGIN + k * LANE_STEP),
    start.y,
    end.y,
    nodes.filter((n) => n.id !== from.id && n.id !== to.id),
    used,
    [],
  );
  return orthogonalOf([start, { x, y: start.y }, { x, y: end.y }, end], {
    x,
    y: (start.y + end.y) / 2,
  });
}

/** Over the top: out of the top of `from`, along a lane above every box, and down into the top of `to`. */
function rowDetour(from: PositionedNode, to: PositionedNode, laneY: number): EdgeGeometry {
  const start = topPoint(from, from.cx);
  const end = topPoint(to, to.cx);
  return orthogonalOf([start, { x: from.cx, y: laneY }, { x: to.cx, y: laneY }, end], {
    x: (from.cx + to.cx) / 2,
    y: laneY,
  });
}

function orthogonalOf(points: Point[], mid: Point): EdgeGeometry {
  const start = points[0];
  const end = points[points.length - 1];
  const last = points[points.length - 2];
  return {
    style: "orthogonal",
    d: points.map((p, i) => `${i === 0 ? "M" : "L"} ${round2(p.x)} ${round2(p.y)}`).join(" "),
    points,
    start,
    end,
    headAngle: Math.atan2(end.y - last.y, end.x - last.x),
    mid,
  };
}

/** Where the vertical line at `x` meets the node's outline on its top. */
function topPoint(node: PositionedNode, x: number): Point {
  let lo = 0;
  let hi = node.height / 2 + 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (nodeContains(node, { x, y: node.cy - mid })) lo = mid;
    else hi = mid;
  }
  return { x, y: node.cy - (lo + hi) / 2 };
}

/** Where the horizontal line at height `y` meets the node's outline, on its
 * left (`side` -1) or right (1). The centre's height stands in for a `y` the
 * shape does not reach. */
function sidePoint(node: PositionedNode, side: -1 | 1, y: number): Point {
  const cx = node.cx;
  const at = nodeContains(node, { x: cx, y }) ? y : node.cy;
  let lo = 0;
  let hi = node.width / 2 + 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (nodeContains(node, { x: cx + side * mid, y: at })) lo = mid;
    else hi = mid;
  }
  return { x: cx + side * ((lo + hi) / 2), y: at };
}

/** The first of `xs` whose vertical leg between `y0` and `y1` is free: no
 * box in the way (far the worst), no other arrow lying along it. `avoid` are
 * lines a leg must keep clear of (the other leg of the same loop). */
function freeLeg(
  xs: number[],
  y0: number,
  y1: number,
  obstacles: PositionedNode[],
  used: Segment[],
  avoid: number[],
): number {
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  let best = xs[0];
  let bestCost = Infinity;
  for (const x of xs) {
    let cost = 0;
    for (const box of obstacles) {
      if (
        x > box.x - CLEARANCE &&
        x < box.x + box.width + CLEARANCE &&
        hi > box.y - CLEARANCE &&
        lo < box.y + box.height + CLEARANCE
      ) {
        cost += 1000;
      }
    }
    for (const seg of used) {
      if (Math.abs(seg.a.x - seg.b.x) >= 0.5 || Math.abs(seg.a.x - x) >= 4) continue;
      const overlap = Math.min(hi, Math.max(seg.a.y, seg.b.y)) - Math.max(lo, Math.min(seg.a.y, seg.b.y));
      if (overlap > 2) cost += 10;
    }
    if (avoid.some((a) => Math.abs(a - x) < 8)) cost += 5;
    if (cost < bestCost) {
      best = x;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return best;
}
