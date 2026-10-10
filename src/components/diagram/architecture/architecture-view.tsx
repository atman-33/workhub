import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, Image, Maximize2, Plus, StickyNote } from "lucide-react";
import { ArchitectureCanvas } from "@/components/diagram/architecture/architecture-canvas";
import { EdgeEditor } from "@/components/diagram/architecture/edge-editor";
import { FrameEditor } from "@/components/diagram/architecture/frame-editor";
import { NodeEditor } from "@/components/diagram/architecture/node-editor";
import { OverviewPanel } from "@/components/diagram/architecture/overview-panel";
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
import {
  copyArchitectureNodes,
  pasteArchitectureNodes,
  type ArchitectureClip,
} from "@/lib/diagram/architecture/clipboard";
import { renderHtml, renderSvg } from "@/lib/diagram/architecture/export";
import { layoutArchitecture } from "@/lib/diagram/architecture/layout";
import {
  addFrame,
  addNode,
  addNodeAfter,
  autoAlign,
  connect,
  deleteEdge,
  deleteFrame,
  deleteNode,
  hasManualPositions,
  moveFrame,
  nudgeNode,
  patchFrame,
  patchNode,
  reattach,
  reparentByDrop,
  reverseEdge,
  setEdgeBidi,
  setNote,
} from "@/lib/diagram/architecture/ops";
import {
  edgeKeyOf,
  findEdge,
  findFrame,
  findNode,
  parseArchitecture,
  serializeArchitecture,
  warningCount,
  type ArchitectureDocModel,
  type ArchitectureEdge,
  type ArchitectureFrame,
  type ArchitectureNode,
} from "@/lib/diagram/architecture/parse";
import {
  DEFAULT_KIND,
  SYMBOLS,
  type NodeKind,
} from "@/lib/diagram/architecture/symbols";
import { svgToPngBase64 } from "@/lib/diagram/raster";
import { newStickyOffset } from "@/lib/diagram/architecture/sticky-spot";
import {
  nextStickyId,
  stickiesOf,
  type Sticky,
} from "@/lib/diagram/sticky";
import { SidePanel } from "@/components/diagram/panel-frame";
import type { EmbeddedDiagram } from "@/lib/embedded-diagram";
import { t as tStatic, useLocale, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Config, Task } from "@/types";

/**
 * The architecture diagram editor (T-0710), copied from the use case editor
 * (T-0707), hosted by the Diagrams tab.
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
 * What an edit *does* lives in `lib/diagram/architecture/ops`; this file only
 * decides which one a gesture calls. Which symbols exist is
 * `lib/diagram/architecture/symbols`. AI editing is hosted by the Diagrams tab
 * (T-0685): it flushes the pending save before a run, and passes `locked`
 * while the agent holds the file.
 *
 * Frames are drawn, selected, renamed, recoloured, memoed, deleted and
 * assigned in the block panel here; dragging a frame, dropping a block into
 * one and adding a block inside one are later work (T-0711).
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

/**
 * Sets an arrow's label while it is typed, so unlike `setEdgeLabel` it does not
 * trim (a space typed between two words must survive the next keystroke); the
 * serializer trims what it writes.
 */
function setLabelRaw(
  doc: ArchitectureDocModel,
  edge: { from: string; to: string; bidi: boolean },
  label: string | undefined,
): ArchitectureDocModel {
  const current = findEdge(doc.edges, edge);
  if (!current) return doc;
  const next: ArchitectureEdge = { ...current };
  if (label) next.label = label;
  else delete next.label;
  return { ...doc, edges: doc.edges.map((e) => (e === current ? next : e)) };
}

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

