import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as pickFolders } from "@tauri-apps/plugin-dialog";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  Archive,
  FolderOpen,
  LayoutGrid,
  List,
  PauseCircle,
  Plus,
  RefreshCw,
  Repeat,
  Terminal as TerminalIcon,
} from "lucide-react";
import { BlockedDialog } from "@/components/blocked-dialog";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { RecurringDialog } from "@/components/recurring-dialog";
import { TaskKanban } from "@/components/task-kanban";
import { TaskList } from "@/components/task-list";
import { TerminalPanel } from "@/components/terminal-panel";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
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
import { api } from "@/lib/api";
import {
  copyTaskPrompt as copyPromptForTask,
  launchAgentForTask,
  sendTaskToClaudeDesktop as sendToClaudeDesktop,
} from "@/lib/task-actions";
import { TASK_EDITOR_TERMINAL_PANEL_EVENT } from "@/lib/task-editor-bridge";
import type { TabFocus } from "@/lib/tab-focus";
import { isStaleBlock } from "@/lib/task-blocked";
import { cn } from "@/lib/utils";
import type { Config, Settings, Task, TaskAssignee, TaskPriority, TaskStatus, UpdateTaskInput } from "@/types";

/** Height the bottom terminal panel snaps to when opened. */
const TERMINAL_PANEL_SIZE = 35;

type ViewMode = "list" | "kanban";

interface Props {
  /** Bumped by the app shell after settings are saved; triggers a config reload. */
  configVersion: number;
  /**
   * Bumped by the app shell when the Repos view changes the registered
   * repositories; triggers a config reload so the Project field's suggestions
   * stay current without an app restart.
   */
  projectsVersion?: number;
  /** Notifies the app shell that settings have changed so it can keep its own copy in sync. */
  onSettingsChange?: (settings: Settings) => void;
  /** A project the Projects tab asked this view to filter down to (T-0190). */
  focus?: TabFocus;
}

