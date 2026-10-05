import type { Task } from "@/types";

/** Archived tasks drawn on first show, and added per "show more" click. */
export const ARCHIVE_PAGE_SIZE = 50;

export interface ArchiveLimited {
  tasks: Task[];
  /** Archived tasks in the input, shown or not. */
  archivedTotal: number;
  /** Archived tasks kept in `tasks`. */
  archivedShown: number;
}

/**
 * Caps the archived tasks at the `limit` newest (highest id) and keeps every
 * other task. The input order is preserved, so the board reads as before with
 * the oldest archived tasks missing.
 */
export function limitArchived(tasks: Task[], limit: number): ArchiveLimited {
  const archived = tasks.filter((t) => t.archived);
  if (archived.length <= limit) {
    return { tasks, archivedTotal: archived.length, archivedShown: archived.length };
  }
  const keep = new Set(
    archived
      .map((t) => t.id)
      .sort()
      .reverse()
      .slice(0, limit),
  );
  return {
    tasks: tasks.filter((t) => !t.archived || keep.has(t.id)),
    archivedTotal: archived.length,
    archivedShown: limit,
  };
}
