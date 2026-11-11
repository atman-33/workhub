/**
 * The Diagram session (T-1218): one open Diagram note together with its
 * unsaved edits, undo history and the file version it was read at. React-free,
 * so the load / debounced save / undo / conflict lifecycle every diagram view
 * used to copy can be tested with a fake api and a fake clock.
 *
 * The note on disk is the source of truth. A session reads the file, parses it
 * into a model (`doc`), lets gestures replace the model, serializes back, and
 * lets the file watcher bring external edits in. Two guards make that safe:
 *
 * - **Debounced writes.** Typing a title produces a change per keystroke; each
 *   one would thrash the file and the watcher. A pending write is flushed when
 *   another note is opened or the session is closed.
 * - **mtime guarding.** Every write carries the mtime the content was read at,
 *   so an Obsidian or agent edit in between is reported, not overwritten.
 *
 * Selection, inline-edit ids, camera, side panel and export messages are not
 * here: they belong to the view.
 */

/** Quiet period after the last edit before the file is written. */
export const SAVE_DEBOUNCE_MS = 600;
/** Depth of the in-memory undo stack (Ctrl+Z). */
export const UNDO_LIMIT = 50;

/** Local date as `YYYY-MM-DD`. */
export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The file port: reading, guarded writing and external-change notification. */
export interface DiagramFileApi {
  read(path: string): Promise<{ content: string; mtime: number }>;
  /** Resolves to the new mtime; rejects when the file changed since `expectedMtime`. */
  write(path: string, content: string, expectedMtime: number): Promise<number>;
  /** Subscribes to "some Diagram note changed on disk"; returns the unsubscribe. */
  onChanged(listener: () => void): () => void;
}

/** The time port: the debounce timer and today's date for `updated`. */
export interface DiagramClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Local date as `YYYY-MM-DD`. */
  today(): string;
}

/** What differs per Kind: how a file becomes a model and back. */
export interface DiagramAdapter<Doc> {
  parse(content: string, fallbackTitle: string): Doc;
  /** `source` is the raw file text read last: it carries what the model does not (`## Memo`, unmanaged frontmatter). */
  serialize(source: string, doc: Doc, today: string): string;
}

/** What a view renders from. A new object whenever anything in it changes. */
export interface DiagramSnapshot<Doc> {
  doc: Doc | null;
  /** The last write failure (a conflict, typically); empty after a successful write. */
  saveError: string;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped when a note was opened and loaded, so the view can fit the camera. A reload of the same note does not bump it. */
  loadedToken: number;
}

/** Inputs the host changes over the session's life; read at use, never cached. */
export interface DiagramSessionInputs {
  /** The Agent lock: every write path goes quiet while true. */
  locked: boolean;
  /** Title for a note that has none of its own. */
  fallbackTitle: string;
  /** The session lets go of the note (it vanished): called with "". */
  onPathChange: (path: string) => void;
}

export interface DiagramSessionDeps<Doc> {
  api: DiagramFileApi;
  clock: DiagramClock;
  adapter: DiagramAdapter<Doc>;
  inputs?: Partial<DiagramSessionInputs>;
}

export interface DiagramSession<Doc> {
  getSnapshot(): DiagramSnapshot<Doc>;
  subscribe(listener: () => void): () => void;
  setInputs(inputs: Partial<DiagramSessionInputs>): void;
  /** Starts listening for external changes; the returned function writes any pending edit and stops. */
  attach(): () => void;
  /** Opens a note (or none, with ""): the edit pending on the previous note is written first. */
  open(path: string): void;
  /** Re-reads the open note regardless of its mtime (after an AI edit ended or was undone). */
  reload(): void;
  /** A user edit: records the previous state for undo, shows the model, schedules the write. */
  mutate(next: Doc): void;
  /** Shows a model and schedules the write without touching the undo stacks (a drag in progress). */
  preview(next: Doc): void;
  undo(): void;
  redo(): void;
  /** Writes the newest pending edit now. Safe to call with nothing pending. */
  flush(): Promise<void>;
}

