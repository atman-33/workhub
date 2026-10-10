/**
 * Which files of a vault project the Projects tab's Documents pane lists
 * (T-0714).
 *
 * The pane shows the project's shared documents — the notes at its root
 * (README, prd, roadmap, links, …) plus the notes under `dev-notes/` and
 * `shared/`, and whatever `attachments/` holds that the preview can render.
 * `backlog/` is deliberately absent: backlog items belong to the next task
 * (T-0715) and have a picker of their own.
 *
 * These are pure helpers over `DocsEntry` rows, kept out of the component so
 * the grouping and filtering rules can be pinned down by tests instead of by
 * looking at the pane.
 */
import { isPreviewable } from "@/lib/docs/preview-kind";
import { relativeWithin } from "@/lib/docs/tree-nav";
import type { DocsEntry } from "@/types";

/**
 * The subfolders whose files are listed, in display order. Anything else —
 * `backlog/`, `schedules/`, `mindmaps/`, `diagrams/` and whatever the layout
 * never named — stays out of the pane.
 */
export const PROJECT_DOC_DIRS = ["dev-notes", "shared", "attachments"] as const;

/** True for a subfolder the pane descends into. `backlog/` never qualifies. */
export function isProjectDocDir(name: string): boolean {
  return (PROJECT_DOC_DIRS as readonly string[]).includes(name);
}

/** True for a row the pane offers to read: a file the preview can render. */
export function isListableDoc(entry: DocsEntry): boolean {
  return isPreviewable(entry);
}

/** One listed group: the files at the project root, or inside one subfolder. */
export interface ProjectDocGroup {
  /** "" for the project root, otherwise the subfolder name. */
  dir: string;
  files: DocsEntry[];
}

/**
 * Groups one directory listing the way the pane shows it: previewable files
 * first (README.md ahead of the rest, then by name), and the names of the
 * listed subfolders to fetch next.
 */
export function groupProjectDocEntries(entries: DocsEntry[]): {
  groups: ProjectDocGroup[];
  subdirs: string[];
} {
  const files = entries.filter(isListableDoc).sort(compareDocFiles);
  const subdirs = entries
    .filter((e) => e.is_dir && isProjectDocDir(e.name))
    .map((e) => e.path)
    .sort();
  return { groups: [{ dir: "", files }], subdirs };
}

/** README.md reads first — it is the project's entry point — then by name. */
export function compareDocFiles(a: DocsEntry, b: DocsEntry): number {
  const aReadme = a.name.toLowerCase() === "readme.md" ? 0 : 1;
  const bReadme = b.name.toLowerCase() === "readme.md" ? 0 : 1;
  if (aReadme !== bReadme) return aReadme - bReadme;
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

/** A document's label in the list: its path relative to the project folder. */
export function docLabel(projectDir: string, path: string): string {
  return relativeWithin(projectDir, path);
}
