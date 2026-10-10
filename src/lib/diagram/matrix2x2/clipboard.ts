import { allocateIds } from "../clipboard";
import { clampUnit, type MatrixDocModel, type MatrixItem } from "./parse";

/**
 * Copy and paste of 2x2 items (T-0688). The matrix has one selected item, so
 * there are no arrows to carry; stickies stay with the original.
 */

/** How far each paste moves a placed item, in unit coordinates. */
export const MATRIX_PASTE_OFFSET = 0.03;

/** Independent snapshots of the items with these ids. */
export function copyMatrixItems(doc: MatrixDocModel, ids: readonly string[]): MatrixItem[] {
  return doc.items.filter((i) => ids.includes(i.id)).map((i) => ({ ...i }));
}

/** One step of `delta` from `v`, turned around when it would leave 0..1. */
function shifted(v: number, delta: number): number {
  return clampUnit(v + delta > 1 || v + delta < 0 ? v - delta : v + delta);
}

/**
 * Adds copies of `items` under fresh ids. A placed item lands down and to the
 * right of the original (`round` steps of it; y runs upward, so down is
 * minus); an unplaced one stays unplaced, which is how the matrix draws it
 * next to the other unplaced items.
 */
export function pasteMatrixItems(
  doc: MatrixDocModel,
  items: readonly MatrixItem[],
  round: number,
): { doc: MatrixDocModel; ids: string[] } {
  const idMap = allocateIds(
    doc.items.map((i) => i.id),
    items.map((i) => i.id),
  );
  const copies = items.map((item): MatrixItem => {
    const copy: MatrixItem = { ...item, id: idMap.get(item.id)! };
    if (item.x !== undefined && item.y !== undefined) {
      copy.x = shifted(item.x, MATRIX_PASTE_OFFSET * round);
      copy.y = shifted(item.y, -MATRIX_PASTE_OFFSET * round);
    }
    return copy;
  });
  return { doc: { ...doc, items: [...doc.items, ...copies] }, ids: copies.map((c) => c.id) };
}
