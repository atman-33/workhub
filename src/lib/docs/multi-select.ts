import { toWindowsPath } from "@/lib/docs/markdown";

/**
 * The files picked with Ctrl/Shift+click in the Docs sidebar (T-0400), so one
 * "Copy path" can take several of them.
 *
 * A plain click opens a file, so the picking is done on the modifiers the way
 * Explorer does it: Ctrl toggles one file, Shift takes the run between the
 * anchor and the clicked file in the order the rows are on screen.
 *
 * `paths` is kept in the order they were picked; `orderedPaths` puts them in
 * screen order when they are copied.
 */
export interface MultiSelection {
  paths: string[];
  /** Where the next Shift+click range starts; "" when nothing set it yet. */
  anchor: string;
}

export const EMPTY_SELECTION: MultiSelection = { paths: [], anchor: "" };

/**
 * Ctrl+click: adds `path` or takes it out again, and makes it the anchor.
 *
 * With nothing picked yet, the file open in the preview (`current`) is picked
 * too when it is on screen — that is the file the plain click before this one
 * "selected", and Explorer would carry it along the same way.
 */
export function toggleSelection(
  sel: MultiSelection,
  path: string,
  order: string[],
  current: string,
): MultiSelection {
  const base =
    sel.paths.length === 0 && current && current !== path && order.includes(current)
      ? [current]
      : sel.paths;
  const paths = base.includes(path) ? base.filter((p) => p !== path) : [...base, path];
  return { paths, anchor: path };
}

/**
 * Shift+click: picks every file from the anchor to `path`, both included, in
 * screen order. The range replaces what was picked, and the anchor stays put
 * so a second Shift+click resizes the same range.
 *
 * Without an anchor on screen the range starts at the open file, and without
 * that it is just the clicked file.
 */
export function rangeSelection(
  sel: MultiSelection,
  path: string,
  order: string[],
  current: string,
): MultiSelection {
  const to = order.indexOf(path);
  if (to < 0) return sel;
  const anchor = order.includes(sel.anchor)
    ? sel.anchor
    : order.includes(current)
      ? current
      : path;
  const from = order.indexOf(anchor);
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return { paths: order.slice(lo, hi + 1), anchor };
}

/**
 * The paths a right-click on `clicked` copies: the whole selection when the
 * clicked row is part of it, only that row otherwise — right-clicking a file
 * outside the selection is about that file, as in Explorer.
 */
export function pathsToCopy(sel: MultiSelection, clicked: string, order: string[]): string[] {
  if (!sel.paths.includes(clicked)) return [clicked];
  return orderedPaths(sel, order);
}

/** The picked paths in screen order; anything picked but scrolled out of the list goes last. */
export function orderedPaths(sel: MultiSelection, order: string[]): string[] {
  const picked = new Set(sel.paths);
  const onScreen = order.filter((p) => picked.has(p));
  const shown = new Set(onScreen);
  return [...onScreen, ...sel.paths.filter((p) => !shown.has(p))];
}

/**
 * What goes on the clipboard: one Windows path per line, CRLF-separated and
 * unquoted — the same shape as a single "Copy path", repeated, with the line
 * ending Explorer's own "Copy as path" uses.
 */
export function formatPaths(paths: string[]): string {
  return paths.map(toWindowsPath).join("\r\n");
}
