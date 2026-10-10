/**
 * Architecture diagram layout: the one geometry the canvas and the exports
 * both draw (T-0709).
 *
 * Blocks are grouped by frame and laid out left to right (`groupRowLayout`:
 * the ungrouped blocks first, then the frames in file order, wrapping past
 * 1600px). Inside a frame the blocks stand in rank columns from the arrows
 * whose both ends sit in the frame; an arrow leaving the frame never moves a
 * block. A frame's rectangle is drawn around its members (margin plus a header
 * band); an empty frame keeps a fixed minimal box. A block with `@x,y` sits at
 * that absolute centre; every block still takes part in its group, so pinning
 * one never moves another. Everything is computed here with fixed text
 * metrics, so an export rendered on another machine puts every box where the
 * app did.
 *
 * Arrows run orthogonally in any direction (`freeRoute`, `flow: "free"`) and
 * cross frame borders; frames are never obstacles. `<->` draws a head at each
 * end. The label sits at the middle. A block joined to itself is kept in the
 * note and not drawn, and no arrow ever joins a frame.
 */
import type { Color } from "../colors";
import { groupRowLayout } from "../graph-layout";
import {
  edgeGeometry,
  startHeadAngle,
  type DiagramNode,
  type EdgeGeometry,
  type Segment,
} from "../node-edge";
import { cylinderLid, PERSON_ICON_HEIGHT } from "../shapes";
import { boundsOfBoxes, placeSticky, type Box, type PositionedSticky } from "../sticky-layout";
import type { Sticky } from "../sticky";
import { LINE_HEIGHT, NODE_PAD_X, textWidth, wrapTitle } from "../text";
import type { ArchitectureEdge, ArchitectureFrame, ArchitectureNode } from "./parse";
import { edgeKeyOf } from "./parse";
import { shapeOfKind, symbolOfKind } from "./symbols";

export const NODE_FONT_SIZE = 13;
export const EDGE_LABEL_FONT_SIZE = 11;
/** Left and top edge of the automatic layout. */
export const ORIGIN = 40;
/** Title width a block wraps at. */
export const BLOCK_TITLE_WIDTH = 180;
export const BLOCK_MIN_WIDTH = 112;
export const BLOCK_MIN_HEIGHT = 52;
/** Space between a person's icon and its name. */
export const PERSON_ICON_GAP = 6;
/** How much wider and taller than its text a cloud is drawn. */
export const CLOUD_GROW = 1.4;
/** Margin between a frame's members and its border. */
export const FRAME_PAD = 20;
/** Header band above a frame's members, carrying its title. */
export const FRAME_HEADER = 28;
export const FRAME_TITLE_FONT_SIZE = 12;

/**
 * The rectangle a frame is drawn with for these member boxes: their outer
 * bounds plus the margin, with the header band on top. `null` when there are
 * no members (an empty frame keeps its minimal box instead).
 */
export function frameRectOf(members: Box[]): Box | null {
  if (members.length === 0) return null;
  const x0 = Math.min(...members.map((n) => n.x));
  const y0 = Math.min(...members.map((n) => n.y));
  const x1 = Math.max(...members.map((n) => n.x + n.width));
  const y1 = Math.max(...members.map((n) => n.y + n.height));
  return {
    x: x0 - FRAME_PAD,
    y: y0 - FRAME_PAD - FRAME_HEADER,
    width: x1 - x0 + 2 * FRAME_PAD,
    height: y1 - y0 + 2 * FRAME_PAD + FRAME_HEADER,
  };
}

export interface PositionedNode extends DiagramNode {
  title: string;
  /** Title split into the lines the shape renders. */
  lines: string[];
  kind: string;
  /** The frame this block sits in, when it names one that exists. */
  frame?: string;
  color?: Color;
  task?: string;
  /** Hover memo: the continuation lines. */
  note?: string;
  /** False when the group chose the spot, true when the file (or a drag) gave one. */
  placed: boolean;
  cx: number;
  cy: number;
  fontSize: number;
  strokeWidth: number;
}

