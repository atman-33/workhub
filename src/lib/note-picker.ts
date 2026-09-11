import { projectOfNotePath } from "@/lib/vault-project";

/**
 * Which note the Schedule and Mindmap tabs should have open (T-0284).
 *
 * Both views used to answer this with two effects that each wrote `path`, and
 * they judged the same note by different rules: one closed a note whose
 * project had left the picker's list, the other opened the first note in the
 * file list. Nothing made the two agree, so a first file the other effect
 * rejected produced an endless clear/reopen loop — and React aborts the render
 * at 50 nested updates with an error that names neither effect.
 *
 * One rule, one writer, and a result chosen from the set the rule accepts:
 * whatever this returns is a value it would return again unchanged, so the
 * effect that applies it settles after a single write.
 */

/** The part of a `ScheduleFile` / `MindmapFile` this decision reads. */
export interface NoteChoice {
  /** Absolute path, forward slashes — the id the views hold in `path`. */
  path: string;
}

export interface OpenNoteInput<T extends NoteChoice> {
  /** The note currently open; `""` when none is. */
  path: string;
  /** The notes the picker is offering, in display order. */
  files: T[];
  /** Project slugs that still exist, as the backend spells them. */
  projects: string[];
}

/**
 * Whether a note's owning project is gone from the list.
 *
 * A path outside `projects/` has no owner to lose and is never orphaned. The
 * owner is read out of the path rather than taken from the file list entry,
 * because the note that matters most here is the open one — and narrowing the
 * picker to another project is exactly the case where it is not in the list.
 */
function orphaned(path: string, projects: string[]): boolean {
  const owner = projectOfNotePath(path);
  return owner !== "" && !projects.includes(owner);
}

/**
 * The path the view should hold, given what it currently has open and what
 * the two listings say exists.
 *
 * The open note wins while it is still offered and its project still exists;
 * otherwise the first note that is not orphaned takes over, and `""` means
 * there is nothing left to open. Callers must wait until both listings have
 * loaded — an empty list that has not loaded yet says nothing about what
 * exists, and acting on it would close the note the user was reading.
 */
export function resolveOpenNote<T extends NoteChoice>({
  path,
  files,
  projects,
}: OpenNoteInput<T>): string {
  if (path && !orphaned(path, projects) && files.some((f) => f.path === path)) {
    return path;
  }
  return files.find((f) => !orphaned(f.path, projects))?.path ?? "";
}
