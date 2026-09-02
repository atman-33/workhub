import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Check,
  Copy,
  Download,
  FolderPlus,
  Image,
  Maximize2,
  Pencil,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
} from "lucide-react";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { MindmapAiPanel } from "@/components/mindmap/mindmap-ai-panel";
import { ChipSettings } from "@/components/mindmap/chip-settings";
import {
  MindmapCanvas,
  type NodeAbilities,
  type NodeAction,
} from "@/components/mindmap/mindmap-canvas";
import { NodeEditor } from "@/components/mindmap/node-editor";
import { ProjectCreateDialog } from "@/components/schedule/project-create-dialog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import type { TabFocus } from "@/lib/tab-focus";
import { projectOfNotePath } from "@/lib/vault-project";
import { readViewState, writeViewState } from "@/lib/view-state";
import { toHtml, toSvg } from "@/lib/mindmap/export";
import { toMermaidBlock } from "@/lib/mindmap/mermaid";
import {
  chipCommand,
  quickAttrGroups,
  quickAttrToggle,
  type AttrChip,
  type ChipAction,
} from "@/lib/mindmap/attrs";
import type { PositionedNode } from "@/lib/mindmap/layout";
import {
  attrKeys as attrKeysOf,
  attrValues,
  canIndent,
  canMoveSibling,
  canOutdent,
  cloneNodes,
  DEFAULT_ATTR_VIEW,
  findNode,
  findParent,
  freezeRootChildSides,
  indentNode,
  moveNode,
  moveSibling,
  nextNodeId,
  outdentNode,
  parseMindmap,
  serializeMindmap,
  nextStickyId,
  stickiesOf,
  subtreeIds,
  visit,
  NODE_WIDTHS,
  type AttrView,
  type MindmapDocModel,
  type MindmapNode,
  type NodeWidth,
  type Sticky,
} from "@/lib/mindmap/parse";
import type { Config, MindmapEditRun, MindmapFile, Task } from "@/types";

/**
 * The Mindmap tab (T-0188).
 *
 * Built as the same loop as the Schedule tab, for the same reason: the note on
 * disk is the source of truth, so this view parses the file into a model, lets
 * gestures mutate the model, serializes back, and lets the file watcher bring
 * external edits in. The two guards that make that safe are also the same:
 *
 * - **Debounced writes.** Typing a title produces a change per keystroke;
 *   writing each one would thrash the file and the watcher.
 * - **mtime guarding.** Every write carries the mtime the content was read at,
 *   so an Obsidian or agent edit in between is reported, not overwritten.
 *
 * What is *not* stored is node positions: the canvas lays the tree out from
 * the file every time it draws it. That is what keeps the note a plain nested
 * bullet list a human can edit, and it is why there is no "arrange" command
 * here — there is nothing to arrange.
 */

/** Quiet period after the last edit before the file is written. */
const SAVE_DEBOUNCE_MS = 600;
/** Depth of the in-memory undo stack (Ctrl+Z). Deep enough to walk back out of
 * a run of experiments, shallow enough that it is obviously not a substitute
 * for the file's git history. */
const UNDO_LIMIT = 50;
/** Starting width of the right column, in percent of the view. */
const SIDEBAR_DEFAULT_PCT = 24;

/**
 * Where a newly added sticky lands, as an offset from its node's centre, and
 * how far each further sticky on the same node is staggered from the last.
 *
 * Far enough to the right of a normal box that the paper does not start life
 * on top of the node it annotates; staggered so that adding three in a row
 * gives three readable notes rather than one pile.
 */
const NEW_STICKY_OFFSET = { dx: 96, dy: 24 };
const NEW_STICKY_STAGGER = { dx: 14, dy: 18 };

/** Wording for the box-width picker. The stored values stay short because they
 * are written into the note's frontmatter, where a human reads them too. */
const NODE_WIDTH_LABEL: Record<NodeWidth, string> = {
  auto: "Auto width",
  siblings: "Even siblings",
  depth: "Even by level",
};

/** Sentinel values for the pickers — Radix rejects an empty string. */
/** Key this view's remembered project/note are stored under. */
const VIEW_ID = "mindmap";

const ALL_PROJECTS = "__all__";
const NEW_PROJECT = "__new__";

/** A stable empty array, so "no stickies" does not re-trigger the canvas's
 * layout effect on every render. */
const EMPTY_STICKIES: Sticky[] = [];
/** Shared empty list, so a map with no attributes hands out one stable
 * identity instead of a new array on every render. */
const EMPTY_KEYS: string[] = [];
/** Sentinel for the "off" option of the attribute selects — Radix rejects an
 * empty string as an item value. */
const ATTR_NONE = "__none__";

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  /** Bumped by the app shell after settings are saved. */
  configVersion: number;
  /** Bumped by the Projects tab after a project is created, archived or
   * restored; reloads the project picker (T-0190). */
  projectsVersion?: number;
  /** A project the Projects tab asked this view to open (T-0190). */
  focus?: TabFocus;
}