export interface PositionedFrame {
  id: string;
  title: string;
  color?: Color;
  /** Hover memo: the continuation lines. */
  note?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedEdge {
  key: string;
  from: string;
  to: string;
  label?: string;
  /** `<->`: a head at each end. */
  bidi: boolean;
  geometry: EdgeGeometry;
  /** Direction the far head points, for `<->` (`atan2(dy, dx)`). */
  startAngle: number;
  /** Where the label is drawn, when there is one. */
  labelBox?: Box;
}

export interface ArchitectureLayout {
  frames: PositionedFrame[];
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  /** Sticky notes, empty when the note hides them. */
  stickies: PositionedSticky[];
  /** Bounding box of everything drawn, before any padding the view adds. */
  bounds: Box;
  byId: Map<string, PositionedNode>;
  frameById: Map<string, PositionedFrame>;
}

export interface ArchitectureLayoutOptions {
  /** Blocks held at exact spots - the ones being dragged. Their frames and
   * arrows follow. */
  pinned?: { id: string; cx: number; cy: number }[];
}

// ---------------------------------------------------------------------------
// sizes
// ---------------------------------------------------------------------------

function textBox(
  title: string,
  wrapWidth: number,
): { width: number; height: number; lines: string[] } {
  const lines = wrapTitle(title, wrapWidth, NODE_FONT_SIZE);
  const widest = Math.max(0, ...lines.map((l) => textWidth(l, NODE_FONT_SIZE)));
  return {
    width: Math.ceil(widest) + 2 * NODE_PAD_X,
    height: Math.ceil(lines.length * NODE_FONT_SIZE * LINE_HEIGHT) + 2 * NODE_PAD_X,
    lines,
  };
}

/** Box size and title lines of a block, from its title and kind. */
export function measureBlock(
  title: string,
  kind: string,
): { width: number; height: number; lines: string[] } {
  const symbol = symbolOfKind(kind);
  const text = textBox(title, BLOCK_TITLE_WIDTH);
  if (symbol.text === "below-icon") {
    return {
      width: Math.max(BLOCK_MIN_WIDTH, text.width),
      height: Math.max(
        BLOCK_MIN_HEIGHT,
        PERSON_ICON_HEIGHT + PERSON_ICON_GAP + text.height - 2 * NODE_PAD_X,
      ),
      lines: text.lines,
    };
  }
  if (symbol.shape === "cylinder") {
    // The lid's ellipses top and bottom come on top of the text box.
    const lid = cylinderLid({ width: Math.max(BLOCK_MIN_WIDTH, text.width), height: text.height });
    return {
      width: Math.max(BLOCK_MIN_WIDTH, text.width),
      height: Math.max(BLOCK_MIN_HEIGHT, text.height + 2 * lid),
      lines: text.lines,
    };
  }
  if (symbol.shape === "cloud") {
    // An ellipse around the text, grown so the text clears the wavy edge.
    return {
      width: Math.max(BLOCK_MIN_WIDTH, Math.ceil(text.width * CLOUD_GROW)),
      height: Math.max(BLOCK_MIN_HEIGHT, Math.ceil(text.height * CLOUD_GROW)),
      lines: text.lines,
    };
  }
  return {
    width: Math.max(BLOCK_MIN_WIDTH, text.width),
    height: Math.max(BLOCK_MIN_HEIGHT, text.height),
    lines: text.lines,
  };
}

/** Baseline of line `i` of a block's title. A person's name sits under the
 * icon, anything else is centred. */
export function nodeTextY(node: PositionedNode, i: number): number {
  const lineHeight = node.fontSize * LINE_HEIGHT;
  const lineMiddle = (k: number) => lineHeight * (k + 0.5) + node.fontSize * 0.36;
  if (symbolOfKind(node.kind).text === "below-icon") {
    return node.y + PERSON_ICON_HEIGHT + PERSON_ICON_GAP + lineMiddle(i);
  }
  return (
    node.cy - ((node.lines.length - 1) * lineHeight) / 2 + i * lineHeight + node.fontSize * 0.36
  );
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

/** Width of the box a label is drawn in. */
function labelWidth(label: string): number {
  return textWidth(label, EDGE_LABEL_FONT_SIZE) + 10;
}

export function layoutArchitecture(
  doc: { frames: ArchitectureFrame[]; nodes: ArchitectureNode[]; edges: ArchitectureEdge[] },
  stickies: Sticky[] = [],
  options: ArchitectureLayoutOptions = {},
): ArchitectureLayout {
  const frameIds = new Set(doc.frames.map((f) => f.id));
  const sized = doc.nodes.map((node) => ({
    node,
    ...measureBlock(node.title, node.kind),
    group: node.frame !== undefined && frameIds.has(node.frame) ? node.frame : null,
  }));

  // Every block takes part, placed or not, so that placing one never moves the
  // spot another was given; the pins are laid over the result.
  const grouped = groupRowLayout(
    sized.map((s) => ({ id: s.node.id, width: s.width, height: s.height, group: s.group })),
    doc.edges.map((e) => ({ from: e.from, to: e.to })),
    { groups: doc.frames.map((f) => f.id), originX: ORIGIN, originY: ORIGIN },
  );
  const centres = new Map(grouped.nodes);
  const pinnedIds = new Set<string>();
  for (const { node } of sized) {
    if (node.x !== undefined && node.y !== undefined) {
      centres.set(node.id, { cx: node.x, cy: node.y });
      pinnedIds.add(node.id);
    }
  }
  if (options.pinned) {
    for (const pin of options.pinned) {
      centres.set(pin.id, { cx: pin.cx, cy: pin.cy });
      pinnedIds.add(pin.id);
    }
  }

  const nodes: PositionedNode[] = sized.map(({ node, width, height, lines, group }) => {
    const c = centres.get(node.id)!;
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
      ...(group ? { frame: group } : {}),
      ...(node.color ? { color: node.color } : {}),
      ...(node.task ? { task: node.task } : {}),
      ...(node.note ? { note: node.note } : {}),
      placed: pinnedIds.has(node.id),
      cx: c.cx,
      cy: c.cy,
      fontSize: NODE_FONT_SIZE,
      strokeWidth: symbolOfKind(node.kind).strokeWidth,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const frames: PositionedFrame[] = doc.frames.map((frame) => {
    const members = nodes.filter((n) => n.frame === frame.id);
    const rect = frameRectOf(members);
    if (!rect) {
      // An empty frame keeps the minimal box the group layout gave it.
      const box = grouped.groups.find((g) => g.key === frame.id)!;
      return {
        id: frame.id,
        title: frame.title,
        ...(frame.color ? { color: frame.color } : {}),
        ...(frame.note ? { note: frame.note } : {}),
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    }
    return {
      id: frame.id,
      title: frame.title,
      ...(frame.color ? { color: frame.color } : {}),
      ...(frame.note ? { note: frame.note } : {}),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });
  const frameById = new Map(frames.map((f) => [f.id, f]));

  const edges: PositionedEdge[] = [];
  const used: Segment[] = [];
  for (const edge of doc.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const geometry = edgeGeometry(from, to, "orthogonal", {
      flow: "free",
      obstacles: nodes.filter((n) => n !== from && n !== to),
      used,
    });
    if (!geometry) continue; // a block joined to itself is kept, not drawn
    geometry.points.slice(1).forEach((q, i) => used.push({ a: geometry.points[i], b: q }));
    const positioned: PositionedEdge = {
      key: edgeKeyOf(edge),
      from: edge.from,
      to: edge.to,
      ...(edge.label ? { label: edge.label } : {}),
      bidi: edge.bidi,
      geometry,
      startAngle: startHeadAngle(geometry.points),
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

  const targets = new Map<string, Box>([...byId, ...frameById] as [string, Box][]);
  const placedStickies = stickies
    .map((sticky) => placeSticky(sticky, targets.get(sticky.targetId)))
    .filter((s): s is PositionedSticky => s !== null);

  const bounds = boundsOfBoxes([
    ...nodes,
    ...frames,
    ...placedStickies,
    ...edges.flatMap((e) => (e.labelBox ? [e.labelBox] : [])),
  ]);

  return { frames, nodes, edges, stickies: placedStickies, bounds, byId, frameById };
}
