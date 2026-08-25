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

import type { Color, MindmapNode } from "./parse";

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
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  hGap: 56,
  vGap: 14,
  maxWidth: 220,
  fontSize: 14,
};

/** Padding inside a node box. */
const PAD_X = 12;
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

export interface MindmapLayout {
  nodes: PositionedNode[];
  edges: LayoutEdge[];
  /** Bounding box of everything drawn, before any padding the view adds. */
  bounds: { x: number; y: number; width: number; height: number };
  byId: Map<string, PositionedNode>;
}

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
 * Splits the root's branches between the two sides, keeping the drawing
 * balanced.
 *
 * Greedy by height rather than alternating: alternating looks tidy on a tree
 * whose branches are all the same size and lopsided on every real one, where
 * a single branch often carries most of the nodes.
 */
function assignSides(children: Measured[]): Side[] {
  const sides: Side[] = [];
  let right = 0;
  let left = 0;
  for (const child of children) {
    if (right <= left) {
      sides.push("right");
      right += child.extent;
    } else {
      sides.push("left");
      left += child.extent;
    }
  }
  return sides;
}

export function layoutMindmap(
  roots: MindmapNode[],
  options: Partial<LayoutOptions> = {},
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

  let rootTop = 0;
  for (const root of roots) {
    const m = measureTree(root, opts);
    const sides = assignSides(m.children);
    const rightKids = m.children.filter((_, i) => sides[i] === "right");
    const leftKids = m.children.filter((_, i) => sides[i] === "left");

    const bandHeight = (list: Measured[]) =>
      list.reduce((sum, c) => sum + c.extent, 0) + Math.max(0, list.length - 1) * opts.vGap;
    const rightHeight = bandHeight(rightKids);
    const leftHeight = bandHeight(leftKids);
    const height = Math.max(m.height, rightHeight, leftHeight);

    // The root is centred on the taller of the two sides, so the two halves
    // meet at the same middle line.
    const rootY = rootTop + (height - m.height) / 2;
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

    let cursor = rootTop + (height - rightHeight) / 2;
    for (const child of rightKids) {
      place(child, 1, "right", cursor, rootNode.x + rootNode.width + opts.hGap, child.node.color, rootNode);
      cursor += child.extent + opts.vGap;
    }
    cursor = rootTop + (height - leftHeight) / 2;
    for (const child of leftKids) {
      place(child, 1, "left", cursor, rootNode.x - opts.hGap, child.node.color, rootNode);
      cursor += child.extent + opts.vGap;
    }

    rootTop += height + opts.vGap * 3;
  }

  return { nodes, edges, bounds: boundsOf(nodes), byId: new Map(nodes.map((n) => [n.id, n])) };
}

function boundsOf(nodes: PositionedNode[]): MindmapLayout["bounds"] {
  if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
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
