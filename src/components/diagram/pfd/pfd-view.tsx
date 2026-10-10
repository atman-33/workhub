import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, Image, Maximize2, Plus, StickyNote } from "lucide-react";
import { EdgeEditor } from "@/components/diagram/pfd/edge-editor";
import { NodeEditor } from "@/components/diagram/pfd/node-editor";
import { OverviewPanel } from "@/components/diagram/pfd/overview-panel";
import { PfdCanvas } from "@/components/diagram/pfd/pfd-canvas";
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
import { copyPfdNodes, pastePfdNodes, type PfdClip } from "@/lib/diagram/pfd/clipboard";
import { edgeKey, type EdgePort } from "@/lib/diagram/node-edge";
import { renderHtml, renderSvg } from "@/lib/diagram/pfd/export";
import { layoutPfd } from "@/lib/diagram/pfd/layout";
import {
  addNode,
  autoAlign,
  connect,
  convertNodeKind,
  deleteEdge,
  hasManualPositions,
  patchNode,
  reattach,
} from "@/lib/diagram/pfd/ops";
import {
  findNode,
  parsePfd,
  serializePfd,
  warningCount,
  type PfdDocModel,
  type PfdNode,
} from "@/lib/diagram/pfd/parse";
import { DEFAULT_PREFIX, followingSymbol, SYMBOLS } from "@/lib/diagram/pfd/symbols";
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
import { t as tStatic, useLocale, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Config, Task } from "@/types";

/**
 * The PFD editor (T-0683), hosted by the Diagrams tab.
 *
 * The same loop as the 2x2 and business-flow editors, for the same reason: the
 * note on disk is the source of truth, so this view parses the file into a
 * model, lets gestures mutate the model, serializes back, and lets the file
 * watcher bring external edits in. The two guards that make that safe are the
 * same too:
 *
 * - **Debounced writes.** Typing a title produces a change per keystroke;
 *   writing each one would thrash the file and the watcher. A pending write is
 *   flushed when the open note changes or the view goes away.
 * - **mtime guarding.** Every write carries the mtime the content was read at,
 *   so an Obsidian or agent edit in between is reported, not overwritten.
 *
 * What an edit *does* lives in `lib/diagram/pfd/ops`; this file only decides
 * which one a gesture calls. Which symbols exist, and which arrows they may
 * have between them, is `lib/diagram/pfd/symbols`. AI editing is hosted by the
 * Diagrams tab (T-0685): it flushes the pending save before a run, and passes
 * `locked` while the agent holds the file.
 */

/** Quiet period after the last edit before the file is written. */
const SAVE_DEBOUNCE_MS = 600;
/** Depth of the in-memory undo stack (Ctrl+Z). */
const UNDO_LIMIT = 50;
/** Starting width of the right column, in percent of the view. */
const SIDEBAR_DEFAULT_PCT = 26;
/** A stable empty array, so "no stickies" does not re-lay the canvas out on every render. */
const EMPTY_STICKIES: Sticky[] = [];
/** Arrow-key nudge of the selected node, in pixels. */
const NUDGE = 4;
const NUDGE_BIG = 16;

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

