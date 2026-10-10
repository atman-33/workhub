/**
 * Program-flow layout: the one geometry the canvas and the exports both draw
 * (T-0698).
 *
 * The chart runs downward. A node with no `@` is put by `rankColumnLayout`:
 * the row is the node's rank (the arrows decide it), and the column is a branch
 * - the first exit of a node continues straight down, the second goes to a new
 * column on the right, the third to one on the left, and so on. A node with
 * `@x,y` sits at that absolute centre, whatever the layout would have said;
 * placing one never moves another. Everything is computed here with fixed text
 * metrics, so an export rendered on another machine puts every box where the
 * app did.
 *
 * Arrows are orthogonal and routed one after another with the vertical router
 * (`flow: "down"`), each avoiding the boxes of the other nodes and the lines
 * already laid. Forward arrows go first so a loop finds its way round them. The
 * label of an arrow leaving a decision sits on its first segment, next to the
 * branch.
 */
import type { Color } from "../colors";
import { portsOption } from "../edge-ports";
import { rankColumnLayout } from "../graph-layout";
import {
  edgeGeometry,
  edgeKey,
  type DiagramNode,
  type EdgeGeometry,
  type Segment,
} from "../node-edge";
import { documentWaveDepth, PARALLELOGRAM_SLANT, SUBROUTINE_INSET } from "../shapes";
import { boundsOfBoxes, placeSticky, type Box, type PositionedSticky } from "../sticky-layout";
import type { Sticky } from "../sticky";
import { LINE_HEIGHT, NODE_PAD_X, textWidth, wrapTitle } from "../text";
import type { AlgorithmEdge, AlgorithmNode } from "./parse";
import { shapeOfKind, type NodeKind } from "./symbols";

export const NODE_FONT_SIZE = 13;
export const NODE_PAD_Y = 8;
export const NODE_MIN_WIDTH = 88;
export const NODE_MIN_HEIGHT = 40;
/** Wrap width of a node's title. */
export const NODE_MAX_WIDTH = 180;
/** Wrap width of a decision's title (the diamond needs the room round it). */
export const DECISION_MAX_WIDTH = 150;
export const EDGE_LABEL_FONT_SIZE = 11;
/** Left and top edge of the automatic layout. */
export const ORIGIN = 40;
/** How far along its first segment the label of an arrow leaving a decision sits. */
export const DECISION_LABEL_OFFSET = 24;

export interface PositionedNode extends DiagramNode {
  title: string;
  /** Title split into the lines the shape renders. */
  lines: string[];
  kind: NodeKind;
  color?: Color;
  task?: string;
  note?: string;
  /** False when the layout chose the spot, true when the file gave a `@`. */
  placed: boolean;
  cx: number;
  cy: number;
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

export interface AlgorithmLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  /** Sticky notes, empty when the note hides them. */
  stickies: PositionedSticky[];
  /** Bounding box of everything drawn, before any padding the view adds. */
  bounds: Box;
  byId: Map<string, PositionedNode>;
}

export interface AlgorithmLayoutOptions {
  /** A node held at an exact spot - the one being dragged. It is not re-ranked. */
  pinned?: { id: string; cx: number; cy: number };
}

// ---------------------------------------------------------------------------
// node sizes
// ---------------------------------------------------------------------------

