/**
 * Turning the Docs tree into a flat list of rows, and moving a cursor through
 * it with the arrow keys (T-0276).
 *
 * The tree used to render itself recursively, one component per open folder.
 * That is the natural shape for "load a folder when it is opened", but there
 * is no flat order in it — and keyboard navigation is nothing *but* a flat
 * order. Flattening here keeps the rendering dumb and puts every rule that can
 * be got wrong (what Down means on the last child, what Left means on a file)
 * in one testable place.
 */
import type { DocsEntry } from "@/types";

/** What one directory's listing is doing, keyed by that directory's path. */
export type DirState =
  | { status: "loading" }
  | { status: "ready"; entries: DocsEntry[] }
  | { status: "error"; message: string };

/** One rendered line: a real entry, or a placeholder standing in for one. */
export type Row =
  | { kind: "entry"; entry: DocsEntry; depth: number }
  | {
      kind: "message";
      /** Unique among rows — the folder the message is about, plus its kind. */
      key: string;
      depth: number;
      text: string;
      tone: "muted" | "error";
    };

export interface FlattenOptions {
  rootPath: string;
  dirs: Record<string, DirState>;
  open: Record<string, boolean>;
  /** Lower-cased, already trimmed. "" shows everything. */
  filter: string;
  /**
   * Hide files, leaving a tree of folders only — the shape the sidebar takes
   * when the file-list pane is on.
   */
  foldersOnly: boolean;
}

/**
 * The rows to draw, in screen order, and the folders whose listings the caller
 * has to fetch for those rows to exist.
 *
 * `needed` is what replaces the old per-level `useEffect`: a folder appears in
 * it when it is on screen and open (the root always is), so the caller can ask
 * for exactly those listings and no others. Nothing is walked that is not
 * visible, which is what keeps a Drive share from being pulled down whole.
 */
export function flattenTree(options: FlattenOptions): { rows: Row[]; needed: string[] } {
  const { rootPath, dirs, open, filter, foldersOnly } = options;
  const rows: Row[] = [];
  const needed: string[] = [];
  if (!rootPath) return { rows, needed };

  const walk = (path: string, depth: number) => {
    needed.push(path);
    const state = dirs[path];
    if (!state || state.status === "loading") {
      rows.push({ kind: "message", key: `${path}:loading`, depth, text: "Loading…", tone: "muted" });
      return;
    }
    if (state.status === "error") {
      rows.push({
        kind: "message",
        key: `${path}:error`,
        depth,
        text: state.message,
        tone: "error",
      });
      return;
    }

    // Folders are never filtered out: a match may be inside one, and this tree
    // only knows what has been opened. Filtering files is enough to make a long
    // folder usable without pretending to search the whole share.
    const entries = state.entries.filter((e) => {
      if (e.is_dir) return true;
      if (foldersOnly) return false;
      return !filter || e.name.toLowerCase().includes(filter);
    });

    if (entries.length === 0) {
      rows.push({
        kind: "message",
        key: `${path}:empty`,
        depth,
        text: foldersOnly
          ? "No folders here."
          : filter
            ? "Nothing matching here."
            : "This folder is empty.",
        tone: "muted",
      });
      return;
    }

    for (const entry of entries) {
      rows.push({ kind: "entry", entry, depth });
      if (entry.is_dir && open[entry.path]) walk(entry.path, depth + 1);
    }
  };

  walk(rootPath, 0);
  return { rows, needed };
}

/** The entry rows only — what the arrow keys move between. */
export function entryRows(rows: Row[]): Extract<Row, { kind: "entry" }>[] {
  return rows.filter((r): r is Extract<Row, { kind: "entry" }> => r.kind === "entry");
}

/** Where `path` sits among the entry rows, or -1. */
export function indexOfPath(rows: Row[], path: string): number {
  return entryRows(rows).findIndex((r) => r.entry.path === path);
}

/** What an arrow key does to the cursor. */
export type NavAction =
  | { type: "move"; path: string }
  | { type: "open"; path: string }
  | { type: "close"; path: string }
  | { type: "none" };

/**
 * The cursor move (or expand/collapse) an arrow key asks for.
 *
 * Deliberately does **not** open a file: on a shared drive, reading one per
 * keypress makes the arrows unusable, so moving is moving and `Enter` is what
 * opens (T-0276, owner's call).
 */
export function navigate(
  key: "ArrowDown" | "ArrowUp" | "ArrowRight" | "ArrowLeft" | "Home" | "End",
  rows: Row[],
  cursor: string,
  open: Record<string, boolean>,
): NavAction {
  const entries = entryRows(rows);
  if (entries.length === 0) return { type: "none" };
  const at = entries.findIndex((r) => r.entry.path === cursor);

  switch (key) {
    case "Home":
      return { type: "move", path: entries[0].entry.path };
    case "End":
      return { type: "move", path: entries[entries.length - 1].entry.path };
    case "ArrowDown": {
      // No cursor yet — the first row, so the first Down lands somewhere.
      if (at < 0) return { type: "move", path: entries[0].entry.path };
      const next = entries[at + 1];
      return next ? { type: "move", path: next.entry.path } : { type: "none" };
    }
    case "ArrowUp": {
      if (at < 0) return { type: "move", path: entries[entries.length - 1].entry.path };
      const prev = entries[at - 1];
      return prev ? { type: "move", path: prev.entry.path } : { type: "none" };
    }
    case "ArrowRight": {
      if (at < 0) return { type: "none" };
      const row = entries[at];
      if (!row.entry.is_dir) return { type: "none" };
      // Closed → open it. Already open → step into it, which is where the
      // eye goes next anyway.
      if (!open[row.entry.path]) return { type: "open", path: row.entry.path };
      const child = entries[at + 1];
      return child && child.depth > row.depth
        ? { type: "move", path: child.entry.path }
        : { type: "none" };
    }
    case "ArrowLeft": {
      if (at < 0) return { type: "none" };
      const row = entries[at];
      if (row.entry.is_dir && open[row.entry.path]) return { type: "close", path: row.entry.path };
      // Otherwise go up a level: the nearest row above that is shallower. On a
      // top-level row there is nowhere to go, and nothing happens.
      for (let i = at - 1; i >= 0; i--) {
        if (entries[i].depth < row.depth) return { type: "move", path: entries[i].entry.path };
      }
      return { type: "none" };
    }
  }
}

/**
 * The folders between `rootPath` and `path`, so a shortcut can open the tree
 * down to what it points at.
 *
 * Paths are compared as strings because that is what they are here: the
 * backend hands out absolute, forward-slashed paths, and every child of a root
 * starts with it. A path outside the root yields nothing rather than guessing.
 */
export function ancestorsWithin(rootPath: string, path: string): string[] {
  if (!rootPath || !path) return [];
  const root = rootPath.replace(/\/+$/, "");
  if (path !== root && !path.startsWith(`${root}/`)) return [];
  const rest = path.slice(root.length + 1);
  if (!rest) return [];
  const parts = rest.split("/").filter(Boolean);
  // Every level except the last: the target itself is revealed, not expanded.
  const out: string[] = [root];
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = `${current}/${part}`;
    out.push(current);
  }
  return out;
}

/** The display name of a path — its last segment. */
export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut < 0 ? trimmed : trimmed.slice(cut + 1);
}

/** The folder a path sits in, or "" when it has no parent within the root. */
export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut <= 0 ? "" : trimmed.slice(0, cut);
}
