import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, Image, Maximize2, Plus, StickyNote } from "lucide-react";
import { MatrixCanvas } from "@/components/diagram/matrix2x2/matrix-canvas";
import { ItemEditor } from "@/components/diagram/matrix2x2/item-editor";
import { LabelsEditor } from "@/components/diagram/matrix2x2/labels-editor";
import { QuadrantEditor } from "@/components/diagram/matrix2x2/quadrant-editor";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { api } from "@/lib/api";
import {
  clipboardShortcut,
  readClip,
  setClip,
  takePasteRound,
  useHasClip,
} from "@/lib/diagram/clipboard";
import { exportFileName } from "@/lib/diagram/export-frame";
import { copyMatrixItems, pasteMatrixItems } from "@/lib/diagram/matrix2x2/clipboard";
import { renderHtml, renderSvg } from "@/lib/diagram/matrix2x2/export";
import { layoutMatrix } from "@/lib/diagram/matrix2x2/layout";
import {
  clampUnit,
  findItem,
  nextItemId,
  parseMatrix,
  serializeMatrix,
  warningCount,
  type LabelField,
  type MatrixDocModel,
  type MatrixItem,
} from "@/lib/diagram/matrix2x2/parse";
import {
  shouldCoalesce,
  type LastNoteEdit,
  type QuadrantKey,
} from "@/lib/diagram/matrix2x2/quadrant-notes";
import { svgToPngBase64 } from "@/lib/diagram/raster";
import {
  NEW_STICKY_OFFSET,
  NEW_STICKY_STAGGER,
  nextStickyId,
  stickiesOf,
  type Sticky,
} from "@/lib/diagram/sticky";
import { SidePanel } from "@/components/diagram/panel-frame";
import { useMultiSelect } from "@/components/diagram/use-multi-select";
import type { EmbeddedDiagram } from "@/lib/embedded-diagram";
import { t as tStatic, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Config, Task } from "@/types";

/**
 * The 2x2 matrix editor (T-0681), hosted by the Diagrams tab.
 *
 * The same loop as the Mindmap tab, for the same reason: the note on disk is
 * the source of truth, so this view parses the file into a model, lets
 * gestures mutate the model, serializes back, and lets the file watcher bring
 * external edits in. The two guards that make that safe are the same too:
 *
 * - **Debounced writes.** Typing a title produces a change per keystroke;
 *   writing each one would thrash the file and the watcher. A pending write is
 *   flushed when the open note changes or the view goes away.
 * - **mtime guarding.** Every write carries the mtime the content was read at,
 *   so an Obsidian or agent edit in between is reported, not overwritten.
 *
 * AI editing is hosted by the Diagrams tab (T-0685): it flushes the pending
 * save before a run, and passes `locked` while the agent holds the file.
 */

/** Quiet period after the last edit before the file is written. */
const SAVE_DEBOUNCE_MS = 600;
/** Depth of the in-memory undo stack (Ctrl+Z). */
const UNDO_LIMIT = 50;
/** Starting width of the right column, in percent of the view. */
const SIDEBAR_DEFAULT_PCT = 26;
/** A stable empty array, so "no stickies" does not re-lay the canvas out on every render. */
const EMPTY_STICKIES: Sticky[] = [];
/** The label field that holds each quadrant's name. */
const QUADRANT_LABEL_FIELD: Record<QuadrantKey, LabelField> = {
  tl: "qTl",
  tr: "qTr",
  bl: "qBl",
  br: "qBr",
};
/** Arrow-key nudge of the selected item, in unit coordinates. */
const NUDGE = 0.01;
const NUDGE_BIG = 0.05;

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  /** Bumped by the app shell after settings are saved. */
  configVersion: number;
  /** What the Diagrams tab hands over: the open note and a way to let go of it. */
  embedded: EmbeddedDiagram;
}