/** Box size and text lines of a node, from its title and kind. */
export function measureNode(
  title: string,
  kind: string,
): { width: number; height: number; lines: string[] } {
  const decision = kind === "decision";
  const lines = wrapTitle(title, decision ? DECISION_MAX_WIDTH : NODE_MAX_WIDTH, NODE_FONT_SIZE);
  const widest = Math.max(...lines.map((l) => textWidth(l, NODE_FONT_SIZE)));
  const textHeight = lines.length * NODE_FONT_SIZE * LINE_HEIGHT;
  if (decision) {
    // The text must fit the rectangle inscribed in the diamond: it fits when
    // textW / W + textH / H <= 1, so the width is chosen and the height follows.
    const tw = Math.ceil(widest) + 12;
    const th = Math.ceil(textHeight) + 8;
    const width = Math.max(120, Math.ceil(tw * 1.7));
    const height = Math.max(64, Math.ceil(th / (1 - tw / width)));
    return { width, height, lines };
  }
  const height = Math.max(NODE_MIN_HEIGHT, Math.ceil(textHeight) + NODE_PAD_Y * 2);
  // What each shape takes from the box for itself: the slanted sides, the
  // inner rules, the rounded ends.
  const extra =
    kind === "io"
      ? 2 * PARALLELOGRAM_SLANT
      : kind === "sub"
        ? 2 * SUBROUTINE_INSET
        : kind === "start" || kind === "end"
          ? 8
          : 0;
  const width = Math.max(NODE_MIN_WIDTH, Math.ceil(widest) + NODE_PAD_X * 2 + extra);
  if (kind === "doc") {
    // Leave room for the ripple along the bottom edge, which takes up to twice its depth.
    return { width, height: height + Math.ceil(2 * documentWaveDepth(height)), lines };
  }
  return { width, height, lines };
}

/** Baseline of line `i` of a node's title, centred on the node. A document's
 * text sits a little high, clear of the ripple along its bottom edge. */
export function nodeTextY(node: PositionedNode, i: number): number {
  const lineHeight = NODE_FONT_SIZE * LINE_HEIGHT;
  const lift = node.kind === "doc" ? documentWaveDepth(node.height) : 0;
  return (
    node.cy - lift - ((node.lines.length - 1) * lineHeight) / 2 + i * lineHeight + NODE_FONT_SIZE * 0.36
  );
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

export function layoutAlgorithm(
  doc: { nodes: AlgorithmNode[]; edges: AlgorithmEdge[] },
  stickies: Sticky[] = [],
  options: AlgorithmLayoutOptions = {},
): AlgorithmLayout {
  const sized = doc.nodes.map((node) => ({ node, ...measureNode(node.title, node.kind) }));

  // Every node takes part, placed or not, so that placing one never moves the
  // spot another was given. The arrows go in as written: the first exit of a
  // node is the trunk. `rankColumnLayout` knows nothing of `@`; it is laid over
  // its result below.
  const layered = rankColumnLayout(
    sized.map((s) => ({ id: s.node.id, width: s.width, height: s.height })),
    doc.edges,
    { originX: ORIGIN, originY: ORIGIN },
  );

  const nodes: PositionedNode[] = sized.map(({ node, width, height, lines }) => {
    const auto = layered.nodes.get(node.id)!;
    const pinned = options.pinned?.id === node.id ? options.pinned : null;
    const placed = pinned !== null || (node.x !== undefined && node.y !== undefined);
    const cx = pinned ? pinned.cx : placed ? node.x! : auto.cx;
    const cy = pinned ? pinned.cy : placed ? node.y! : auto.cy;
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
      ...(node.note ? { note: node.note } : {}),
      placed,
      cx,
      cy,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Forward arrows are routed first so that a loop finds its way round them
  // rather than the other way about.
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
    const geometry = edgeGeometry(from, to, "orthogonal", {
      flow: "down",
      obstacles: nodes.filter((n) => n.id !== from.id && n.id !== to.id),
      used,
      ...(from.kind === "decision" ? { labelOffset: DECISION_LABEL_OFFSET } : {}),
      ...portsOption(edge),
    });
    if (!geometry) continue; // an arrow from a node to itself is kept, not drawn
    for (let k = 1; k < geometry.points.length; k++) {
      used.push({ a: geometry.points[k - 1], b: geometry.points[k] });
    }
    const positioned: PositionedEdge = {
      key: edgeKey(edge),
      from: edge.from,
      to: edge.to,
      ...(edge.label ? { label: edge.label } : {}),
      back: layered.back[i],
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
    ...nodes,
    ...placedStickies,
    ...edges.flatMap((e) => (e.labelBox ? [e.labelBox] : [])),
    ...edges.map((e) =>
      boundsOfBoxes(e.geometry.points.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 }))),
    ),
  ]);

  return { nodes, edges, stickies: placedStickies, bounds, byId };
}
