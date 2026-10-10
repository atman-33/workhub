/**
 * Which files of a vault project's `backlog/` the Projects tab's Backlog pane
 * lists (T-0715).
 *
 * A backlog item is a folder of notes (`B-NNN-<slug>/` holding the entry note
 * that names it, numbered child notes `NNN-...`, task deliverables
 * `NNN-T-xxxx-...`, HTML files and diagram notes), or — the old shape from
 * before folder-first (T-0321) — a single `B-NNN-....md` file. Either way the
 * item's status and priority come from its entry note's frontmatter, the same
 * fields `_backlog.base` renders.
 *
 * These are pure helpers over `DocsEntry` rows and frontmatter text, kept out
 * of the component so the discovery, sorting and classification rules can be
 * pinned down by tests instead of by looking at the pane.
 */
import { isDiagramKind } from "@/lib/diagram-kinds";
import { isPreviewable } from "@/lib/docs/preview-kind";
import { splitFrontmatter } from "@/lib/docs/markdown";
import type { DocsEntry } from "@/types";

/**
 * The statuses an entry note carries (`idea | ready | doing | done |
 * dropped`), in lifecycle order. The pane filters on these; "" means no
 * filter.
 */
export const BACKLOG_STATUSES = ["idea", "ready", "doing", "done", "dropped"] as const;

/** True for a status value the filter accepts ("" shows everything). */
export function isBacklogStatusFilter(value: string): boolean {
  return value === "" || (BACKLOG_STATUSES as readonly string[]).includes(value);
}

/**
 * The `B-NNN` at the front of an item's file or folder name, or the whole
 * name when it carries no such prefix. Mirrors `id_prefix` in
 * `src-tauri/src/vault_project.rs` — the two are one decision (what names an
 * item when its entry note is missing), so a change here belongs there too.
 */
export function backlogIdPrefix(stem: string): string {
  if (!stem.startsWith("B-")) return stem;
  const digits = stem.slice(2).match(/^[0-9]+/)?.[0] ?? "";
  return digits ? `B-${digits}` : stem;
}

/** True when two backlog ids name the same item (the backend matches
 * case-insensitively in `find_backlog_item`). */
export function sameBacklogId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * A backlog id's number, for ordering. Mirrors `backlog_id_num` in
 * `src-tauri/src/vault_project.rs`.
 */
