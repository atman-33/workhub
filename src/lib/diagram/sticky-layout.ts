/**
 * Sticky placement shared by every diagram kind.
 *
 * A sticky's position comes from the file only as an offset from the element
 * it is pinned to, so it is placed *after* the diagram has been laid out and
 * takes no part in that layout. Two stickies can overlap; that is the price of
 * putting them exactly where the user dropped them.
 */
import type { Color } from "./colors";
import { STICKY_DEFAULT_COLOR, type Sticky } from "./sticky";
import { LINE_HEIGHT, NODE_PAD_X, wrapTitle } from "./text";

/** An axis-aligned box in diagram coordinates. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A sticky note placed on the diagram. */
export interface PositionedSticky {
  id: string;
  targetId: string;
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
  /** Point on the pinned element the leader line runs to. */
  anchorX: number;
  anchorY: number;
}

/** How wide a sticky's paper is. Fixed rather than sized to its text: a wall
 * of stickies reads as a wall only if they are the same shape, and a sticky
 * that grew sideways would drift out from under the offset the user set. */
export const STICKY_WIDTH = 180;
/** Font size of a sticky's text - smaller than an element's, because a sticky
 * is an aside and must not compete with the diagram it annotates. */
export const STICKY_FONT_SIZE = 11;
/** Padding inside a sticky. Exported because the canvas and the export both
 * place the text with it. */
export const STICKY_PAD = 8;
/** Smallest paper, so an empty sticky is still visible and clickable. */
const STICKY_MIN_HEIGHT = 34;

/**
 * Wraps a sticky's text, honouring the line breaks the user typed.
 *
 * `wrapTitle` measures against an element's padding, so the width handed to it
 * is corrected for the sticky's own - the alternative is a second wrapper, and
 * two wrappers drift.
 */
export function wrapStickyText(text: string, width = STICKY_WIDTH): string[] {
  const budget = width - STICKY_PAD * 2 + NODE_PAD_X * 2;
  const lines = text.split("\n").flatMap((line) => wrapTitle(line, budget, STICKY_FONT_SIZE));
  return lines.length ? lines : [""];
}

/**
 * Places one sticky against the box of the element it is pinned to. Returns
 * `null` for a sticky whose element is gone or hidden - the line stays in the
 * file, but there is nothing on screen to pin it to.
 */
export function placeSticky(sticky: Sticky, target: Box | undefined): PositionedSticky | null {
  if (!target) return null;

  const lines = wrapStickyText(sticky.text);
  const height = Math.max(
    STICKY_MIN_HEIGHT,
    Math.ceil(lines.length * STICKY_FONT_SIZE * LINE_HEIGHT) + STICKY_PAD * 2,
  );
  const centreX = target.x + target.width / 2;
  const centreY = target.y + target.height / 2;
  const x = centreX + sticky.dx;
  const y = centreY + sticky.dy;

  // The leader line ends on the edge of the element nearest the sticky, rather
  // than at its centre, so it reads as "this paper belongs to that box".
  const anchorX = Math.max(target.x, Math.min(x + STICKY_WIDTH / 2, target.x + target.width));
  const anchorY = Math.max(target.y, Math.min(y + height / 2, target.y + target.height));

  return {
    id: sticky.id,
    targetId: sticky.targetId,
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

/** Bounds of boxes, or an empty box at the origin when there are none. */
export function boundsOfBoxes(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
