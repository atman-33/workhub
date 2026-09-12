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
  | {
      kind: "entry";
      entry: DocsEntry;
      depth: number;
      /** The synthetic row for the root folder; drawn permanently expanded. */
      isRoot?: true;
      /**
       * A folder already listed and known to hold nothing this mode would
       * show. Drawn without a chevron, so it reads as a leaf rather than
       * opening onto an apology (T-0294).
       */
      isLeaf?: true;
    }
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
  /**
   * Draw a row for the root itself, so its own files can be selected in the
   * file-list pane. Without it the root has no row — the tree lists a root's
   * children — and the documents sitting directly in the shared folder would
   * be unreachable the moment a sub-folder was picked.
   *
   * The root row is always expanded: collapsing it would hide the whole tree
   * and leave nothing to click but itself.
   */
  rootName?: string;
}

/**
 * The rows to draw, in screen order, and the folders whose listings the caller
 * has to fetch for those rows to exist.
 *
 * `needed` is what replaces the old per-level `useEffect`: a folder appears in
 * it when it is on screen and open (the root always is), so the caller can ask
 * for exactly those listings and no others. Nothing is walked that is not
 * visible, which is what keeps a Drive share from being pulled down whole.
 *
 * A visible folder already known to be a leaf is in `needed` too, even though
 * it is closed and nothing is drawn under it. It costs no extra read — the
 * cache serves it until the refresh token changes — and it is what lets a
 * refresh notice that the folder has gained a sub-folder and give its chevron
 * back. A folder that has *never* been listed stays out: fetching one just for
 * being on screen is the whole-tree walk this module exists to avoid.
 */
export function flattenTree(options: FlattenOptions): { rows: Row[]; needed: string[] } {
  const { rootPath, dirs, open, filter, foldersOnly, rootName } = options;
  const rows: Row[] = [];
  const needed: string[] = [];
  if (!rootPath) return { rows, needed };
  const base = rootName ? 1 : 0;
  if (rootName) {
    rows.push({
      kind: "entry",
      depth: 0,
      isRoot: true,
      entry: {
        path: rootPath,
        name: rootName,
        is_dir: true,
        is_markdown: false,
        is_html: false,
      } as DocsEntry,
    });
  }

  // Folders are never filtered out: a match may be inside one, and this tree
  // only knows what has been opened. Filtering files is enough to make a long
  // folder usable without pretending to search the whole share.
  const visible = (entries: DocsEntry[]) =>
    entries.filter((e) => {
      if (e.is_dir) return true;
      if (foldersOnly) return false;
      return !filter || e.name.toLowerCase().includes(filter);
    });

  /**
   * True for a folder already listed and holding nothing this mode would show.
   *
   * Never while a filter is on: an empty result there is the filter's doing and
   * lasts as long as the typing does, and a folder that lost its chevron
   * mid-search would be unopenable once the search was cleared.
   */
  const isLeaf = (path: string): boolean => {
    if (filter) return false;
    const state = dirs[path];
    return state?.status === "ready" && visible(state.entries).length === 0;
  };

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

    const entries = visible(state.entries);

    if (entries.length === 0) {
      // Only the root can be drawn open-and-empty: every other empty folder is
      // a leaf, has no chevron and was never walked. Saying so beats a row that
      // reads as an apology for having opened at all (T-0294).
      if (filter || path === rootPath) {
        rows.push({
          kind: "message",
          key: `${path}:empty`,
          depth,
          text: filter ? "Nothing matching here." : "This folder is empty.",
          tone: "muted",
        });
      }
      return;
    }

    for (const entry of entries) {
      const leaf = entry.is_dir && isLeaf(entry.path);
      rows.push({ kind: "entry", entry, depth, ...(leaf ? { isLeaf: true as const } : {}) });
      // A leaf is closed by definition — `open` may still say otherwise if the
      // folder emptied since it was expanded, and the leaf wins.
      if (leaf) {
        // Visible and already listed: keep it in `needed` so the next refresh
        // re-reads it and a newly added sub-folder brings the chevron back.
        needed.push(entry.path);
        continue;
      }
      if (entry.is_dir && open[entry.path]) walk(entry.path, depth + 1);
    }
  };

  walk(rootPath, base);
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
      // A leaf has nothing to step into, the same way a file has not.
      if (row.isLeaf) return { type: "none" };
      // Closed → open it. Already open → step into it, which is where the
      // eye goes next anyway.
      // The root row is drawn expanded and has no closed state to open.
      if (!row.isRoot && !open[row.entry.path]) return { type: "open", path: row.entry.path };
      const child = entries[at + 1];
      return child && child.depth > row.depth
        ? { type: "move", path: child.entry.path }
        : { type: "none" };
    }
    case "ArrowLeft": {
      if (at < 0) return { type: "none" };
      const row = entries[at];
      // A leaf draws closed whatever `open` still says, so Left goes up a
      // level rather than closing something that does not look open.
      if (!row.isRoot && !row.isLeaf && row.entry.is_dir && open[row.entry.path]) {
        return { type: "close", path: row.entry.path };
      }
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
 * True when `path` is `rootPath` or sits under it.
 *
 * Paths are compared as strings because that is what they are here: the
 * backend hands out absolute, forward-slashed paths, and every child of a root
 * starts with it. The separator in the test is what keeps `G:/share-old` from
 * counting as inside `G:/share`.
 *
 * This is the frontend's own containment question — "is this row worth showing
 * while that root is picked" — and is not the security boundary. That is
 * `resolve_within_roots` in `src-tauri/src/docs.rs`, which canonicalizes both
 * sides and is the only thing a read is ever allowed through.
 */
export function isWithinRoot(rootPath: string, path: string): boolean {
  if (!rootPath || !path) return false;
  const root = rootPath.replace(/\/+$/, "");
  return path === root || path.startsWith(`${root}/`);
}

/**
 * The folders between `rootPath` and `path`, so a shortcut can open the tree
 * down to what it points at.
 *
 * A path outside the root yields nothing rather than guessing.
 */
export function ancestorsWithin(rootPath: string, path: string): string[] {
  if (!isWithinRoot(rootPath, path)) return [];
  const root = rootPath.replace(/\/+$/, "");
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

/**
 * `path` as written from inside `rootPath` — the form a note keeps.
 *
 * An absolute path is machine-local (`docs_root_paths`), so anything stored
 * per document is keyed by the root's id plus this, and a second machine that
 * mounts the share elsewhere still finds it. Outside the root there is no
 * relative form, and the absolute path is returned rather than a guess.
 */
export function relativeWithin(rootPath: string, path: string): string {
  if (!isWithinRoot(rootPath, path)) return path;
  const root = rootPath.replace(/\/+$/, "");
  return path === root ? "" : path.slice(root.length + 1);
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
