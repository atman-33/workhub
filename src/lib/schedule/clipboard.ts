import { allocateIds } from "../diagram/clipboard";
import { shiftDate } from "./layout";
import type { ScheduleItem } from "./parse";

/**
 * Copy and paste of schedule elements (T-0688). A schedule has no arrows and
 * one selected element, so a snapshot is the element itself.
 */

/** An independent snapshot of the element, or null when it is not in the list. */
export function copyScheduleItem(items: readonly ScheduleItem[], id: string): ScheduleItem | null {
  const item = items.find((i) => i.id === id);
  return item ? { ...item } : null;
}

/**
 * Appends a copy under a fresh id, moved `round` days later (a range keeps its
 * length). It goes last, i.e. on top: the list order is the stacking order.
 */
export function pasteScheduleItem(
  items: readonly ScheduleItem[],
  source: ScheduleItem,
  round: number,
): { items: ScheduleItem[]; id: string } {
  const id = allocateIds(
    items.map((i) => i.id),
    [source.id],
  ).get(source.id)!;
  const copy: ScheduleItem = {
    ...source,
    id,
    start: shiftDate(source.start, round),
    end: shiftDate(source.end, round),
  };
  return { items: [...items, copy], id };
}
