/**
 * Helpers for the "blocked" badge — a task that is waiting on someone else.
 * The point of the badge is not the note but the elapsed time: a block nobody
 * chases turns into a stalled task, so the age drives the colour.
 */

/** Local `YYYY-MM-DD` — the stamp used when a task becomes blocked. */
export function todayString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetween(from: string, to: string): number | null {
  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

/**
 * Whole days a task has been blocked, or null when `blocked_since` is missing
 * or unparsable (blocked today = 0). Never negative: a date in the future is
 * a typo, not a negative wait.
 */
export function blockedDays(blockedSince: string): number | null {
  if (!blockedSince) return null;
  const days = daysBetween(blockedSince, todayString());
  if (days === null) return null;
  return Math.max(0, days);
}

/** Badge label, e.g. `Blocked · 3d`, falling back to `Blocked` without a date. */
export function blockedLabel(blockedSince: string): string {
  const days = blockedDays(blockedSince);
  return days === null ? "Blocked" : `Blocked · ${days}d`;
}

/**
 * Text-colour class for the badge: amber for a fresh block, red once it has
 * been sitting for a week — the point at which it needs chasing.
 */
export function blockedTone(blockedSince: string): string {
  const days = blockedDays(blockedSince);
  return days !== null && days >= 7 ? "text-red-400" : "text-amber-400";
}
