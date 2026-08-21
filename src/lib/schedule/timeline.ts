/**
 * Timeline layout — the long-range ("大日程") reading of a schedule note
 * (T-0111).
 *
 * The calendar grid in `layout.ts` answers "which days do I have"; this module
 * answers "how do the phases sit against each other over months". Both read the
 * same note: an element is the same `- [bar] I-001 ...` line either way, and
 * switching modes is a change of drawing, never of data.
 *
 * Two decisions carry the whole file.
 *
 * **Geometry is expressed as fractions of the window, not as columns.** A bar
 * that starts mid-week has to start mid-column, so measuring in days and
 * dividing by the window length is the only way the bars, the column rules, the
 * sprint bands and the today line can agree. Columns then become a header and a
 * backdrop rather than a coordinate system.
 *
 * **The column unit follows the window length.** A quarter reads best in weeks;
 * a year in weeks is 52 unreadable slivers. Choosing automatically keeps a
 * control off the toolbar that the user would only ever set one way for a given
 * span.
 */

import { addDays, addMonths, startOfMonth, startOfWeek } from "date-fns";
import { calendarDays, countWorkingDays, fromISO, shiftDate, toISO } from "./layout";
import { isRangeKind, type ScheduleDocModel, type ScheduleItem, type SprintConfig } from "./parse";
import { sprintSlices, type SprintSlice } from "./sprint";

/** Sunday-first, matching the calendar grid so a week means the same thing in
 * both modes. */
const WEEK_STARTS_ON = 0;

/**
 * Window length (in days) at which the columns switch from weeks to months.
 * Roughly a quarter: beyond that a week column is thinner than the text it has
 * to carry, and the month is the unit the plan is being discussed in anyway.
 */
const MONTH_UNIT_FROM_DAYS = 100;

export type TimelineUnit = "week" | "month";

export function timelineUnit(start: string, end: string): TimelineUnit {
  return calendarDays(start, end) > MONTH_UNIT_FROM_DAYS ? "month" : "week";
}

/** A span positioned on the axis. `frac` values are 0..1 of the window. */
export interface TimelineSpan {
  start: string;
  end: string;
  startFrac: number;
  widthFrac: number;
}

export interface TimelineColumn extends TimelineSpan {
  /** Month of the column's first day, 1-12. */
  month: number;
  year: number;
  /** Day-of-month of the column's first day — the week columns' label. */
  day: number;
  /** True when the column opens a month, which is where the heavier rule is
   * drawn. Always true for month columns. */
  isMonthStart: boolean;
  /** Calendar days the column covers *inside the window* (a clipped first or
   * last column covers fewer). */
  days: number;
  /** Working days among them — the number the plan is actually spent from. */
  workingDays: number;
  containsToday: boolean;
}

/** The coarse header row above the columns: months over week columns, years
 * over month columns. */
export interface TimelineBand extends TimelineSpan {
  label: string;
  /** Month (1-12) for a month band; undefined for a year band. */
  month?: number;
  year: number;
}

export interface TimelineBar extends TimelineSpan {
  item: ScheduleItem;
  lane: number;
  /** True when the element's real start is inside the window; a bar running in
   * from before it is drawn open-ended on that side. */
  isStart: boolean;
  isEnd: boolean;
  /** Working days over the whole element, not the visible part — the number
   * being decided against. */
  workingDays: number;
}

export interface TimelinePoint {
  item: ScheduleItem;
  lane: number;
  /** Position of the element's day on the axis, 0..1. */
  frac: number;
}

export interface TimelineLayout {
  start: string;
  end: string;
  /** Inclusive day count of the window — the denominator behind every `frac`. */
  totalDays: number;
  unit: TimelineUnit;
  bands: TimelineBand[];
  columns: TimelineColumn[];
  /** Sprint slices covering the window, empty when the note declares no
   * cadence. */
  sprints: (SprintSlice & TimelineSpan)[];
  bars: TimelineBar[];
  /** Lanes needed by `bars`. */
  laneCount: number;
  points: TimelinePoint[];
  /** Lanes needed by `points`. */
  pointLaneCount: number;
  /** Position of today on the axis, or null when it is outside the window. */
  todayFrac: number | null;
  /** Working days across the whole window. */
  workingDays: number;
}

/** Fraction of the window at which `date` begins. */
function startFracOf(date: string, windowStart: string, totalDays: number): number {
  return clamp01(dayOffset(windowStart, date) / totalDays);
}

