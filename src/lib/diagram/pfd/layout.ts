/**
 * PFD layout: the one geometry the canvas and the exports both draw.
 *
 * A node with `@x,y` sits at that absolute centre. A node without one is put
 * where `layerLayout` says - columns follow the arrows, everything in a single
 * row - which is only a starting point: the file gets a position for a node
 * when the user drags it, and for no other. Sizes come from fixed text metrics,
 * so an export rendered on another machine puts every box where the app did.
 *
 * Arrows are curves (`edgeGeometry`'s "curve"), cut where they leave and enter
 * the node shapes and headed along the curve's own direction at the tip.
 */
import type { Color } from "../colors";
import { layerLayout } from "../graph-layout";
import { edgeGeometry, edgeKey, type DiagramNode, type EdgeGeometry } from "../node-edge";
import { documentWaveDepth } from "../shapes";
import {
  boundsOfBoxes,
  placeSticky,
  type Box,
  type PositionedSticky,
} from "../sticky-layout";
import type { Sticky } from "../sticky";
import { LINE_HEIGHT, textWidth, wrapTitle } from "../text";
import type { PfdEdge, PfdNode } from "./parse";
import { symbolOf } from "./symbols";

export const NODE_FONT_SIZE = 13;
export const NODE_MIN_HEIGHT = 52;
/** Wrap width of a node's title. */
export const NODE_MAX_WIDTH = 190;
/** Left and top edge of the automatic layout. */
export const ORIGIN = 40;
/** Shape used for a node whose prefix is not a symbol (never laid out in practice). */
const FALLBACK_SHAPE = "rect";

export interface PositionedNode extends DiagramNode {
  title: string;
  /** Title split into the lines the shape renders. */
  lines: string[];
  /** Id prefix, which says what kind of node it is. */
  prefix: string;
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
  geometry: EdgeGeometry;
}

export interface PfdLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  /** Sticky notes, empty when the note hides them. */
  stickies: PositionedSticky[];
  /** Bounding box of everything drawn, before any padding the view adds. */
  bounds: Box;
  byId: Map<string, PositionedNode>;
}

export interface PfdLayoutOptions {
  /** A node held at an exact spot - the one being dragged. */
  pinned?: { id: string; cx: number; cy: number };
}

// ---------------------------------------------------------------------------
// node sizes
// ---------------------------------------------------------------------------

/** Box size and text lines of a node, from its title and the shape it is drawn with. */
export function measureNode(title: string, shape: string): {
  width: number;
  height: number;
  lines: string[];
} {
  const lines = wrapTitle(title, NODE_MAX_WIDTH, NODE_FONT_SIZE);
  const widest = Math.max(...lines.map((l) => textWidth(l, NODE_FONT_SIZE)));
  const textHeight = lines.length * NODE_FONT_SIZE * LINE_HEIGHT;
  if (shape === "ellipse") {
    // The text must fit the rectangle inscribed in the ellipse: it fits when
    // (textW / W)^2 + (textH / H)^2 <= 1, so the width is chosen and the
    // height follows.
    const tw = Math.ceil(widest) + 8;
    const th = Math.ceil(textHeight) + 6;
    const width = Math.max(120, Math.ceil(tw * 1.5));
    const height = Math.max(NODE_MIN_HEIGHT, Math.ceil(th / Math.sqrt(1 - (tw / width) ** 2)));
    return { width, height, lines };
  }
  if (shape === "document") {
    const base = Math.ceil(textHeight) + 18;
    const width = Math.max(110, Math.ceil(widest) + 32);
    // Leave room for the ripple at the bottom, which takes up to twice its depth.
    let height = Math.max(NODE_MIN_HEIGHT, base);
    height = Math.max(height, base + Math.ceil(2 * documentWaveDepth(height)));
    return { width, height, lines };
  }
  return {
    width: Math.max(96, Math.ceil(widest) + 32),
    height: Math.max(NODE_MIN_HEIGHT, Math.ceil(textHeight) + 18),
    lines,
  };
}

/** Baseline of line `i` of a node's title, centred on the node. A deliverable's
 * text sits a little high, clear of the ripple along its bottom edge. */
export function nodeTextY(node: PositionedNode, i: number): number {
  const lineHeight = NODE_FONT_SIZE * LINE_HEIGHT;
  const lift = node.shape === "document" ? documentWaveDepth(node.height) : 0;
  return (
    node.cy - lift - ((node.lines.length - 1) * lineHeight) / 2 + i * lineHeight + NODE_FONT_SIZE * 0.36
  );
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

export function layoutPfd(
  doc: { nodes: PfdNode[]; edges: PfdEdge[] },
  stickies: Sticky[] = [],
  options: PfdLayoutOptions = {},
): PfdLayout {
  const sized = doc.nodes.map((node) => {
    const symbol = symbolOf(node.id);
    const shape = symbol?.shape ?? FALLBACK_SHAPE;
    return { node, shape, prefix: symbol?.prefix ?? "", ...measureNode(node.title, shape) };
  });

  // Every node takes part, placed or not, so that placing one never moves the
  // spot another was given.
  const layered = layerLayout(
    sized.map((s) => ({ id: s.node.id, width: s.width, height: s.height, row: "" })),
    doc.edges,
    { rows: [""], originX: ORIGIN, originY: ORIGIN },
  );

  const nodes: PositionedNode[] = sized.map(({ node, shape, prefix, width, height, lines }) => {
    const auto = layered.nodes.get(node.id)!;
    const pinned = options.pinned?.id === node.id ? options.pinned : null;
    const placed = pinned !== null || (node.x !== undefined && node.y !== undefined);
    const cx = pinned ? pinned.cx : placed ? node.x! : auto.cx;
    const cy = pinned ? pinned.cy : placed ? node.y! : auto.cy;
    return {
      id: node.id,
      shape,
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
      title: node.title,
      lines,
      prefix,
      ...(node.color ? { color: node.color } : {}),
      ...(node.task ? { task: node.task } : {}),
      ...(node.note ? { note: node.note } : {}),
      placed,
      cx,
      cy,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const edges: PositionedEdge[] = [];
  for (const edge of doc.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const geometry = edgeGeometry(from, to, "curve");
    if (!geometry) continue;
    edges.push({ key: edgeKey(edge), from: edge.from, to: edge.to, geometry });
  }

  const placedStickies = stickies
    .map((sticky) => placeSticky(sticky, byId.get(sticky.targetId)))
    .filter((s): s is PositionedSticky => s !== null);

  const bounds = boundsOfBoxes([
    ...nodes,
    ...placedStickies,
    ...edges.map((e) =>
      boundsOfBoxes(e.geometry.points.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 }))),
    ),
  ]);

  return { nodes, edges, stickies: placedStickies, bounds, byId };
}
