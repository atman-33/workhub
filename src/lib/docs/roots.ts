/**
 * Ordering the registered document roots for display (T-0294).
 *
 * The stored order is the order they were registered in, which is the order
 * they happened to be added and tells the reader nothing. The picker is a
 * place to *find* a folder, so it is sorted by the label it shows.
 *
 * Sorting here rather than in the config keeps the registry as it is: the
 * stored list is a set of registrations, and nothing else reads an order into
 * it. Display order is a property of the picker, not of the data.
 */
import type { DocsRootStatus } from "@/types";

/**
 * The label a root is listed under — its name, or its path when it has none.
 * Sorting has to use this and not `name`, or the unnamed roots would all sort
 * together at one end regardless of where they point.
 */
export function rootLabel(root: DocsRootStatus): string {
  return root.name || root.path;
}

/**
 * `Intl.Collator` rather than `<`: these names are routinely Japanese, where
 * code-point order is not alphabetical order. `numeric` so `plan 2` comes
 * before `plan 10`, and `sensitivity: "base"` so case and width do not split
 * two names that read the same.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The roots in the order the picker lists them: by label, ascending. */
export function sortRootsByLabel(roots: DocsRootStatus[]): DocsRootStatus[] {
  return [...roots].sort((a, b) => collator.compare(rootLabel(a), rootLabel(b)));
}
