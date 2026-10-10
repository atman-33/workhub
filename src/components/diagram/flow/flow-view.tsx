import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, Image, Maximize2, Plus, StickyNote } from "lucide-react";
import { EdgeEditor } from "@/components/diagram/flow/edge-editor";
import { FlowCanvas } from "@/components/diagram/flow/flow-canvas";
import { LanesEditor } from "@/components/diagram/flow/lanes-editor";
import { StepEditor } from "@/components/diagram/flow/step-editor";
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
import { copyFlowSteps, pasteFlowSteps, type FlowClip } from "@/lib/diagram/flow/clipboard";
import { renderHtml, renderSvg } from "@/lib/diagram/flow/export";
import { layoutFlow } from "@/lib/diagram/flow/layout";
import {
  addLane,
  addStep,
  autoAlign,
  connect,
  deleteEdge,
  deleteLane,
  deleteStep,
  hasManualPositions,
  moveLane,
  moveStepTo,
  nudgeStep,
  patchEdge,
  patchLane,
  patchStep,
  reattach,
  stepsInLane,
} from "@/lib/diagram/flow/ops";
import {
  findStep,
  parseFlow,
  serializeFlow,
  warningCount,
  type FlowDocModel,
  type FlowStep,
} from "@/lib/diagram/flow/parse";
import { edgeKey } from "@/lib/diagram/node-edge";
import { svgToPngBase64 } from "@/lib/diagram/raster";
import {
  NEW_STICKY_OFFSET,
  NEW_STICKY_STAGGER,
  nextStickyId,
  stickiesOf,
  type Sticky,
} from "@/lib/diagram/sticky";
import { SidePanel } from "@/components/diagram/panel-frame";
import type { EmbeddedDiagram } from "@/lib/embedded-diagram";
import { t as tStatic, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Config, Task } from "@/types";

/**
 * The business-flow editor (T-0682), hosted by the Diagrams tab.
 *
 * The same loop as the 2x2 and Mindmap editors, for the same reason: the note
 * on disk is the source of truth, so this view parses the file into a model,
 * lets gestures mutate the model, serializes back, and lets the file watcher
 * bring external edits in. The two guards that make that safe are the same too:
 *
 * - **Debounced writes.** Typing a title produces a change per keystroke;
 *   writing each one would thrash the file and the watcher. A pending write is
 *   flushed when the open note changes or the view goes away.
 * - **mtime guarding.** Every write carries the mtime the content was read at,
 *   so an Obsidian or agent edit in between is reported, not overwritten.
 *
 * What an edit *does* lives in `lib/diagram/flow/ops`; this file only decides
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
/** Arrow-key nudge of the selected step, in pixels. */
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

