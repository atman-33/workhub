/** Helpers behind `DateTimePicker`, kept pure so the date arithmetic (the
 * part that actually breaks) is unit-testable without a DOM. */

/** Minute granularity of the picker's time selects. A schedule anchor does not
 * need per-minute precision, and a 12-entry list stays scannable. */
export const MINUTE_STEP = 5;

export const pad = (n: number) => String(n).padStart(2, "0");

/** Floor a minute value onto the picker's grid, so a timestamp saved with an
 * off-grid minute (e.g. by the old native input) still selects an option. */
export function floorMinute(minute: number): number {
  return Math.floor(minute / MINUTE_STEP) * MINUTE_STEP;
}

/** `date` floored to the minute grid, seconds/ms zeroed. */
export function roundToStep(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  d.setMinutes(floorMinute(d.getMinutes()));
  return d;
}

export function toUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * `base` with any of the calendar date, hour, or minute replaced, as unix
 * seconds. The date patch contributes only its Y/M/D — its time-of-day is
 * discarded — so picking a day in the calendar never disturbs the chosen time.
 */
export function applyDateTime(
  base: Date,
  patch: { date?: Date; hour?: number; minute?: number },
): number {
  const source = patch.date ?? base;
  const next = new Date(
    source.getFullYear(),
    source.getMonth(),
    source.getDate(),
    patch.hour ?? base.getHours(),
    patch.minute ?? base.getMinutes(),
    0,
    0,
  );
  return toUnix(next);
}
