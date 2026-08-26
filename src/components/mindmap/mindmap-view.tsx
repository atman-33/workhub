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
  Trash2,
} from "lucide-react";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { MindmapAiPanel } from "@/components/mindmap/mindmap-ai-panel";
import { MindmapCanvas } from "@/components/mindmap/mindmap-canvas";
import { NodeEditor } from "@/components/mindmap/node-editor";
import { ProjectCreateDialog } from "@/components/schedule/project-create-dialog";
import { Button } from "@/components/ui/button";
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
import { toHtml, toSvg } from "@/lib/mindmap/export";
import { toMermaidBlock } from "@/lib/mindmap/mermaid";
import {
  cloneNodes,
  findNode,
  findParent,
  freezeRootChildSides,
  moveNode,
  nextNodeId,
  parseMindmap,
  serializeMindmap,
  visit,
  NODE_WIDTHS,
  type MindmapDocModel,
  type MindmapNode,
  type NodeWidth,
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

/** Wording for the box-width picker. The stored values stay short because they
 * are written into the note's frontmatter, where a human reads them too. */
const NODE_WIDTH_LABEL: Record<NodeWidth, string> = {
  auto: "Auto width",
  siblings: "Even siblings",
  depth: "Even by level",
};

/** Sentinel values for the pickers — Radix rejects an empty string. */
const ALL_PROJECTS = "__all__";
const NEW_PROJECT = "__new__";

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  /** Bumped by the app shell after settings are saved. */
  configVersion: number;
  /** A project the Projects tab asked this view to open (T-0190). */
  focus?: TabFocus;
}

export function MindmapView({ configVersion, focus }: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [project, setProject] = useState("");
  const [files, setFiles] = useState<MindmapFile[]>([]);
  const [path, setPath] = useState("");
  const [doc, setDoc] = useState<MindmapDocModel | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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
  }, [vaultPath, project]);

  const loadProjects = useCallback(async () => {
    if (!vaultPath) return;
    setProjects(await api.listScheduleProjects(vaultPath));
    setProjectsLoaded(true);
  }, [vaultPath]);

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
    if (path && files.some((f) => f.path === path)) return;
    setPath(files[0]?.path ?? "");
  }, [files, path]);

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
      siblings.splice(idx, 1);
      mutate({ ...doc, roots });
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
      if (editingId) return;

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
        navigate(e.key.replace("Arrow", "").toLowerCase() as "up" | "down" | "left" | "right");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [aiRunning, doc, editingId, selectedId, addNode, deleteNode, navigate, undo, redo]);

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
        }),
      );
      setStatus(`Exported to ${out}`);
      await api.openExplorer(out);
    } catch (e) {
      setStatus(String(e));
    }
  }, [doc, vaultPath, exportDir]);

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
    const svg = toSvg(doc.roots, { title: doc.title, nodeWidth: doc.nodeWidth });
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
  }, [doc, vaultPath, exportDir]);

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
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setCreating(true)}
            disabled={!targetProject}
            title="New mindmap"
          >
            <Plus className="size-3.5" />
          </Button>
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
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!path || aiRunning}
            onClick={() => {
              setRenameTitle(current?.title ?? "");
              setRenaming(true);
            }}
            title="Rename this mindmap"
          >
            <Pencil className="size-3.5" />
          </Button>
        )}

        <Select
          value={doc?.nodeWidth ?? "auto"}
          disabled={!doc || aiRunning}
          onValueChange={(v) => changeNodeWidth(v as NodeWidth)}
        >
          <SelectTrigger className="h-7 w-32 text-xs" title="How wide node boxes are">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NODE_WIDTHS.map((value) => (
              <SelectItem key={value} value={value}>
                {NODE_WIDTH_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1.5">
          {status && <span className="max-w-72 truncate text-[11px] text-muted-foreground">{status}</span>}
          {nodeCount > 0 && (
            <span className="text-[11px] text-muted-foreground">{nodeCount} nodes</span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!doc}
            onClick={() => setFitToken((n) => n + 1)}
            title="Fit the map to the window"
          >
            <Maximize2 className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!doc}
            onClick={copyMermaid}
            title="Copy as a mermaid code block"
          >
            {copied ? <Check className="mr-1 size-3.5" /> : <Copy className="mr-1 size-3.5" />}
            mermaid
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!doc}
            onClick={exportHtml}
            title="Export a single-file HTML page"
          >
            <Download className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!doc}
            onClick={exportPng}
            title="Export a PNG image"
          >
            <Image className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant={aiOpen ? "secondary" : "outline"}
            className="h-7 text-xs"
            disabled={!doc}
            onClick={() => setAiOpen((v) => !v)}
            title="Edit with AI"
          >
            <Sparkles className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!path || aiRunning}
            onClick={() => setDeleteOpen(true)}
            title="Move this mindmap to the trash"
          >
            <Trash2 className="size-3.5" />
          </Button>
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
                selectedId={selectedId}
                editingId={editingId}
                locked={aiRunning}
                fitToken={fitToken}
                onSelect={setSelectedId}
                onStartEdit={setEditingId}
                onCommitEdit={(id, title) => finishEdit(id, title)}
                onCancelEdit={() => editingId && finishEdit(editingId, null)}
                onToggleCollapse={toggleCollapse}
                onReparent={reparent}
              />
              <div className="shrink-0 border-t px-3 py-1 text-[11px] text-muted-foreground">
                Tab: child · Enter: sibling · F2 / double-click: rename · Delete: remove · drag
                onto a node: move · right-drag: pan · wheel: zoom
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
                  disabled={aiRunning}
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
