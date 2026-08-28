/**
 * Mindmap layout: turns the parsed tree into positioned boxes and edges.
 *
 * Positions are computed, never stored. That is the decision the whole feature
 * hangs off: the note stays a plain nested bullet list a human can edit in
 * Obsidian, and there is no coordinate data to go stale when they do. The cost
 * is that this module has to be deterministic — the canvas, the HTML export
 * and the PNG export all lay the same tree out and must agree — which is why
 * text is measured with a fixed metric here rather than by the browser.
 *
 * The shape is the classic mindmap one: the root sits in the middle and its
 * branches go out to the left and the right, each subtree occupying a
 * contiguous vertical band so that no two subtrees can overlap.
 */

import {
  rootChildSide,
  STICKY_DEFAULT_COLOR,
  type Color,
  type MindmapNode,
  type NodeWidth,
  type Sticky,
} from "./parse";

export type Side = "left" | "right";

export interface LayoutOptions {
  /** Horizontal gap between a node and its children. */
  hGap: number;
  /** Vertical gap between siblings. */
  vGap: number;
  /** Maximum width of a node box before its title wraps. */
  maxWidth: number;
  /** Font size the title is measured at. */
  fontSize: number;
  /** Which boxes are widened to a common width. */
  nodeWidth: NodeWidth;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  hGap: 56,
  vGap: 14,
  maxWidth: 220,
  fontSize: 14,
  nodeWidth: "auto",
};

/** Padding inside a node box. Exported because the canvas sizes the inline
 * rename box with it, so a node grows as it is typed into. */
export const NODE_PAD_X = 12;
const PAD_X = NODE_PAD_X;
const PAD_Y = 8;
/** Line height as a multiple of the font size. */
const LINE_HEIGHT = 1.45;
/** Smallest box, so that a node with an empty title is still clickable. */
const MIN_WIDTH = 48;

export interface PositionedNode {
  id: string;
  title: string;
  /** Title split into the lines the box renders. */
  lines: string[];
  color?: Color;
  task?: string;
  note?: string;
  /** Depth from the root: 0 is the root itself. */
  depth: number;
  /** Which way this node's branch grows. The root reports "right". */
  side: Side;
  /** True when the node has children that are currently hidden. */
  collapsed: boolean;
  /** Number of direct children, hidden or not. */
  childCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Color inherited from the nearest coloured ancestor, for the branch. */
  branchColor?: Color;
  parentId?: string;
}

export interface LayoutEdge {
  from: string;
  to: string;
  /** Cubic bezier, in the same coordinate space as the nodes. */
  path: string;
  color?: Color;
  side: Side;
}

/**
 * A sticky note placed on the diagram.
 *
 * Its position comes from the file, but only as an offset from the node it is
 * pinned to — so a sticky is placed *after* the tree has been laid out, and
 * takes no part in that layout. Two stickies can therefore overlap; that is
 * the price of putting them exactly where the user dropped them, and the
 * bargain the feature is asking for.
 */
export interface PositionedSticky {
  id: string;
  nodeId: string;
  /** The text as the file holds it. Carried through so the inline editor can
   * offer the user what they wrote, not the wrapped lines. */
  text: string;
  /** Body text split into the lines the paper renders. */
  lines: string[];
  color: Color;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Point on the pinned node the leader line runs to. */
  anchorX: number;
  anchorY: number;
}

export interface MindmapLayout {
  nodes: PositionedNode[];
  edges: LayoutEdge[];
  /** Sticky notes, empty when the note hides them. */
  stickies: PositionedSticky[];
  /** Bounding box of everything drawn, before any padding the view adds. */
  bounds: { x: number; y: number; width: number; height: number };
  byId: Map<string, PositionedNode>;
}

/** How wide a sticky's paper is. Fixed rather than sized to its text: a wall
 * of stickies reads as a wall only if they are the same shape, and a sticky
 * that grew sideways would drift out from under the offset the user set. */
export const STICKY_WIDTH = 180;
/** Font size of a sticky's text — smaller than a node's, because a sticky is
 * an aside and must not compete with the map it annotates. */
export const STICKY_FONT_SIZE = 11;
/** Padding inside a sticky. Exported because the canvas and the export both
 * place the text with it. */
export const STICKY_PAD = 8;
/** Smallest paper, so an empty sticky is still visible and clickable. */
const STICKY_MIN_HEIGHT = 34;

