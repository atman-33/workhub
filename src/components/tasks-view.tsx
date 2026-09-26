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
  Wrench,
} from "lucide-react";
import { BlockedDialog } from "@/components/blocked-dialog";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { RecurringDialog } from "@/components/recurring-dialog";
import { TerminalSettings } from "@/components/tasks/terminal-settings";
import { TaskKanban } from "@/components/task-kanban";
import { TaskList } from "@/components/task-list";
import { TerminalPanel } from "@/components/terminal-panel";
import { VaultSetupDialog } from "@/components/vault-setup-dialog";
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
import { t as i18nT, useT } from "@/lib/i18n";
import { TASK_ASSIGNEE_LABEL_KEY, TASK_STATUS_LABEL_KEY } from "@/lib/i18n/labels";
import {
  copyTaskPrompt as copyPromptForTask,
  launchAgentForTask,
  sendTaskToClaudeDesktop as sendToClaudeDesktop,
} from "@/lib/task-actions";
import { TASK_EDITOR_TERMINAL_PANEL_EVENT } from "@/lib/task-editor-bridge";
import type { TabFocus } from "@/lib/tab-focus";
import { isStaleBlock } from "@/lib/task-blocked";
import { cn } from "@/lib/utils";
import { taskProjectFilterLabel, projectOptionsOf } from "@/lib/vault-project";
import type { Config, Settings, Task, TaskAssignee, TaskPriority, TaskStatus, UpdateTaskInput, VaultProject } from "@/types";

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
  const t = useT();
  const [config, setConfig] = useState<Config | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  /** Vault projects (`projects/<slug>/`), the only thing a task's `project:`
   *  may name. Not the Repos tab's registered repositories: those are reached
   *  through a project's `repos:`, never from a task directly (T-0219). */
  const [vaultProjects, setVaultProjects] = useState<VaultProject[]>([]);
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
  /**
   * First-run setup. Opened right after a vault folder is chosen, and again
   * from the empty state when that run was postponed — choosing the folder is
   * only the first of three steps, and the other two are what a new install
   * used to be left to discover on its own (T-0297).
   */
  const [setupOpen, setSetupOpen] = useState(false);
  /** False once setup has been run or dismissed for this vault this session. */
  const [setupPending, setSetupPending] = useState(false);
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
  const herdrEnabled = config?.settings.use_herdr ?? false;
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
      .catch((e) => setStatus(i18nT("task.msg.loadFailed", { error: String(e) })));
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
        setStatus(i18nT("task.msg.vaultCheckFailed", { error: String(e) }));
        setVaultExists(false);
      }
    })();
  }, [configVersion]);

  // ---- the Project suggestions: every vault project, reloaded whenever one
  // is created, archived or restored (`projectsVersion`), and again when a
  // folder appears or disappears outside the app (Obsidian, an agent) ----
  const refreshVaultProjects = useCallback((path: string | null | undefined) => {
    if (!path) {
      setVaultProjects([]);
      return;
    }
    // A failure here costs suggestions, not the board — leave the last list.
    void api.listVaultProjects(path, false).then(setVaultProjects).catch(() => {});
  }, []);

  useEffect(() => {
    refreshVaultProjects(vaultPath);
  }, [vaultPath, projectsVersion, refreshVaultProjects]);

  useEffect(() => {
    const unlisten = listen("projects-changed", () => refreshVaultProjects(vaultPath));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [vaultPath, refreshVaultProjects]);

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

  // Patched onto a fresh read rather than onto the copy held here: every save
  // writes the whole struct, so a stale copy would revert what another tab
  // changed meanwhile (T-0281).
  const setTerminalEmbed = useCallback(
    async (embed: boolean) => {
      const next = await api.patchSettings({ terminal_embed: embed });
      setConfig(next);
      onSettingsChange?.(next.settings);
    },
    [onSettingsChange],
  );

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
    const picked = await pickFolders({
      directory: true,
      title: i18nT("task.empty.chooseFolderDialogTitle"),
    });
    if (typeof picked === "string") {
      await saveVaultPath(picked.replaceAll("\\", "/"));
      // The folder is one of three steps, and the dialog is what tells the
      // owner so. It re-checks what is already true, so opening it for a vault
      // that is fully set up costs a glance, not a run.
      setSetupPending(true);
      setSetupOpen(true);
    }
  }, [saveVaultPath]);

  const initVault = useCallback(async () => {
    if (!vaultPath) return;
    setInitializing(true);
    try {
      await api.initVault(vaultPath);
      setStatus(i18nT("task.msg.vaultInitialized"));
      refreshTasks(vaultPath);
    } catch (e) {
      setStatus(i18nT("task.msg.vaultInitFailed", { error: String(e) }));
    } finally {
      setInitializing(false);
    }
  }, [vaultPath, refreshTasks]);

  // Choices for the Project field: the vault's projects, and nothing else.
  // Offering registered repository names here is what produced the "unknown
  // projects" the Projects tab reports — the field was recommending values
  // that the rest of the app then flags as orphans (T-0219).
  //
  // Ordered by folder name rather than by slug, so the list reads in the order
  // the owner arranged their projects in (T-0282); drawn with each project's
  // sort number beside it for the task editor and the recurring-rule dialog
  // (T-0286). Display only: both fields still commit the slug.
  const { slugs: knownProjects, folders: projectFolders } = useMemo(
    () => projectOptionsOf(vaultProjects),
    [vaultProjects],
  );

  // Switching to the board drops the status filter with it: the picker is
  // hidden there (the columns are the statuses), and a filter you cannot see
  // is one you cannot undo.
  const showKanban = useCallback(() => {
    setViewMode("kanban");
    setStatusFilter("");
  }, []);

  // The toolbar filter answers a different question — "narrow what is on the
  // board" — so it also lists values tasks actually carry, including ones no
  // project answers to. Without them a mis-filed task cannot be filtered for,
  // which is when you most want to find it.
  //
  // Ordered like the pickers (T-0335): known projects stay in folder order,
  // unknown values go last alphabetically. A plain `.sort()` here put the
  // filter in slug order, matching neither Obsidian nor the Projects tab.
  const filterProjects = useMemo(() => {
    const known = new Set(knownProjects);
    const unknown = Array.from(
      new Set(
        tasks
          .map((t) => t.project)
          .filter(Boolean)
          .filter((p) => !known.has(p)),
      ),
    ).sort();
    return [...knownProjects, ...unknown];
  }, [knownProjects, tasks]);

  // Display label for the filter: the `NNNN` sort number beside a known slug,
  // like the task editor and recurring-rule pickers (T-0282/T-0286), and an
  // `(unregistered)` marker on values no project answers to — display only,
  // the filter still compares bare values. Without the marker a mis-filed
  // value reads as a duplicate of the project it resembles.
  const knownProjectSet = useMemo(() => new Set(knownProjects), [knownProjects]);
  const projectFilterLabel = useCallback(
    (value: string) => taskProjectFilterLabel(value, projectFolders, knownProjectSet),
    [projectFolders, knownProjectSet],
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
        setStatus(i18nT("task.msg.launchFailed", { error: String(e) }));
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
        setStatus(i18nT("task.msg.copiedPrompt", { id: task.id }));
      } catch (e) {
        setStatus(i18nT("task.msg.copyFailed", { error: String(e) }));
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
        setStatus(i18nT("task.msg.sendFailed", { error: String(e) }));
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
      setStatus(i18nT("task.msg.openObsidianFailed", { error: String(e) }));
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
        setStatus(i18nT("task.msg.updateFailed", { error: String(e) }));
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
      setStatus(i18nT("task.msg.deleted", { id: target.id }));
      refreshTasks(vaultPath);
    } catch (e) {
      setStatus(i18nT("task.msg.deleteFailed", { error: String(e) }));
    }
  }, [vaultPath, deleteTarget, refreshTasks]);

  // Opening a task hands the whole form off to the editor window: it owns
  // the draft, the autosave and the create call from here on. Nothing comes
  // back — the vault watcher's `tasks-changed` refreshes the board when the
  // editor writes (see tasks.rs::start_watcher).
  //
  // The project list is re-read here rather than taken from state: another
  // window, Obsidian or an agent may have created a project since the board
  // last reloaded, and the payload would otherwise freeze that stale list
  // into the editor (T-0343). A failed re-read falls back to the board's
  // copy — opening with a stale list beats not opening at all.
  const openEditor = useCallback(
    (mode: "create" | "edit", task: Task | null) => {
      const open = (projects: VaultProject[]) => {
        const { slugs, folders } = projectOptionsOf(projects);
        void api
          .openTaskEditor({ mode, task, knownProjects: slugs, projectFolders: folders })
          .catch((e) => {
            setStatus(i18nT("task.msg.openEditorFailed", { error: String(e) }));
          });
      };
      if (vaultPath) {
        void api
          .listVaultProjects(vaultPath, false)
          .then(open)
          .catch(() => open(vaultProjects));
      } else {
        open([]);
      }
    },
    [vaultPath, vaultProjects],
  );

  // Rendered from both branches below: the dialog has to survive the moment
  // the board replaces the empty state, which is exactly when it opens.
  const setupDialog = vaultPath ? (
    <VaultSetupDialog
      vaultPath={vaultPath}
      open={setupOpen}
      onClose={() => setSetupOpen(false)}
      onDone={() => {
        setSetupPending(false);
        refreshTasks(vaultPath);
      }}
    />
  ) : null;

  if (!config || vaultExists === null) return null;

  if (!vaultPath || !vaultExists) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <FolderOpen className="size-10 text-muted-foreground/40" />
        <div>
          <p className="font-semibold">
            {!vaultPath ? t("task.empty.noVaultTitle") : t("task.empty.vaultNotFoundTitle")}
          </p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {!vaultPath
              ? t("task.empty.noVaultDescription")
              : t("task.empty.vaultNotFoundDescription", { path: vaultPath })}
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={chooseVaultFolder}>
          <FolderOpen className="size-3.5" /> {t("task.empty.chooseFolder")}
        </Button>
        {setupDialog}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {setupDialog}
      {/* Only after the setup dialog was postponed — the three steps are not
          optional, so the way back to them must not be the folder picker. */}
      {setupPending && !setupOpen && (
        <div className="flex items-center gap-3 bg-muted px-4 py-2 text-[13px]">
          <Wrench className="size-4 shrink-0 text-primary" />
          <span className="truncate">
            <span className="font-medium">{t("task.setupPending.text")}</span>{" "}
            {t("task.setupPending.detail")}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-6 shrink-0 px-2 text-xs"
            onClick={() => setSetupOpen(true)}
          >
            {t("task.setupPending.resume")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs text-muted-foreground"
            onClick={() => setSetupPending(false)}
          >
            {t("common.dismiss")}
          </Button>
        </div>
      )}
      {/* toolbar */}
      <div className="flex items-center gap-2 overflow-x-auto border-b px-4 py-2">
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openEditor("create", null)}>
          <Plus className="size-3.5" /> {t("task.toolbar.newTask")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={() => refreshTasks(vaultPath)}
        >
          <RefreshCw className="size-3.5" /> {t("common.refresh")}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={initializing} onClick={initVault}>
              {initializing ? t("task.toolbar.initializing") : t("task.toolbar.initVault")}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("task.toolbar.initVaultTooltip")}</TooltipContent>
        </Tooltip>

        {/* List view only. On the kanban board the columns *are* the statuses,
            so filtering by one leaves a single column standing with nothing on
            screen to say why. The list is flat and shows status as a badge, so
            there this is the only way to narrow by it. */}
        {viewMode === "list" && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger size="sm" className="min-w-[7rem]">
              <SelectValue placeholder={t("task.toolbar.allStatuses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t("task.toolbar.allStatuses")}</SelectItem>
              {(["inbox", "todo", "doing", "review", "done"] as TaskStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {t(TASK_STATUS_LABEL_KEY[s])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger size="sm" className="min-w-[7.5rem]">
            <SelectValue placeholder={t("task.toolbar.allAssignees")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t("task.toolbar.allAssignees")}</SelectItem>
            {(["me", "claude-code", "opencode"] as TaskAssignee[]).map((a) => (
              <SelectItem key={a} value={a}>
                {t(TASK_ASSIGNEE_LABEL_KEY[a])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger size="sm" className="min-w-[7rem]">
            <SelectValue placeholder={t("task.toolbar.allProjects")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t("task.toolbar.allProjects")}</SelectItem>
            {filterProjects.map((p) => (
              <SelectItem key={p} value={p}>
                {projectFilterLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger size="sm" className="min-w-[6.5rem]">
            <SelectValue placeholder={t("task.toolbar.allTags")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t("task.toolbar.allTags")}</SelectItem>
            {knownTags.map((tag) => (
              <SelectItem key={tag} value={tag}>
                #{tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex shrink-0 items-center gap-1.5">
          <Select value={blockedFilter} onValueChange={setBlockedFilter}>
            <SelectTrigger size="sm" className="min-w-[7.5rem]">
              <SelectValue placeholder={t("task.toolbar.blockedAny")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t("task.toolbar.blockedAny")}</SelectItem>
              <SelectItem value="blocked">{t("task.toolbar.blockedOnly")}</SelectItem>
              <SelectItem value="unblocked">{t("task.toolbar.notBlocked")}</SelectItem>
            </SelectContent>
          </Select>
          {/* The cards say nothing about a block going stale — this does, once
              for the whole board. Clicking it narrows to the waiting tasks. */}
          {blockedCount > 0 && (
            <Hint
              label={
                staleBlockedCount > 0
                  ? t("task.toolbar.blockedHintStale", {
                      count: blockedCount,
                      stale: staleBlockedCount,
                    })
                  : t("task.toolbar.blockedHint", { count: blockedCount })
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

        <Hint label={showArchived ? t("task.toolbar.hideArchived") : t("task.toolbar.showArchived")}>
          <button
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors",
              showArchived ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent/50",
            )}
            onClick={() => setShowArchived((v) => !v)}
          >
            <Archive className="size-3.5" /> {t("task.toolbar.archivedLabel")}
          </button>
        </Hint>

        <Hint label={t("task.toolbar.recurringHint")}>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setRecurringOpen(true)}
          >
            <Repeat className="size-3.5" /> {t("task.toolbar.recurring")}
            {activeRuleCount > 0 && (
              <span className="text-[11px] text-muted-foreground">{activeRuleCount}</span>
            )}
          </Button>
        </Hint>

        {/* Only this tab reads `terminal_embed`, so its switch sits beside the
            toggle it governs rather than in the settings dialog (T-0300). */}
        {herdrEnabled && (
          <div className="flex shrink-0 items-center gap-0.5">
            {terminalEnabled && (
              <Hint label={t("task.toolbar.terminalHint")}>
                <Button
                  size="sm"
                  variant={terminalOpen ? "secondary" : "outline"}
                  className="h-8 gap-1.5 text-xs"
                  onClick={toggleTerminalPanel}
                >
                  <TerminalIcon className="size-3.5" /> {t("task.toolbar.terminal")}
                </Button>
              </Hint>
            )}
            <TerminalSettings
              embed={terminalEnabled}
              onEmbedChange={(embed) => void setTerminalEmbed(embed)}
            />
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center overflow-hidden rounded-md border">
          <button
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 text-xs transition-colors",
              viewMode === "list" ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent/50",
            )}
            onClick={() => setViewMode("list")}
          >
            <List className="size-3.5" /> {t("task.toolbar.list")}
          </button>
          <button
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 text-xs transition-colors",
              viewMode === "kanban" ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent/50",
            )}
            onClick={() => showKanban()}
          >
            <LayoutGrid className="size-3.5" /> {t("task.toolbar.kanban")}
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
          {t("task.footer.summary", { total: tasks.length, shown: visible.length })}
        </span>
      </footer>

      <BlockedDialog
        task={blockedTarget}
        onSave={saveBlockedNote}
        onClose={() => setBlockedTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("task.confirm.deleteTitle")}
        description={
          deleteTarget
            ? t("task.confirm.deleteDescription", {
                id: deleteTarget.id,
                title: deleteTarget.title,
              })
            : ""
        }
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={archiveDoneOpen}
        title={t("task.kanban.archiveAllDone")}
        description={
          doneToArchive.length === 1
            ? t("task.confirm.archiveDoneDescriptionOne")
            : t("task.confirm.archiveDoneDescriptionOther", { count: doneToArchive.length })
        }
        confirmLabel={t("task.list.archive")}
        onConfirm={confirmArchiveDone}
        onClose={() => setArchiveDoneOpen(false)}
      />

      <RecurringDialog
        open={recurringOpen}
        onClose={() => setRecurringOpen(false)}
        knownProjects={knownProjects}
        projectFolders={projectFolders}
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
