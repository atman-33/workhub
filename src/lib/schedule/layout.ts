/**
 * Continuous-week grid layout — the one place schedule geometry is computed.
 *
 * The screen and the HTML export both render *this* output rather than each
 * working out their own week rows and bar positions, because two
 * implementations of the same layout drift and the export then stops matching
 * what the user approved on screen (design note §8.2).
 *
 * Everything here is a pure function of dates and the document model: no DOM,
 * no React, no `Date.now()` beyond what the caller passes in. That is what
 * makes it unit-testable, and the tests are the specification of the tricky
 * parts (month boundaries, bar clipping at week edges, working-day counts).
 *
 * Dates are `YYYY-MM-DD` strings throughout. They compare and sort correctly
 * as strings, they round-trip through the file unchanged, and they carry no
 * timezone — a schedule day is a calendar day, not an instant.
 */

import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns";
import type { NonWorking, ScheduleDocModel, ScheduleItem } from "./parse";

export interface LayoutDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Day of month, 1-31. */
  day: number;
  /** Month, 1-12. */
  month: number;
  year: number;
  /** 0 = Sunday, matching `Date#getDay()`. */
  weekday: number;
  isNonWorking: boolean;
  /** Label of the explicit non-working range covering this day, if any. */
  nonWorkingLabel?: string;
  /** First day of its month — rendered as "8/1" and given a divider, which is
   * how a month change reads without breaking the run of weeks (§3.1). */
  isMonthStart: boolean;
  /** Outside the requested range: rendered dimmed, since a week row always
   * shows all seven days even when the range starts midweek. */
  isOutside: boolean;
  /** Point elements (milestones and notes) falling on this day. */
  points: ScheduleItem[];
}

/** A bar clipped to one week row. A bar spanning three weeks yields three. */
export interface LayoutBar {
  item: ScheduleItem;
  /** Column index within the week, 0-6. */
  startCol: number;
  /** Inclusive end column, 0-6. */
  endCol: number;
  /** True when the bar actually begins in this week (rounded left edge, and
   * the only segment that shows the title). */
  isStart: boolean;
  /** True when the bar ends in this week (rounded right edge). */
  isEnd: boolean;
  /** Stacking row within the week, assigned by `packBars`. */
  lane: number;
  /** Working days across the *whole* bar, not just this segment — the number
   * the user is actually deciding against. */
  workingDays: number;
}

export interface LayoutWeek {
  days: LayoutDay[];
  /** Month label for the left gutter: the month most of this week sits in. */
  monthLabel: string;
  bars: LayoutBar[];
  /** Number of stacking lanes this week needs (0 when it has no bars). */
  lanes: number;
}

export interface Layout {
  weeks: LayoutWeek[];
  /** Echoed back so renderers can label the range without re-deriving it. */
  start: string;
  end: string;
}

/** Monday-first weeks: a working week reads Mon..Sun, and a plan is about
 * working weeks. `date-fns`' `weekStartsOn: 1`. */
const WEEK_STARTS_ON = 1;

export function toISO(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function fromISO(s: string): Date {
  return parseISO(s);
}

/** Inclusive day count between two ISO dates. */
export function calendarDays(start: string, end: string): number {
  return differenceInCalendarDays(fromISO(end), fromISO(start)) + 1;
}

/**
 * Whether a date is non-working: either its weekday is in the weekly set, or
 * an explicit range covers it. Explicit ranges are what encode holidays and
 * leave; the weekly set is the standing weekend.
 */
export function isNonWorking(date: string, nw: NonWorking): boolean {
  const weekday = fromISO(date).getDay();
  if (nw.weekly.includes(weekday)) return true;
  return nw.ranges.some((r) => date >= r.start && date <= r.end);
}

function nonWorkingLabel(date: string, nw: NonWorking): string | undefined {
  const hit = nw.ranges.find((r) => date >= r.start && date <= r.end && r.label);
  return hit?.label;
}

/**
 * Working days in an inclusive span — the number the whole feature exists to
 * make visible (§3.3). A span that is entirely non-working correctly counts 0.
 */
export function countWorkingDays(start: string, end: string, nw: NonWorking): number {
  if (end < start) return 0;
  let count = 0;
  let cursor = fromISO(start);
  const last = fromISO(end);
  while (cursor <= last) {
    if (!isNonWorking(toISO(cursor), nw)) count++;
    cursor = addDays(cursor, 1);
  }
  return count;
}

/**
 * Assigns each bar a lane so that overlapping bars stack instead of colliding.
 * First-fit over lanes, scanning bars in start order: the earliest bar keeps
 * the top lane, which makes the layout stable as the user drags — a bar that
 * moves by a day should not reshuffle every other bar on screen.
 */
function packBars(bars: LayoutBar[]): number {
  const laneEnds: number[] = [];
  const ordered = [...bars].sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol);
  for (const bar of ordered) {
    let lane = laneEnds.findIndex((end) => end < bar.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bar.endCol);
    } else {
      laneEnds[lane] = bar.endCol;
    }
    bar.lane = lane;
  }
  return laneEnds.length;
}

