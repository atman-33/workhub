/**
 * What the Docs tab does with a file: render it, or hand it to the OS.
 *
 * Two callers need the answer from two different things, which is why this is
 * a module rather than a line in each component. The tree and the file-list
 * pane have a `DocsEntry` and its backend flags; the preview has only the path
 * it was told to open — a viewer window (T-0279) is launched with a path and
 * never sees the listing the path came from. Deriving both from one table is
 * what stops a file being clickable in the tree and unreadable in the pane.
 */
import type { DocsEntry } from "@/types";

/** Which renderer a file gets; `null` for one only the OS can open. */
export type PreviewKind = "markdown" | "html" | "text" | null;

const MARKDOWN_EXTENSIONS = ["md", "markdown"];
const HTML_EXTENSIONS = ["html", "htm"];

/**
 * Plain-text kinds, mirroring `TEXT_EXTENSIONS` in `src-tauri/src/docs.rs`.
 *
 * The backend's list is the one the tree's flags come from; this one answers
 * for a bare path. They are two copies of one decision, so a kind added to
 * either belongs in both — `preview-kind.test.ts` is where that is pinned.
 */
export const TEXT_EXTENSIONS = [
  "txt",
  "text",
  "log",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "csv",
  "tsv",
  "xml",
];

/** A path's extension, lower-cased and without the dot; "" when it has none. */
function extensionOf(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const cut = name.lastIndexOf(".");
  // A leading dot is the whole name (`.gitignore`), not an extension.
  return cut <= 0 ? "" : name.slice(cut + 1).toLowerCase();
}

/** What the preview would do with `path`, judged from its name alone. */
export function previewKindForPath(path: string): PreviewKind {
  const ext = extensionOf(path);
  if (MARKDOWN_EXTENSIONS.includes(ext)) return "markdown";
  if (HTML_EXTENSIONS.includes(ext)) return "html";
  if (TEXT_EXTENSIONS.includes(ext)) return "text";
  return null;
}

/**
 * True when the tab can show this entry itself.
 *
 * Reads the backend's flags rather than the name: the listing is where the
 * decision was actually made, and a second opinion here could only disagree
 * with it.
 */
export function isPreviewable(entry: DocsEntry): boolean {
  return !entry.is_dir && (entry.is_markdown || entry.is_html || entry.is_text);
}
