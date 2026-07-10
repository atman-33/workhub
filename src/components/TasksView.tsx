import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as pickFolders } from "@tauri-apps/plugin-dialog";
import { FolderOpen, LayoutGrid, List, Plus, RefreshCw } from "lucide-react";
import { TaskDialog, type TaskDraft } from "@/components/TaskDialog";
import { TaskKanban } from "@/components/TaskKanban";
import { TaskList } from "@/components/TaskList";
import { Button } from "@/components/ui/button";
import { api, DEV_VAULT_TEMPLATE_SOURCE } from "@/lib/api";
import { buildBody, parseBody } from "@/lib/taskBody";
import { cn } from "@/lib/utils";
import type { Config, Task, TaskAssignee, TaskStatus } from "@/types";

type ViewMode = "list" | "kanban";
type DialogState = { mode: "create" } | { mode: "edit"; task: Task } | null;

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface Props {
  /** Bumped by the app shell after settings are saved; triggers a config reload. */
  configVersion: number;
}

export function TasksView({ configVersion }: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [status, setStatus] = useState("");
  const [initializing, setInitializing] = useState(false);

  const vaultPath = config?.settings.vault_path ?? null;

  const refreshTasks = useCallback((path: string) => {
    void api
      .listTasks(path)
      .then(setTasks)
      .catch((e) => setStatus(`Failed to load tasks — ${e}`));
  }, []);

  // ---- startup + after app-level settings saves: load config ----
  useEffect(() => {
    void api.getConfig().then(setConfig);
  }, [configVersion]);

  // ---- watch + initial load once a vault is configured ----
  useEffect(() => {
    if (!vaultPath) return;
    void api.watchVault(vaultPath);
    refreshTasks(vaultPath);
  }, [vaultPath, refreshTasks]);

  // ---- react to external vault edits ----
  useEffect(() => {
    if (!vaultPath) return;
    const unlisten = listen("tasks-changed", () => refreshTasks(vaultPath));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [vaultPath, refreshTasks]);

  const saveVaultPath = useCallback(
    async (path: string) => {
      const cfg = await api.getConfig();
      const next: Config = { ...cfg, settings: { ...cfg.settings, vault_path: path } };
      await api.saveConfig(next);
      setConfig(next);
    },
    [],
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

  const knownProjects = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.project).filter(Boolean))).sort(),
    [tasks],
  );

  const visible = useMemo(
    () =>
      tasks.filter((t) => {
        if (statusFilter && t.status !== statusFilter) return false;
        if (assigneeFilter && t.assignee !== assigneeFilter) return false;
        if (projectFilter && t.project !== projectFilter) return false;
        return true;
      }),
    [tasks, statusFilter, assigneeFilter, projectFilter],
  );

  const launchAgent = useCallback(
    (task: Task) => {
      if (!config) return;
      void api
        .launchAgentForTask(config.settings.agent_cmd, task.id, task.file, task.project)
        .then(() => setStatus(`Launched agent for ${task.id}`))
        .catch((e) => setStatus(`Agent launch failed — ${e}`));
    },
    [config],
  );

  const changeStatus = useCallback(
    (task: Task, next: TaskStatus) => {
      if (!vaultPath) return;
      void api
        .updateTask(vaultPath, { id: task.id, status: next })
        .then(() => refreshTasks(vaultPath))
        .catch((e) => setStatus(`Update failed — ${e}`));
    },
    [vaultPath, refreshTasks],
  );

  const submitDialog = useCallback(
    async (draft: TaskDraft) => {
      if (!vaultPath) return;
      const tags = draft.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      try {
        if (dialog?.mode === "edit") {
          const original = dialog.task;
          const parsed = parseBody(original.body);
          const bodyChanged = draft.content !== parsed.content;
          await api.updateTask(vaultPath, {
            id: original.id,
            title: draft.title,
            status: draft.status,
            assignee: draft.assignee,
            project: draft.project,
            priority: draft.priority,
            due: draft.due,
            tags,
            body: bodyChanged ? buildBody(parsed, draft.content) : undefined,
          });
        } else {
          const created = await api.createTask(vaultPath, {
            title: draft.title,
            status: draft.status,
            assignee: draft.assignee,
            project: draft.project,
            priority: draft.priority,
            due: draft.due,
            tags,
          });
          if (draft.content.trim()) {
            const parsed = parseBody(created.body);
            await api.updateTask(vaultPath, {
              id: created.id,
              body: buildBody(parsed, draft.content),
            });
          }
        }
        refreshTasks(vaultPath);
      } catch (e) {
        setStatus(`Save failed — ${e}`);
      }
    },
    [vaultPath, dialog, refreshTasks],
  );

  if (!config) return null;

  if (!vaultPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <FolderOpen className="size-10 text-muted-foreground/40" />
        <div>
          <p className="font-semibold">No task vault configured</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Tasks are stored as Markdown files in a dedicated Obsidian vault. Choose an existing
            vault folder or an empty one to initialize.
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
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={initializing} onClick={initVault}>
          {initializing ? "Initializing…" : "初期化"}
        </Button>

        <select
          className={selectClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {(["inbox", "todo", "doing", "review", "done"] as TaskStatus[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
        >
          <option value="">All assignees</option>
          {(["me", "claude-code", "opencode"] as TaskAssignee[]).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">All projects</option>
          {knownProjects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <span
          className="ml-auto max-w-64 shrink-0 truncate font-mono text-[11px] text-muted-foreground"
          title={vaultPath}
        >
          {vaultPath}
        </span>
        <div className="flex shrink-0 items-center overflow-hidden rounded-md border">
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
        {viewMode === "list" ? (
          <TaskList
            tasks={visible}
            onOpen={(task) => setDialog({ mode: "edit", task })}
            onLaunchAgent={launchAgent}
          />
        ) : (
          <TaskKanban
            tasks={visible}
            onOpen={(task) => setDialog({ mode: "edit", task })}
            onStatusChange={changeStatus}
            onLaunchAgent={launchAgent}
          />
        )}
      </main>

      {/* status bar */}
      <footer className="flex items-center border-t px-4 py-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">{status}</span>
        <span className="ml-auto shrink-0">
          {tasks.length} tasks · {visible.length} shown
        </span>
      </footer>

      <TaskDialog
        open={dialog !== null}
        mode={dialog?.mode ?? "create"}
        task={dialog?.mode === "edit" ? dialog.task : null}
        knownProjects={knownProjects}
        onClose={() => setDialog(null)}
        onSubmit={(draft) => void submitDialog(draft)}
      />
    </div>
  );
}
