/**
 * The shared multi-select foundation (T-0716): selection state, marquee
 * (rectangle) selection and group moves, as pure functions with no DOM.
 *
 * Every diagram kind with positioned nodes plugs into the same pieces:
 *
 * - `normalizeRect` / `rectHitsBox` / `idsInRect` decide which node boxes a
 *   marquee rectangle catches;
 * - `toggleSelected` / `replaceSelected` / `unionSelected` are the selection
 *   reducer over an ordered id list (the last entry is the focused node the
 *   side panel edits);
 * - `shiftPositions` moves a group by one delta, so a group drag writes every
 *   moved node's position in a single model update (a single undo step).
 *
 * Coordinate systems stay the kind's own business: the caller passes the node
 * boxes in diagram pixels and a `snap` that rounds positions the way the file
 * needs (unit-clamped for the 2x2 matrix, whole pixels for the PFD).
 */
import type { Box } from "./sticky-layout";

/** A marquee rectangle in diagram coordinates, normalized so `x0 <= x1`. */
export interface MarqueeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The rectangle spanned by two diagram points, corner order independent. */
export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): MarqueeRect {
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

/** True when the rectangle touches the box at all; sharing an edge counts. */
export function rectHitsBox(rect: MarqueeRect, box: Box): boolean {
  return (
    rect.x0 <= box.x + box.width && rect.x1 >= box.x && rect.y0 <= box.y + box.height && rect.y1 >= box.y
  );
}

/**
 * Ids of the boxes a marquee catches, in the order given. Boxes the rectangle
 * only touches count as caught, so a thin sliver still selects its node.
 */
export function idsInRect<T extends Box & { id: string }>(
  boxes: readonly T[],
  rect: MarqueeRect,
): string[] {
  return boxes.filter((b) => rectHitsBox(rect, b)).map((b) => b.id);
}

// ---------------------------------------------------------------------------
// selection reducer
// ---------------------------------------------------------------------------

/**
 * Shift+click: adds the id when it is not selected, removes it when it is.
 * Removing keeps the order of the rest; adding puts the id last (focused).
 */
export function toggleSelected(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

/** A plain click: the id alone, or nothing when it is `null`. */
export function replaceSelected(id: string | null): string[] {
  return id === null ? [] : [id];
}

/**
 * The ids a marquee release selects: the caught ids replace the selection, or
 * join it when the release held Shift. Joining keeps the old order first, so
 * the focused node does not jump.
 */
export function unionSelected(selected: readonly string[], caught: readonly string[]): string[] {
  const next = [...selected];
  for (const id of caught) if (!next.includes(id)) next.push(id);
  return next;
}

// ---------------------------------------------------------------------------
// group moves
// ---------------------------------------------------------------------------

/**
 * Where each of `ids` lands after a group drag of `(dx, dy)` in the same
 * units as `origins` (diagram pixels for free canvases, unit coordinates for
 * the 2x2 matrix). `snap` rounds a landing the way the file needs; ids with
 * no origin are skipped, so an auto-placed node the layout cannot find never
 * gains a position from a drag it was not part of.
 */
export function shiftPositions(
  origins: ReadonlyMap<string, { x: number; y: number }>,
  ids: readonly string[],
  dx: number,
  dy: number,
  snap: (x: number, y: number) => { x: number; y: number },
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const at = origins.get(id);
    if (!at) continue;
    out.set(id, snap(at.x + dx, at.y + dy));
  }
  return out;
}