/** Whole days from `from` to `to`, without going through `date-fns` twice. */
function dayOffset(from: string, to: string): number {
  return Math.round((fromISO(to).getTime() - fromISO(from).getTime()) / 86_400_000);
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Places an inclusive date span on the axis, clipped to the window. */
function spanOf(
  start: string,
  end: string,
  windowStart: string,
  windowEnd: string,
  totalDays: number,
): TimelineSpan {
  const from = start < windowStart ? windowStart : start;
  const to = end > windowEnd ? windowEnd : end;
  const startFrac = startFracOf(from, windowStart, totalDays);
  // The end fraction covers the *whole* last day: a one-day element must be
  // one day wide, not zero.
  const endFrac = clamp01((dayOffset(windowStart, to) + 1) / totalDays);
  return { start: from, end: to, startFrac, widthFrac: Math.max(0, endFrac - startFrac) };
}

/**
 * First-fit lane packing over date spans, scanning in **document order** — the
 * order the lines appear in `## Items`.
 *
 * The grid packs its bar lanes the same way and for the same reason: file
 * order is the one thing the user can edit (`reorder.ts`), so it, and not the
 * start date, decides what ends up on top. Both views therefore stack the same
 * elements in the same order.
 *
 * `gapDays` is what keeps labels apart: two elements that merely touch would
 * collide as text long before they collide as geometry, so a lane is only
 * reused once the previous element has been over for that many days.
 *
 * Each lane keeps every span placed in it rather than just the rightmost end:
 * in document order an element can arrive to the *left* of one already in the
 * lane, and only the full list can tell whether it still fits.
 */
function packLanes<T extends { start: string; end: string }>(
  spans: T[],
  gapDays: number,
): { item: T; lane: number }[] {
  const lanes: { start: string; end: string }[][] = [];
  return spans.map((item) => {
    const gapEnd = shiftDate(item.end, gapDays);
    let lane = lanes.findIndex((occupants) =>
      occupants.every((o) => item.start > o.end || gapEnd < o.start),
    );
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane].push({ start: item.start, end: gapEnd });
    return { item, lane };
  });
}

/**
 * Days of clearance a point element's label needs before its lane can be
 * reused. Proportional to the window, because a milestone's label is roughly a
 * fixed width on screen however many months that width represents.
 */
function pointGapDays(totalDays: number): number {
  return Math.max(1, Math.round(totalDays / 12));
}

function buildColumns(
  start: string,
  end: string,
  unit: TimelineUnit,
  doc: ScheduleDocModel,
  totalDays: number,
  today?: string,
): TimelineColumn[] {
  const columns: TimelineColumn[] = [];
  const last = fromISO(end);
  let cursor =
    unit === "week"
      ? startOfWeek(fromISO(start), { weekStartsOn: WEEK_STARTS_ON })
      : startOfMonth(fromISO(start));

  while (cursor <= last) {
    const next = unit === "week" ? addDays(cursor, 7) : addMonths(cursor, 1);
    const rawStart = toISO(cursor);
    const rawEnd = toISO(addDays(next, -1));
    const span = spanOf(rawStart, rawEnd, start, end, totalDays);
    const first = fromISO(span.start);
    columns.push({
      ...span,
      month: first.getMonth() + 1,
      year: first.getFullYear(),
      day: first.getDate(),
      // A month column always opens one; a week column does so when the 1st
      // falls inside it, which is where the calendar grid draws its divider
      // too.
      isMonthStart: unit === "month" || containsFirstOfMonth(rawStart, rawEnd),
      days: calendarDays(span.start, span.end),
      workingDays: countWorkingDays(span.start, span.end, doc.nonWorking),
      containsToday: today !== undefined && today >= span.start && today <= span.end,
    });
    cursor = next;
  }
  return columns;
}

/** Whether an inclusive span covers the first day of some month. */
function containsFirstOfMonth(start: string, end: string): boolean {
  const from = fromISO(start);
  for (let i = 0; i < calendarDays(start, end); i++) {
    if (addDays(from, i).getDate() === 1) return true;
  }
  return false;
}

