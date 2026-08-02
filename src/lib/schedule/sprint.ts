/**
 * Sprint arithmetic for the timeline (T-0111).
 *
 * A cadence is two numbers — a first day and a length in weeks — so every
 * question about it is a division. Keeping that division here, rather than in
 * the renderer, is what lets the screen and the HTML export agree on which
 * week is "S3" without either of them counting weeks itself.
 *
 * Sprints are a *reading* of the calendar, never a constraint on it: nothing
 * in this file moves an element, rounds a date, or rejects a plan that
 * straddles a boundary. Planning against sprints is the user's judgement; the
 * app only has to show where the boundaries fall.
 */

import { fromISO, shiftDate } from "./layout";
import type { SprintConfig } from "./parse";

/** Days in one sprint. */
export function sprintDays(cfg: SprintConfig): number {
  return cfg.weeks * 7;
}

/**
 * 1-based sprint number containing `date`, or null when the date falls before
 * sprint 1 starts.
 *
 * Dates before the start are deliberately *not* numbered backwards (`S0`,
 * `S-1`): the cadence begins where the user said it begins, and preparation
 * work sitting in front of it belongs to no sprint at all.
 */
export function sprintNumberAt(date: string, cfg: SprintConfig): number | null {
  const offset = Math.floor(
    (fromISO(date).getTime() - fromISO(cfg.start).getTime()) / 86_400_000,
  );
  if (offset < 0) return null;
  return Math.floor(offset / sprintDays(cfg)) + 1;
}

/** Inclusive date span of sprint `n` (1-based). */
export function sprintSpan(n: number, cfg: SprintConfig): { start: string; end: string } {
  const start = shiftDate(cfg.start, (n - 1) * sprintDays(cfg));
  return { start, end: shiftDate(start, sprintDays(cfg) - 1) };
}

export interface SprintSlice {
  /** 1-based sprint number. */
  number: number;
  /** Span clipped to the requested window. */
  start: string;
  end: string;
  /** True when the sprint's real first day is inside the window — the only
   * slice that should draw a boundary line and a full label. */
  isStart: boolean;
  isEnd: boolean;
}

/**
 * The sprints overlapping `start`..`end`, clipped to it.
 *
 * The leading gap before sprint 1 produces no slice rather than a placeholder:
 * an unlabelled stretch of header reads as "outside the cadence" on its own,
 * and inventing an `S0` band would imply a sprint that does not exist.
 */
export function sprintSlices(start: string, end: string, cfg: SprintConfig): SprintSlice[] {
  if (end < start) return [];
  const first = sprintNumberAt(start, cfg) ?? 1;
  const slices: SprintSlice[] = [];
  for (let n = first; ; n++) {
    const span = sprintSpan(n, cfg);
    if (span.start > end) break;
    if (span.end < start) continue;
    slices.push({
      number: n,
      start: span.start < start ? start : span.start,
      end: span.end > end ? end : span.end,
      isStart: span.start >= start,
      isEnd: span.end <= end,
    });
  }
  return slices;
}

/** A cadence starting on the Sunday of the week containing `date` — the
 * default offered when a note first enables sprints, so the boundaries line up
 * with the week columns the timeline already draws. */
export function defaultSprintStart(date: string): string {
  return shiftDate(date, -fromISO(date).getDay());
}
