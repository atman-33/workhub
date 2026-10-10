/**
 * Use case diagram layout: the one geometry the canvas and the exports both
 * draw (T-0706).
 *
 * The systems sit in a row in the middle and everything else - people and
 * external services - on an ellipse around them (`ringLayout`, in file order,
 * from 12 o'clock clockwise). A person's actions are an always-visible speech
 * bubble on the outer side of the person; the ring leaves room for it, and the
 * bubble follows the person wherever it is dropped. A node with `@x,y` sits at
 * that absolute centre; every node still takes part in the ring, so pinning one
 * never moves another. Everything is computed here with fixed text metrics, so
 * an export rendered on another machine puts every box where the app did.
 *
 * Lines are straight, centre to centre, cut at each node's outline. The label
 * sits at the middle. A node joined to itself is kept in the note and not drawn.
 */
import type { Color } from "../colors";
import { RING_SYSTEM_CLEARANCE, ringLayout } from "../graph-layout";
import { edgeGeometry, edgeKey, type DiagramNode, type EdgeGeometry } from "../node-edge";
import { BUBBLE_TAIL, PERSON_ICON_HEIGHT, type BubbleSide } from "../shapes";
import { boundsOfBoxes, placeSticky, type Box, type PositionedSticky } from "../sticky-layout";
import type { Sticky } from "../sticky";
import { LINE_HEIGHT, NODE_PAD_X, textWidth, wrapTitle } from "../text";
import { actionsOf, type UsecaseEdge, type UsecaseNode } from "./parse";
import { shapeOfKind, symbolOfKind, type NodeKind } from "./symbols";

export const NODE_FONT_SIZE = 13;
export const SYSTEM_FONT_SIZE = 14;
export const EDGE_LABEL_FONT_SIZE = 11;
/** Left and top edge of the automatic layout. */
export const ORIGIN = 40;

/** Space between a person's icon and its name. */
export const PERSON_ICON_GAP = 6;
export const PERSON_MIN_WIDTH = 88;
/** Wrap width of a person's name. */
export const PERSON_NAME_WIDTH = 140;
export const SYSTEM_MIN_WIDTH = 200;
export const SYSTEM_MIN_HEIGHT = 120;
export const SYSTEM_TITLE_WIDTH = 220;
/** Space above a system's title. */
export const SYSTEM_PAD_TOP = 14;
export const EXT_MIN_WIDTH = 120;
export const EXT_MIN_HEIGHT = 48;
export const EXT_TITLE_WIDTH = 160;
export const NODE_PAD_Y = 8;
/** Free line on each side of a label that sits on a line between a system and its neighbour. */
export const LABEL_ROOM = 24;

export const BUBBLE_FONT_SIZE = 12;
export const BUBBLE_PAD = 8;
/** Room for the bullet in front of each item; the text starts this far right of the padding. */
export const BUBBLE_BULLET_WIDTH = 12;
export const BUBBLE_BULLET = "・";
export const BUBBLE_MAX_WIDTH = 200;
export const BUBBLE_MIN_WIDTH = 48;
export const BUBBLE_LINE_HEIGHT = BUBBLE_FONT_SIZE * LINE_HEIGHT;

export interface PositionedNode extends DiagramNode {
  title: string;
  /** Title split into the lines the shape renders. */
  lines: string[];
  kind: NodeKind;
  color?: Color;
  task?: string;
  /** Hover memo: the continuation lines of a system or an external service. A person's go to the bubble. */
  note?: string;
  /** False when the ring chose the spot, true when the file (or a drag) gave one. */
  placed: boolean;
  cx: number;
  cy: number;
  fontSize: number;
  /** Title in bold (a system's). */
  bold: boolean;
  strokeWidth: number;
  /** `stroke-dasharray` of the outline, when dashed. */
  dash?: string;
}

/** A person's speech bubble: the box (the tail lies outside it) and its text. */
export interface PositionedBubble extends Box {
  /** The person it belongs to. */
  nodeId: string;
  /** Side of the person the bubble sits on. */
  side: BubbleSide;
  /** Side of the bubble that carries the tail (faces the person):
   * `speechBubbleOutline(bubble, bubble.tailSide)`. */
  tailSide: BubbleSide;
  /** One entry per action. `lines[0]` gets the bullet; the rest hang under the text.
   * `y` is the first line's baseline, from the top of the bubble; the next line is
   * `BUBBLE_LINE_HEIGHT` further down. Text starts at x + BUBBLE_PAD + BUBBLE_BULLET_WIDTH,
   * the bullet at x + BUBBLE_PAD. */
  items: { lines: string[]; y: number }[];
}

export interface PositionedEdge {
  key: string;
  from: string;
  to: string;
  label?: string;
  /** Draw an arrowhead at `geometry.end` (`->`). A line (`--`) has none. */
  head: boolean;
  geometry: EdgeGeometry;
  /** Where the label is drawn, when there is one. */
  labelBox?: Box;
}