export function ArchitectureView({ configVersion, embedded }: Props) {
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
  const [doc, setDoc] = useState<ArchitectureDocModel | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingFrameId, setEditingFrameId] = useState<string | null>(null);
  // Node, frame, arrow and sticky selection are mutually exclusive: Delete has
  // to know which of them it is deleting.
  const [selectedStickyId, setSelectedStickyId] = useState<string | null>(null);
  const [editingStickyId, setEditingStickyId] = useState<string | null>(null);
  /** The kind a double-click on empty canvas (and the + button, when nothing is selected) adds. */
  const [palette, setPalette] = useState<NodeKind>(DEFAULT_KIND);
  const [status, setStatus] = useState("");
  const [fitToken, setFitToken] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const undoStack = useRef<ArchitectureDocModel[]>([]);
  const redoStack = useRef<ArchitectureDocModel[]>([]);
  // The raw file text and the mtime it was read at: serialization needs the
  // original bytes to preserve `## Memo` and unmanaged frontmatter, and the
  // mtime is what makes the next write conflict-safe.
  const source = useRef<{ content: string; mtime: number }>({ content: "", mtime: 0 });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The newest edit not yet written, and the note it belongs to. */
  const pending = useRef<{ path: string; doc: ArchitectureDocModel } | null>(null);
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
  const selectedFrame = useMemo(
    () => (doc && selectedFrameId ? findFrame(doc.frames, selectedFrameId) : null),
    [doc, selectedFrameId],
  );
  const selectedEdge = useMemo(
    () =>
      doc && selectedEdgeKey
        ? (doc.edges.find((e) => edgeKeyOf(e) === selectedEdgeKey) ?? null)
        : null,
    [doc, selectedEdgeKey],
  );
  /** The stickies the canvas and the exports draw: none while the note hides them. */
  const visibleStickies = useMemo(
    () => (doc && !doc.stickiesHidden ? doc.stickies : EMPTY_STICKIES),
    [doc],
  );
  const layout = useMemo(
    () => (doc ? layoutArchitecture(doc, visibleStickies) : null),
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
      setDoc(parseArchitecture(read.content, fallbackTitle.current));
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
    const content = serializeArchitecture(source.current.content, p.doc, todayISO());
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
    setEditingFrameId(null);
    setEditingStickyId(null);
  }, [locked]);

  // Opening another note: the edit still pending belongs to the one being left
  // and is written first, so the load below cannot overwrite the mtime that
  // write is guarded by.
  useEffect(() => {
    setSelectedNodeId(null);
    setSelectedFrameId(null);
    setSelectedEdgeKey(null);
    setEditingNodeId(null);
    setEditingFrameId(null);
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
    (next: ArchitectureDocModel) => {
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
    (next: ArchitectureDocModel) => {
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

  const selectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    if (id) {
      setSelectedFrameId(null);
      setSelectedEdgeKey(null);
      setSelectedStickyId(null);
    }
  }, []);

  const selectFrame = useCallback((id: string | null) => {
    setSelectedFrameId(id);
    if (id) {
      setSelectedNodeId(null);
      setSelectedEdgeKey(null);
      setSelectedStickyId(null);
    }
  }, []);

  const selectEdge = useCallback((key: string | null) => {
    setSelectedEdgeKey(key);
    if (key) {
      setSelectedNodeId(null);
      setSelectedFrameId(null);
      setSelectedStickyId(null);
    }
  }, []);

  const selectSticky = useCallback((id: string | null) => {
    setSelectedStickyId(id);
    if (id) {
      setSelectedNodeId(null);
      setSelectedFrameId(null);
      setSelectedEdgeKey(null);
    }
  }, []);

  // ---- block commands -------------------------------------------------------

  const patchSelected = useCallback(
    (id: string, patch: Partial<ArchitectureNode>) => {
      if (doc) mutate(patchNode(doc, id, patch));
    },
    [doc, mutate],
  );

  const moveNode = useCallback(
    (id: string, cx: number, cy: number) => {
      // A drop may also move the block across a frame border.
      if (doc && layout) mutate(reparentByDrop(doc, layout, id, cx, cy));
    },
    [doc, layout, mutate],
  );

  /** A finished frame drag: every member travels, in one undo entry. */
  const moveFrameBy = useCallback(
    (id: string, dx: number, dy: number) => {
      if (doc && layout) mutate(moveFrame(doc, layout, id, dx, dy));
    },
    [doc, layout, mutate],
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

  /** Adds a block of the chosen symbol where the gesture dropped it (a double-click on empty canvas, in the frame under it when there is one). */
  const addNodeAt = useCallback(
    (x: number, y: number, frameId: string | undefined) => {
      if (!doc) return;
      const added = addNode(doc, { kind: palette, ...(frameId ? { frame: frameId } : {}), x, y });
      mutate(added.doc);
      beginEditing(added.id);
    },
    [doc, palette, mutate, beginEditing],
  );

  /**
   * The toolbar's add: the chosen element after the selected block (in its
   * frame, joined to it), and unplaced - the groups put it.
   */
  const addAfter = useCallback(() => {
    if (!doc) return;
    const added = addNodeAfter(doc, selectedNodeId ?? undefined, { kind: palette });
    mutate(added.doc);
    beginEditing(added.id);
  }, [doc, selectedNodeId, palette, mutate, beginEditing]);

  const removeNode = useCallback(
    (id: string) => {
      if (!doc) return;
      mutate(deleteNode(doc, id));
      if (selectedNodeId === id) setSelectedNodeId(null);
      if (editingNodeId === id) setEditingNodeId(null);
    },
    [doc, mutate, selectedNodeId, editingNodeId],
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
        removeNode(id);
        return;
      }
      if (title !== null && next && next !== node.title) patchSelected(id, { title: next });
    },
    [doc, removeNode, patchSelected],
  );

  const changeMemo = useCallback(
    (id: string, text: string) => {
      if (doc) mutate(setNote(doc, id, text));
    },
    [doc, mutate],
  );

  // ---- frame commands -------------------------------------------------------

  const patchSelectedFrame = useCallback(
    (id: string, patch: Partial<ArchitectureFrame>) => {
      if (doc) mutate(patchFrame(doc, id, patch));
    },
    [doc, mutate],
  );

  const beginFrameEditing = useCallback(
    (id: string) => {
      freshId.current = id;
      selectFrame(id);
      setEditingFrameId(id);
    },
    [selectFrame],
  );

  /** The toolbar's frame add, and the overview panel's: an empty frame. */
  const addFrameAfter = useCallback(() => {
    if (!doc) return;
    const added = addFrame(doc, {});
    mutate(added.doc);
    beginFrameEditing(added.id);
  }, [doc, mutate, beginFrameEditing]);

  const removeFrame = useCallback(
    (id: string) => {
      if (!doc) return;
      mutate(deleteFrame(doc, id));
      if (selectedFrameId === id) setSelectedFrameId(null);
      if (editingFrameId === id) setEditingFrameId(null);
    },
    [doc, mutate, selectedFrameId, editingFrameId],
  );

  /**
   * Ends an inline frame title edit. `title === null` abandons it. A frame
   * just added and still unnamed is dropped, like a block.
   */
  const finishFrameEdit = useCallback(
    (id: string, title: string | null) => {
      setEditingFrameId(null);
      if (!doc) return;
      const frame = findFrame(doc.frames, id);
      if (!frame) return;
      const next = (title ?? frame.title).replace(/\s+/g, " ").trim();
      const fresh = freshId.current === id;
      if (fresh) freshId.current = null;
      if (!next && fresh) {
        removeFrame(id);
        return;
      }
      if (title !== null && next && next !== frame.title)
        patchSelectedFrame(id, { title: next });
    },
    [doc, removeFrame, patchSelectedFrame],
  );

  const changeFrameMemo = useCallback(
    (id: string, text: string) => {
      if (!doc) return;
      const note = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n");
      mutate(patchFrame(doc, id, { note: note === "" ? undefined : note }));
    },
    [doc, mutate],
  );

  // ---- copy and paste (T-0688) ----

  const canPaste = useHasClip("architecture", path);

  const copySelected = useCallback(
    (id: string) => {
      if (!doc) return;
      const clip = copyArchitectureNodes(doc, [id]);
      if (clip.nodes.length) setClip("architecture", path, clip);
    },
    [doc, path],
  );

  /** Adds the copies a step away from the originals and selects the first. */
  const addCopies = useCallback(
    (clip: ArchitectureClip, round: number) => {
      if (!doc || !clip.nodes.length) return;
      const out = pasteArchitectureNodes(doc, clip, round);
      mutate(out.doc);
      selectNode(out.ids[0]);
    },
    [doc, mutate, selectNode],
  );

  const pasteCopied = useCallback(() => {
    if (!doc || lockedRef.current) return;
    const clip = readClip<ArchitectureClip>("architecture", path);
    if (!clip) return;
    addCopies(clip.payload, takePasteRound("architecture", path));
  }, [doc, path, addCopies]);

  const duplicate = useCallback(
    (id: string) => {
      if (!doc) return;
      addCopies(copyArchitectureNodes(doc, [id]), 1);
    },
    [doc, addCopies],
  );

  // ---- arrow commands -------------------------------------------------------

  const connectNodes = useCallback(
    (from: string, to: string) => {
      if (!doc) return;
      const next = connect(doc, from, to, false);
      mutate(next);
      if (next !== doc) selectEdge(edgeKeyOf({ from, to, bidi: false }));
    },
    [doc, mutate, selectEdge],
  );

  const reattachEdge = useCallback(
    (edge: { from: string; to: string; bidi: boolean }, end: "from" | "to", nodeId: string) => {
      if (!doc) return;
      const next = reattach(doc, edge, end, nodeId);
      mutate(next);
      if (next === doc) return;
      selectEdge(
        edgeKeyOf({
          from: end === "from" ? nodeId : edge.from,
          to: end === "to" ? nodeId : edge.to,
          bidi: edge.bidi,
        }),
      );
    },
    [doc, mutate, selectEdge],
  );

  /** Flips a one-way arrow's direction; a two-way arrow reads the same either way. */
  const reverseSelectedEdge = useCallback(
    (edge: { from: string; to: string; bidi: boolean }) => {
      if (!doc) return;
      const next = reverseEdge(doc, edge);
      mutate(next);
      if (next !== doc) selectEdge(edgeKeyOf({ from: edge.to, to: edge.from, bidi: false }));
    },
    [doc, mutate, selectEdge],
  );

  const removeEdge = useCallback(
    (key: string) => {
      if (!doc) return;
      const edge = doc.edges.find((e) => edgeKeyOf(e) === key);
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
      if (!doc || !layout) return;
      const existing = stickiesOf(doc.stickies, targetId).length;
      const sticky: Sticky = {
        id: nextStickyId(doc.stickies),
        targetId,
        // A frame's middle is its members: the sticky goes outside its upper right.
        ...newStickyOffset(layout, targetId, existing),
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
    [doc, layout, mutate, selectSticky],
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
      if (editingNodeId || editingFrameId || editingStickyId) return;

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
      if (clipboardKey === "copy" && selectedNodeId) {
        e.preventDefault();
        copySelected(selectedNodeId);
        return;
      }
      if (e.key === "Escape") {
        setSelectedNodeId(null);
        setSelectedFrameId(null);
        setSelectedEdgeKey(null);
        setSelectedStickyId(null);
        return;
      }
      if (e.key === "Delete") {
        if (selectedStickyId) deleteSticky(selectedStickyId);
        else if (selectedEdgeKey) removeEdge(selectedEdgeKey);
        else if (selectedNodeId) removeNode(selectedNodeId);
        else if (selectedFrameId) removeFrame(selectedFrameId);
        else return;
        e.preventDefault();
        return;
      }
      if ((e.key === "F2" || e.key === "Enter") && selectedNodeId) {
        setEditingNodeId(selectedNodeId);
        e.preventDefault();
        return;
      }
      if (selectedNodeId && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const node = layout.byId.get(selectedNodeId);
        if (!node) return;
        const step = e.shiftKey ? NUDGE_BIG : NUDGE;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        mutate(nudgeNode(doc, layout, selectedNodeId, dx, dy));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    doc,
    layout,
    editingNodeId,
    editingFrameId,
    editingStickyId,
    selectedNodeId,
    selectedFrameId,
    selectedEdgeKey,
    selectedStickyId,
    deleteSticky,
    removeEdge,
    removeNode,
    removeFrame,
    mutate,
    undo,
    redo,
    copySelected,
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
        throw new Error(tStatic("diagram.architecture.noProjectFolder", { project: targetProject }));
      }
      const out = `${dir}/${exportFileName(doc.title, "architecture", "html")}`;
      await api.exportDiagramFile(
        out,
        renderHtml(doc, {
          title: doc.title,
          exportedOn: todayISO(),
          stickies: visibleStickies,
        }),
        { vaultPath, project: targetProject },
      );
      setStatus(tStatic("diagram.architecture.exportedTo", { path: out }));
      await api.openExplorer(out);
    } catch (e) {
      setStatus(String(e));
    }
  }, [doc, vaultPath, exportDir, visibleStickies, targetProject]);

  const exportPng = useCallback(async () => {
    if (!doc || !vaultPath) return;
    const svg = renderSvg(doc, {
      title: doc.title,
      stickies: visibleStickies,
    });
    try {
      const dir = await exportDir();
      if (!dir) {
        throw new Error(tStatic("diagram.architecture.noProjectFolder", { project: targetProject }));
      }
      const png = await svgToPngBase64(svg, {
        rasterize: tStatic("diagram.architecture.rasterizeFailed"),
        canvas: tStatic("diagram.architecture.noCanvasContext"),
      });
      const out = `${dir}/${exportFileName(doc.title, "architecture", "png")}`;
      await api.exportDiagramPng(out, png, { vaultPath, project: targetProject });
      setStatus(tStatic("diagram.architecture.exportedTo", { path: out }));
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
                  {t("diagram.architecture.warnings", { count: warnings })}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground">
                {t("diagram.architecture.nodeCount", { count: doc.nodes.length })}
              </span>
              {/* The symbol the next add (double-click, or + with nothing
                  selected) creates. */}
              <div className="flex items-center rounded-md border p-0.5">
                {SYMBOLS.map((symbol) => (
                  <Hint
                    key={symbol.kind}
                    label={t("diagram.architecture.paletteHint", { name: symbol.label[locale] })}
                  >
                    <Button
                      size="sm"
                      variant={palette === symbol.kind ? "secondary" : "ghost"}
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setPalette(symbol.kind as NodeKind)}
                    >
                      {symbol.label[locale]}
                    </Button>
                  </Hint>
                ))}
              </div>
              <Hint label={t("diagram.architecture.addHint")}>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addAfter}>
                  <Plus className="size-3.5" />
                </Button>
              </Hint>
              <Hint label={t("diagram.architecture.fitHint")}>
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
                      ? t("diagram.architecture.showStickiesHint", { count: stickyCount })
                      : t("diagram.architecture.hideStickiesHint", { count: stickyCount })
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
              <Hint label={t("diagram.architecture.exportHtmlHint")}>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportHtml}>
                  <Download className="size-3.5" />
                </Button>
              </Hint>
              <Hint label={t("diagram.architecture.exportPngHint")}>
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
            <ResizablePanel id="architecture-canvas" defaultSize="74%" minSize="40%" className="min-h-0">
              <div className="flex h-full min-h-0 flex-col">
                <ArchitectureCanvas
                  doc={doc}
                  stickies={visibleStickies}
                  layout={layout}
                  selectedNodeId={selectedNodeId}
                  selectedFrameId={selectedFrameId}
                  selectedEdgeKey={selectedEdgeKey}
                  selectedStickyId={selectedStickyId}
                  editingNodeId={editingNodeId}
                  editingFrameId={editingFrameId}
                  editingStickyId={editingStickyId}
                  onSelectNode={selectNode}
                  onSelectFrame={selectFrame}
                  onSelectEdge={selectEdge}
                  onSelectSticky={selectSticky}
                  onStartEditNode={setEditingNodeId}
                  onCommitNodeTitle={(id, title) => finishNodeEdit(id, title)}
                  onCancelNodeEdit={() => editingNodeId && finishNodeEdit(editingNodeId, null)}
                  onStartEditFrame={setEditingFrameId}
                  onCommitFrameTitle={(id, title) => finishFrameEdit(id, title)}
                  onCancelFrameEdit={() => editingFrameId && finishFrameEdit(editingFrameId, null)}
                  onStartEditSticky={setEditingStickyId}
                  onCommitStickyText={(id, text) => finishStickyEdit(id, text)}
                  onCancelStickyEdit={() => editingStickyId && finishStickyEdit(editingStickyId, null)}
                  onMoveSticky={(id, dx, dy) => patchSticky(id, { dx, dy })}
                  onMoveNode={moveNode}
                  onMoveFrame={moveFrameBy}
                  onAddAt={addNodeAt}
                  onConnect={connectNodes}
                  onReattach={reattachEdge}
                  fitToken={fitToken}
                  clipboard={{ canPaste, onCopy: copySelected, onDuplicate: duplicate, onPaste: pasteCopied }}
                />
                <div className="shrink-0 border-t px-3 py-1 text-[11px] text-muted-foreground">
                  {t("diagram.architecture.footerHint")}
                </div>
              </div>
            </ResizablePanel>
            <SidePanel
              id="architecture-side"
              open={embedded.sidePanelOpen}
              onOpenChange={embedded.onSidePanelOpenChange}
              defaultSize={`${SIDEBAR_DEFAULT_PCT}%`}
            >
              <div className="flex h-full min-h-0 flex-col overflow-y-auto">
                {selectedNode ? (
                  <NodeEditor
                    node={selectedNode}
                    frames={doc.frames}
                    tasks={projectTasks}
                    stickies={stickiesOf(doc.stickies, selectedNode.id)}
                    stickiesHidden={doc.stickiesHidden}
                    onAddSticky={() => addSticky(selectedNode.id)}
                    onChangeSticky={patchSticky}
                    onDeleteSticky={deleteSticky}
                    onChange={(patch) => patchSelected(selectedNode.id, patch)}
                    onChangeMemo={(text) => changeMemo(selectedNode.id, text)}
                    onDelete={() => removeNode(selectedNode.id)}
                  />
                ) : selectedFrame ? (
                  <FrameEditor
                    frame={selectedFrame}
                    memberCount={doc.nodes.filter((n) => n.frame === selectedFrame.id).length}
                    stickies={stickiesOf(doc.stickies, selectedFrame.id)}
                    stickiesHidden={doc.stickiesHidden}
                    onAddSticky={() => addSticky(selectedFrame.id)}
                    onChangeSticky={patchSticky}
                    onDeleteSticky={deleteSticky}
                    onChange={(patch) => patchSelectedFrame(selectedFrame.id, patch)}
                    onChangeMemo={(text) => changeFrameMemo(selectedFrame.id, text)}
                    onDelete={() => removeFrame(selectedFrame.id)}
                  />
                ) : selectedEdge ? (
                  <EdgeEditor
                    edge={selectedEdge}
                    from={findNode(doc.nodes, selectedEdge.from)}
                    to={findNode(doc.nodes, selectedEdge.to)}
                    onChangeLabel={(label) => mutate(setLabelRaw(doc, selectedEdge, label))}
                    onChangeBidi={(bidi) => mutate(setEdgeBidi(doc, selectedEdge, bidi))}
                    onReverse={() => reverseSelectedEdge(selectedEdge)}
                    onDelete={() => removeEdge(edgeKeyOf(selectedEdge))}
                  />
                ) : (
                  <OverviewPanel
                    canAutoAlign={hasManualPositions(doc)}
                    onAddFrame={addFrameAfter}
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
