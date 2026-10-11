/**
 * Whether the Projects tab's project list is shown (T-0744).
 *
 * Stored in `localStorage` like the tab's split widths (T-0743): a screen
 * preference of this machine, not a vault setting. Every access is guarded so
 * a blocked or full storage leaves the list shown instead of breaking the tab.
 */

export const PROJECTS_LIST_OPEN_KEY = "projects-list-open";

/** The slice of `Storage` this module needs; lets the tests pass a plain object. */
export interface ListOpenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The list is shown unless the stored value is exactly "false". */
export function readProjectsListOpen(storage: ListOpenStorage | undefined): boolean {
  try {
    return storage?.getItem(PROJECTS_LIST_OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeProjectsListOpen(storage: ListOpenStorage | undefined, open: boolean): void {
  try {
    storage?.setItem(PROJECTS_LIST_OPEN_KEY, open ? "true" : "false");
  } catch {
    // Not remembered; the list still toggles for this session.
  }
}
