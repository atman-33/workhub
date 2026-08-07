/** Date formatting for the git graph's commit rows, kept pure so the calendar
 * arithmetic is unit-testable and the "now" reference can be injected. */

import { pad } from "@/lib/date-time";

/**
 * Row label for a commit timestamp.
 *
 * Commits from the current year drop the year and keep the clock time
 * (`08-07 10:04`) — that is the part being compared when scanning recent work.
 * Older commits keep the year and drop the clock time (`2025-11-03`), since by
 * then the exact minute is noise. Both forms are 10-11 chars wide, so the
 * column stays narrow enough not to squeeze the subject.
 */
export function formatCommitDate(unixSecs: number, now: Date = new Date()): string {
  const d = new Date(unixSecs * 1000);
  if (d.getFullYear() !== now.getFullYear()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Unabbreviated local timestamp, for the row's tooltip. */
export function formatCommitDateFull(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