export function PfdView({ configVersion, embedded }: Props) {
  const t = useT();
  const locale = useLocale();
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
  const [doc, setDoc] = useState<PfdDocModel | null>(null);
  // Multi-select (T-0716): the ordered selection, last entry focused for the
  // side panel. Edge and sticky selection stay single and exclusive.
  const multi = useMultiSelect();
  const selectedNodeIds = multi.selected;
  const selectedNodeId = selectedNodeIds[selectedNodeIds.length - 1] ?? null;
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  // Node, arrow and sticky selection are mutually exclusive: Delete has to
  // know which of them it is deleting.
  const [selectedStickyId, setSelectedStickyId] = useState<string | null>(null);
  const [editingStickyId, setEditingStickyId] = useState<string | null>(null);
  /** The symbol a double-click on empty canvas (and the + button, when nothing is selected) adds. */
  const [palette, setPalette] = useState(DEFAULT_PREFIX);
  const [status, setStatus] = useState("");
  /** Why the last kind change of a node was refused; shown in that node's panel only. */
  const [kindRefusal, setKindRefusal] = useState<{ id: string; message: string } | null>(null);
  const [fitToken, setFitToken] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const undoStack = useRef<PfdDocModel[]>([]);
  const redoStack = useRef<PfdDocModel[]>([]);
  // The raw file text and the mtime it was read at: serialization needs the
  // original bytes to preserve `## Memo` and unmanaged frontmatter, and the
  // mtime is what makes the next write conflict-safe.
  const source = useRef<{ content: string; mtime: number }>({ content: "", mtime: 0 });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The newest edit not yet written, and the note it belongs to. */
  const pending = useRef<{ path: string; doc: PfdDocModel } | null>(null);
  /** The flush of the note just left; the next load waits for it. */
  const flushing = useRef<Promise<void>>(Promise.resolve());
  const pathRef = useRef(path);
  pathRef.current = path;
  /** A node added by a gesture and not named yet: abandoned if left empty. */
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

  const selectedNode = useMemo(
    () => (doc && selectedNodeId ? findNode(doc.nodes, selectedNodeId) : null),
    [doc, selectedNodeId],
  );
  const selectedEdge = useMemo(
    () =>
      doc && selectedEdgeKey
        ? (doc.edges.find((e) => edgeKey(e) === selectedEdgeKey) ?? null)
        : null,
    [doc, selectedEdgeKey],
  );
  /** The stickies the canvas and the exports draw: none while the note hides them. */
  const visibleStickies = useMemo(
    () => (doc && !doc.stickiesHidden ? doc.stickies : EMPTY_STICKIES),
    [doc],
  );
  const layout = useMemo(
    () => (doc ? layoutPfd(doc, visibleStickies) : null),
    [doc, visibleStickies],
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
      setDoc(parsePfd(read.content, fallbackTitle.current));
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
    const content = serializePfd(source.current.content, p.doc, todayISO());
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
    setEditingNodeId(null);
    setEditingStickyId(null);
  }, [locked]);

  // Opening another note: the edit still pending belongs to the one being left
  // and is written first, so the load below cannot overwrite the mtime that
  // write is guarded by.
  useEffect(() => {
    multi.clear();
    setSelectedEdgeKey(null);
    setEditingNodeId(null);
    setSelectedStickyId(null);
    setEditingStickyId(null);
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
    (next: PfdDocModel) => {
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
    (next: PfdDocModel) => {
      if (!doc || next === doc || lockedRef.current) return;
      undoStack.current.push(doc);
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      apply(next);
    },
    [doc, apply],
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev || !doc) return;
    redoStack.current.push(doc);
    apply(prev);
  }, [doc, apply]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next || !doc) return;
    undoStack.current.push(doc);
    apply(next);
  }, [doc, apply]);

  // ---- selection ------------------------------------------------------------

  /**
   * A click on a node: plain replaces the selection, Shift toggles the node.
   * A non-empty node selection clears the edge and sticky ones.
   */
  const selectNode = useCallback(
    (id: string | null, additive = false) => {
      if (id === null) multi.clear();
      else if (additive) multi.toggle(id);
      else multi.replace(id);
      if (id !== null) {
        setSelectedEdgeKey(null);
        setSelectedStickyId(null);
      }
    },
    [multi],
  );

  /** A marquee release on the canvas: the caught ids replace or join. */
  const selectMarquee = useCallback(
    (ids: readonly string[], additive: boolean) => {
      multi.marquee(ids, additive);
      if (ids.length || !additive) {
        setSelectedEdgeKey(null);
        setSelectedStickyId(null);
      }
    },
    [multi],
  );

  const clearSelection = useCallback(() => {
    multi.clear();
    setSelectedEdgeKey(null);
    setSelectedStickyId(null);
  }, [multi]);

  const selectEdge = useCallback(
    (key: string | null) => {
      setSelectedEdgeKey(key);
      if (key) {
        multi.clear();
        setSelectedStickyId(null);
      }
    },
    [multi],
  );

  const selectSticky = useCallback(
    (id: string | null) => {
      setSelectedStickyId(id);
      if (id) {
        multi.clear();
        setSelectedEdgeKey(null);
      }
    },
    [multi],
  );

  // ---- node commands --------------------------------------------------------

  const patchSelected = useCallback(
    (id: string, patch: Partial<PfdNode>) => {
      if (doc) mutate(patchNode(doc, id, patch));
    },
    [doc, mutate],
  );

  /**
   * Switches a node between process and deliverable. That is a new id, so the
   * selection (and an open title edit) moves with it; a refusal changes nothing
   * and is explained in the panel.
   */
  const convertSelectedKind = useCallback(
    (id: string, prefix: string) => {
      if (!doc) return;
      const r = convertNodeKind(doc, id, prefix);
      if (!r.ok) {
        setKindRefusal({ id, message: tStatic("diagram.pfd.kindUnknown") });
        return;
      }
      setKindRefusal(null);
      if (r.id === id) return;
      mutate(r.doc);
      multi.replace(r.id);
      if (editingNodeId === id) setEditingNodeId(r.id);
      if (freshId.current === id) freshId.current = r.id;
    },
    [doc, locale, mutate, multi, editingNodeId],
  );

  /**
   * A finished drag, single or group (T-0716): every moved node gets its new
   * `@` in one model update, so one undo step restores them all. Nodes outside
   * the move keep their positions untouched.
   */
  const moveNodes = useCallback(
    (moves: ReadonlyMap<string, { x: number; y: number }>) => {
      if (!doc || !moves.size) return;
      mutate({
        ...doc,
        nodes: doc.nodes.map((node) => {
          const at = moves.get(node.id);
          return at ? { ...node, x: Math.round(at.x), y: Math.round(at.y) } : node;
        }),
      });
    },
    [doc, mutate],
  );

  const beginEditing = useCallback(
    (id: string) => {
      freshId.current = id;
      selectNode(id);
      // A new node is empty, so it opens straight into its title box -
      // otherwise every add would be two gestures.
      setEditingNodeId(id);
    },
    [selectNode],
  );

  /** Adds a node of the chosen symbol where the gesture dropped it (a double-click on empty canvas). */
  const addNodeAt = useCallback(
    (x: number, y: number) => {
      if (!doc) return;
      const added = addNode(doc, { prefix: palette, x, y });
      mutate(added.doc);
      beginEditing(added.id);
    },
    [doc, palette, mutate, beginEditing],
  );

  /**
   * The toolbar's add. With a node selected it adds the symbol that node may
   * lead on to (a deliverable after a process and the other way about) and
   * joins them, so repeated presses build a chain; otherwise it adds the
   * chosen symbol, unplaced.
   */
  const addNodeAfter = useCallback(() => {
    if (!doc) return;
    const from = selectedNode;
    const prefix = (from && followingSymbol(from.id)?.prefix) || palette;
    const added = addNode(doc, { prefix });
    mutate(from ? connect(added.doc, from.id, added.id) : added.doc);
    beginEditing(added.id);
  }, [doc, selectedNode, palette, mutate, beginEditing]);

  const removeNodes = useCallback(
    (ids: readonly string[]) => {
      if (!doc || !ids.length) return;
      const gone = new Set(ids);
      mutate({
        ...doc,
        nodes: doc.nodes.filter((n) => !gone.has(n.id)),
        edges: doc.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
        stickies: doc.stickies.filter((s) => !gone.has(s.targetId)),
      });
      if (selectedNodeId && gone.has(selectedNodeId)) multi.clear();
      else if (selectedNodeIds.some((id) => gone.has(id)))
        multi.setSelected(selectedNodeIds.filter((id) => !gone.has(id)));
      if (editingNodeId && gone.has(editingNodeId)) setEditingNodeId(null);
    },
    [doc, mutate, selectedNodeId, selectedNodeIds, multi, editingNodeId],
  );

  /**
   * Ends an inline title edit. `title === null` abandons it. A node that was
   * just added and is still unnamed is dropped - it is created empty, and an
   * abandoned one would otherwise be a blank shape left on the diagram.
   */
  const finishNodeEdit = useCallback(
    (id: string, title: string | null) => {
      setEditingNodeId(null);
      if (!doc) return;
      const node = findNode(doc.nodes, id);
      if (!node) return;
      const next = (title ?? node.title).replace(/\s+/g, " ").trim();
      const fresh = freshId.current === id;
      if (fresh) freshId.current = null;
      if (!next && fresh) {
        removeNodes([id]);
        return;
      }
      if (title !== null && next && next !== node.title) patchSelected(id, { title: next });
    },
    [doc, removeNodes, patchSelected],
  );

  // ---- copy and paste (T-0688, multi-select T-0716) ----

  const canPaste = useHasClip("pfd", path);

  /** Copies the given nodes with the arrows inside them; Ctrl+C passes the whole selection. */
  const copyNodes = useCallback(
    (ids: readonly string[]) => {
      if (!doc) return;
      const clip = copyPfdNodes(doc, ids);
      if (clip.nodes.length) setClip("pfd", path, clip);
    },
    [doc, path],
  );

  /** Adds the copies a step away from the originals and selects them all. */
  const addCopies = useCallback(
    (clip: PfdClip, round: number) => {
      if (!doc || !clip.nodes.length) return;
      const out = pastePfdNodes(doc, clip, round);
      mutate(out.doc);
      multi.setSelected(out.ids);
    },
    [doc, mutate, multi],
  );

  const pasteCopied = useCallback(() => {
    if (!doc || lockedRef.current) return;
    const clip = readClip<PfdClip>("pfd", path);
    if (!clip) return;
    addCopies(clip.payload, takePasteRound("pfd", path));
  }, [doc, path, addCopies]);

  const duplicate = useCallback(
    (id: string) => {
      if (!doc) return;
      addCopies(copyPfdNodes(doc, [id]), 1);
    },
    [doc, addCopies],
  );

  // ---- arrow commands -------------------------------------------------------

  const connectNodes = useCallback(
    (
      from: string,
      to: string,
      ports: { fromPort?: EdgePort; toPort?: EdgePort } = {},
    ) => {
      if (!doc) return;
      const next = connect(doc, from, to, ports);
      mutate(next);
      if (next !== doc) selectEdge(edgeKey({ from, to }));
    },
    [doc, mutate, selectEdge],
  );

  const reattachEdge = useCallback(
    (
      edge: { from: string; to: string },
      end: "from" | "to",
      nodeId: string,
      port: EdgePort | null,
    ) => {
      if (!doc) return;
      const next = reattach(doc, edge, end, nodeId, port);
      mutate(next);
      if (next === doc) return;
      selectEdge(
        edgeKey({ from: end === "from" ? nodeId : edge.from, to: end === "to" ? nodeId : edge.to }),
      );
    },
    [doc, mutate, selectEdge],
  );

  const removeEdge = useCallback(
    (key: string) => {
      if (!doc) return;
      const edge = doc.edges.find((e) => edgeKey(e) === key);
      if (!edge) return;
      mutate(deleteEdge(doc, edge));
      setSelectedEdgeKey(null);
    },
    [doc, mutate],
  );

  // ---- sticky commands --------------------------------------------------------

  const patchSticky = useCallback(
    (id: string, patch: Partial<Sticky>) => {
      if (!doc) return;
      const stickies = doc.stickies.map((sticky) => {
        if (sticky.id !== id) return sticky;
        const next = { ...sticky, ...patch } as Record<string, unknown>;
        // `undefined` in a patch means "clear it".
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete next[key];
        }
        return next as unknown as Sticky;
      });
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

  /**
   * Keyboard editing, bound on the window rather than a focused element so the
   * shortcuts work straight after a click on the canvas. The app keeps every
   * tab mounted, so a view that is not on screen must not answer.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (lockedRef.current) return;
      if (!doc || !layout || !rootRef.current || rootRef.current.offsetParent === null) return;
      // Never steal a key from a field the user is typing in.
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (editingNodeId || editingStickyId) return;

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
        pasteCopied();
        return;
      }
      if (clipboardKey === "copy" && selectedNodeIds.length) {
        e.preventDefault();
        copyNodes(selectedNodeIds);
        return;
      }
      if (e.key === "Escape") {
        clearSelection();
        return;
      }
      if (e.key === "Delete") {
        if (selectedStickyId) deleteSticky(selectedStickyId);
        else if (selectedEdgeKey) removeEdge(selectedEdgeKey);
        else if (selectedNodeIds.length) removeNodes(selectedNodeIds);
        else return;
        e.preventDefault();
        return;
      }
      if ((e.key === "F2" || e.key === "Enter") && selectedNodeId) {
        setEditingNodeId(selectedNodeId);
        e.preventDefault();
        return;
      }
      if (selectedNodeIds.length && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_BIG : NUDGE;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const moves = new Map<string, { x: number; y: number }>();
        for (const id of selectedNodeIds) {
          const node = layout.byId.get(id);
          if (node) moves.set(id, { x: node.cx + dx, y: node.cy + dy });
        }
        moveNodes(moves);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    doc,
    layout,
    editingNodeId,
    editingStickyId,
    selectedNodeId,
    selectedNodeIds,
    selectedEdgeKey,
    selectedStickyId,
    clearSelection,
    deleteSticky,
    removeEdge,
    removeNodes,
    moveNodes,
    mutate,
    undo,
    redo,
    copyNodes,
    pasteCopied,
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
        throw new Error(tStatic("diagram.pfd.noProjectFolder", { project: targetProject }));
      }
      const out = `${dir}/${exportFileName(doc.title, "pfd", "html")}`;
      await api.exportDiagramFile(
        out,
        renderHtml(doc, { title: doc.title, exportedOn: todayISO(), stickies: visibleStickies }),
        { vaultPath, project: targetProject },
      );
      setStatus(tStatic("diagram.pfd.exportedTo", { path: out }));
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
        throw new Error(tStatic("diagram.pfd.noProjectFolder", { project: targetProject }));
      }
      const png = await svgToPngBase64(svg, {
        rasterize: tStatic("diagram.pfd.rasterizeFailed"),
        canvas: tStatic("diagram.pfd.noCanvasContext"),
      });
      const out = `${dir}/${exportFileName(doc.title, "pfd", "png")}`;
      await api.exportDiagramPng(out, png, { vaultPath, project: targetProject });
      setStatus(tStatic("diagram.pfd.exportedTo", { path: out }));
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
      {doc && layout && (
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
                  {t("diagram.pfd.warnings", { count: warnings })}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground">
                {t("diagram.pfd.nodeCount", { count: doc.nodes.length })}
              </span>
              {selectedNodeIds.length > 1 && (
                <span className="text-[11px] text-muted-foreground">
                  {t("diagram.multi.selectedCount", { count: selectedNodeIds.length })}
                </span>
              )}
              {/* The symbol the next add (double-click, or + with nothing
                  selected) creates. */}
              <div className="flex items-center rounded-md border p-0.5">
                {SYMBOLS.map((symbol) => (
                  <Hint
                    key={symbol.prefix}
                    label={t("diagram.pfd.paletteHint", { name: symbol.label[locale] })}
                  >
                    <Button
                      size="sm"
                      variant={palette === symbol.prefix ? "secondary" : "ghost"}
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setPalette(symbol.prefix)}
                    >
                      {symbol.label[locale]}
                    </Button>
                  </Hint>
                ))}
              </div>
              <Hint label={t("diagram.pfd.addHint")}>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addNodeAfter}>
                  <Plus className="size-3.5" />
                </Button>
              </Hint>
              <Hint label={t("diagram.pfd.fitHint")}>
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
                      ? t("diagram.pfd.showStickiesHint", { count: stickyCount })
                      : t("diagram.pfd.hideStickiesHint", { count: stickyCount })
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
              <Hint label={t("diagram.pfd.exportHtmlHint")}>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportHtml}>
                  <Download className="size-3.5" />
                </Button>
              </Hint>
              <Hint label={t("diagram.pfd.exportPngHint")}>
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
            <ResizablePanel id="pfd-canvas" defaultSize="74%" minSize="40%" className="min-h-0">
              <div className="flex h-full min-h-0 flex-col">
                <PfdCanvas
                  doc={doc}
                  stickies={visibleStickies}
                  layout={layout}
                  selectedNodeIds={selectedNodeIds}
                  selectedEdgeKey={selectedEdgeKey}
                  selectedStickyId={selectedStickyId}
                  editingNodeId={editingNodeId}
                  editingStickyId={editingStickyId}
                  fitToken={fitToken}
                  onSelectNode={selectNode}
                  onSelectMarquee={selectMarquee}
                  onSelectEdge={selectEdge}
                  onSelectSticky={selectSticky}
                  onStartEditNode={setEditingNodeId}
                  onCommitNodeTitle={(id, title) => finishNodeEdit(id, title)}
                  onCancelNodeEdit={() => editingNodeId && finishNodeEdit(editingNodeId, null)}
                  onStartEditSticky={setEditingStickyId}
                  onCommitStickyText={(id, text) => finishStickyEdit(id, text)}
                  onCancelStickyEdit={() => editingStickyId && finishStickyEdit(editingStickyId, null)}
                  onMoveSticky={(id, dx, dy) => patchSticky(id, { dx, dy })}
                  onMoveNodes={moveNodes}
                  onAddAt={addNodeAt}
                  onConnect={connectNodes}
                  onReattach={reattachEdge}
                  clipboard={{ canPaste, onCopy: (id) => copyNodes([id]), onDuplicate: duplicate, onPaste: pasteCopied }}
                />
                <div className="shrink-0 border-t px-3 py-1 text-[11px] text-muted-foreground">
                  {t("diagram.pfd.footerHint")}
                </div>
              </div>
            </ResizablePanel>
            <SidePanel
              id="pfd-side"
              open={embedded.sidePanelOpen}
              onOpenChange={embedded.onSidePanelOpenChange}
              defaultSize={`${SIDEBAR_DEFAULT_PCT}%`}
            >
              <div className="flex h-full min-h-0 flex-col overflow-y-auto">
                {selectedNode ? (
                  <NodeEditor
                    node={selectedNode}
                    tasks={projectTasks}
                    stickies={stickiesOf(doc.stickies, selectedNode.id)}
                    stickiesHidden={doc.stickiesHidden}
                    onAddSticky={() => addSticky(selectedNode.id)}
                    onChangeSticky={patchSticky}
                    onDeleteSticky={deleteSticky}
                    onChange={(patch) => patchSelected(selectedNode.id, patch)}
                    onConvertKind={(prefix) => convertSelectedKind(selectedNode.id, prefix)}
                    kindRefusal={kindRefusal?.id === selectedNode.id ? kindRefusal.message : null}
                    onDelete={() => removeNodes([selectedNode.id])}
                  />
                ) : selectedEdge ? (
                  <EdgeEditor
                    edge={selectedEdge}
                    from={findNode(doc.nodes, selectedEdge.from)}
                    to={findNode(doc.nodes, selectedEdge.to)}
                    onDelete={() => removeEdge(edgeKey(selectedEdge))}
                  />
                ) : (
                  <OverviewPanel
                    canAutoAlign={hasManualPositions(doc)}
                    onAutoAlign={() => mutate(autoAlign(doc))}
                  />
                )}
              </div>
            </SidePanel>
          </ResizablePanelGroup>
        </>
      )}
    </div>
  );
}