// ---------------------------------------------------------------------------
// text measurement
// ---------------------------------------------------------------------------

/**
 * Approximate advance width of one character at font size 1.
 *
 * Deliberately a table and not a canvas measurement: an export rendered on a
 * machine with different fonts must place its boxes exactly where the app did,
 * and `measureText` cannot promise that. The numbers are the usual ratios for
 * a UI sans-serif, rounded generously so a box is never too small for its
 * text.
 */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  // CJK, kana, and full-width forms occupy a full em.
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 1;
  }
  if (ch === " ") return 0.28;
  if (/[iljtfIr.,;:'`|!]/.test(ch)) return 0.3;
  if (/[A-Z@%&WM]/.test(ch)) return 0.68;
  return 0.55;
}

export function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w * fontSize;
}

/**
 * Splits a title into lines that fit `maxWidth`.
 *
 * Breaks on spaces where it can and mid-word where it cannot — a long URL or
 * an unspaced Japanese phrase must still fit the box rather than overflow it.
 */
export function wrapTitle(title: string, maxWidth: number, fontSize: number): string[] {
  const text = title.trim();
  if (!text) return [""];
  const limit = Math.max(maxWidth - PAD_X * 2, fontSize * 2);

  const lines: string[] = [];
  let line = "";
  const flush = () => {
    if (line) lines.push(line);
    line = "";
  };
  // Keep the spaces attached to the word before them, so a break never
  // produces a line that starts with a space.
  const words = text.split(/(?<=\s)/);
  for (const word of words) {
    const candidate = line + word;
    if (textWidth(candidate.trimEnd(), fontSize) <= limit || !line) {
      // A single word that is itself too long is split character by character.
      if (!line && textWidth(word.trimEnd(), fontSize) > limit) {
        let chunk = "";
        for (const ch of word) {
          if (textWidth(chunk + ch, fontSize) > limit && chunk) {
            lines.push(chunk);
            chunk = "";
          }
          chunk += ch;
        }
        line = chunk;
        continue;
      }
      line = candidate;
      continue;
    }
    flush();
    line = word;
  }
  flush();
  return lines.length ? lines.map((l) => l.trimEnd()) : [""];
}