export interface UsecaseLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  bubbles: PositionedBubble[];
  /** Sticky notes, empty when the note hides them. */
  stickies: PositionedSticky[];
  /** Bounding box of everything drawn (bubble tails included), before any padding the view adds. */
  bounds: Box;
  byId: Map<string, PositionedNode>;
  /** Bubble of each person that has one. */
  bubbleOf: Map<string, PositionedBubble>;
}

export interface UsecaseLayoutOptions {
  /** A node held at an exact spot - the one being dragged. Its bubble follows. */
  pinned?: { id: string; cx: number; cy: number };
}

// ---------------------------------------------------------------------------
// sizes
// ---------------------------------------------------------------------------

/** Box size and title lines of a node, from its title and kind. */
export function measureNode(
  title: string,
  kind: string,
): { width: number; height: number; lines: string[] } {
  const symbol = symbolOfKind(kind);
  if (symbol.text === "below-icon") {
    const lines = wrapTitle(title, PERSON_NAME_WIDTH, NODE_FONT_SIZE);
    const widest = Math.max(...lines.map((l) => textWidth(l, NODE_FONT_SIZE)));
    return {
      width: Math.max(PERSON_MIN_WIDTH, Math.ceil(widest) + 2 * NODE_PAD_X),
      height:
        PERSON_ICON_HEIGHT + PERSON_ICON_GAP + Math.ceil(lines.length * NODE_FONT_SIZE * LINE_HEIGHT),
      lines,
    };
  }
  if (symbol.text === "top") {
    const lines = wrapTitle(title, SYSTEM_TITLE_WIDTH, SYSTEM_FONT_SIZE);
    const widest = Math.max(...lines.map((l) => textWidth(l, SYSTEM_FONT_SIZE)));
    const textHeight = Math.ceil(lines.length * SYSTEM_FONT_SIZE * LINE_HEIGHT);
    return {
      width: Math.max(SYSTEM_MIN_WIDTH, Math.ceil(widest) + 2 * NODE_PAD_X),
      height: Math.max(SYSTEM_MIN_HEIGHT, textHeight + SYSTEM_PAD_TOP + 2 * NODE_PAD_Y),
      lines,
    };
  }
  const lines = wrapTitle(title, EXT_TITLE_WIDTH, NODE_FONT_SIZE);
  const widest = Math.max(...lines.map((l) => textWidth(l, NODE_FONT_SIZE)));
  const textHeight = Math.ceil(lines.length * NODE_FONT_SIZE * LINE_HEIGHT);
  return {
    width: Math.max(EXT_MIN_WIDTH, Math.ceil(widest) + 2 * NODE_PAD_X),
    height: Math.max(EXT_MIN_HEIGHT, textHeight + 2 * NODE_PAD_Y),
    lines,
  };
}

/** Baseline of line `i` of a node's title. A person's name sits under the icon, a
 * system's at the top of its box, anything else is centred. */
export function nodeTextY(node: PositionedNode, i: number): number {
  const lineHeight = node.fontSize * LINE_HEIGHT;
  const lineMiddle = (k: number) => lineHeight * (k + 0.5) + node.fontSize * 0.36;
  const text = symbolOfKind(node.kind).text;
  if (text === "below-icon") return node.y + PERSON_ICON_HEIGHT + PERSON_ICON_GAP + lineMiddle(i);
  if (text === "top") return node.y + SYSTEM_PAD_TOP + lineMiddle(i);
  return node.cy - ((node.lines.length - 1) * lineHeight) / 2 + i * lineHeight + node.fontSize * 0.36;
}

