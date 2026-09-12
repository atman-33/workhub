/**
 * The Docs tab's "Recent files" list (T-0276).
 *
 * It lives in `localStorage`, not in the settings file: a list of what was
 * opened is history, and the repo rule `.claude/rules/settings-placement.md`
 * keeps history machine-local. Shortcuts, which the user curates, go the other
 * way and are vault-scoped.
 *
 * The list is kept **per root**. A path only means something inside the root
 * it belongs to, so one shared list would show rows that cannot be opened
 * after a root switch.
 */

/** How many files the section holds. The eleventh drops off the end. */
export const RECENT_LIMIT = 10;

const KEY_PREFIX = "docs.recent.";

/** The recorded paths for one root, most recent first. */
export function readRecent(rootId: string): string[] {
  if (!rootId) return [];
  try {
    const raw = localStorage.getItem(KEY_PREFIX + rootId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string").slice(0, RECENT_LIMIT);
  } catch {
    // Unreadable or not JSON — an empty history is the harmless answer.
    return [];
  }
}

function writeRecent(rootId: string, paths: string[]) {
  try {
    localStorage.setItem(KEY_PREFIX + rootId, JSON.stringify(paths));
  } catch {
    // Storage unavailable — the history is a convenience, not state anything
    // else depends on.
  }
}

/**
 * Puts `path` at the front, drops any earlier mention of it, and trims to
 * `RECENT_LIMIT`. Returns the new list so the caller can render it without
 * reading back.
 */
export function pushRecent(rootId: string, path: string): string[] {
  if (!rootId || !path) return readRecent(rootId);
  const next = [path, ...readRecent(rootId).filter((p) => p !== path)].slice(0, RECENT_LIMIT);
  writeRecent(rootId, next);
  return next;
}

/** Forgets one entry — the row's own context menu. */
export function removeRecent(rootId: string, path: string): string[] {
  const next = readRecent(rootId).filter((p) => p !== path);
  writeRecent(rootId, next);
  return next;
}

/** Forgets the whole list for a root. */
export function clearRecent(rootId: string): string[] {
  writeRecent(rootId, []);
  return [];
}