export function FlowView({ configVersion, embedded }: Props) {
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
  const [doc, setDoc] = useState<FlowDocModel | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editingEdgeKey, setEditingEdgeKey] = useState<string | null>(null);
  // Step, arrow and sticky selection are mutually exclusive: Delete has to
  // know which of them it is deleting.
  const [selectedStickyId, setSelectedStickyId] = useState<string | null>(null);
  const [editingStickyId, setEditingStickyId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [fitToken, setFitToken] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const undoStack = useRef<FlowDocModel[]>([]);
  const redoStack = useRef<FlowDocModel[]>([]);
  // The raw file text and the mtime it was read at: serialization needs the
  // original bytes to preserve `## Memo` and unmanaged frontmatter, and the
  // mtime is what makes the next write conflict-safe.
  const source = useRef<{ content: string; mtime: number }>({ content: "", mtime: 0 });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The newest edit not yet written, and the note it belongs to. */
  const pending = useRef<{ path: string; doc: FlowDocModel } | null>(null);
  /** The flush of the note just left; the next load waits for it. */
  const flushing = useRef<Promise<void>>(Promise.resolve());
  const pathRef = useRef(path);
  pathRef.current = path;
  /** A step added by a gesture and not named yet: abandoned if left empty. */
  const freshId = useRef<string | null>(null);

  const vaultPath = config?.settings.vault_path ?? null;
  const targetProject = project;
  const unassignedLabel = t("diagram.flow.unassigned");

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

  const selectedStep = useMemo(
    () => (doc && selectedStepId ? findStep(doc.steps, selectedStepId) : null),
    [doc, selectedStepId],
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
    () => (doc ? layoutFlow(doc, visibleStickies, { unassignedLabel }) : null),
    [doc, visibleStickies, unassignedLabel],
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
      setDoc(parseFlow(read.content, fallbackTitle.current));
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
    const content = serializeFlow(source.current.content, p.doc, todayISO());
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
    setEditingStepId(null);
    setEditingEdgeKey(null);
    setEditingStickyId(null);
  }, [locked]);

  // Opening another note: the edit still pending belongs to the one being left
  // and is written first, so the load below cannot overwrite the mtime that
  // write is guarded by.
  useEffect(() => {
    setSelectedStepId(null);
    setSelectedEdgeKey(null);
    setEditingStepId(null);
    setEditingEdgeKey(null);
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
    (next: FlowDocModel) => {
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
    (next: FlowDocModel) => {
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

  const selectStep = useCallback((id: string | null) => {
    setSelectedStepId(id);
    if (id) {
      setSelectedEdgeKey(null);
      setSelectedStickyId(null);
    }
  }, []);

  const selectEdge = useCallback((key: string | null) => {
    setSelectedEdgeKey(key);
    if (key) {
      setSelectedStepId(null);
      setSelectedStickyId(null);
    }
  }, []);

  const selectSticky = useCallback((id: string | null) => {
    setSelectedStickyId(id);
    if (id) {
      setSelectedStepId(null);
      setSelectedEdgeKey(null);
    }
  }, []);

  // ---- step commands --------------------------------------------------------

  const patchSelected = useCallback(
    (id: string, patch: Partial<FlowStep>) => {
      if (doc) mutate(patchStep(doc, id, patch));
    },
    [doc, mutate],
  );

  const changeLane = useCallback(
    (id: string, lane: string | undefined) => {
      if (!doc) return;
      const step = findStep(doc.steps, id);
      if (!step) return;
      // An offset measured from the old lane's middle means nothing in the new one.
      mutate(patchStep(doc, id, { lane, ...(step.x !== undefined ? { y: 0 } : {}) }));
    },
    [doc, mutate],
  );

  const moveStep = useCallback(
    (id: string, cx: number, cy: number) => {
      if (doc && layout) mutate(moveStepTo(doc, layout, id, cx, cy));
    },
    [doc, layout, mutate],
  );

  const beginEditing = useCallback(
    (id: string) => {
      freshId.current = id;
      selectStep(id);
      // A new step is empty, so it opens straight into its title box -
      // otherwise every add would be two gestures.
      setEditingStepId(id);
    },
    [selectStep],
  );

  /** Adds a step where the gesture dropped it (a double-click on a lane). */
  const addStepAt = useCallback(
    (bandKey: string, x: number, y: number) => {
      if (!doc) return;
      const added = addStep(doc, { ...(bandKey ? { lane: bandKey } : {}), x, y });
      mutate(added.doc);
      beginEditing(added.id);
    },
    [doc, mutate, beginEditing],
  );

  /** The toolbar's add: next to the selected step, and joined to it. */
  const addStepAfter = useCallback(() => {
    if (!doc) return;
    const from = selectedStep;
    const lane = from?.lane && doc.lanes.some((l) => l.id === from.lane) ? from.lane : doc.lanes[0]?.id;
    const added = addStep(doc, lane ? { lane } : {});
    mutate(from ? connect(added.doc, from.id, added.id) : added.doc);
    beginEditing(added.id);
  }, [doc, selectedStep, mutate, beginEditing]);

  const removeStep = useCallback(
    (id: string) => {
      if (!doc) return;
      mutate(deleteStep(doc, id));
      if (selectedStepId === id) setSelectedStepId(null);
      if (editingStepId === id) setEditingStepId(null);
    },
    [doc, mutate, selectedStepId, editingStepId],
  );

  /**
   * Ends an inline title edit. `title === null` abandons it. A step that was
   * just added and is still unnamed is dropped - it is created empty, and an
   * abandoned one would otherwise be a blank box left on the diagram.
   */
  const finishStepEdit = useCallback(
    (id: string, title: string | null) => {
      setEditingStepId(null);
      if (!doc) return;
      const step = findStep(doc.steps, id);
      if (!step) return;
      const next = (title ?? step.title).replace(/\s+/g, " ").trim();
      const fresh = freshId.current === id;
      if (fresh) freshId.current = null;
      if (!next && fresh) {
        removeStep(id);
        return;
      }
      if (title !== null && next && next !== step.title) patchSelected(id, { title: next });
    },
    [doc, removeStep, patchSelected],
  );

  // ---- copy and paste (T-0688) ----

  const canPaste = useHasClip("flow", path);

  const copySelected = useCallback(
    (id: string) => {
      if (!doc) return;
      const clip = copyFlowSteps(doc, [id]);
      if (clip.steps.length) setClip("flow", path, clip);
    },
    [doc, path],
  );

  /** Adds the copies a step away from the originals and selects the first. */
  const addCopies = useCallback(
    (clip: FlowClip, round: number) => {
      if (!doc || !clip.steps.length) return;
      const out = pasteFlowSteps(doc, clip, round);
      mutate(out.doc);
      selectStep(out.ids[0]);
    },
    [doc, mutate, selectStep],
  );

  const pasteCopied = useCallback(() => {
    if (!doc || lockedRef.current) return;
    const clip = readClip<FlowClip>("flow", path);
    if (!clip) return;
    addCopies(clip.payload, takePasteRound("flow", path));
  }, [doc, path, addCopies]);

  const duplicate = useCallback(
    (id: string) => {
      if (!doc) return;
      addCopies(copyFlowSteps(doc, [id]), 1);
    },
    [doc, addCopies],
  );

  // ---- arrow commands -------------------------------------------------------

  const connectSteps = useCallback(
    (from: string, to: string) => {
      if (!doc) return;
      const next = connect(doc, from, to);
      mutate(next);
      if (next !== doc) selectEdge(edgeKey({ from, to }));
    },
    [doc, mutate, selectEdge],
  );

  const reattachEdge = useCallback(
    (edge: { from: string; to: string }, end: "from" | "to", nodeId: string) => {
      if (!doc) return;
      const next = reattach(doc, edge, end, nodeId);
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
      setEditingEdgeKey(null);
    },
    [doc, mutate],
  );

  const setEdgeLabel = useCallback(
    (key: string, label: string) => {
      setEditingEdgeKey(null);
      if (!doc) return;
      const edge = doc.edges.find((e) => edgeKey(e) === key);
      if (!edge) return;
      const next = label.replace(/\s+/g, " ").trim();
      if (next !== (edge.label ?? "")) mutate(patchEdge(doc, edge, { label: next || undefined }));
    },
    [doc, mutate],
  );

  // ---- lane commands --------------------------------------------------------

  const laneStepCount = useCallback((id: string) => (doc ? stepsInLane(doc, id) : 0), [doc]);

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
      if (editingStepId || editingEdgeKey || editingStickyId) return;

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
      if (clipboardKey === "copy" && selectedStepId) {
        e.preventDefault();
        copySelected(selectedStepId);
        return;
      }
      if (e.key === "Escape") {
        setSelectedStepId(null);
        setSelectedEdgeKey(null);
        setSelectedStickyId(null);
        return;
      }
      if (e.key === "Delete") {
        if (selectedStickyId) deleteSticky(selectedStickyId);
        else if (selectedEdgeKey) removeEdge(selectedEdgeKey);
        else if (selectedStepId) removeStep(selectedStepId);
        else return;
        e.preventDefault();
        return;
      }
      if (e.key === "F2" || e.key === "Enter") {
        if (selectedStepId) setEditingStepId(selectedStepId);
        else if (selectedEdgeKey) setEditingEdgeKey(selectedEdgeKey);
        else return;
        e.preventDefault();
        return;
      }
      if (selectedStepId && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_BIG : NUDGE;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        mutate(nudgeStep(doc, layout, selectedStepId, dx, dy));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    doc,
    layout,
    editingStepId,
    editingEdgeKey,
    editingStickyId,
    selectedStepId,
    selectedEdgeKey,
    selectedStickyId,
    deleteSticky,
    removeEdge,
    removeStep,
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
        throw new Error(tStatic("diagram.flow.noProjectFolder", { project: targetProject }));
      }
      const out = `${dir}/${exportFileName(doc.title, "flow", "html")}`;
      await api.exportDiagramFile(
        out,
        renderHtml(doc, {
          title: doc.title,
          exportedOn: todayISO(),
          stickies: visibleStickies,
          unassignedLabel: tStatic("diagram.flow.unassigned"),
        }),
        { vaultPath, project: targetProject },
      );
      setStatus(tStatic("diagram.flow.exportedTo", { path: out }));
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
      unassignedLabel: tStatic("diagram.flow.unassigned"),
    });
    try {
      const dir = await exportDir();
      if (!dir) {
        throw new Error(tStatic("diagram.flow.noProjectFolder", { project: targetProject }));
      }
      const png = await svgToPngBase64(svg, {
        rasterize: tStatic("diagram.flow.rasterizeFailed"),
        canvas: tStatic("diagram.flow.noCanvasContext"),
      });
      const out = `${dir}/${exportFileName(doc.title, "flow", "png")}`;
      await api.exportDiagramPng(out, png, { vaultPath, project: targetProject });
      setStatus(tStatic("diagram.flow.exportedTo", { path: out }));
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
                  {t("diagram.flow.warnings", { count: warnings })}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground">
                {t("diagram.flow.stepCount", { count: doc.steps.length })}
              </span>
              <Hint label={t("diagram.flow.addHint")}>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addStepAfter}>
                  <Plus className="size-3.5" />
                </Button>
              </Hint>
              <Hint label={t("diagram.flow.fitHint")}>
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
                      ? t("diagram.flow.showStickiesHint", { count: stickyCount })
                      : t("diagram.flow.hideStickiesHint", { count: stickyCount })
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
              <Hint label={t("diagram.flow.exportHtmlHint")}>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportHtml}>
                  <Download className="size-3.5" />
                </Button>
              </Hint>
              <Hint label={t("diagram.flow.exportPngHint")}>
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
            <ResizablePanel id="flow-canvas" defaultSize="74%" minSize="40%" className="min-h-0">
              <div className="flex h-full min-h-0 flex-col">
                <FlowCanvas
                  doc={doc}
                  stickies={visibleStickies}
                  layout={layout}
                  unassignedLabel={unassignedLabel}
                  selectedStepId={selectedStepId}
                  selectedEdgeKey={selectedEdgeKey}
                  selectedStickyId={selectedStickyId}
                  editingStepId={editingStepId}
                  editingEdgeKey={editingEdgeKey}
                  editingStickyId={editingStickyId}
                  fitToken={fitToken}
                  onSelectStep={selectStep}
                  onSelectEdge={selectEdge}
                  onSelectSticky={selectSticky}
                  onStartEditStep={setEditingStepId}
                  onCommitStepTitle={(id, title) => finishStepEdit(id, title)}
                  onCancelStepEdit={() => editingStepId && finishStepEdit(editingStepId, null)}
                  onStartEditEdge={setEditingEdgeKey}
                  onCommitEdgeLabel={setEdgeLabel}
                  onCancelEdgeEdit={() => setEditingEdgeKey(null)}
                  onStartEditSticky={setEditingStickyId}
                  onCommitStickyText={(id, text) => finishStickyEdit(id, text)}
                  onCancelStickyEdit={() => editingStickyId && finishStickyEdit(editingStickyId, null)}
                  onMoveSticky={(id, dx, dy) => patchSticky(id, { dx, dy })}
                  onMoveStep={moveStep}
                  onAddAt={addStepAt}
                  onConnect={connectSteps}
                  onReattach={reattachEdge}
                  clipboard={{ canPaste, onCopy: copySelected, onDuplicate: duplicate, onPaste: pasteCopied }}
                />
                <div className="shrink-0 border-t px-3 py-1 text-[11px] text-muted-foreground">
                  {t("diagram.flow.footerHint")}
                </div>
              </div>
            </ResizablePanel>
            <SidePanel
              id="flow-side"
              open={embedded.sidePanelOpen}
              onOpenChange={embedded.onSidePanelOpenChange}
              defaultSize={`${SIDEBAR_DEFAULT_PCT}%`}
            >
              <div className="flex h-full min-h-0 flex-col overflow-y-auto">
                {selectedStep ? (
                  <StepEditor
                    step={selectedStep}
                    lanes={doc.lanes}
                    tasks={projectTasks}
                    stickies={stickiesOf(doc.stickies, selectedStep.id)}
                    stickiesHidden={doc.stickiesHidden}
                    onAddSticky={() => addSticky(selectedStep.id)}
                    onChangeSticky={patchSticky}
                    onDeleteSticky={deleteSticky}
                    onChange={(patch) => patchSelected(selectedStep.id, patch)}
                    onChangeLane={(lane) => changeLane(selectedStep.id, lane)}
                    onDelete={() => removeStep(selectedStep.id)}
                  />
                ) : selectedEdge ? (
                  <EdgeEditor
                    edge={selectedEdge}
                    from={findStep(doc.steps, selectedEdge.from)}
                    to={findStep(doc.steps, selectedEdge.to)}
                    onChange={(patch) => mutate(patchEdge(doc, selectedEdge, patch))}
                    onDelete={() => removeEdge(edgeKey(selectedEdge))}
                  />
                ) : (
                  <LanesEditor
                    lanes={doc.lanes}
                    stepCount={laneStepCount}
                    canAutoAlign={hasManualPositions(doc)}
                    onAdd={() => mutate(addLane(doc, t("diagram.flow.newLane")).doc)}
                    onChange={(id, patch) => mutate(patchLane(doc, id, patch))}
                    onMove={(id, direction) => mutate(moveLane(doc, id, direction))}
                    onDelete={(id) => mutate(deleteLane(doc, id))}
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