export function MindmapView({ configVersion, projectsVersion = 0, focus }: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  // Restored from the last session, so a restart lands back on the map that was
  // being worked on rather than on whatever the scan happens to list first.
  const [project, setProject] = useState(() => readViewState(VIEW_ID).project);
  const [files, setFiles] = useState<MindmapFile[]>([]);
  // An empty list before the first scan means "unknown", not "no notes" — the
  // auto-open below must not read it as a reason to drop the restored path.
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [path, setPath] = useState(() => readViewState(VIEW_ID).path);
  const [doc, setDoc] = useState<MindmapDocModel | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Sticky selection is kept apart from node selection, and the two are
  // mutually exclusive: Delete has to know which of the two it is deleting.
  const [selectedStickyId, setSelectedStickyId] = useState<string | null>(null);
  const [editingStickyId, setEditingStickyId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [fitToken, setFitToken] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRun, setAiRun] = useState<MindmapEditRun | null>(null);

  const undoStack = useRef<MindmapDocModel[]>([]);
  const redoStack = useRef<MindmapDocModel[]>([]);
  // The raw file text and the mtime it was read at: serialization needs the
  // original bytes to preserve `## Memo` and unmanaged frontmatter, and the
  // mtime is what makes the next write conflict-safe.
  const source = useRef<{ content: string; mtime: number }>({ content: "", mtime: 0 });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const vaultPath = config?.settings.vault_path ?? null;
  const aiRunning = aiRun?.state === "running";
  const selected = useMemo(
    () => (doc && selectedId ? findNode(doc.roots, selectedId) : null),
    [doc, selectedId],
  );
  /**
   * The stickies the canvas and the exports draw: none while the note hides
   * them. Memoized because the canvas re-lays the map out whenever this array
   * changes identity.
   */
  const visibleStickies = useMemo(
    () => (doc && !doc.stickiesHidden ? doc.stickies : EMPTY_STICKIES),
    [doc],
  );
  /**
   * The attribute view the canvas and the exports both lay out with.
   *
   * Memoized for the same reason `visibleStickies` is: the canvas re-lays the
   * map out whenever this object changes identity, and `doc.attrView` is a
   * fresh object on every parse.
   */
  const attrView = useMemo<AttrView>(() => doc?.attrView ?? DEFAULT_ATTR_VIEW, [doc]);
  /** The map's own attribute vocabulary, for the toolbar and the editor. */
  const attrKeys = useMemo(() => (doc ? attrKeysOf(doc.roots) : EMPTY_KEYS), [doc]);
  const attrValuesFor = useCallback(
    (key: string) => (doc ? attrValues(doc.roots, key) : EMPTY_KEYS),
    [doc],
  );
  /** Every `key=value` the filter can be set to, in the order it offers them. */
  const attrFilterOptions = useMemo(
    () =>
      attrKeys.flatMap((key) =>
        attrValuesFor(key).map((value) => ({ key, value, id: `${key}=${value}` })),
      ),
    [attrKeys, attrValuesFor],
  );
  const current = files.find((f) => f.path === path) ?? null;
  const targetProject = project || current?.project || projects[0] || "";

  // A project handed over by the Projects tab. Keyed on the request counter
  // rather than the object, so a parent re-render never re-applies it over a
  // project the user picked here since.
  const focusN = focus?.n ?? 0;
  const focusProject = focus?.value ?? "";
  useEffect(() => {
    if (focusN > 0 && focusProject) setProject(focusProject);
  }, [focusN, focusProject]);

  useEffect(() => {
    void api.getConfig().then(setConfig);
  }, [configVersion]);

  const loadFiles = useCallback(async () => {
    if (!vaultPath) return;
    setFiles(await api.listMindmaps(vaultPath, project));
    setFilesLoaded(true);
  }, [vaultPath, project]);

  const loadProjects = useCallback(async () => {
    if (!vaultPath) return;
    setProjects(await api.listScheduleProjects(vaultPath));
    setProjectsLoaded(true);
    // `projectsVersion` is not read here — it is a reload trigger, and listing
    // it as a dependency is what makes the effect below re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, projectsVersion]);

  /**
   * Reads a note into the view.
   *
   * `fit` frames the map, and is for opening a *different* note — re-framing on
   * every reload threw the user's zoom away each time the watcher reported a
   * save. `skipUnchanged` drops the reload entirely when the file on disk is
   * the one we just wrote, which is what that watcher event usually is.
   */
  const loadDoc = useCallback(
    async (target: string, { fit = false, skipUnchanged = false } = {}) => {
      if (!target) {
        setDoc(null);
        return;
      }
      const read = await api.readMindmap(target);
      if (skipUnchanged && read.mtime === source.current.mtime) return;
      source.current = { content: read.content, mtime: read.mtime };
      // A reload means the file, not the user, decided the current state — the
      // stack would otherwise let Ctrl+Z "undo" someone else's edit.
      undoStack.current = [];
      redoStack.current = [];
      setDoc(parseMindmap(read.content));
      if (fit) setFitToken((n) => n + 1);
    },
    [],
  );

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (!vaultPath) return;
    void api.listTasks(vaultPath).then(setTasks);
    void loadProjects();
  }, [vaultPath, loadProjects]);

  useEffect(() => {
    void loadDoc(path, { fit: true });
    setSelectedId(null);
    setEditingId(null);
  }, [path, loadDoc]);

  // The open note's project may be the one that just left. Judged from the
  // note's own path rather than from the file list, because switching the
  // picker to another project also empties the list of it — and that is not a
  // reason to close what the user is editing. Holding on to the path would
  // leave the editor writing into `archive/projects/` behind the user's back.
  useEffect(() => {
    if (!path || !projectsLoaded) return;
    const owner = projectOfNotePath(path);
    if (owner && !projects.includes(owner)) setPath("");
  }, [path, projects, projectsLoaded]);

  // A project folder appearing or disappearing (created here, in the Projects
  // tab, in Obsidian, or by an agent) changes what the picker may offer.
  // Archiving is a *move* to `archive/projects/`, so an archived project drops
  // out of this list on its own — there is no separate exclusion to apply.
  useEffect(() => {
    const unlisten = listen("projects-changed", () => {
      void loadProjects();
      void loadFiles();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadProjects, loadFiles]);

  // The selected project may be the one that just left. Falling back to "all
  // projects" is what keeps the picker from showing a value it no longer has.
  useEffect(() => {
    if (projectsLoaded && project && !projects.includes(project)) setProject("");
  }, [projectsLoaded, projects, project]);

  // External edits (Obsidian, the AI agent) arrive as events rather than
  // polling, so the canvas follows the file without a refresh button.
  useEffect(() => {
    const unlisten = listen("mindmaps-changed", () => {
      void loadFiles();
      // A pending local edit is the newer intent; letting the reload win would
      // throw away what the user typed a moment ago. The event is usually the
      // echo of our own save, which `skipUnchanged` drops.
      if (path && !saveTimer.current) void loadDoc(path, { skipUnchanged: true });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [path, loadDoc, loadFiles]);

  useEffect(() => {
    void api.mindmapEditStatus().then(setAiRun);
    const unlisten = listen<MindmapEditRun>("mindmap-edit:status", (e) => setAiRun(e.payload));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Open the first note of the project automatically: a picker showing one
  // file and an empty canvas is a click the user never wants to make.
  useEffect(() => {
    if (!filesLoaded) return;
    if (path && files.some((f) => f.path === path)) return;
    setPath(files[0]?.path ?? "");
  }, [files, filesLoaded, path]);

  // Remember where the user was. Written on every change rather than on unmount
  // because the view is never unmounted — the tab bar only hides it.
  useEffect(() => {
    writeViewState(VIEW_ID, "path", path);
  }, [path]);

  useEffect(() => {
    writeViewState(VIEW_ID, "project", project);
  }, [project]);

  /**
   * Writes a model to state and schedules the file write, without touching the
   * undo stacks — the undo/redo handlers manage those themselves.
   */
  const apply = useCallback(
    (next: MindmapDocModel) => {
      if (aiRunning) return; // the agent holds the file
      setDoc(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void (async () => {
          const content = serializeMindmap(source.current.content, next, todayISO());
          try {
            const mtime = await api.writeMindmap(path, content, source.current.mtime);
            source.current = { content, mtime };
            setStatus("");
          } catch (e) {
            // A conflict is not recoverable by retrying: the user has to see
            // the other edit before deciding, so surface it and reload.
            setStatus(String(e));
            void loadDoc(path);
          }
        })();
      }, SAVE_DEBOUNCE_MS);
    },
    [aiRunning, path, loadDoc],
  );

  /**
   * Writes a pending debounced edit now, so an operation that moves the file
   * out from under the timer cannot lose it. Without this a rename would let
   * the timer fire against the old path — and since a guarded write skips its
   * mtime check when the file is gone, that would *recreate* the note under
   * its old name.
   */
  const flushSave = useCallback(async () => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (!doc || !path) return;
    const content = serializeMindmap(source.current.content, doc, todayISO());
    const mtime = await api.writeMindmap(path, content, source.current.mtime);
    source.current = { content, mtime };
  }, [doc, path]);

  /** Applies a user edit: records the previous state for undo, then writes. */
  const mutate = useCallback(
    (next: MindmapDocModel) => {
      if (aiRunning || !doc) return;
      undoStack.current.push(doc);
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      apply(next);
    },
    [aiRunning, doc, apply],
  );

  /**
   * Changes the note's box-width setting.
   *
   * Goes through `mutate` like any other edit: it is written to the file's
   * frontmatter, so it belongs on the undo stack and travels with the note
   * rather than living in the app.
   */
  const changeNodeWidth = useCallback(
    (value: NodeWidth) => {
      if (!doc) return;
      mutate({ ...doc, nodeWidth: value });
    },
    [doc, mutate],
  );

  /**
   * Changes how the attributes are being looked at — chips, colouring, filter.
   *
   * Goes through `mutate` like `changeNodeWidth`, and for the same reason: the
   * view is written to the note's frontmatter, so an export matches what was
   * on screen and reopening the map does not throw the answer away.
   */
  const changeAttrView = useCallback(
    (patch: Partial<AttrView>) => {
      if (!doc) return;
      mutate({ ...doc, attrView: { ...doc.attrView, ...patch } });
    },
    [doc, mutate],
  );

  /** Replaces one node in place, leaving the rest of the tree alone. */
  const patchNode = useCallback(
    (id: string, patch: Partial<MindmapNode>) => {
      if (!doc) return;
      const roots = cloneNodes(doc.roots);
      const node = findNode(roots, id);
      if (!node) return;
      Object.assign(node, patch);
      // `undefined` in a patch means "clear it"; `Object.assign` leaves the key
      // present, which the serializer would then write out.
      const fields = node as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete fields[key];
      }
      mutate({ ...doc, roots });
    },
    [doc, mutate],
  );

  /**
   * A command chosen from an attribute chip's right-click menu.
   *
   * Four of the five change how the map is being *looked at* and go through
   * `changeAttrView`; only `remove` edits the tree. Both paths end up in
   * `mutate`, so a menu command is on the undo stack like any other edit.
   */
  const chipAction = useCallback(
    (action: ChipAction, node: PositionedNode, chip: AttrChip) => {
      if (!doc) return;
      const target = findNode(doc.roots, node.id);
      if (!target) return;
      const command = chipCommand(action, chip, {
        view: doc.attrView,
        keys: attrKeys,
        attrs: target.attrs,
      });
      if (command.kind === "view") changeAttrView(command.patch);
      else patchNode(node.id, { attrs: command.attrs });
    },
    [doc, attrKeys, changeAttrView, patchNode],
  );

  /** Selecting a node clears any selected sticky, and the other way round —
   * one cursor, two kinds of thing under it. */
  const selectNode = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setSelectedStickyId(null);
  }, []);

  const selectSticky = useCallback((id: string | null) => {
    setSelectedStickyId(id);
    if (id) setSelectedId(null);
  }, []);

  /** Replaces one sticky in place. */
  const patchSticky = useCallback(
    (id: string, patch: Partial<Sticky>) => {
      if (!doc) return;
      const stickies = doc.stickies.map((sticky) =>
        sticky.id === id ? { ...sticky, ...patch } : sticky,
      );
      // `undefined` in a patch means "clear it" — the same contract as
      // `patchNode`, so the serializer does not write the key back out.
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
    (nodeId: string) => {
      if (!doc) return;
      const existing = stickiesOf(doc.stickies, nodeId).length;
      const sticky: Sticky = {
        id: nextStickyId(doc.stickies),
        nodeId,
        dx: NEW_STICKY_OFFSET.dx + existing * NEW_STICKY_STAGGER.dx,
        dy: NEW_STICKY_OFFSET.dy + existing * NEW_STICKY_STAGGER.dy,
        text: "",
      };
      // Adding a sticky while they are hidden would put it somewhere the user
      // cannot see; showing them again is the only reading of the gesture that
      // works — the same call the collapse handling makes for a hidden child.
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

  /**
   * Ends an inline sticky edit, dropping the sticky when nothing was typed —
   * the bargain `finishEdit` makes for a node, for the same reason: a sticky
   * is created empty, and an abandoned one would otherwise be blank paper left
   * on the map.
   */
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
   * so it travels with the map and the exports match the screen. */
  const toggleStickies = useCallback(() => {
    if (!doc) return;
    mutate({ ...doc, stickiesHidden: !doc.stickiesHidden });
  }, [doc, mutate]);

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

  // ---- tree commands ------------------------------------------------------

  const addNode = useCallback(
    (relativeTo: string | null, as: "child" | "sibling") => {
      if (!doc) return;
      const roots = cloneNodes(doc.roots);
      const fresh: MindmapNode = { id: nextNodeId(roots), title: "", children: [] };

      // A sibling of the root would be a *second* root, which stacks below the
      // first as a separate map — never what pressing Enter on the centre
      // means. Treat it as "add a branch", the way a mindmapping tool does.
      const parent = relativeTo && as === "sibling" ? findParent(roots, relativeTo) : null;
      const target = as === "child" || (as === "sibling" && !parent) ? "child" : "sibling";

      if (!relativeTo || !roots.length) {
        roots.push(fresh);
      } else if (target === "child") {
        const node = findNode(roots, relativeTo);
        if (!node) return;
        // Adding to a collapsed node would put the new node somewhere the user
        // cannot see; expanding is the only reading of the gesture that works.
        delete node.collapsed;
        node.children.push(fresh);
      } else {
        const siblings = parent!.children;
        const at = siblings.findIndex((n) => n.id === relativeTo) + 1;
        if (roots.includes(parent!)) {
          // A branch of the root: the new one belongs on the same side as the
          // branch the user was on. Freezing the rest first stops the
          // insertion from shifting any of them across the root, since the
          // default side is derived from position.
          freezeRootChildSides(parent!);
          fresh.side = siblings[at - 1].side;
        }
        siblings.splice(at, 0, fresh);
      }
      mutate({ ...doc, roots });
      setSelectedId(fresh.id);
      // A new node is empty, so it opens straight into its rename box —
      // otherwise every add would be two gestures.
      setEditingId(fresh.id);
    },
    [doc, mutate],
  );

  const deleteNode = useCallback(
    (id: string) => {
      if (!doc) return;
      const roots = cloneNodes(doc.roots);
      const parent = findParent(roots, id);
      const siblings = parent ? parent.children : roots;
      const idx = siblings.findIndex((n) => n.id === id);
      if (idx === -1) return;
      // A sticky is pinned to a node; when the node goes, so does its paper —
      // and the same for every node in the subtree that goes with it. Leaving
      // them behind would strand lines in the file that can never be shown.
      const gone = subtreeIds(siblings[idx]);
      siblings.splice(idx, 1);
      mutate({
        ...doc,
        roots,
        stickies: doc.stickies.filter((sticky) => !gone.has(sticky.nodeId)),
      });
      setSelectedId(parent?.id ?? null);
    },
    [doc, mutate],
  );

  /**
   * Ends an inline rename, dropping the node when nothing was typed.
   *
   * A node is created empty and opens straight into its name box, so
   * abandoning that box (Escape, or a click elsewhere) would otherwise leave a
   * blank box on the map — and a run of them if the user was pressing Enter.
   * Only a childless node is dropped: an empty *branch* head is a structure
   * someone built, not a leftover.
   */
  const finishEdit = useCallback(
    (id: string, title: string | null) => {
      setEditingId(null);
      if (!doc) return;
      const node = findNode(doc.roots, id);
      if (!node) return;
      const next = title === null ? node.title : title;
      if (!next.trim() && !node.children.length) {
        deleteNode(id);
        return;
      }
      if (title !== null && title !== node.title) patchNode(id, { title });
    },
    [doc, deleteNode, patchNode],
  );

  const toggleCollapse = useCallback(
    (id: string) => {
      const node = doc ? findNode(doc.roots, id) : null;
      if (!node) return;
      patchNode(id, { collapsed: node.collapsed ? undefined : true });
    },
    [doc, patchNode],
  );

  const reparent = useCallback(
    (id: string, parentId: string, dropSide: "left" | "right") => {
      if (!doc) return;
      const roots = moveNode(doc.roots, id, parentId);
      // `null` means the drop was into the node's own subtree, or onto itself.
      if (!roots) {
        setStatus("A node cannot be moved inside itself.");
        return;
      }
      const parent = findNode(roots, parentId);
      const moved = findNode(roots, id);
      if (parent) delete parent.collapsed;
      if (parent && moved) {
        if (roots.includes(parent)) {
          // Dropped onto the root: which side of it the pointer was on is the
          // whole content of the gesture — it is how a branch is moved from
          // the left of the map to the right.
          freezeRootChildSides(parent);
          moved.side = dropSide;
        } else {
          // Anywhere else, a branch follows its new parent and has no side of
          // its own to assert.
          delete moved.side;
        }
      }
      mutate({ ...doc, roots });
    },
    [doc, mutate],
  );

  /**
   * The four structural moves, from the keyboard or from a node's menu.
   *
   * Each helper answers `null` when the move is not available, which is the
   * same question `nodeAbilities` asks to grey the menu item out — so the
   * shortcut and the menu can never disagree about what is possible.
   */
  const structuralMove = useCallback(
    (id: string, move: "moveUp" | "moveDown" | "indent" | "outdent") => {
      if (!doc) return;
      const roots =
        move === "moveUp"
          ? moveSibling(doc.roots, id, -1)
          : move === "moveDown"
            ? moveSibling(doc.roots, id, 1)
            : move === "indent"
              ? indentNode(doc.roots, id)
              : outdentNode(doc.roots, id);
      // Nothing to do — the node is already at that edge of its branch. Silent
      // on purpose: holding Alt+Up to the top of a list is a normal gesture,
      // and a status line firing at the end of it would be noise.
      if (!roots) return;
      mutate({ ...doc, roots });
    },
    [doc, mutate],
  );

  /** Which structural moves are open to a node, for its menu. */
  const nodeAbilities = useCallback(
    (id: string): NodeAbilities => {
      if (!doc) return { moveUp: false, moveDown: false, indent: false, outdent: false };
      return {
        moveUp: canMoveSibling(doc.roots, id, -1),
        moveDown: canMoveSibling(doc.roots, id, 1),
        indent: canIndent(doc.roots, id),
        outdent: canOutdent(doc.roots, id),
      };
    },
    [doc],
  );

  /** The map's own `key`/values, which is what a node's menu offers. */
  const attrVocabulary = useMemo(
    () => attrKeys.map((key) => ({ key, values: attrValuesFor(key) })),
    [attrKeys, attrValuesFor],
  );

  const quickAttrsFor = useCallback(
    (node: PositionedNode) => quickAttrGroups(attrVocabulary, node.attrs),
    [attrVocabulary],
  );

  /** One value put on or taken off a node from its menu. */
  const quickAttr = useCallback(
    (node: PositionedNode, key: string, value: string) => {
      if (!doc) return;
      const target = findNode(doc.roots, node.id);
      if (!target) return;
      patchNode(node.id, { attrs: quickAttrToggle(target.attrs, key, value) });
    },
    [doc, patchNode],
  );

  /**
   * A command chosen from a node's own right-click menu.
   *
   * Every item here is something the keyboard already does. The menu exists
   * because the shortcuts are unguessable, not because the actions are
   * different, so each one routes to the same callback the key does.
   */
  const nodeAction = useCallback(
    (action: NodeAction, node: PositionedNode) => {
      switch (action) {
        case "moveUp":
        case "moveDown":
        case "indent":
        case "outdent":
          structuralMove(node.id, action);
          return;
        case "rename":
          setSelectedId(node.id);
          setEditingId(node.id);
          return;
        case "addChild":
          addNode(node.id, "child");
          return;
        case "addSibling":
          addNode(node.id, "sibling");
          return;
        case "toggleCollapse":
          toggleCollapse(node.id);
          return;
        case "delete":
          deleteNode(node.id);
          return;
      }
    },
    [structuralMove, addNode, toggleCollapse, deleteNode],
  );

  /** Arrow-key navigation: parent, first child, or the sibling either way. */
  const navigate = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      if (!doc || !selectedId) return;
      const node = findNode(doc.roots, selectedId);
      if (!node) return;
      const parent = findParent(doc.roots, selectedId);
      const siblings = parent ? parent.children : doc.roots;
      const idx = siblings.findIndex((n) => n.id === selectedId);

      if (direction === "up" || direction === "down") {
        const next = siblings[idx + (direction === "up" ? -1 : 1)];
        if (next) setSelectedId(next.id);
        return;
      }
      // Left/right follow the tree rather than the screen: on a left-hand
      // branch "into the children" is leftwards, and chasing the screen
      // direction would need the layout here just to move the cursor.
      if (direction === "right") {
        if (!node.collapsed && node.children[0]) setSelectedId(node.children[0].id);
      } else if (parent) {
        setSelectedId(parent.id);
      }
    },
    [doc, selectedId],
  );

  /**
   * Keyboard editing, bound on the window rather than a focused element so the
   * shortcuts work straight after a click on the canvas.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Never steal a key from a field the user is typing in.
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (aiRunning || !doc) return;
      // A node opens straight into its name box, and the box takes focus one
      // frame later. Without this, a second Enter in that gap reached this
      // handler instead of the field and created another empty node — a run of
      // them, if the user was typing at speed.
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
      if (e.key === "Escape") {
        setEditingId(null);
        setSelectedId(null);
        setSelectedStickyId(null);
        return;
      }
      if (e.key === "Delete" && selectedStickyId) {
        e.preventDefault();
        deleteSticky(selectedStickyId);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        addNode(selectedId, "child");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        addNode(selectedId, "sibling");
        return;
      }
      if (!selectedId) return;
      if (e.key === "F2") {
        e.preventDefault();
        setEditingId(selectedId);
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        deleteNode(selectedId);
        return;
      }
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const direction = e.key.replace("Arrow", "").toLowerCase() as
          | "up"
          | "down"
          | "left"
          | "right";
        // Alt moves the node, a bare arrow moves the cursor. Left/right are
        // the tree's own directions here as well, so Alt+Right files a node
        // under its neighbour whichever side of the root it is drawn on.
        if (e.altKey) {
          structuralMove(
            selectedId,
            direction === "up"
              ? "moveUp"
              : direction === "down"
                ? "moveDown"
                : direction === "right"
                  ? "indent"
                  : "outdent",
          );
          return;
        }
        navigate(direction);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    aiRunning,
    doc,
    editingId,
    editingStickyId,
    selectedId,
    selectedStickyId,
    addNode,
    deleteNode,
    deleteSticky,
    navigate,
    structuralMove,
    undo,
    redo,
  ]);

  // ---- file commands ------------------------------------------------------

  const createFile = useCallback(async () => {
    const title = newTitle.trim();
    if (!vaultPath || !targetProject || !title) return;
    try {
      const created = await api.createMindmap(vaultPath, targetProject, title);
      setCreating(false);
      setNewTitle("");
      await loadFiles();
      setPath(created.path);
    } catch (e) {
      setStatus(String(e));
    }
  }, [newTitle, vaultPath, targetProject, loadFiles]);

  const renameFile = useCallback(async () => {
    const title = renameTitle.trim();
    if (!vaultPath || !path || !title) return;
    try {
      await flushSave();
      const renamed = await api.renameMindmap(vaultPath, path, title);
      setRenaming(false);
      await loadFiles();
      setPath(renamed.path);
      await loadDoc(renamed.path);
      setStatus("");
    } catch (e) {
      setStatus(String(e));
    }
  }, [renameTitle, vaultPath, path, flushSave, loadFiles, loadDoc]);

  const deleteFile = useCallback(async () => {
    if (!vaultPath || !path) return;
    setDeleteOpen(false);
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      const moved = await api.deleteMindmap(vaultPath, path);
      setPath("");
      await loadFiles();
      setStatus(`Moved to ${moved}`);
    } catch (e) {
      setStatus(String(e));
    }
  }, [vaultPath, path, loadFiles]);

  const copyMermaid = useCallback(async () => {
    if (!doc) return;
    await writeText(toMermaidBlock(doc.roots));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [doc]);

  /** Where an export lands: beside the project it documents. */
  const exportDir = useCallback(
    () => `${vaultPath}/projects/${targetProject}/attachments`,
    [vaultPath, targetProject],
  );

  const exportHtml = useCallback(async () => {
    if (!doc || !vaultPath) return;
    const name = `${(doc.title || "mindmap").replace(/[\\/:*?"<>|]/g, "-")}.html`;
    const out = `${exportDir()}/${name}`;
    try {
      await api.exportMindmapFile(
        out,
        toHtml(doc.roots, {
          title: doc.title,
          exportedOn: todayISO(),
          mermaid: toMermaidBlock(doc.roots),
          nodeWidth: doc.nodeWidth,
          attrView,
          stickies: visibleStickies,
        }),
      );
      setStatus(`Exported to ${out}`);
      await api.openExplorer(out);
    } catch (e) {
      setStatus(String(e));
    }
  }, [doc, vaultPath, exportDir, visibleStickies]);

  /**
   * PNG export: rasterize the very SVG the HTML export uses.
   *
   * Going through the same markup rather than a second renderer is what keeps
   * the three outputs from drifting into three slightly different pictures.
   * The 2x scale is for the usual reason — a diagram pasted into a document
   * and then zoomed should not be a blur.
   */
  const exportPng = useCallback(async () => {
    if (!doc || !vaultPath) return;
    const svg = toSvg(doc.roots, {
      title: doc.title,
      nodeWidth: doc.nodeWidth,
      attrView,
      stickies: visibleStickies,
    });
    const width = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 800);
    const height = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 600);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("the diagram could not be rasterized"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d canvas context");
      ctx.scale(2, 2);
      ctx.drawImage(image, 0, 0);

      const name = `${(doc.title || "mindmap").replace(/[\\/:*?"<>|]/g, "-")}.png`;
      const out = `${exportDir()}/${name}`;
      await api.exportMindmapPng(out, canvas.toDataURL("image/png").split(",")[1] ?? "");
      setStatus(`Exported to ${out}`);
      await api.openExplorer(out);
    } catch (e) {
      setStatus(String(e));
    }
  }, [doc, vaultPath, exportDir, visibleStickies]);

  const runAiEdit = useCallback(
    async (instruction: string, confirm: boolean) => {
      try {
        await flushSave();
        await api.runMindmapEdit(path, instruction, confirm);
      } catch (e) {
        setStatus(String(e));
      }
    },
    [flushSave, path],
  );

  const undoAiEdit = useCallback(async () => {
    try {
      await api.restoreMindmapSnapshot(path);
      await loadDoc(path);
    } catch (e) {
      setStatus(String(e));
    }
  }, [path, loadDoc]);

  // ---- render -------------------------------------------------------------

  if (!vaultPath) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        Set a vault path in Settings to use mindmaps.
      </div>
    );
  }

  if (projectsLoaded && !projects.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
        This vault has no projects yet.
        <Button size="sm" onClick={() => setProjectDialogOpen(true)}>
          <FolderPlus className="mr-1 size-3.5" />
          New project…
        </Button>
        <ProjectCreateDialog
          vaultPath={vaultPath}
          open={projectDialogOpen}
          onOpenChange={setProjectDialogOpen}
          onCreated={(slug) => {
            void loadProjects();
            setProject(slug);
          }}
        />
      </div>
    );
  }

  const nodeCount = doc ? countNodes(doc.roots) : 0;
  const stickyCount = doc?.stickies.length ?? 0;

  // `h-full`, not `flex-1`: the app shell mounts each tab in a plain `h-full`
  // div, which is not a flex container — a `flex-1` root there has no height to
  // take, and the panel group below collapses to a few pixels.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        <Select
          value={project || ALL_PROJECTS}
          onValueChange={(v) => {
            if (v === NEW_PROJECT) {
              setProjectDialogOpen(true);
              return;
            }
            setProject(v === ALL_PROJECTS ? "" : v);
          }}
        >
          <SelectTrigger className="h-7 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
            {projects.map((slug) => (
              <SelectItem key={slug} value={slug}>
                {slug}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={NEW_PROJECT}>New project…</SelectItem>
          </SelectContent>
        </Select>

        <Select value={path} onValueChange={setPath} disabled={!files.length}>
          <SelectTrigger className="h-7 w-56 text-xs">
            <SelectValue placeholder={files.length ? "Pick a mindmap" : "No mindmaps yet"} />
          </SelectTrigger>
          <SelectContent>
            {files.map((file) => (
              <SelectItem key={file.path} value={file.path}>
                {file.title}
                {!project && <span className="ml-1 text-muted-foreground">· {file.project}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {creating ? (
          <InlineInput
            value={newTitle}
            placeholder="Mindmap name"
            onChange={setNewTitle}
            onCommit={createFile}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <Hint label="New mindmap" disabled={!targetProject}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setCreating(true)}
              disabled={!targetProject}
            >
              <Plus className="size-3.5" />
            </Button>
          </Hint>
        )}

        {renaming ? (
          <InlineInput
            value={renameTitle}
            placeholder="New name"
            onChange={setRenameTitle}
            onCommit={renameFile}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <Hint label="Rename this mindmap" disabled={!path || aiRunning}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!path || aiRunning}
              onClick={() => {
                setRenameTitle(current?.title ?? "");
                setRenaming(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
          </Hint>
        )}

        <Select
          value={doc?.nodeWidth ?? "auto"}
          disabled={!doc || aiRunning}
          onValueChange={(v) => changeNodeWidth(v as NodeWidth)}
        >
          <Hint label="How wide node boxes are">
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
          </Hint>
          <SelectContent>
            {NODE_WIDTHS.map((value) => (
              <SelectItem key={value} value={value}>
                {NODE_WIDTH_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Attribute controls appear only once the map actually uses
            attributes, so a map that does not is exactly the toolbar it was
            before the feature existed. */}
        {attrKeys.length > 0 && (
          <>
            <Select
              value={attrView.color || ATTR_NONE}
              disabled={!doc || aiRunning}
              onValueChange={(v) => changeAttrView({ color: v === ATTR_NONE ? "" : v })}
            >
              <Hint label="Colour the boxes by an attribute instead of the map's own colours">
                <SelectTrigger className="h-7 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
              </Hint>
              <SelectContent>
                <SelectItem value={ATTR_NONE}>Map colours</SelectItem>
                <SelectSeparator />
                {attrKeys.map((key) => (
                  <SelectItem key={key} value={key}>
                    Colour by {key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={attrView.filter ? `${attrView.filter.key}=${attrView.filter.value}` : ATTR_NONE}
              disabled={!doc || aiRunning}
              onValueChange={(v) => {
                if (v === ATTR_NONE) {
                  changeAttrView({ filter: null });
                  return;
                }
                const option = attrFilterOptions.find((o) => o.id === v);
                changeAttrView({ filter: option ? { key: option.key, value: option.value } : null });
              }}
            >
              <Hint label="Dim every node that does not carry this attribute">
                <SelectTrigger className="h-7 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
              </Hint>
              <SelectContent>
                <SelectItem value={ATTR_NONE}>No filter</SelectItem>
                <SelectSeparator />
                {attrFilterOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.key}: {option.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <ChipSettings
              keys={attrKeys}
              chips={attrView.chips}
              disabled={!doc || aiRunning}
              onChange={(chips) => changeAttrView({ chips })}
            />
          </>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {status && <span className="max-w-72 truncate text-[11px] text-muted-foreground">{status}</span>}
          {nodeCount > 0 && (
            <span className="text-[11px] text-muted-foreground">{nodeCount} nodes</span>
          )}
          <Hint label="Fit the map to the window" disabled={!doc}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!doc}
              onClick={() => setFitToken((n) => n + 1)}
            >
              <Maximize2 className="size-3.5" />
            </Button>
          </Hint>
          {stickyCount > 0 && (
            <Hint
              label={
                doc?.stickiesHidden
                  ? `Show the ${stickyCount} sticky notes`
                  : `Hide the ${stickyCount} sticky notes`
              }
              disabled={!doc || aiRunning}
            >
              <Button
                size="sm"
                variant={doc?.stickiesHidden ? "outline" : "secondary"}
                className="h-7 text-xs"
                disabled={!doc || aiRunning}
                onClick={toggleStickies}
              >
                <StickyNote className="mr-1 size-3.5" />
                {stickyCount}
              </Button>
            </Hint>
          )}
          <Hint label="Copy as a mermaid code block" disabled={!doc}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!doc}
              onClick={copyMermaid}
            >
              {copied ? <Check className="mr-1 size-3.5" /> : <Copy className="mr-1 size-3.5" />}
              mermaid
            </Button>
          </Hint>
          <Hint label="Export a single-file HTML page" disabled={!doc}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!doc}
              onClick={exportHtml}
            >
              <Download className="size-3.5" />
            </Button>
          </Hint>
          <Hint label="Export a PNG image" disabled={!doc}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!doc}
              onClick={exportPng}
            >
              <Image className="size-3.5" />
            </Button>
          </Hint>
          <Hint label="Edit with AI" disabled={!doc}>
            <Button
              size="sm"
              variant={aiOpen ? "secondary" : "outline"}
              className="h-7 text-xs"
              disabled={!doc}
              onClick={() => setAiOpen((v) => !v)}
            >
              <Sparkles className="size-3.5" />
            </Button>
          </Hint>
          <Hint label="Move this mindmap to the trash" disabled={!path || aiRunning}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!path || aiRunning}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </Hint>
        </div>
      </div>

      {!doc ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          {files.length ? "Pick a mindmap." : "Create a mindmap to get started."}
        </div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="mindmap-canvas" defaultSize="76%" minSize="40%" className="min-h-0">
            <div className="flex h-full min-h-0 flex-col">
              <MindmapCanvas
                roots={doc.roots}
                nodeWidth={doc.nodeWidth}
                attrView={attrView}
                stickies={visibleStickies}
                selectedId={selectedId}
                selectedStickyId={selectedStickyId}
                editingStickyId={editingStickyId}
                editingId={editingId}
                locked={aiRunning}
                fitToken={fitToken}
                onSelectSticky={selectSticky}
                onStartEditSticky={setEditingStickyId}
                onCommitStickyText={(id, text) => finishStickyEdit(id, text)}
                onCancelStickyEdit={() =>
                  editingStickyId && finishStickyEdit(editingStickyId, null)
                }
                onMoveSticky={(id, dx, dy) => patchSticky(id, { dx, dy })}
                onSelect={selectNode}
                onStartEdit={setEditingId}
                onCommitEdit={(id, title) => finishEdit(id, title)}
                onCancelEdit={() => editingId && finishEdit(editingId, null)}
                onToggleCollapse={toggleCollapse}
                onReparent={reparent}
                onChipAction={chipAction}
                abilitiesOf={nodeAbilities}
                onNodeAction={nodeAction}
                quickAttrsOf={quickAttrsFor}
                onQuickAttr={quickAttr}
              />
              <div className="shrink-0 border-t px-3 py-1 text-[11px] text-muted-foreground">
                Tab: child · Enter: sibling · F2 / double-click: rename · Delete: remove ·
                Alt+arrows: reorder / indent · right-click a node: menu · drag onto a node:
                move · right-drag: pan · wheel: zoom · sticky: drag to place, double-click to
                edit
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle />
          {/* Rendered unconditionally, even when it has nothing to show.
              `react-resizable-panels` recomputes its layout when the number of
              panels changes, and taking this one away mid-session collapsed the
              canvas panel to zero height — the map simply vanished on a click
              that cleared the selection (T-0188 follow-up). */}
          <ResizablePanel
            id="mindmap-side"
            defaultSize={`${SIDEBAR_DEFAULT_PCT}%`}
            minSize="16%"
            className="min-h-0"
          >
            <div className="flex h-full min-h-0 flex-col overflow-y-auto">
              {selected ? (
                <NodeEditor
                  node={selected}
                  tasks={tasks}
                  attrKeys={attrKeys}
                  attrValuesFor={attrValuesFor}
                  attrChips={attrView.chips}
                  onAttrChipsChange={(chips) => changeAttrView({ chips })}
                  disabled={aiRunning}
                  stickies={stickiesOf(doc.stickies, selected.id)}
                  stickiesHidden={doc.stickiesHidden}
                  onAddSticky={() => addSticky(selected.id)}
                  onChangeSticky={patchSticky}
                  onDeleteSticky={deleteSticky}
                  onChange={(patch) => patchNode(selected.id, patch)}
                  onAddChild={() => addNode(selected.id, "child")}
                  onAddSibling={() => addNode(selected.id, "sibling")}
                  onDelete={() => deleteNode(selected.id)}
                />
              ) : (
                !aiOpen && (
                  <p className="p-3 text-xs text-muted-foreground">
                    Pick a node to edit it, or press Tab to add one.
                  </p>
                )
              )}
              {aiOpen && aiRun && (
                <MindmapAiPanel
                  run={aiRun}
                  defaultConfirm={config?.settings.mindmap_confirm ?? false}
                  disabled={!path}
                  onRun={(instruction, confirm) => void runAiEdit(instruction, confirm)}
                  onUndo={() => void undoAiEdit()}
                />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      <ProjectCreateDialog
        vaultPath={vaultPath}
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        onCreated={(slug) => {
          void loadProjects();
          setProject(slug);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Move this mindmap to the trash?"
        description={`"${current?.title ?? ""}" is moved to _ai/memory/mindmap-trash/ in the vault. Nothing is deleted, and the file can be moved back by hand.`}
        confirmLabel="Move to trash"
        destructive
        onConfirm={() => void deleteFile()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

function countNodes(roots: MindmapNode[]): number {
  let n = 0;
  visit(roots, () => {
    n += 1;
  });
  return n;
}

/** Toolbar text field that commits on Enter and abandons on Escape. */
function InlineInput({
  value,
  placeholder,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <Input
      autoFocus
      value={value}
      placeholder={placeholder}
      className="h-7 w-48 text-xs"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onCommit();
        if (e.key === "Escape") onCancel();
      }}
      onBlur={onCancel}
    />
  );
}