export function MatrixView({ configVersion, embedded }: Props) {
  const t = useT();
  const { project, path } = embedded;
  // The host hands a fresh callback on every render; reading it through a ref
  // keeps the loaders (and the effects that depend on them) stable.
  const onPathChange = useRef(embedded.onPathChange);
  onPathChange.current = embedded.onPathChange;
  const fallbackTitle = useRef(embedded.title);
  fallbackTitle.current = embedded.title;
  // While an AI edit runs the agent holds the file (T-0685): every write path
  // goes quiet and the toolbar, canvas and side panel stop answering. Read
  // through a ref so the callbacks below stay stable.
  const locked = embedded.locked;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const registerFlush = useRef(embedded.registerFlush);
  registerFlush.current = embedded.registerFlush;
  const [config, setConfig] = useState<Config | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [doc, setDoc] = useState<MatrixDocModel | null>(null);
  // Multi-select (T-0716): the ordered selection, last entry focused for the
  // side panel. Sticky and quadrant selection stay single and exclusive.
  const multi = useMultiSelect();
  const selectedIds = multi.selected;
  const selectedId = selectedIds[selectedIds.length - 1] ?? null;
  const [editingId, setEditingId] = useState<string | null>(null);
  // Sticky selection is kept apart from item selection, and the two are
  // mutually exclusive: Delete has to know which of the two it is deleting.
  const [selectedStickyId, setSelectedStickyId] = useState<string | null>(null);
  const [editingStickyId, setEditingStickyId] = useState<string | null>(null);
  // A quadrant selected for its note (T-0692): exclusive with the two above.
  const [selectedQuadrant, setSelectedQuadrant] = useState<QuadrantKey | null>(null);
  const [status, setStatus] = useState("");
  const [fitToken, setFitToken] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const undoStack = useRef<MatrixDocModel[]>([]);
  const redoStack = useRef<MatrixDocModel[]>([]);
  /** The last quadrant-note keystroke, so a run of them is one undo step. */
  const lastNoteEdit = useRef<LastNoteEdit | null>(null);
  // The raw file text and the mtime it was read at: serialization needs the
  // original bytes to preserve `## Memo` and unmanaged frontmatter, and the
  // mtime is what makes the next write conflict-safe.
  const source = useRef<{ content: string; mtime: number }>({ content: "", mtime: 0 });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The newest edit not yet written, and the note it belongs to. */
  const pending = useRef<{ path: string; doc: MatrixDocModel } | null>(null);
  /** The flush of the note just left; the next load waits for it. */
  const flushing = useRef<Promise<void>>(Promise.resolve());
  const pathRef = useRef(path);
  pathRef.current = path;
  /** An item added by a gesture and not named yet: abandoned if left empty. */
  const freshId = useRef<string | null>(null);

  const vaultPath = config?.settings.vault_path ?? null;
  const targetProject = project;

  useEffect(() => {
    void api.getConfig().then(setConfig);
  }, [configVersion]);

  useEffect(() => {
    if (!vaultPath) return;
    void api.listTasks(vaultPath).then(setTasks);
  }, [vaultPath]);
  const projectTasks = useMemo(
    () => (project ? tasks.filter((task) => task.project === project) : tasks),
    [tasks, project],
  );

  const selected = useMemo(
    () => (doc && selectedId ? findItem(doc.items, selectedId) : null),
    [doc, selectedId],
  );
  /** The stickies the canvas and the exports draw: none while the note hides them. */
  const visibleStickies = useMemo(
    () => (doc && !doc.stickiesHidden ? doc.stickies : EMPTY_STICKIES),
    [doc],
  );

  // ---- reading and writing ------------------------------------------------

  const loadDoc = useCallback(
    async (target: string, { fit = false, skipUnchanged = false } = {}) => {
      if (!target) {
        setDoc(null);
        return;
      }
      let read: Awaited<ReturnType<typeof api.readDiagram>>;
      try {
        read = await api.readDiagram(target);
      } catch {
        // The note is no longer where it was (moved, renamed elsewhere, its
        // project archived). Letting go of the path lets the list re-resolve.
        setDoc(null);
        onPathChange.current("");
        return;
      }
      if (target !== pathRef.current) return; // the user moved on while it was read
      if (skipUnchanged && read.mtime === source.current.mtime) return;
      source.current = { content: read.content, mtime: read.mtime };
      // A reload means the file, not the user, decided the current state - the
      // stack would otherwise let Ctrl+Z "undo" someone else's edit.
      undoStack.current = [];
      redoStack.current = [];
      lastNoteEdit.current = null;
      setDoc(parseMatrix(read.content, fallbackTitle.current));
      if (fit) setFitToken((n) => n + 1);
    },
    [],
  );

  /** Writes the newest pending edit now. Safe to call with nothing pending. */
  const writePending = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    const content = serializeMatrix(source.current.content, p.doc, todayISO());
    try {
      const mtime = await api.writeDiagram(p.path, content, source.current.mtime);
      if (p.path === pathRef.current) source.current = { content, mtime };
      setStatus("");
    } catch (e) {
      // A conflict is not recoverable by retrying: the user has to see the
      // other edit before deciding, so surface it and reload.
      setStatus(String(e));
      if (p.path === pathRef.current) void loadDoc(p.path);
    }
  }, [loadDoc]);

  const reloadToken = embedded.reloadToken;
  const handledReload = useRef(reloadToken);
  useEffect(() => {
    if (reloadToken === handledReload.current) return;
    handledReload.current = reloadToken;
    if (pathRef.current) void loadDoc(pathRef.current);
  }, [reloadToken, loadDoc]);

  // The host asks for this before it starts an AI edit, so the file the agent
  // reads has everything that is on screen.
  const flush = useCallback(async () => {
    await flushing.current;
    await writePending();
  }, [writePending]);
  useEffect(() => {
    registerFlush.current(flush);
    return () => registerFlush.current(null);
  }, [flush]);

  // Entering the lock closes any inline edit: its box would sit dead under the
  // inert canvas.
  useEffect(() => {
    if (!locked) return;
    setEditingId(null);
    setEditingStickyId(null);
  }, [locked]);

  // Opening another note: the edit still pending belongs to the one being left
  // and is written first, so the load below cannot overwrite the mtime that
  // write is guarded by.
  useEffect(() => {
    multi.clear();
    setEditingId(null);
    setSelectedStickyId(null);
    setEditingStickyId(null);
    setSelectedQuadrant(null);
    freshId.current = null;
    void (async () => {
      await flushing.current;
      await loadDoc(path, { fit: true });
    })();
    return () => {
      flushing.current = writePending();
    };
  }, [path, loadDoc, writePending]);

  // External edits (Obsidian, an AI agent) arrive as events rather than
  // polling, so the canvas follows the file without a refresh button.
  useEffect(() => {
    const unlisten = listen("diagrams-changed", () => {
      // A pending local edit is the newer intent; letting the reload win would
      // throw away what the user typed a moment ago. The event is usually the
      // echo of our own save, which `skipUnchanged` drops.
      if (path && !saveTimer.current) void loadDoc(path, { skipUnchanged: true });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [path, loadDoc]);

  /** Shows a model and schedules the file write, without touching the undo stacks. */
  const apply = useCallback(
    (next: MatrixDocModel) => {
      if (lockedRef.current) return; // the agent holds the file
      setDoc(next);
      pending.current = { path, doc: next };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void writePending(), SAVE_DEBOUNCE_MS);
    },
    [path, writePending],
  );

  /** Applies a user edit: records the previous state for undo, then writes. */
  const mutate = useCallback(
    (next: MatrixDocModel) => {
      if (!doc || lockedRef.current) return;
      undoStack.current.push(doc);
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      lastNoteEdit.current = null;
      apply(next);
    },
    [doc, apply],
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev || !doc) return;
    redoStack.current.push(doc);
    lastNoteEdit.current = null;
    apply(prev);
  }, [doc, apply]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next || !doc) return;
    undoStack.current.push(doc);
    lastNoteEdit.current = null;
    apply(next);
  }, [doc, apply]);

  // ---- selection ------------------------------------------------------------

  /**
   * A click on an item: plain replaces the selection, Shift toggles the item.
   * A non-empty item selection clears the sticky and quadrant ones.
   */
  const selectItem = useCallback(
    (id: string | null, additive = false) => {
      if (id === null) multi.clear();
      else if (additive) multi.toggle(id);
      else multi.replace(id);
      if (id !== null) {
        setSelectedStickyId(null);
        setSelectedQuadrant(null);
      }
    },
    [multi],
  );

  /** A marquee release on the canvas: the caught ids replace or join. */
  const selectMarquee = useCallback(
    (ids: readonly string[], additive: boolean) => {
      multi.marquee(ids, additive);
      if (ids.length || !additive) {
        setSelectedStickyId(null);
        setSelectedQuadrant(null);
      }
    },
    [multi],
  );

  const clearSelection = useCallback(() => {
    multi.clear();
    setSelectedStickyId(null);
    setSelectedQuadrant(null);
  }, [multi]);

  const selectSticky = useCallback(
    (id: string | null) => {
      setSelectedStickyId(id);
      if (id) {
        multi.clear();
        setSelectedQuadrant(null);
      }
    },
    [multi],
  );

  const selectQuadrant = useCallback(
    (key: QuadrantKey | null) => {
      setSelectedQuadrant(key);
      if (key) {
        multi.clear();
        setSelectedStickyId(null);
      }
    },
    [multi],
  );

  // ---- item commands --------------------------------------------------------

  const patchItem = useCallback(
    (id: string, patch: Partial<MatrixItem>) => {
      if (!doc) return;
      const items = doc.items.map((item) => (item.id === id ? { ...item, ...patch } : item));
      // `undefined` in a patch means "clear it"; the spread leaves the key
      // present, which the serializer would then treat as set.
      for (const item of items) {
        if (item.id !== id) continue;
        const fields = item as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete fields[key];
        }
      }
      mutate({ ...doc, items });
    },
    [doc, mutate],
  );

  /**
   * A finished drag, single or group (T-0716): every moved item gets its new
   * `@` in one model update, so one undo step restores them all. Items outside
   * the move keep their positions untouched.
   */
  const moveItems = useCallback(
    (moves: ReadonlyMap<string, { x: number; y: number }>) => {
      if (!doc || !moves.size) return;
      const items = doc.items.map((item) => {
        const at = moves.get(item.id);
        return at ? { ...item, x: clampUnit(at.x), y: clampUnit(at.y) } : item;
      });
      mutate({ ...doc, items });
    },
    [doc, mutate],
  );

  /** Adds an item, at unit coordinates when the gesture gave a spot. */
  const addItem = useCallback(
    (at?: { x: number; y: number }) => {
      if (!doc) return;
      const item: MatrixItem = {
        id: nextItemId(doc.items),
        title: "",
        ...(at ? { x: clampUnit(at.x), y: clampUnit(at.y) } : {}),
      };
      freshId.current = item.id;
      mutate({ ...doc, items: [...doc.items, item] });
      selectItem(item.id);
      // A new item is empty, so it opens straight into its title box -
      // otherwise every add would be two gestures.
      setEditingId(item.id);
    },
    [doc, mutate, selectItem],
  );

  const deleteItems = useCallback(
    (ids: readonly string[]) => {
      if (!doc || !ids.length) return;
      const gone = new Set(ids);
      mutate({
        ...doc,
        items: doc.items.filter((item) => !gone.has(item.id)),
        // Deleting items deletes the stickies pinned to them.
        stickies: doc.stickies.filter((sticky) => !gone.has(sticky.targetId)),
      });
      if (selectedId && gone.has(selectedId)) multi.clear();
      else if (selectedIds.some((id) => gone.has(id))) multi.setSelected(selectedIds.filter((id) => !gone.has(id)));
      if (editingId && gone.has(editingId)) setEditingId(null);
    },
    [doc, mutate, selectedId, selectedIds, multi, editingId],
  );

  /**
   * Ends an inline title edit. `title === null` abandons it. An item that was
   * just added and is still unnamed is dropped - it is created empty, and an
   * abandoned one would otherwise be a blank box left on the matrix.
   */
  const finishEdit = useCallback(
    (id: string, title: string | null) => {
      setEditingId(null);
      if (!doc) return;
      const item = findItem(doc.items, id);
      if (!item) return;
      const next = (title ?? item.title).replace(/\s+/g, " ").trim();
      const fresh = freshId.current === id;
      if (fresh) freshId.current = null;
      if (!next && fresh) {
        deleteItems([id]);
        return;
      }
      if (title !== null && next && next !== item.title) patchItem(id, { title: next });
    },
    [doc, deleteItems, patchItem],
  );

  const setLabel = useCallback(
    (field: LabelField, value: string) => {
      if (!doc) return;
      mutate({ ...doc, [field]: value });
    },
    [doc, mutate],
  );

  // ---- quadrant notes (T-0692) ----

  /**
   * Edits a quadrant's note. The note is kept as typed (trailing spaces
   * included, or typing a word then a space would eat the space); the file
   * writer normalizes it. A run of edits to one quadrant is one undo step, so
   * Ctrl+Z takes back a passage rather than a keystroke.
   */
  const setQuadrantNote = useCallback(
    (key: QuadrantKey, text: string) => {
      if (!doc || lockedRef.current) return;
      if (text === doc.quadrantNotes[key]) return;
      const next = { ...doc, quadrantNotes: { ...doc.quadrantNotes, [key]: text } };
      const now = Date.now();
      if (shouldCoalesce(key, lastNoteEdit.current, now) && undoStack.current.length) {
        redoStack.current = [];
        apply(next);
      } else {
        mutate(next);
      }
      lastNoteEdit.current = { key, at: now };
    },
    [doc, apply, mutate],
  );

  // ---- copy and paste (T-0688, multi-select T-0716) ----

  const canPaste = useHasClip("matrix2x2", path);

  /** Copies the given items; Ctrl+C passes the whole selection. */
  const copyItems = useCallback(
    (ids: readonly string[]) => {
      if (!doc) return;
      const items = copyMatrixItems(doc, ids);
      if (items.length) setClip("matrix2x2", path, items);
    },
    [doc, path],
  );

  /** Adds copies of `items` a step away from the originals and selects them all. */
  const addCopies = useCallback(
    (items: MatrixItem[], round: number) => {
      if (!doc || !items.length) return;
      const out = pasteMatrixItems(doc, items, round);
      mutate(out.doc);
      multi.setSelected(out.ids);
    },
    [doc, mutate, multi],
  );

  const pasteItems = useCallback(() => {
    if (!doc || lockedRef.current) return;
    const clip = readClip<MatrixItem[]>("matrix2x2", path);
    if (!clip) return;
    addCopies(clip.payload, takePasteRound("matrix2x2", path));
  }, [doc, path, addCopies]);

  const duplicateItem = useCallback(
    (id: string) => {
      if (!doc) return;
      addCopies(copyMatrixItems(doc, [id]), 1);
    },
    [doc, addCopies],
  );

  // ---- sticky commands --------------------------------------------------------

  const patchSticky = useCallback(
    (id: string, patch: Partial<Sticky>) => {
      if (!doc) return;
      const stickies = doc.stickies.map((sticky) => (sticky.id === id ? { ...sticky, ...patch } : sticky));
      for (const sticky of stickies) {
        if (sticky.id !== id) continue;
        const fields = sticky as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete fields[key];
        }
      }
      mutate({ ...doc, stickies });
    },
    [doc, mutate],
  );

  const addSticky = useCallback(
    (targetId: string) => {
      if (!doc) return;
      const existing = stickiesOf(doc.stickies, targetId).length;
      const sticky: Sticky = {
        id: nextStickyId(doc.stickies),
        targetId,
        dx: NEW_STICKY_OFFSET.dx + existing * NEW_STICKY_STAGGER.dx,
        dy: NEW_STICKY_OFFSET.dy + existing * NEW_STICKY_STAGGER.dy,
        text: "",
      };
      // Adding a sticky while they are hidden would put it somewhere the user
      // cannot see; showing them again is the only reading of the gesture that
      // works.
      mutate({ ...doc, stickies: [...doc.stickies, sticky], stickiesHidden: false });
      selectSticky(sticky.id);
      // A new sticky is empty, so it opens straight into its editor.
      setEditingStickyId(sticky.id);
    },
    [doc, mutate, selectSticky],
  );

  const deleteSticky = useCallback(
    (id: string) => {
      if (!doc) return;
      mutate({ ...doc, stickies: doc.stickies.filter((sticky) => sticky.id !== id) });
      if (selectedStickyId === id) setSelectedStickyId(null);
      if (editingStickyId === id) setEditingStickyId(null);
    },
    [doc, mutate, selectedStickyId, editingStickyId],
  );

  /** Ends an inline sticky edit, dropping the sticky when nothing was typed. */
  const finishStickyEdit = useCallback(
    (id: string, text: string | null) => {
      setEditingStickyId(null);
      if (!doc) return;
      const sticky = doc.stickies.find((s) => s.id === id);
      if (!sticky) return;
      const next = text === null ? sticky.text : text;
      if (!next.trim()) {
        deleteSticky(id);
        return;
      }
      if (text !== null && text !== sticky.text) patchSticky(id, { text });
    },
    [doc, deleteSticky, patchSticky],
  );

  /** Shows or hides every sticky at once. Written to the note's frontmatter,
   * so it travels with the diagram and the exports match the screen. */
  const toggleStickies = useCallback(() => {
    if (!doc) return;
    mutate({ ...doc, stickiesHidden: !doc.stickiesHidden });
  }, [doc, mutate]);

  // ---- keyboard -------------------------------------------------------------

  /** Moves every selected item by a step; an unplaced one starts from where it is drawn. */
  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (!doc || !selectedIds.length) return;
      const laid = layoutMatrix(doc);
      const moves = new Map<string, { x: number; y: number }>();
      for (const id of selectedIds) {
        const at = laid.byId.get(id);
        if (at) moves.set(id, { x: at.fx + dx, y: at.fy + dy });
      }
      moveItems(moves);
    },
    [doc, selectedIds, moveItems],
  );

  /**
   * Keyboard editing, bound on the window rather than a focused element so the
   * shortcuts work straight after a click on the canvas. The app keeps every
   * tab mounted, so a view that is not on screen must not answer.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (lockedRef.current) return;
      if (!doc || !rootRef.current || rootRef.current.offsetParent === null) return;
      // Never steal a key from a field the user is typing in.
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (editingId || editingStickyId) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      const clipboardKey = clipboardShortcut(e);
      if (clipboardKey === "paste") {
        e.preventDefault();
        pasteItems();
        return;
      }
      if (clipboardKey === "copy" && selectedIds.length) {
        e.preventDefault();
        copyItems(selectedIds);
        return;
      }
      if (e.key === "Escape") {
        clearSelection();
        return;
      }
      if (e.key === "Delete" && selectedStickyId) {
        e.preventDefault();
        deleteSticky(selectedStickyId);
        return;
      }
      if (!selectedId) return;
      if (e.key === "F2" || e.key === "Enter") {
        e.preventDefault();
        setEditingId(selectedId);
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        deleteItems(selectedIds);
        return;
      }
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_BIG : NUDGE;
        // Screen up is a higher y.
        if (e.key === "ArrowLeft") nudge(-step, 0);
        else if (e.key === "ArrowRight") nudge(step, 0);
        else if (e.key === "ArrowUp") nudge(0, step);
        else nudge(0, -step);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    doc,
    editingId,
    editingStickyId,
    selectedId,
    selectedIds,
    selectedStickyId,
    clearSelection,
    deleteItems,
    deleteSticky,
    nudge,
    undo,
    redo,
    copyItems,
    pasteItems,
  ]);

  // ---- export ---------------------------------------------------------------

  /**
   * Where an export lands: the project's real `attachments/` folder, which may
   * carry a `NNNN-` sort prefix the slug never includes - resolved rather than
   * guessed (T-0379). `null` when the slug has no folder.
   */
  const exportDir = useCallback(async () => {
    if (!vaultPath || !targetProject) return null;
    const projectDir = await api.resolveProjectDir(vaultPath, targetProject);
    return projectDir ? `${projectDir}/attachments` : null;
  }, [vaultPath, targetProject]);

  const exportHtml = useCallback(async () => {
    if (!doc || !vaultPath) return;
    try {
      const dir = await exportDir();
      if (!dir) {
        throw new Error(tStatic("diagram.matrix.noProjectFolder", { project: targetProject }));
      }
      const out = `${dir}/${exportFileName(doc.title, "matrix2x2", "html")}`;
      await api.exportDiagramFile(
        out,
        renderHtml(doc, { title: doc.title, exportedOn: todayISO(), stickies: visibleStickies }),
        { vaultPath, project: targetProject },
      );
      setStatus(tStatic("diagram.matrix.exportedTo", { path: out }));
      await api.openExplorer(out);
    } catch (e) {
      setStatus(String(e));
    }
  }, [doc, vaultPath, exportDir, visibleStickies, targetProject]);

  const exportPng = useCallback(async () => {
    if (!doc || !vaultPath) return;
    const svg = renderSvg(doc, { title: doc.title, stickies: visibleStickies });
    try {
      const dir = await exportDir();
      if (!dir) {
        throw new Error(tStatic("diagram.matrix.noProjectFolder", { project: targetProject }));
      }
      const png = await svgToPngBase64(svg, {
        rasterize: tStatic("diagram.matrix.rasterizeFailed"),
        canvas: tStatic("diagram.matrix.noCanvasContext"),
      });
      const out = `${dir}/${exportFileName(doc.title, "matrix2x2", "png")}`;
      await api.exportDiagramPng(out, png, { vaultPath, project: targetProject });
      setStatus(tStatic("diagram.matrix.exportedTo", { path: out }));
      await api.openExplorer(out);
    } catch (e) {
      setStatus(String(e));
    }
  }, [doc, vaultPath, exportDir, visibleStickies, targetProject]);

  // ---- render ---------------------------------------------------------------

  const stickyCount = doc?.stickies.length ?? 0;
  const warnings = doc ? warningCount(doc) : 0;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      {doc && (
        <>
          <div
            inert={locked}
            className={cn(
              "flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5",
              locked && "opacity-60",
            )}
          >
            <span className="truncate text-xs font-medium">{doc.title}</span>
            <div className="ml-auto flex items-center gap-1.5">
              {locked && (
                <span className="text-[11px] text-amber-500">{t("diagram.aiPanel.lockedHint")}</span>
              )}
              {status && (
                <span className="max-w-72 truncate text-[11px] text-muted-foreground">{status}</span>
              )}
              {warnings > 0 && (
                <span className="text-[11px] text-amber-500">
                  {t("diagram.matrix.warnings", { count: warnings })}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground">
                {t("diagram.matrix.itemCount", { count: doc.items.length })}
              </span>
              {selectedIds.length > 1 && (
                <span className="text-[11px] text-muted-foreground">
                  {t("diagram.multi.selectedCount", { count: selectedIds.length })}
                </span>
              )}
              <Hint label={t("diagram.matrix.addHint")}>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addItem()}>
                  <Plus className="size-3.5" />
                </Button>
              </Hint>
              <Hint label={t("diagram.matrix.fitHint")}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setFitToken((n) => n + 1)}
                >
                  <Maximize2 className="size-3.5" />
                </Button>
              </Hint>
              {stickyCount > 0 && (
                <Hint
                  label={
                    doc.stickiesHidden
                      ? t("diagram.matrix.showStickiesHint", { count: stickyCount })
                      : t("diagram.matrix.hideStickiesHint", { count: stickyCount })
                  }
                >
                  <Button
                    size="sm"
                    variant={doc.stickiesHidden ? "outline" : "secondary"}
                    className="h-7 text-xs"
                    onClick={toggleStickies}
                  >
                    <StickyNote className="mr-1 size-3.5" />
                    {stickyCount}
                  </Button>
                </Hint>
              )}
              <Hint label={t("diagram.matrix.exportHtmlHint")}>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportHtml}>
                  <Download className="size-3.5" />
                </Button>
              </Hint>
              <Hint label={t("diagram.matrix.exportPngHint")}>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportPng}>
                  <Image className="size-3.5" />
                </Button>
              </Hint>
            </div>
          </div>

          <ResizablePanelGroup
            orientation="horizontal"
            inert={locked}
            className={cn("min-h-0 flex-1", locked && "opacity-60")}
          >
            <ResizablePanel id="matrix-canvas" defaultSize="74%" minSize="40%" className="min-h-0">
              <div className="flex h-full min-h-0 flex-col">
                <MatrixCanvas
                  doc={doc}
                  stickies={visibleStickies}
                  selectedIds={selectedIds}
                  selectedStickyId={selectedStickyId}
                  selectedQuadrant={selectedQuadrant}
                  editingId={editingId}
                  editingStickyId={editingStickyId}
                  fitToken={fitToken}
                  onSelect={selectItem}
                  onSelectMarquee={selectMarquee}
                  onSelectSticky={selectSticky}
                  onSelectQuadrant={selectQuadrant}
                  onStartEdit={setEditingId}
                  onCommitEdit={(id, title) => finishEdit(id, title)}
                  onCancelEdit={() => editingId && finishEdit(editingId, null)}
                  onStartEditSticky={setEditingStickyId}
                  onCommitStickyText={(id, text) => finishStickyEdit(id, text)}
                  onCancelStickyEdit={() => editingStickyId && finishStickyEdit(editingStickyId, null)}
                  onMoveSticky={(id, dx, dy) => patchSticky(id, { dx, dy })}
                  onMoveItems={moveItems}
                  onAddAt={(x, y) => addItem({ x, y })}
                  clipboard={{ canPaste, onCopy: (id) => copyItems([id]), onDuplicate: duplicateItem, onPaste: pasteItems }}
                />
                <div className="shrink-0 border-t px-3 py-1 text-[11px] text-muted-foreground">
                  {t("diagram.matrix.footerHint")}
                </div>
              </div>
            </ResizablePanel>
            <SidePanel
              id="matrix-side"
              open={embedded.sidePanelOpen}
              onOpenChange={embedded.onSidePanelOpenChange}
              defaultSize={`${SIDEBAR_DEFAULT_PCT}%`}
            >
              <div className="flex h-full min-h-0 flex-col overflow-y-auto">
                {selected ? (
                  <ItemEditor
                    item={selected}
                    tasks={projectTasks}
                    stickies={stickiesOf(doc.stickies, selected.id)}
                    stickiesHidden={doc.stickiesHidden}
                    onAddSticky={() => addSticky(selected.id)}
                    onChangeSticky={patchSticky}
                    onDeleteSticky={deleteSticky}
                    onChange={(patch) => patchItem(selected.id, patch)}
                    onDelete={() => deleteItems([selected.id])}
                  />
                ) : selectedQuadrant ? (
                  <QuadrantEditor
                    quadrant={selectedQuadrant}
                    name={doc[QUADRANT_LABEL_FIELD[selectedQuadrant]]}
                    note={doc.quadrantNotes[selectedQuadrant]}
                    onChangeName={(name) => setLabel(QUADRANT_LABEL_FIELD[selectedQuadrant], name)}
                    onChangeNote={(note) => setQuadrantNote(selectedQuadrant, note)}
                    onClearNote={() =>
                      doc &&
                      mutate({ ...doc, quadrantNotes: { ...doc.quadrantNotes, [selectedQuadrant]: "" } })
                    }
                  />
                ) : (
                  <LabelsEditor labels={doc} onChange={setLabel} />
                )}
              </div>
            </SidePanel>
          </ResizablePanelGroup>
        </>
      )}
    </div>
  );
}