/**
 * Builds the week rows covering `start`..`end`. Rows always start on Monday
 * and always hold seven days, so the grid stays a grid; days outside the
 * requested range are marked `isOutside` rather than omitted.
 */
export function buildLayout(doc: ScheduleDocModel, start: string, end: string): Layout {
  if (end < start) return { weeks: [], start, end };

  const nw = doc.nonWorking;
  const firstDay = startOfWeek(fromISO(start), { weekStartsOn: WEEK_STARTS_ON });
  const lastDate = fromISO(end);

  // Point elements bucketed by date up front: a linear scan per day would be
  // O(days x items) for no benefit.
  const pointsByDate = new Map<string, ScheduleItem[]>();
  for (const item of doc.items) {
    if (item.kind === "bar") continue;
    const list = pointsByDate.get(item.start);
    if (list) list.push(item);
    else pointsByDate.set(item.start, [item]);
  }

  const weeks: LayoutWeek[] = [];
  let cursor = firstDay;
  while (cursor <= lastDate) {
    const days: LayoutDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(cursor, i);
      const iso = toISO(d);
      days.push({
        date: iso,
        day: d.getDate(),
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        weekday: d.getDay(),
        isNonWorking: isNonWorking(iso, nw),
        nonWorkingLabel: nonWorkingLabel(iso, nw),
        isMonthStart: d.getDate() === 1,
        isOutside: iso < start || iso > end,
        points: pointsByDate.get(iso) ?? [],
      });
    }

    const weekStart = days[0].date;
    const weekEnd = days[6].date;
    const bars: LayoutBar[] = [];
    for (const item of doc.items) {
      if (item.kind !== "bar") continue;
      if (item.end < weekStart || item.start > weekEnd) continue;
      const startCol = item.start <= weekStart ? 0 : dayIndex(days, item.start);
      const endCol = item.end >= weekEnd ? 6 : dayIndex(days, item.end);
      bars.push({
        item,
        startCol,
        endCol,
        isStart: item.start >= weekStart && item.start <= weekEnd,
        isEnd: item.end >= weekStart && item.end <= weekEnd,
        lane: 0,
        workingDays: countWorkingDays(item.start, item.end, nw),
      });
    }
    const lanes = packBars(bars);

    weeks.push({ days, monthLabel: monthLabelFor(days), bars, lanes });
    cursor = addDays(cursor, 7);
  }

  return { weeks, start, end };
}

function dayIndex(days: LayoutDay[], date: string): number {
  const idx = days.findIndex((d) => d.date === date);
  return idx === -1 ? 0 : idx;
}

/**
 * Gutter label for a week: the month holding most of its days. A week split
 * across two months gets the one it mostly belongs to, and the month change
 * itself is carried by the per-day marker instead.
 */
function monthLabelFor(days: LayoutDay[]): string {
  const counts = new Map<string, number>();
  for (const d of days) {
    const key = `${d.year}-${d.month}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = "";
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  const [, month] = best.split("-");
  return MONTH_NAMES[Number(month) - 1] ?? "";
}

/** Short month names, spelled out rather than formatted at render time:
 * `toLocaleString` would follow the OS display language and turn the gutter
 * Japanese on a Japanese machine (`.claude/rules/tauri-webview-gotchas.md`). */
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Parses a `YYYY-MM-DD..YYYY-MM-DD` frontmatter range. Returns null when the
 * value is absent or malformed, so the caller can fall back to a default
 * window rather than render nothing. */
export function parseRange(range: string): { start: string; end: string } | null {
  const [start, end] = range.split("..").map((s) => s.trim());
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return null;
  }
  return end < start ? null : { start, end };
}

export function formatRange(start: string, end: string): string {
  return `${start}..${end}`;
}

/** Shifts an ISO date by whole days — the primitive every drag operation is
 * expressed in, so drag handling never touches `Date` directly. */
export function shiftDate(date: string, days: number): string {
  return toISO(addDays(fromISO(date), days));
}
