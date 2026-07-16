import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as pickFolders } from "@tauri-apps/plugin-dialog";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  Archive,
  FolderOpen,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Terminal as TerminalIcon,
} from "lucide-react";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { TaskDialog, type TaskDraft } from "@/components/task-dialog";
import { TaskKanban } from "@/components/task-kanban";
import { TaskList } from "@/components/task-list";
import { TerminalPanel } from "@/components/terminal-panel";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, DEV_VAULT_TEMPLATE_SOURCE } from "@/lib/api";
import { buildBody, DEFAULT_BODY, parseBody } from "@/lib/task-body";
import { cn } from "@/lib/utils";
import type { Config, Settings, Task, TaskAssignee, TaskStatus, UpdateTaskInput } from "@/types";

/** Height the bottom terminal panel snaps to when opened. */
const TERMINAL_PANEL_SIZE = 35;

type ViewMode = "list" | "kanban";
type DialogState = { mode: "create" } | { mode: "edit"; task: Task } | null;

interface Props {
  /** Bumped by the app shell after settings are saved; triggers a config reload. */
  configVersion: number;
  /** Notifies the app shell that settings have changed so it can keep its own copy in sync. */
  onSettingsChange?: (settings: Settings) => void;
}

export function TasksView({ configVersion, onSettingsChange }: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [archiveDoneOpen, setArchiveDoneOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [initializing, setInitializing] = useState(false);
  const [vaultExists, setVaultExists] = useState<boolean | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalMaximized, setTerminalMaximized] = useState(false);
  const terminalPanelRef = useRef<PanelImperativeHandle>(null);
  const boardPanelRef = useRef<PanelImperativeHandle>(null);

  const vaultPath = config?.settings.vault_path ?? null;
  const terminalEnabled = config?.settings.terminal_embed ?? false;

  const openTerminalPanel = useCallback(() => {
    setTerminalOpen((prev) => {
      if (!prev) terminalPanelRef.current?.resize(`${TERMINAL_PANEL_SIZE}%`);
      return true;
    });
  }, []);

  const toggleTerminalPanel = useCallback(() => {
    setTerminalOpen((prev) => {
      const next = !prev;
      if (next) {
        terminalPanelRef.current?.resize(`${TERMINAL_PANEL_SIZE}%`);
      } else {
        // The board may be collapsed by a maximized terminal; restore it
        // before collapsing the terminal so the layout stays valid.
        setTerminalMaximized(false);
        boardPanelRef.current?.resize("100%");
        terminalPanelRef.current?.collapse();
      }
      return next;
    });
  }, []);

  const toggleTerminalMaximize = useCallback(() => {
    setTerminalMaximized((prev) => {
      const next = !prev;
      if (next) boardPanelRef.current?.collapse();
      else terminalPanelRef.current?.resize(`${TERMINAL_PANEL_SIZE}%`);
      return next;
    });
  }, []);

  const refreshTasks = useCallback((path: string) => {
    void api
      .listTasks(path)
      .then(setTasks)
      .catch((e) => setStatus(`Failed to load tasks — ${e}`));
  }, []);

  // ---- startup + after app-level settings saves: load config ----
  useEffect(() => {
    setVaultExists(null);
    void (async () => {
      try {
        const cfg = await api.getConfig();
        setConfig(cfg);
        const path = cfg.settings.vault_path;
        if (path) {
          setVaultExists(await api.checkVaultPath(path));
        } else {
          setVaultExists(false);
        }
      } catch (e) {
        setStatus(`Vault check failed — ${e}`);
        setVaultExists(false);
      }
    })();
  }, [configVersion]);

  // ---- watch + initial load once a vault is configured ----
  useEffect(() => {
    if (!vaultPath || !vaultExists) return;
    void api.watchVault(vaultPath);
    refreshTasks(vaultPath);
  }, [vaultPath, vaultExists, refreshTasks]);

  // ---- react to external vault edits ----
  useEffect(() => {
    if (!vaultPath || !vaultExists) return;
    const unlisten = listen("tasks-changed", () => refreshTasks(vaultPath));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [vaultPath, vaultExists, refreshTasks]);

  const saveVaultPath = useCallback(
    async (path: string) => {
      const cfg = await api.getConfig();
      const next: Config = { ...cfg, settings: { ...cfg.settings, vault_path: path } };
      await api.saveConfig(next);
      setConfig(next);
      setVaultExists(true);
      onSettingsChange?.(next.settings);
    },
    [onSettingsChange],
  );

  const chooseVaultFolder = useCallback(async () => {
    const picked = await pickFolders({ directory: true, title: "Choose or create a vault folder" });
    if (typeof picked === "string") {
      await saveVaultPath(picked.replaceAll("\\", "/"));
    }
  }, [saveVaultPath]);

  const initVault = useCallback(async () => {
    if (!vaultPath) return;
    setInitializing(true);
    try {
      await api.initVault(vaultPath, DEV_VAULT_TEMPLATE_SOURCE);
      setStatus("Vault initialized");
      refreshTasks(vaultPath);
    } catch (e) {
      setStatus(`Vault initialization failed — ${e}`);
    } finally {
      setInitializing(false);
    }
  }, [vaultPath, refreshTasks]);

  // Suggestions for the Project field: projects already used on tasks plus
  // the repositories registered in the Repos view.
  const knownProjects = useMemo(
    () =>
      Array.from(
        new Set([
          ...tasks.map((t) => t.project).filter(Boolean),
          ...(config?.projects.map((p) => p.name) ?? []),
        ]),
      ).sort(),
    [tasks, config],
  );

  const knownTags = useMemo(
    () => Array.from(new Set(tasks.flatMap((t) => t.tags))).sort(),
    [tasks],
  );

  const visible = useMemo(
    () =>
      tasks.filter((t) => {
        if (!showArchived && t.archived) return false;
        if (statusFilter && t.status !== statusFilter) return false;
        if (assigneeFilter && t.assignee !== assigneeFilter) return false;
        if (projectFilter && t.project !== projectFilter) return false;
        if (tagFilter && !t.tags.includes(tagFilter)) return false;
        return true;
      }),
    [tasks, statusFilter, assigneeFilter, projectFilter, tagFilter, showArchived],
  );

  // Returns the launch promise so callers (the animated LaunchAgentButton) can
  // sync their feedback to it; still surfaces the outcome in the status bar.
  const launchAgent = useCallback(
    async (task: Task) => {
      if (!config) return;
      const agentCmd =
        task.assignee === "opencode" ? config.settings.opencode_cmd : config.settings.agent_cmd;
      // In embedded mode, open the panel (which starts the herdr client) before
      // asking Rust to launch — Rust polls briefly for the server to come up
      // instead of spawning an external `wt` window (see herdr::ensure_server).
      if (config.settings.terminal_embed && config.settings.use_herdr) {
        openTerminalPanel();
      }
      try {
        const message = await api.launchAgentForTask(
          agentCmd,
          task.assignee,
          task.id,
          task.title,
          task.file,
          task.project,
          task.model,
          task.confirm,
          task.worktree,
          config.settings.vault_path ?? "",
          config.settings.use_herdr,
          config.settings.herdr_cmd,
          config.settings.terminal_embed,
        );
        setStatus(message);
      } catch (e) {
        setStatus(`Agent launch failed — ${e}`);
        throw e;
      }
    },
    [config, openTerminalPanel],
  );

  const copyTaskPrompt = useCallback(
    async (task: Task) => {
      if (!config) return;
      try {
        await api.copyTaskPrompt(
          task.assignee,
          task.id,
          task.title,
          task.file,
          task.project,
          task.model,
          task.confirm,
          task.worktree,
          config.settings.vault_path ?? "",
        );
        setStatus(`Copied prompt for ${task.id}`);
      } catch (e) {
        setStatus(`Copy prompt failed — ${e}`);
        throw e;
      }
    },
    [config],
  );

  const applyUpdates = useCallback(
    async (updates: UpdateTaskInput[]) => {
      if (!vaultPath) return;
      try {
        for (const u of updates) {
          await api.updateTask(vaultPath, u);
        }
        refreshTasks(vaultPath);
      } catch (e) {
        setStatus(`Update failed — ${e}`);
      }
    },
    [vaultPath, refreshTasks],
  );

  const setArchived = useCallback(
    (task: Task, archived: boolean) => {
      void applyUpdates([{ id: task.id, archived }]);
    },
    [applyUpdates],
  );

  // Non-archived Done tasks currently visible — the targets of a bulk archive.
  const doneToArchive = useMemo(
    () => visible.filter((t) => t.status === "done" && !t.archived),
    [visible],
  );

  const confirmArchiveDone = useCallback(() => {
    setArchiveDoneOpen(false);
    if (doneToArchive.length === 0) return;
    void applyUpdates(doneToArchive.map((t) => ({ id: t.id, archived: true })));
  }, [doneToArchive, applyUpdates]);

  const confirmDelete = useCallback(async () => {
    if (!vaultPath || !deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await api.deleteTask(vaultPath, target.id);
      setStatus(`Deleted ${target.id} (moved to recycle bin)`);
      refreshTasks(vaultPath);
    } catch (e) {
      setStatus(`Delete failed — ${e}`);
    }
  }, [vaultPath, deleteTarget, refreshTasks]);

  const createTask = useCallback(
    async (draft: TaskDraft) => {
      if (!vaultPath) return;
      const tags = draft.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const body = draft.content.trim()
        ? buildBody(parseBody(DEFAULT_BODY), draft.content)
        : undefined;
      try {
        await api.createTask(vaultPath, {
          title: draft.title,
          status: draft.status,
          assignee: draft.assignee,
          project: draft.project,
          priority: draft.priority,
          model: draft.model.trim(),
          confirm: draft.confirm,
          worktree: draft.worktree,
          due: draft.due,
          tags,
          body,
        });
        refreshTasks(vaultPath);
      } catch (e) {
        setStatus(`Create failed — ${e}`);
      }
    },
    [vaultPath, refreshTasks],
  );

  const editingTask = dialog?.mode === "edit" ? dialog.task : null;

  const autoSaveTask = useCallback(
    async (draft: TaskDraft) => {
      if (!vaultPath || !editingTask) return;
      const tags = draft.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      try {
        const parsed = parseBody(editingTask.body);
        const bodyChanged = draft.content !== parsed.content;
        await api.updateTask(vaultPath, {
          id: editingTask.id,
          title: draft.title,
          status: draft.status,
          assignee: draft.assignee,
          project: draft.project,
          priority: draft.priority,
          model: draft.model.trim(),
          confirm: draft.confirm,
          worktree: draft.worktree,
          due: draft.due,
          tags,
          body: bodyChanged ? buildBody(parsed, draft.content) : undefined,
        });
        refreshTasks(vaultPath);
      } catch (e) {
        setStatus(`Auto-save failed — ${e}`);
      }
    },
    [vaultPath, editingTask, refreshTasks],
  );

  if (!config || vaultExists === null) return null;

  if (!vaultPath || !vaultExists) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <FolderOpen className="size-10 text-muted-foreground/40" />
        <div>
          <p className="font-semibold">
            {!vaultPath ? "No task vault configured" : "Configured vault not found"}
          </p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {!vaultPath
              ? "Tasks are stored as Markdown files in a dedicated Obsidian vault. Choose an existing vault folder or an empty one to initialize."
              : `The configured vault folder no longer exists: ${vaultPath}`}
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={chooseVaultFolder}>
          <FolderOpen className="size-3.5" /> Choose vault folder
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex items-center gap-2 overflow-x-auto border-b px-4 py-2">
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setDialog({ mode: "create" })}>
          <Plus className="size-3.5" /> New task
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={() => refreshTasks(vaultPath)}
        >
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={initializing} onClick={initVault}>
              {initializing ? "Initializing…" : "Init vault"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Copy the default vault template into the configured vault folder. Existing files are never
            overwritten.
          </TooltipContent>
        </Tooltip>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger size="sm" className="min-w-[7rem]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All statuses</SelectItem>
            {(["inbox", "todo", "doing", "review", "done"] as TaskStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger size="sm" className="min-w-[7.5rem]">
            <SelectValue placeholder="All assignees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All assignees</SelectItem>
            {(["me", "claude-code", "opencode"] as TaskAssignee[]).map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger size="sm" className="min-w-[7rem]">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All projects</SelectItem>
            {knownProjects.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger size="sm" className="min-w-[6.5rem]">
            <SelectValue placeholder="All tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All tags</SelectItem>
            {knownTags.map((t) => (
              <SelectItem key={t} value={t}>
                #{t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors",
            showArchived ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent/50",
          )}
          title={showArchived ? "Hide archived tasks" : "Show archived tasks"}
          onClick={() => setShowArchived((v) => !v)}
        >
          <Archive className="size-3.5" /> Archived
        </button>

        {terminalEnabled && (
          <Button
            size="sm"
            variant={terminalOpen ? "secondary" : "outline"}
            className="h-8 gap-1.5 text-xs"
            onClick={toggleTerminalPanel}
            title="Toggle the embedded terminal (herdr)"
          >
            <TerminalIcon className="size-3.5" /> Terminal
          </Button>
        )}

        <div className="ml-auto flex shrink-0 items-center overflow-hidden rounded-md border">
          <button
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 text-xs transition-colors",
              viewMode === "list" ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent/50",
            )}
            onClick={() => setViewMode("list")}
          >
            <List className="size-3.5" /> List
          </button>
          <button
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 text-xs transition-colors",
              viewMode === "kanban" ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent/50",
            )}
            onClick={() => setViewMode("kanban")}
          >
            <LayoutGrid className="size-3.5" /> Kanban
          </button>
        </div>
      </div>

      {/* body */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {(() => {
          const boardContent =
            viewMode === "list" ? (
              <TaskList
                tasks={visible}
                onOpen={(task) => setDialog({ mode: "edit", task })}
                onLaunchAgent={launchAgent}
                onCopyTaskPrompt={copyTaskPrompt}
                onArchive={setArchived}
                onDelete={setDeleteTarget}
              />
            ) : (
              <TaskKanban
                tasks={visible}
                onOpen={(task) => setDialog({ mode: "edit", task })}
                onMove={(updates) => void applyUpdates(updates)}
                onLaunchAgent={launchAgent}
                onCopyTaskPrompt={copyTaskPrompt}
                onArchive={setArchived}
                onArchiveDone={() => setArchiveDoneOpen(true)}
                onDelete={setDeleteTarget}
              />
            );

          if (!terminalEnabled) return boardContent;

          // The terminal panel stays mounted (via a collapsible ResizablePanel,
          // collapsedSize 0) even while hidden, so the herdr client's PTY
          // session and its Tauri event subscriptions survive show/hide —
          // only the panel's size and CSS visibility toggle.
          return (
            <ResizablePanelGroup orientation="vertical" className="h-full">
              <ResizablePanel
                id="board"
                panelRef={boardPanelRef}
                minSize="20%"
                collapsedSize={0}
                collapsible
                className="min-h-0"
              >
                {boardContent}
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel
                id="terminal"
                panelRef={terminalPanelRef}
                defaultSize={0}
                collapsedSize={0}
                collapsible
                minSize="15%"
                className="min-h-0"
              >
                <TerminalPanel
                  visible={terminalOpen}
                  maximized={terminalMaximized}
                  onToggleMaximize={toggleTerminalMaximize}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          );
        })()}
      </main>

      {/* status bar */}
      <footer className="flex items-center border-t px-4 py-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">{status}</span>
        <span className="ml-auto shrink-0">
          {tasks.length} tasks · {visible.length} shown
        </span>
      </footer>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete task"
        description={
          deleteTarget
            ? `Move "${deleteTarget.id} ${deleteTarget.title}" to the recycle bin?`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={archiveDoneOpen}
        title="Archive all Done tasks"
        description={
          doneToArchive.length === 1
            ? "Archive the 1 task in the Done column?"
            : `Archive all ${doneToArchive.length} tasks in the Done column?`
        }
        confirmLabel="Archive"
        onConfirm={confirmArchiveDone}
        onClose={() => setArchiveDoneOpen(false)}
      />

      <TaskDialog
        open={dialog !== null}
        mode={dialog?.mode ?? "create"}
        task={editingTask}
        knownProjects={knownProjects}
        onClose={() => setDialog(null)}
        onCreate={dialog?.mode === "create" ? (draft) => void createTask(draft) : undefined}
        onAutoSave={dialog?.mode === "edit" ? (draft) => autoSaveTask(draft) : undefined}
        onLaunchAgent={dialog?.mode === "edit" ? launchAgent : undefined}
        onCopyTaskPrompt={dialog?.mode === "edit" ? copyTaskPrompt : undefined}
      />
    </div>
  );
}