/** Size and wrapped text of the bubble for a person's `actions`; `null` when there are none. */
export function measureBubble(
  actions: readonly string[],
): { width: number; height: number; items: { lines: string[]; y: number }[] } | null {
  if (!actions.length) return null;
  // `wrapTitle` budgets two paddings of its own, so the line limit is added back.
  const limit = BUBBLE_MAX_WIDTH - 2 * BUBBLE_PAD - BUBBLE_BULLET_WIDTH;
  const items: { lines: string[]; y: number }[] = [];
  let widest = 0;
  let row = 0;
  for (const action of actions) {
    const lines = wrapTitle(action, limit + 2 * NODE_PAD_X, BUBBLE_FONT_SIZE);
    for (const l of lines) widest = Math.max(widest, textWidth(l, BUBBLE_FONT_SIZE));
    items.push({
      lines,
      y: BUBBLE_PAD + BUBBLE_LINE_HEIGHT * (row + 0.5) + BUBBLE_FONT_SIZE * 0.36,
    });
    row += lines.length;
  }
  return {
    width: Math.min(
      BUBBLE_MAX_WIDTH,
      Math.max(BUBBLE_MIN_WIDTH, Math.ceil(widest) + BUBBLE_BULLET_WIDTH + 2 * BUBBLE_PAD),
    ),
    height: Math.ceil(BUBBLE_LINE_HEIGHT * row) + 2 * BUBBLE_PAD,
    items,
  };
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

/** Width of the box a label is drawn in. */
function labelWidth(label: string): number {
  return textWidth(label, EDGE_LABEL_FONT_SIZE) + 10;
}

/**
 * How far the ring keeps its members from the systems. A line between a system
 * and the nearest member is about this long, so when a line has a label the
 * clearance is raised to fit the label on it (otherwise the label would cover
 * the node it points at).
 */
export function ringClearanceFor(edges: readonly UsecaseEdge[]): number {
  let widest = 0;
  for (const e of edges) if (e.label) widest = Math.max(widest, labelWidth(e.label));
  return Math.max(RING_SYSTEM_CLEARANCE, Math.ceil(widest) + LABEL_ROOM);
}

export function layoutUsecase(
  doc: { nodes: UsecaseNode[]; edges: UsecaseEdge[] },
  stickies: Sticky[] = [],
  options: UsecaseLayoutOptions = {},
): UsecaseLayout {
  const sized = doc.nodes.map((node) => {
    const symbol = symbolOfKind(node.kind);
    const actions = symbol.bubble ? actionsOf(node) : [];
    return { node, symbol, ...measureNode(node.title, node.kind), bubble: measureBubble(actions) };
  });

  const pinned = new Map<string, { cx: number; cy: number }>();
  for (const { node } of sized) {
    if (node.x !== undefined && node.y !== undefined) pinned.set(node.id, { cx: node.x, cy: node.y });
  }
  if (options.pinned) pinned.set(options.pinned.id, { cx: options.pinned.cx, cy: options.pinned.cy });

  // Every node takes part, placed or not, so that placing one never moves the
  // spot another was given; the pins are laid over the result.
  const ring = ringLayout(
    sized
      .filter((s) => s.symbol.centre)
      .map((s) => ({ id: s.node.id, width: s.width, height: s.height })),
    sized
      .filter((s) => !s.symbol.centre)
      .map((s) => ({
        id: s.node.id,
        width: s.width,
        height: s.height,
        ...(s.bubble ? { bubble: { width: s.bubble.width, height: s.bubble.height } } : {}),
      })),
    { originX: ORIGIN, originY: ORIGIN, pinned, systemClearance: ringClearanceFor(doc.edges) },
  );

  const nodes: PositionedNode[] = sized.map(({ node, symbol, width, height, lines }) => {
    const c = ring.nodes.get(node.id)!;
    const note = !symbol.bubble ? node.note : undefined;
    return {
      id: node.id,
      shape: shapeOfKind(node.kind),
      x: c.cx - width / 2,
      y: c.cy - height / 2,
      width,
      height,
      title: node.title,
      lines,
      kind: node.kind,
      ...(node.color ? { color: node.color } : {}),
      ...(node.task ? { task: node.task } : {}),
      ...(note ? { note } : {}),
      placed: pinned.has(node.id),
      cx: c.cx,
      cy: c.cy,
      fontSize: symbol.text === "top" ? SYSTEM_FONT_SIZE : NODE_FONT_SIZE,
      bold: symbol.text === "top",
      strokeWidth: symbol.strokeWidth,
      ...("dash" in symbol && symbol.dash ? { dash: symbol.dash } : {}),
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const bubbles: PositionedBubble[] = [];
  const bubbleOf = new Map<string, PositionedBubble>();
  for (const { node, bubble } of sized) {
    const placed = ring.bubbles.get(node.id);
    if (!bubble || !placed) continue;
    const b: PositionedBubble = {
      nodeId: node.id,
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
      side: placed.side,
      tailSide: placed.tailSide,
      items: bubble.items,
    };
    bubbles.push(b);
    bubbleOf.set(node.id, b);
  }

  const edges: PositionedEdge[] = [];
  for (const edge of doc.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const geometry = edgeGeometry(from, to, "straight");
    if (!geometry) continue; // a line from a node to itself is kept, not drawn
    const positioned: PositionedEdge = {
      key: edgeKey(edge),
      from: edge.from,
      to: edge.to,
      ...(edge.label ? { label: edge.label } : {}),
      head: edge.arrow,
      geometry,
    };
    if (edge.label) {
      const width = labelWidth(edge.label);
      const height = EDGE_LABEL_FONT_SIZE * LINE_HEIGHT + 4;
      positioned.labelBox = {
        x: geometry.mid.x - width / 2,
        y: geometry.mid.y - height / 2,
        width,
        height,
      };
    }
    edges.push(positioned);
  }

  const placedStickies = stickies
    .map((sticky) => placeSticky(sticky, byId.get(sticky.targetId)))
    .filter((s): s is PositionedSticky => s !== null);

  const bounds = boundsOfBoxes([
    ...nodes,
    // The tail sticks out of the bubble's box towards the person.
    ...bubbles.map((b) => inflate(b, b.tailSide, BUBBLE_TAIL)),
    ...placedStickies,
    ...edges.flatMap((e) => (e.labelBox ? [e.labelBox] : [])),
  ]);

  return { nodes, edges, bubbles, stickies: placedStickies, bounds, byId, bubbleOf };
}

function inflate(box: Box, side: BubbleSide, by: number): Box {
  if (side === "left") return { x: box.x - by, y: box.y, width: box.width + by, height: box.height };
  if (side === "right") return { ...box, width: box.width + by };
  if (side === "top") return { x: box.x, y: box.y - by, width: box.width, height: box.height + by };
  return { ...box, height: box.height + by };
}
