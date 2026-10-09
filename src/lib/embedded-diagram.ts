/**
 * What the Diagrams tab hands an editor view (Schedule, Mindmap) when it hosts
 * it (T-0680).
 *
 * Standing alone, those views own their project picker, note picker and the
 * create/rename controls. Embedded, the Diagrams tab owns all of that - one
 * list for every kind of diagram - and the view is told which note to edit.
 * The view then keeps only what is specific to editing that kind of note.
 */
export interface EmbeddedDiagram {
  /** Slug of the project the open note belongs to. */
  project: string;
  /** Absolute path of the note to edit; empty when none is open. */
  path: string;
  /** The note's title, for confirmation dialogs. */
  title: string;
  /** The view asks for another note (or none, after a delete or a rename). */
  onPathChange: (path: string) => void;
}