export function TasksView({
  configVersion,
  projectsVersion = 0,
  onSettingsChange,
  focus,
}: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  /** "" = any, "blocked" = only waiting tasks, "unblocked" = what's actionable. */
  const [blockedFilter, setBlockedFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  /** Task whose blocked reason is being edited in the one-field dialog. */
  const [blockedTarget, setBlockedTarget] = useState<Task | null>(null);
  const [archiveDoneOpen, setArchiveDoneOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [initializing, setInitializing] = useState(false);
  const [vaultExists, setVaultExists] = useState<boolean | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalMaximized, setTerminalMaximized] = useState(false);
  const terminalPanelRef = useRef<PanelImperativeHandle>(null);
  const boardPanelRef = useRef<PanelImperativeHandle>(null);
  // Last user-chosen terminal height (percent); open/restore return to it
  // instead of the default split. Mirrors `terminalMaximized` in a ref so the
  // panel's onResize callback (which fires during our own collapse/expand
  // calls) can tell user drags apart from the maximize transition.
  const lastTerminalSizeRef = useRef(TERMINAL_PANEL_SIZE);
  const terminalMaximizedRef = useRef(false);

  const vaultPath = config?.settings.vault_path ?? null;
  const terminalEnabled = config?.settings.terminal_embed ?? false;
  const activeRuleCount = (config?.settings.recurring ?? []).filter((r) => r.enabled).length;

  const restoreTerminalSize = useCallback(() => {
    terminalMaximizedRef.current = false;
    setTerminalMaximized(false);
    // The board may be collapsed by a maximized terminal; it must be expanded
    // explicitly — resizing the neighbor does not un-collapse it.
    boardPanelRef.current?.expand();
    terminalPanelRef.current?.resize(`${lastTerminalSizeRef.current}%`);
  }, []);

  const openTerminalPanel = useCallback(() => {
    setTerminalOpen((prev) => {
      if (!prev) terminalPanelRef.current?.resize(`${lastTerminalSizeRef.current}%`);
      return true;
    });
  }, []);

  const toggleTerminalPanel = useCallback(() => {
    setTerminalOpen((prev) => {
      const next = !prev;
      if (next) {
        terminalPanelRef.current?.resize(`${lastTerminalSizeRef.current}%`);
      } else {
        terminalMaximizedRef.current = false;
        setTerminalMaximized(false);
        boardPanelRef.current?.expand();
        terminalPanelRef.current?.collapse();
      }
      return next;
    });
  }, []);

  const toggleTerminalMaximize = useCallback(() => {
    if (terminalMaximizedRef.current) {
      restoreTerminalSize();
    } else {
      terminalMaximizedRef.current = true;
      setTerminalMaximized(true);
      boardPanelRef.current?.collapse();
    }
  }, [restoreTerminalSize]);

  const refreshTasks = useCallback((path: string) => {
    void api
      .listTasks(path)
      .then(setTasks)
      .catch((e) => setStatus(`Failed to load tasks — ${e}`));
  }, []);

  // ---- startup + after app-level settings saves: load config ----
  // A project handed over by the Projects tab. Keyed on the request counter
  // rather than the object, so a parent re-render never re-applies it over a
  // filter the user changed here since.
  const focusN = focus?.n ?? 0;
  const focusProject = focus?.value ?? "";
  useEffect(() => {
    if (focusN > 0 && focusProject) setProjectFilter(focusProject);
  }, [focusN, focusProject]);

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

  // ---- after a repo add/remove/rename: refresh the Project suggestions ----
  useEffect(() => {
    if (projectsVersion === 0) return;
    void api.getConfig().then(setConfig);
  }, [projectsVersion]);

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
      await api.initVault(vaultPath);
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

  // Everything except the blocked filter. The toolbar's blocked counter reads
  // this rather than `visible`, so switching to "Not blocked" doesn't zero out
  // the very number that says how much is waiting.
  const scoped = useMemo(
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

  const visible = useMemo(
    () =>
      scoped.filter((t) => {
        if (blockedFilter === "blocked" && !t.blocked) return false;
        if (blockedFilter === "unblocked" && t.blocked) return false;
        return true;
      }),
    [scoped, blockedFilter],
  );

  // Blocked tasks in scope, and how many of those nobody has chased in a week.
  // The stale count is the one warning left in colour anywhere in the feature:
  // the cards stay quiet, and this is where a forgotten block surfaces.
  const blockedCount = useMemo(() => scoped.filter((t) => t.blocked).length, [scoped]);
  const staleBlockedCount = useMemo(
    () => scoped.filter((t) => t.blocked && isStaleBlock(t.blocked_since)).length,
    [scoped],
  );

  // In embedded mode the panel (which starts the herdr client) has to be up
  // before Rust launches — Rust polls briefly for the server to come up instead
  // of spawning an external `wt` window (see herdr::ensure_server).
  const prepareTerminalForLaunch = useCallback(() => {
    if (config?.settings.terminal_embed && config.settings.use_herdr) {
      openTerminalPanel();
    }
  }, [config, openTerminalPanel]);

  // Returns the launch promise so callers (the animated LaunchAgentButton) can
  // sync their feedback to it; still surfaces the outcome in the status bar.
  const launchAgent = useCallback(
    async (task: Task) => {
      if (!config) return;
      prepareTerminalForLaunch();
      try {
        setStatus(await launchAgentForTask(config, task));
      } catch (e) {
        setStatus(`Agent launch failed — ${e}`);
        throw e;
      }
    },
    [config, prepareTerminalForLaunch],
  );

  const copyTaskPrompt = useCallback(
    async (task: Task) => {
      if (!config) return;
      try {
        await copyPromptForTask(config, task);
        setStatus(`Copied prompt for ${task.id}`);
      } catch (e) {
        setStatus(`Copy prompt failed — ${e}`);
        throw e;
      }
    },
    [config],
  );

  const sendTaskToClaudeDesktop = useCallback(
    async (task: Task) => {
      if (!config) return;
      try {
        setStatus(await sendToClaudeDesktop(config, task));
      } catch (e) {
        setStatus(`Send to Claude Desktop failed — ${e}`);
        throw e;
      }
    },
    [config],
  );

  // The editor runs in its own window, so an agent launched from there cannot
  // open the terminal panel itself — it asks for it here instead.
  useEffect(() => {
    const unlisten = listen(TASK_EDITOR_TERMINAL_PANEL_EVENT, () => prepareTerminalForLaunch());
    return () => {
      void unlisten.then((f) => f());
    };
  }, [prepareTerminalForLaunch]);

  // Jump straight to the task file in Obsidian from a card/row, without
  // opening the edit dialog. Errors land in the status bar; rethrown so the
  // button can settle its busy state.
  const openTaskInObsidian = useCallback(async (task: Task) => {
    try {
      await api.openInObsidian(task.file);
    } catch (e) {
      setStatus(`Open in Obsidian failed — ${e}`);
      throw e;
    }
  }, []);

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

  const cyclePriority = useCallback(
    (task: Task, next: TaskPriority) => {
      void applyUpdates([{ id: task.id, priority: next }]);
    },
    [applyUpdates],
  );

  // Context menu / badge click: clearing the flag also clears the note and the
  // date (see `update_task`), so an unblocked task carries nothing stale.
  const unblockTask = useCallback(
    (task: Task) => {
      void applyUpdates([{ id: task.id, blocked: false }]);
    },
    [applyUpdates],
  );

  // Saving from the one-field dialog always blocks the task: it is reached
  // both from an already-blocked task (editing the reason) and from a free one
  // (recording the block), and `update_task` stamps today's date on the
  // transition.
  const saveBlockedNote = useCallback(
    (task: Task, note: string) => {
      void applyUpdates([{ id: task.id, blocked: true, blockedNote: note }]);
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

  // Opening a task hands the whole form off to the editor window: it owns
  // the draft, the autosave and the create call from here on. Nothing comes
  // back — the vault watcher's `tasks-changed` refreshes the board when the
  // editor writes (see tasks.rs::start_watcher).
  const openEditor = useCallback(
    (mode: "create" | "edit", task: Task | null) => {
      void api.openTaskEditor({ mode, task, knownProjects }).catch((e) => {
        setStatus(`Could not open the task editor — ${e}`);
      });
    },
    [knownProjects],
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
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openEditor("create", null)}>
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
        <div className="flex shrink-0 items-center gap-1.5">
          <Select value={blockedFilter} onValueChange={setBlockedFilter}>
            <SelectTrigger size="sm" className="min-w-[7.5rem]">
              <SelectValue placeholder="Blocked: any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Blocked: any</SelectItem>
              <SelectItem value="blocked">Blocked only</SelectItem>
              <SelectItem value="unblocked">Not blocked</SelectItem>
            </SelectContent>
          </Select>
          {/* The cards say nothing about a block going stale — this does, once
              for the whole board. Clicking it narrows to the waiting tasks. */}
          {blockedCount > 0 && (
            <Hint
              label={
                staleBlockedCount > 0
                  ? `${blockedCount} blocked · ${staleBlockedCount} waiting a week or more`
                  : `${blockedCount} blocked`
              }
            >
              <button
                className="flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/50"
                onClick={() => setBlockedFilter("blocked")}
              >
                <PauseCircle className="size-3.5" />
                {blockedCount}
                {staleBlockedCount > 0 && (
                  <span className="size-1.5 rounded-full bg-amber-400" aria-hidden />
                )}
              </button>
            </Hint>
          )}
        </div>

        <Hint label={showArchived ? "Hide archived tasks" : "Show archived tasks"}>
          <button
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors",
              showArchived ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent/50",
            )}
            onClick={() => setShowArchived((v) => !v)}
          >
            <Archive className="size-3.5" /> Archived
          </button>
        </Hint>

        <Hint label="Rules that put a task on the board on their own schedule">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setRecurringOpen(true)}
          >
            <Repeat className="size-3.5" /> Recurring
            {activeRuleCount > 0 && (
              <span className="text-[11px] text-muted-foreground">{activeRuleCount}</span>
            )}
          </Button>
        </Hint>

        {terminalEnabled && (
          <Hint label="Toggle the embedded terminal (herdr)">
            <Button
              size="sm"
              variant={terminalOpen ? "secondary" : "outline"}
              className="h-8 gap-1.5 text-xs"
              onClick={toggleTerminalPanel}
            >
              <TerminalIcon className="size-3.5" /> Terminal
            </Button>
          </Hint>
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
                onOpen={(task) => openEditor("edit", task)}
                onLaunchAgent={launchAgent}
                onCopyTaskPrompt={copyTaskPrompt}
                onSendToClaudeDesktop={sendTaskToClaudeDesktop}
                claudeDesktopMode={config?.settings.claude_desktop_mode ?? "code"}
                onOpenInObsidian={openTaskInObsidian}
                onCyclePriority={cyclePriority}
                onEditBlocked={setBlockedTarget}
                onUnblock={unblockTask}
                onArchive={setArchived}
                onDelete={setDeleteTarget}
              />
            ) : (
              <TaskKanban
                tasks={visible}
                onOpen={(task) => openEditor("edit", task)}
                onMove={(updates) => void applyUpdates(updates)}
                onLaunchAgent={launchAgent}
                onCopyTaskPrompt={copyTaskPrompt}
                onSendToClaudeDesktop={sendTaskToClaudeDesktop}
                claudeDesktopMode={config?.settings.claude_desktop_mode ?? "code"}
                onOpenInObsidian={openTaskInObsidian}
                onCyclePriority={cyclePriority}
                onEditBlocked={setBlockedTarget}
                onUnblock={unblockTask}
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
                onResize={(size) => {
                  // Remember the height the user actually dragged the panel
                  // to; skip the collapse (0) and maximize (100) transitions.
                  if (!terminalMaximizedRef.current && size.asPercentage > 0) {
                    lastTerminalSizeRef.current = size.asPercentage;
                  }
                }}
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

      <BlockedDialog
        task={blockedTarget}
        onSave={saveBlockedNote}
        onClose={() => setBlockedTarget(null)}
      />

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

      <RecurringDialog
        open={recurringOpen}
        onClose={() => setRecurringOpen(false)}
        // Keep the toolbar count (and any later config read) in step with what
        // the dialog just wrote, without a full config reload.
        onSaved={(recurring) =>
          setConfig((prev) =>
            prev ? { ...prev, settings: { ...prev.settings, recurring } } : prev,
          )
        }
      />
    </div>
  );
}