export function createDiagramSession<Doc>(deps: DiagramSessionDeps<Doc>): DiagramSession<Doc> {
  const { api, clock, adapter } = deps;
  const inputs: DiagramSessionInputs = {
    locked: false,
    fallbackTitle: "",
    onPathChange: () => {},
    ...deps.inputs,
  };

  let path = "";
  let doc: Doc | null = null;
  let saveError = "";
  let loadedToken = 0;
  let undoStack: Doc[] = [];
  let redoStack: Doc[] = [];
  // The raw file text and the mtime it was read at: serialization needs the
  // original bytes, and the mtime is what makes the next write conflict-safe.
  let source = { content: "", mtime: 0 };
  let timer: unknown = null;
  /** The newest edit not yet written, and the note it belongs to. */
  let pending: { path: string; doc: Doc } | null = null;
  /** The flush of the note just left; the next load waits for it. */
  let flushing: Promise<void> = Promise.resolve();

  const listeners = new Set<() => void>();
  let snapshot: DiagramSnapshot<Doc> = build();

  function build(): DiagramSnapshot<Doc> {
    return {
      doc,
      saveError,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      loadedToken,
    };
  }

  function publish(): void {
    const next = build();
    if (
      next.doc === snapshot.doc &&
      next.saveError === snapshot.saveError &&
      next.canUndo === snapshot.canUndo &&
      next.canRedo === snapshot.canRedo &&
      next.loadedToken === snapshot.loadedToken
    ) {
      return;
    }
    snapshot = next;
    for (const l of [...listeners]) l();
  }

  async function load(
    target: string,
    { opened = false, skipUnchanged = false } = {},
  ): Promise<void> {
    if (!target) {
      doc = null;
      publish();
      return;
    }
    let read: { content: string; mtime: number };
    try {
      read = await api.read(target);
    } catch {
      // The note is no longer where it was (moved, renamed elsewhere, its
      // project archived). Letting go of the path lets the list re-resolve.
      doc = null;
      publish();
      inputs.onPathChange("");
      return;
    }
    if (target !== path) return; // the user moved on while it was read
    if (skipUnchanged && read.mtime === source.mtime) return;
    source = { content: read.content, mtime: read.mtime };
    // A reload means the file, not the user, decided the current state - the
    // stacks would otherwise let Ctrl+Z "undo" someone else's edit.
    undoStack = [];
    redoStack = [];
    doc = adapter.parse(read.content, inputs.fallbackTitle);
    if (opened) loadedToken += 1;
    publish();
  }

  async function writePending(): Promise<void> {
    if (timer !== null) {
      clock.clearTimeout(timer);
      timer = null;
    }
    const p = pending;
    pending = null;
    if (!p) return;
    const content = adapter.serialize(source.content, p.doc, clock.today());
    try {
      const mtime = await api.write(p.path, content, source.mtime);
      if (p.path === path) source = { content, mtime };
      saveError = "";
      publish();
    } catch (e) {
      // A conflict is not recoverable by retrying: the user has to see the
      // other edit before deciding, so surface it and reload.
      saveError = String(e);
      publish();
      if (p.path === path) void load(p.path);
    }
  }

  function apply(next: Doc): void {
    if (inputs.locked) return; // the agent holds the file
    doc = next;
    pending = { path, doc: next };
    if (timer !== null) clock.clearTimeout(timer);
    timer = clock.setTimeout(() => void writePending(), SAVE_DEBOUNCE_MS);
    publish();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setInputs(next) {
      Object.assign(inputs, next);
    },
    attach() {
      // External edits (Obsidian, an AI agent) arrive as events rather than
      // polling, so the canvas follows the file without a refresh button.
      const unlisten = api.onChanged(() => {
        // A pending local edit is the newer intent; letting the reload win
        // would throw away what the user typed a moment ago. The event is
        // usually the echo of our own save, which `skipUnchanged` drops.
        if (path && timer === null) void load(path, { skipUnchanged: true });
      });
      return () => {
        unlisten();
        flushing = writePending();
      };
    },
    open(next) {
      // The edit still pending belongs to the note being left and is written
      // first, so the load below cannot overwrite the mtime that write is
      // guarded by. `path` already names the new note: the old write must not
      // adopt its result as this note's source.
      path = next;
      flushing = writePending();
      void (async () => {
        await flushing;
        await load(next, { opened: true });
      })();
    },
    reload() {
      if (path) void load(path);
    },
    mutate(next) {
      if (doc === null || next === doc || inputs.locked) return;
      undoStack.push(doc);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack = [];
      apply(next);
    },
    preview: apply,
    undo() {
      const prev = undoStack.pop();
      if (prev === undefined || doc === null) return;
      redoStack.push(doc);
      apply(prev);
    },
    redo() {
      const next = redoStack.pop();
      if (next === undefined || doc === null) return;
      undoStack.push(doc);
      apply(next);
    },
    async flush() {
      await flushing;
      await writePending();
    },
  };
}
