/**
 * Helpers for blocked tasks — the ones waiting on someone else.
 *
 * Colour belongs to priority (which task to do first). Blocked is a different
 * axis — whether a task *can* be done at all — so the card badge is greyscale
 * and never warns. A block nobody chases still has to surface somewhere, so
 * the "stale" judgment moved to the toolbar, which counts them across the
 * board instead of shouting from each card.
 */

/** Days after which an unchased block counts as stale. */
export const STALE_BLOCK_DAYS = 7;

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

/**
 * Age label for the badge, e.g. `12d`. Empty when no date is known — the
 * pause icon alone already says "blocked", so there is nothing to pad with.
 */
export function blockedAge(blockedSince: string): string {
  const days = blockedDays(blockedSince);
  return days === null ? "" : `${days}d`;
}

/** Whether a block has gone unchased long enough to be worth surfacing. */
export function isStaleBlock(blockedSince: string): boolean {
  const days = blockedDays(blockedSince);
  return days !== null && days >= STALE_BLOCK_DAYS;
}
