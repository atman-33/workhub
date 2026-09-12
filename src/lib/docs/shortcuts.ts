/**
 * Shortcuts are stored as one list and shown a root at a time (T-0296).
 *
 * The list itself stays whole: a shortcut's path already says which root it
 * belongs to, so nothing has to be restructured, and a root that is removed
 * and registered again gets its shortcuts back rather than having lost them.
 * What changes is the sidebar, which only shows the ones the picked root
 * contains — the same call `recent.ts` already made, for the same reason: a
 * path means nothing outside the root it belongs to, and a row that cannot be
 * revealed in the tree is a row that only half works.
 *
 * Showing a subset is where the danger is. The section reorders by dragging
 * and hands back the order it now has — which is the order of the *subset*.
 * Saved as-is, every shortcut belonging to another root is gone, silently and
 * with no way back. `reorderWithinRoot` is what stops that, and it is a pure
 * function so the rule can be pinned by tests instead of by remembering.
 */
import { isWithinRoot } from "@/lib/docs/tree-nav";
import type { DocsShortcut } from "@/types";

/** The shortcuts the picked root contains, in their stored order. */
export function shortcutsInRoot(shortcuts: DocsShortcut[], rootPath: string): DocsShortcut[] {
  if (!rootPath) return [];
  return shortcuts.filter((s) => isWithinRoot(rootPath, s.path));
}

/**
 * The whole list, with the visible rows rearranged into `reordered`.
 *
 * Every shortcut outside `rootPath` keeps the index it had; the visible ones
 * are dealt back into the slots they occupied, in their new order. So dragging
 * a row inside one root reorders that root and moves nothing else.
 *
 * `reordered` is trusted to be a permutation of what is visible, because it is
 * one — it is the section's own list after a drag. A row that is not visible
 * is ignored rather than inserted, so a stale drag cannot smuggle another
 * root's shortcut into this one's positions.
 */
export function reorderWithinRoot(
  shortcuts: DocsShortcut[],
  rootPath: string,
  reordered: DocsShortcut[],
): DocsShortcut[] {
  const visible = new Set(shortcutsInRoot(shortcuts, rootPath).map((s) => s.path));
  const queue = reordered.filter((s) => visible.has(s.path));
  // A short queue would leave a hole; fall back to the stored order rather
  // than dropping a shortcut, which is the failure this function exists for.
  if (queue.length !== visible.size) return shortcuts;
  let next = 0;
  return shortcuts.map((s) => (visible.has(s.path) ? queue[next++] : s));
}
