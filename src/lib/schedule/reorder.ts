/**
 * Manual vertical ordering of schedule elements.
 *
 * The whole feature rests on one rule: **the order of the lines in `## Items`
 * is the order the elements stack on screen.** Point elements (milestones and
 * notes) were already drawn in file order; bars and arrows now pack their
 * lanes in file order too (`packBars`, `packLanes`), so moving a line up moves
 * the element up everywhere it is drawn — grid, timeline and HTML export.
 *
 * Reordering therefore means nothing more than swapping two entries of
 * `doc.items`. The only real question is *which* two, and that is what
 * `moveItem` answers: an element swaps with its nearest **visual competitor**,
 * not with whatever line happens to sit next to it in the file. Two milestones
 * on different days never contend for the same slot, so swapping them would
 * move nothing on screen and would look like a broken menu item.
 */

import { isRangeKind } from "./parse";
import type { ScheduleItem } from "./parse";

/** Up (`-1`) is earlier in the file and therefore higher on screen. */
export type MoveDirection = -1 | 1;

/**
 * Whether two elements compete for the same vertical slot, and so can be
 * meaningfully swapped.
 *
 * Range and point elements are drawn in separate bands (bar lanes above,
 * milestones below), so they never compete even when they cover the same day.
 * Within a band the test is the one the layout itself uses: points collide
 * when they sit on the same day, ranges when their spans overlap at all.
 */
function competes(a: ScheduleItem, b: ScheduleItem): boolean {
  const aRange = isRangeKind(a.kind);
  if (aRange !== isRangeKind(b.kind)) return false;
  if (!aRange) return a.start === b.start;
  return a.start <= b.end && b.start <= a.end;
}

/**
 * Moves one element one step up or down among the elements it competes with,
 * returning a new array.
 *
 * The element is swapped with the nearest competitor in that direction —
 * "nearest" in file order, skipping over everything it does not contend with.
 * Skipping matters: an element usually has unrelated lines between it and the
 * bar it visually sits under, and stepping onto those would take several
 * invisible moves before anything happened on screen.
 *
 * Returns the original array unchanged (same reference) when there is nothing
 * to swap with, so callers can treat "no-op" as "do not write the file".
 */
export function moveItem(
  items: ScheduleItem[],
  id: string,
  dir: MoveDirection,
): ScheduleItem[] {
  const index = items.findIndex((i) => i.id === id);
  if (index === -1) return items;

  const item = items[index];
  let target = -1;
  for (let i = index + dir; i >= 0 && i < items.length; i += dir) {
    if (competes(item, items[i])) {
      target = i;
      break;
    }
  }
  if (target === -1) return items;

  const next = [...items];
  next[index] = next[target];
  next[target] = item;
  return next;
}

/** Whether `moveItem` would do anything — used to disable the menu entry
 * rather than offer a move that silently does nothing. */
export function canMoveItem(items: ScheduleItem[], id: string, dir: MoveDirection): boolean {
  return moveItem(items, id, dir) !== items;
}