export function backlogIdNum(id: string): number | null {
  const rest = id.startsWith("B-") ? id.slice(2) : null;
  if (rest === null || !/^[0-9]+$/.test(rest)) return null;
  const n = Number(rest);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Orders two backlog ids numerically on their `B-NNN` number rather than
 * lexically, so `B-1000` sorts after `B-200`. Mirrors `backlog_id_cmp` in
 * `src-tauri/src/vault_project.rs`.
 */
export function compareBacklogIds(a: string, b: string): number {
  const x = backlogIdNum(a);
  const y = backlogIdNum(b);
  if (x !== null && y !== null) return x - y;
  if (x !== null) return -1;
  if (y !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Top-level scalar fields of a YAML frontmatter block, lower-cased keys.
 *
 * This is not a YAML parser — it reads the `key: value` lines the pane needs
 * (`id`, `title`, `status`, `priority`, `type`) and ignores the rest (lists,
 * nested maps, multiline values). Values are unquoted and cut at an inline
 * ` #` comment, the way the template writes them (`status: idea  # idea |
 * ...`). Anything fancier belongs in Obsidian, which owns the editing.
 */
export function parseFrontmatterScalars(text: string): Record<string, string> {
  const { frontmatter } = splitFrontmatter(text);
  const out: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const row = line.replace(/\r$/, "");
    // Only top-level `key: value` lines — indented lines belong to a list or
    // a nested map, and `- ` lines are list items.
    if (/^\s/.test(row) || !row.includes(":")) continue;
    const cut = row.indexOf(":");
    const key = row.slice(0, cut).trim().toLowerCase();
    if (!key || /[\s#]/.test(key)) continue;
    let value = row.slice(cut + 1).trim();
    if (!value) {
      out[key] = "";
      continue;
    }
    const quoted = /^("([^"]*)"|'([^']*)')/.exec(value);
    if (quoted) {
      out[key] = quoted[2] ?? quoted[3] ?? "";
      continue;
    }
    // An inline comment starts at a `#` preceded by whitespace.
    const comment = value.search(/\s+#/);
    if (comment >= 0) value = value.slice(0, comment).trim();
    out[key] = value;
  }
  return out;
}

/**
 * One backlog item as discovered in a `backlog/` listing: either a folder of
 * notes or a single file (the old shape).
 */
export interface BacklogDirItem {
  /** The folder name, or the file name for a single-file item. */
  name: string;
  /** True for the old shape: one `B-NNN-....md` file, not a folder. */
  isFile: boolean;
}

/** True for a `B-NNN` stem: `B-` followed by at least one digit. */
function isBacklogStem(stem: string): boolean {
  return /^B-[0-9]+/i.test(stem);
}

/**
 * Discovers the backlog items in one `backlog/` directory listing.
 *
 * Every folder counts as an item (mirroring `list_backlog_items` in the
 * backend, which falls back to the folder name when the entry note is
 * missing); a Markdown file counts when its stem carries a `B-NNN` id — the
 * old single-file shape. Dot- and underscore-prefixed rows (`_backlog.base`,
 * `.obsidian`) are never items.
 */
export function discoverBacklogItems(entries: DocsEntry[]): BacklogDirItem[] {
  const out: BacklogDirItem[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
    if (e.is_dir) {
      out.push({ name: e.name, isFile: false });
      continue;
    }
    if (!e.is_markdown) continue;
    const stem = e.name.replace(/\.[^.]*$/, "");
    if (isBacklogStem(stem)) out.push({ name: e.name, isFile: true });
  }
  out.sort((a, b) => {
    const aStem = a.isFile ? a.name.replace(/\.[^.]*$/, "") : a.name;
    const bStem = b.isFile ? b.name.replace(/\.[^.]*$/, "") : b.name;
    return (
      compareBacklogIds(backlogIdPrefix(aStem), backlogIdPrefix(bStem)) ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
  });
  return out;
}

/** One backlog item with the fields the pane shows, read off its entry note. */
export interface BacklogListItem extends BacklogDirItem {
  /** `B-NNN`, from the entry note's frontmatter or the name's prefix. */
  id: string;
  title: string;
  /** idea | ready | doing | done | dropped; "" when the note says nothing. */
  status: string;
  /** low | medium | high; "" when the note says nothing. */
  priority: string;
}

/** The file name of an item folder's entry note: the folder's own name. */
export function entryNoteName(folderName: string): string {
  return `${folderName}.md`;
}

/**
 * Builds the pane's item row from the entry note's frontmatter fields (as
 * read by `parseFrontmatterScalars`). A folder still without its entry note
 * falls back to its name, so the pane offers it rather than pretending it is
 * not there — the same fallback the backend's picker uses.
 */
export function backlogItemFromFrontmatter(
  item: BacklogDirItem,
  front: Record<string, string>,
): BacklogListItem {
  const stem = item.isFile ? item.name.replace(/\.[^.]*$/, "") : item.name;
  const id = front.id?.trim() || backlogIdPrefix(stem);
  const title = front.title?.trim() || stem;
  return {
    ...item,
    id,
    title,
    status: front.status?.trim() ?? "",
    priority: front.priority?.trim() ?? "",
  };
}

/** Keeps the items whose status matches, or all of them when `status` is "". */
export function filterBacklogItems(items: BacklogListItem[], status: string): BacklogListItem[] {
  if (!status) return items;
  return items.filter((i) => i.status === status);
}

/** What one file inside an item folder is. */
export type BacklogFileKind =
  | "entry"
  | "deliverable"
  | "child"
  | "diagram"
  | "html"
  | "note";

/**
 * Classifies one previewable file inside an item folder:
 *
 * - the entry note (the folder's own name) reads first;
 * - a note whose frontmatter `type` is a diagram kind is a diagram, whatever
 *   its name (the kind decides, not the folder — the same rule the Diagrams
 *   tab uses);
 * - `NNN-T-xxxx-...` files are task deliverables (what a finished task left
 *   behind), `NNN-...` files are child notes;
 * - HTML files render as pages; anything else previewable is a plain note.
 */
export function classifyBacklogFile(
  name: string,
  isEntry: boolean,
  frontType: string,
  isHtml: boolean,
): BacklogFileKind {
  if (isEntry) return "entry";
  if (isDiagramKind(frontType)) return "diagram";
  if (isHtml) return "html";
  const stem = name.replace(/\.[^.]*$/, "");
  if (/^[0-9]+-T-/i.test(stem)) return "deliverable";
  if (/^[0-9]+-/.test(stem)) return "child";
  return "note";
}

/** True for a row the pane offers to read: a file the preview can render. */
export function isListableBacklogFile(entry: DocsEntry): boolean {
  return isPreviewable(entry);
}

/** The entry note first, then by name — the order the pane lists files in. */
export function compareBacklogFiles(
  a: { name: string; isEntry: boolean },
  b: { name: string; isEntry: boolean },
): number {
  if (a.isEntry !== b.isEntry) return a.isEntry ? -1 : 1;
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}
