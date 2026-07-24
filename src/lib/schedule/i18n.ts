/**
 * Display strings for the schedule grid and its HTML export.
 *
 * Deliberately a hand-written table rather than `Intl` / `toLocaleString`:
 * those follow the *OS* display language, so on a Japanese Windows machine the
 * grid would render Japanese regardless of this setting — and the exported
 * file would depend on whichever machine produced it
 * (`.claude/rules/tauri-webview-gotchas.md`).
 *
 * Scope: **date presentation** — weekday and month labels, and the day-count
 * readouts that accompany them — plus the exported document, which is a
 * hand-out and should not depend on the locale of the machine that produced
 * it. Commands and labels (menu items, buttons, tooltips) stay English like
 * the rest of the app.
 *
 * This is display only. The schedule note itself never stores localized text,
 * so switching locale can never change a file.
 */

export type ScheduleLocale = "en" | "ja";

export function isScheduleLocale(value: string): value is ScheduleLocale {
  return value === "en" || value === "ja";
}

interface Strings {
  /** Weekday headers, Sunday first (matching `Date#getDay()` order). */
  weekdays: string[];
  /** Short month names, index 0 = January. */
  months: string[];
  /** `2026-07-20 to 2026-08-31` — the export header's range. */
  range: (start: string, end: string) => string;
  /** `13 working days` */
  workingDays: (n: number) => string;
  /** `18 calendar days` */
  calendarDays: (n: number) => string;
  /** `exported 2026-07-24` */
  exportedOn: (date: string) => string;
  nonWorkingDay: string;
  notes: string;
}

const EN: Strings = {
  weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  months: [
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
  ],
  range: (start, end) => `${start} to ${end}`,
  workingDays: (n) => `${n} working ${n === 1 ? "day" : "days"}`,
  calendarDays: (n) => `${n} calendar ${n === 1 ? "day" : "days"}`,
  exportedOn: (date) => `exported ${date}`,
  nonWorkingDay: "Non-working day",
  notes: "Notes",
};

const JA: Strings = {
  weekdays: ["日", "月", "火", "水", "木", "金", "土"],
  months: [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ],
  range: (start, end) => `${start} 〜 ${end}`,
  workingDays: (n) => `稼働 ${n} 日`,
  calendarDays: (n) => `暦 ${n} 日`,
  exportedOn: (date) => `出力日 ${date}`,
  nonWorkingDay: "非稼働日",
  notes: "メモ",
};

export function strings(locale: ScheduleLocale): Strings {
  return locale === "ja" ? JA : EN;
}

/** Short month label for the grid's left gutter. `month` is 1-12. */
export function monthLabel(month: number, locale: ScheduleLocale): string {
  return strings(locale).months[month - 1] ?? "";
}