/** Coarse header bands: months over week columns, years over month columns. */
function buildBands(
  columns: TimelineColumn[],
  unit: TimelineUnit,
  start: string,
  end: string,
  totalDays: number,
): TimelineBand[] {
  if (columns.length === 0) return [];
  const bands: TimelineBand[] = [];
  const keyOf = (c: TimelineColumn) => (unit === "week" ? `${c.year}-${c.month}` : `${c.year}`);

  let groupStart = columns[0].start;
  let groupEnd = columns[0].end;
  let current = columns[0];
  let key = keyOf(columns[0]);

  const flush = () => {
    const span = spanOf(groupStart, groupEnd, start, end, totalDays);
    bands.push({
      ...span,
      label: unit === "week" ? String(current.month) : String(current.year),
      ...(unit === "week" ? { month: current.month } : {}),
      year: current.year,
    });
  };

  for (const col of columns.slice(1)) {
    const next = keyOf(col);
    if (next === key) {
      groupEnd = col.end;
      continue;
    }
    flush();
    key = next;
    current = col;
    groupStart = col.start;
    groupEnd = col.end;
  }
  flush();
  return bands;
}

/**
 * Builds everything the timeline draws for `doc` over `start`..`end`.
 *
 * Like `buildLayout`, it never reads the clock: `today` is passed in so the
 * rendering stays a pure function of its inputs and the HTML export can be
 * snapshot-tested.
 */
export function buildTimeline(
  doc: ScheduleDocModel,
  start: string,
  end: string,
  today?: string,
): TimelineLayout {
  const empty: TimelineLayout = {
    start,
    end,
    totalDays: 0,
    unit: "week",
    bands: [],
    columns: [],
    sprints: [],
    bars: [],
    laneCount: 0,
    points: [],
    pointLaneCount: 0,
    todayFrac: null,
    workingDays: 0,
  };
  if (end < start) return empty;

  const totalDays = calendarDays(start, end);
  const unit = timelineUnit(start, end);
  const columns = buildColumns(start, end, unit, doc, totalDays, today);

  const ranges = doc.items.filter((i) => isRangeKind(i.kind) && i.end >= start && i.start <= end);
  const packedBars = packLanes(ranges, 0);
  const bars: TimelineBar[] = packedBars.map(({ item, lane }) => ({
    ...spanOf(item.start, item.end, start, end, totalDays),
    item,
    lane,
    isStart: item.start >= start,
    isEnd: item.end <= end,
    workingDays: countWorkingDays(item.start, item.end, doc.nonWorking),
  }));

  const pointItems = doc.items.filter(
    (i) => !isRangeKind(i.kind) && i.start >= start && i.start <= end,
  );
  const packedPoints = packLanes(pointItems, pointGapDays(totalDays));
  const points: TimelinePoint[] = packedPoints.map(({ item, lane }) => ({
    item,
    lane,
    frac: startFracOf(item.start, start, totalDays),
  }));

  const sprints = doc.sprint
    ? sprintSlices(start, end, doc.sprint).map((slice) => ({
        ...slice,
        ...spanOf(slice.start, slice.end, start, end, totalDays),
      }))
    : [];

  return {
    start,
    end,
    totalDays,
    unit,
    bands: buildBands(columns, unit, start, end, totalDays),
    columns,
    sprints,
    bars,
    laneCount: bars.reduce((max, b) => Math.max(max, b.lane + 1), 0),
    points,
    pointLaneCount: points.reduce((max, p) => Math.max(max, p.lane + 1), 0),
    todayFrac:
      today !== undefined && today >= start && today <= end
        ? startFracOf(today, start, totalDays)
        : null,
    workingDays: countWorkingDays(start, end, doc.nonWorking),
  };
}

/**
 * The date at a fraction of the axis — how a pointer position becomes a day.
 *
 * The calendar grid hit-tests against the day cell under the cursor; a
 * timeline has no cells, so the axis is inverted arithmetically instead. Same
 * outcome: gestures are measured in **dates**, never pixels, so a drag means
 * the same thing at any zoom.
 */
export function dateAtFrac(layout: TimelineLayout, frac: number): string {
  if (layout.totalDays === 0) return layout.start;
  const day = Math.floor(clamp01(frac) * layout.totalDays);
  return shiftDate(layout.start, Math.min(day, layout.totalDays - 1));
}

/** Snaps a day delta to whole weeks — what Shift does during a drag, for the
 * common long-range edit of "push this a fortnight". */
export function snapWeeks(deltaDays: number): number {
  return Math.round(deltaDays / 7) * 7;
}

/** Sprint number covering a date, for tooltips. Null when the note has no
 * cadence or the date sits before it. */
export function sprintLabelAt(date: string, cfg: SprintConfig | undefined): string | null {
  if (!cfg) return null;
  const slices = sprintSlices(date, date, cfg);
  const n = slices[0]?.number;
  return n === undefined ? null : `S${n}`;
}
