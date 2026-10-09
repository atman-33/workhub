/**
 * What the Diagrams tab hands an editor view (every kind) when it hosts
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
  /** True while an AI edit holds the file (T-0685): the editor must not write,
   * and should stop answering gestures, keys and toolbar buttons. */
  locked: boolean;
  /**
   * The editor hands the host a function that writes its pending (debounced)
   * save now, or `null` when it goes away. The host calls it before it starts
   * an AI edit, so the file the agent reads has what is on screen. The host's
   * callbacks are new on every render: call `registerFlush` through a ref.
   */
  registerFlush: (flush: (() => Promise<void>) | null) => void;
  /** Bumped by the host after an AI edit ends or is undone: reload the note
   * from disk even if the file watcher's event was missed or the mtime did
   * not change. */
  reloadToken: number;
}