function measure(title: string, opts: LayoutOptions): { lines: string[]; width: number; height: number } {
  const lines = wrapTitle(title, opts.maxWidth, opts.fontSize);
  const widest = Math.max(...lines.map((l) => textWidth(l, opts.fontSize)));
  return {
    lines,
    width: Math.max(MIN_WIDTH, Math.ceil(widest) + PAD_X * 2),
    height: Math.ceil(lines.length * opts.fontSize * LINE_HEIGHT) + PAD_Y * 2,
  };
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

interface Measured {
  node: MindmapNode;
  lines: string[];
  width: number;
  height: number;
  children: Measured[];
  /** Vertical extent of this node's whole subtree. */
  extent: number;
}

function measureTree(node: MindmapNode, opts: LayoutOptions): Measured {
  const m = measure(node.title, opts);
  const children = node.collapsed ? [] : node.children.map((c) => measureTree(c, opts));
  const stacked = children.reduce((sum, c) => sum + c.extent, 0) + Math.max(0, children.length - 1) * opts.vGap;
  return { node, ...m, children, extent: Math.max(m.height, stacked) };
}

/**
 * Widens boxes so that a group shares one width, per `LayoutOptions.nodeWidth`.
 *
 * Runs after `measureTree` and before placement, and only ever grows a box, so
 * a title can still not overflow its box. Widths do not feed back into
 * `extent` (that is a vertical measure), which is why this can be a separate
 * pass rather than part of the measurement.
 *
 * A collapsed node's hidden children are not in the tree here, so they cannot
 * pull a level wider than what is actually on screen.
 */
function normalizeWidths(root: Measured, mode: NodeWidth): void {
  if (mode === "auto") return;

  if (mode === "depth") {
    const byDepth = new Map<number, Measured[]>();
    const walk = (m: Measured, depth: number) => {
      const group = byDepth.get(depth);
      if (group) group.push(m);
      else byDepth.set(depth, [m]);
      for (const child of m.children) walk(child, depth + 1);
    };
    walk(root, 0);
    for (const group of byDepth.values()) widenToMax(group);
    return;
  }

  const walk = (m: Measured) => {
    widenToMax(m.children);
    for (const child of m.children) walk(child);
  };
  walk(root);
}

function widenToMax(group: Measured[]): void {
  if (group.length < 2) return;
  const width = Math.max(...group.map((m) => m.width));
  for (const m of group) m.width = width;
}

/**
 * Splits the root's branches between the two sides.
 *
 * The decision belongs to the document, not to this function: `rootChildSide`
 * honours an explicit `^left` / `^right` and otherwise alternates by position.
 *
 * This started out as a greedy balance by subtree height, which draws a nicer
 * picture and is unusable to edit — every added node re-balanced the whole map,
 * so a branch would jump to the other side of the root while the user was
 * typing into it. Predictability wins: adding a branch at the end cannot move
 * any existing branch.
 */
function assignSides(children: Measured[]): Side[] {
  return children.map((child, index) => rootChildSide(child.node, index));
}

/**
 * Wraps a sticky's text, honouring the line breaks the user typed.
 *
 * `wrapTitle` measures against a node's padding, so the width handed to it is
 * corrected for the sticky's own — the alternative is a second wrapper, and
 * two wrappers drift.
 */
export function wrapStickyText(text: string, width = STICKY_WIDTH): string[] {
  const budget = width - STICKY_PAD * 2 + PAD_X * 2;
  const lines = text.split("\n").flatMap((line) => wrapTitle(line, budget, STICKY_FONT_SIZE));
  return lines.length ? lines : [""];
}

/** Places one sticky against the node it is pinned to. Returns `null` for a
 * sticky whose node is gone or hidden — the line stays in the file, but there
 * is nothing on screen to pin it to. */
function placeSticky(sticky: Sticky, byId: Map<string, PositionedNode>): PositionedSticky | null {
  const node = byId.get(sticky.nodeId);
  if (!node) return null;

  const lines = wrapStickyText(sticky.text);
  const height = Math.max(
    STICKY_MIN_HEIGHT,
    Math.ceil(lines.length * STICKY_FONT_SIZE * LINE_HEIGHT) + STICKY_PAD * 2,
  );
  const centreX = node.x + node.width / 2;
  const centreY = node.y + node.height / 2;
  const x = centreX + sticky.dx;
  const y = centreY + sticky.dy;

  // The leader line ends on the edge of the node nearest the sticky, rather
  // than at its centre, so it reads as "this paper belongs to that box".
  const anchorX = Math.max(node.x, Math.min(x + STICKY_WIDTH / 2, node.x + node.width));
  const anchorY = Math.max(node.y, Math.min(y + height / 2, node.y + node.height));

  return {
    id: sticky.id,
    nodeId: sticky.nodeId,
    text: sticky.text,
    lines,
    color: sticky.color ?? STICKY_DEFAULT_COLOR,
    x,
    y,
    width: STICKY_WIDTH,
    height,
    anchorX,
    anchorY,
  };
}

export function layoutMindmap(
  roots: MindmapNode[],
  options: Partial<LayoutOptions> & {
    /** Stickies to place. Omitted — or empty, when the note hides them — the
     * layout is exactly what it was before the feature existed. */
    stickies?: Sticky[];
  } = {},
): MindmapLayout {
  const opts = { ...DEFAULT_LAYOUT, ...options };
  const nodes: PositionedNode[] = [];
  const edges: LayoutEdge[] = [];

  /** Places a subtree whose vertical band starts at `top`, growing `side`. */
  const place = (
    m: Measured,
    depth: number,
    side: Side,
    top: number,
    anchorX: number,
    branchColor: Color | undefined,
    parent: PositionedNode | undefined,
  ): PositionedNode => {
    const x = side === "right" ? anchorX : anchorX - m.width;
    const y = top + (m.extent - m.height) / 2;
    const color = m.node.color ?? branchColor;

    const positioned: PositionedNode = {
      id: m.node.id,
      title: m.node.title,
      lines: m.lines,
      depth,
      side,
      collapsed: Boolean(m.node.collapsed) && m.node.children.length > 0,
      childCount: m.node.children.length,
      x,
      y,
      width: m.width,
      height: m.height,
      ...(m.node.color ? { color: m.node.color } : {}),
      ...(m.node.task ? { task: m.node.task } : {}),
      ...(m.node.note ? { note: m.node.note } : {}),
      // The root's own colour is not a branch colour: it would tint every
      // branch the same and destroy the colour coding.
      ...(depth > 0 && color ? { branchColor: color } : {}),
      ...(parent ? { parentId: parent.id } : {}),
    };
    nodes.push(positioned);
    if (parent) {
      edges.push({
        from: parent.id,
        to: positioned.id,
        side,
        path: edgePath(parent, positioned, side),
        ...(positioned.branchColor ? { color: positioned.branchColor } : {}),
      });
    }

    let cursor = top;
    const childAnchor = side === "right" ? x + m.width + opts.hGap : x - opts.hGap;
    for (const child of m.children) {
      place(child, depth + 1, side, cursor, childAnchor, depth === 0 ? child.node.color : color, positioned);
      cursor += child.extent + opts.vGap;
    }
    return positioned;
  };

  // Where the next root's band starts. `null` until the first root has been
  // placed, because the first root is not stacked — it is the origin.
  let bandTop: number | null = null;
  for (const root of roots) {
    const m = measureTree(root, opts);
    normalizeWidths(m, opts.nodeWidth);
    const sides = assignSides(m.children);
    const rightKids = m.children.filter((_, i) => sides[i] === "right");
    const leftKids = m.children.filter((_, i) => sides[i] === "left");

    const bandHeight = (list: Measured[]) =>
      list.reduce((sum, c) => sum + c.extent, 0) + Math.max(0, list.length - 1) * opts.vGap;
    const rightHeight = bandHeight(rightKids);
    const leftHeight = bandHeight(leftKids);
    const height = Math.max(m.height, rightHeight, leftHeight);

    /**
     * The map is anchored on the root, not on the top of its band.
     *
     * The first root's centre is the origin, and the branches grow away from
     * it in both directions. Anchoring on the band's top instead meant that
     * collapsing anything changed the band's height and therefore moved the
     * root — so the whole map slid across the screen under a camera that had
     * not moved. With the root fixed, only the branches that actually changed
     * re-flow.
     */
    const centerY: number = bandTop === null ? 0 : bandTop + height / 2;
    const rootY = centerY - m.height / 2;
    const rootNode: PositionedNode = {
      id: m.node.id,
      title: m.node.title,
      lines: m.lines,
      depth: 0,
      side: "right",
      collapsed: Boolean(m.node.collapsed) && m.node.children.length > 0,
      childCount: m.node.children.length,
      x: -m.width / 2,
      y: rootY,
      width: m.width,
      height: m.height,
      ...(m.node.color ? { color: m.node.color } : {}),
      ...(m.node.task ? { task: m.node.task } : {}),
      ...(m.node.note ? { note: m.node.note } : {}),
    };
    nodes.push(rootNode);

    let cursor = centerY - rightHeight / 2;
    for (const child of rightKids) {
      place(child, 1, "right", cursor, rootNode.x + rootNode.width + opts.hGap, child.node.color, rootNode);
      cursor += child.extent + opts.vGap;
    }
    cursor = centerY - leftHeight / 2;
    for (const child of leftKids) {
      place(child, 1, "left", cursor, rootNode.x - opts.hGap, child.node.color, rootNode);
      cursor += child.extent + opts.vGap;
    }

    bandTop = centerY + height / 2 + opts.vGap * 3;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const stickies = (options.stickies ?? [])
    .map((sticky) => placeSticky(sticky, byId))
    .filter((s): s is PositionedSticky => s !== null);

  // Stickies count towards the bounds even though they took no part in the
  // layout: Fit and every export frame the map by this box, and a sticky the
  // user dropped off to one side must not be the thing that gets cropped.
  return { nodes, edges, stickies, bounds: boundsOf(nodes, stickies), byId };
}

function boundsOf(
  nodes: PositionedNode[],
  stickies: PositionedSticky[] = [],
): MindmapLayout["bounds"] {
  if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of [...nodes, ...stickies]) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Edge from a parent's side to a child's side, as a cubic bezier that leaves
 * and arrives horizontally. The horizontal tangents are what make a branch
 * read as one continuous line through several generations instead of a chain
 * of separate arcs.
 */
function edgePath(parent: PositionedNode, child: PositionedNode, side: Side): string {
  const x1 = side === "right" ? parent.x + parent.width : parent.x;
  const y1 = parent.y + parent.height / 2;
  const x2 = side === "right" ? child.x : child.x + child.width;
  const y2 = child.y + child.height / 2;
  const dx = (x2 - x1) / 2;
  return `M ${round(x1)} ${round(y1)} C ${round(x1 + dx)} ${round(y1)}, ${round(x2 - dx)} ${round(y2)}, ${round(x2)} ${round(y2)}`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
