import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Archive,
  ArchiveRestore,
  CalendarRange,
  CircleAlert,
  CircleCheck,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Info,
  ListTodo,
  Network,
  RefreshCw,
} from "lucide-react";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { ProjectList } from "@/components/projects/project-list";
import { ProjectCreateDialog } from "@/components/schedule/project-create-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, timeAgo } from "@/lib/api";
import {
  TASK_STATUSES,
  buildProjectFixPrompt,
  buildSharedSpaceSurveyPrompt,
  isSurveyStale,
  issueLabel,
  linkedRepos,
  sortProjects,
  taskCountsByProject,
  unknownProjects,
  type ProjectOrderWrite,
} from "@/lib/vault-project";
import { cn } from "@/lib/utils";
import type { Config, Task, VaultProject } from "@/types";

/**
 * The Projects tab (T-0190).
 *
 * Schedule and Mindmap both start from `projects/<slug>/`, but until this tab
 * there was no screen for the project itself — no way to see what a project
 * folder holds, to create or retire one, or to notice that the vault's layout
 * conventions had quietly stopped being followed.
 *
 * The tab's main job is therefore *reconciliation*, not CRUD:
 *
 * - the folder against the layout documented in the vault's CLAUDE.md
 *   (findings come from the backend scan);
 * - the tasks against the projects — a task's `project:` is free text, so a
 *   typo silently orphans it, and that is shown here rather than never;
 * - the projects against the registered repositories, which do not share a
 *   naming scheme with them and never will.
 *
 * There is no delete. A project folder holds months of hand-written prose, so
 * the only removal is an archive to `archive/projects/<slug>/`, undone from
 * the same screen.
 */

/** Sentinel for the repo picker — Radix rejects an empty string as a value. */
const NO_REPO = "__none__";

/** Where the four navigation buttons hand off to. */
export type ProjectTarget = "tasks" | "schedule" | "mindmap" | "repos";

interface Props {
  /** Bumped by the app shell after settings are saved. */
  configVersion: number;
  /** Whether the Projects tab is the visible one; gates the reload on focus. */
  active: boolean;
  /** Opens another tab focused on this project (or, for `repos`, on the
   * repository path it is linked to). */
  onNavigate: (target: ProjectTarget, value: string) => void;
  /** Called after this view creates, archives or restores a project, so the
   * project pickers in the other tabs reload. The watcher's
   * `projects-changed` event reports the same thing for writers outside the
   * app; this is the deterministic path for the app's own actions. */
  onProjectsChange?: () => void;
}

export function ProjectsView({
  configVersion,
  active,
  onNavigate,
  onProjectsChange,
}: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [projects, setProjects] = useState<VaultProject[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [slug, setSlug] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [editName, setEditName] = useState("");
  const [editSummary, setEditSummary] = useState("");

  const vaultPath = config?.settings.vault_path ?? null;
  const repos = config?.projects ?? [];
  // Held in a ref because the app shell passes a fresh arrow every render;
  // depending on it directly would rebuild every callback below on each one.
  const onProjectsChangeRef = useRef(onProjectsChange);
  onProjectsChangeRef.current = onProjectsChange;

  const load = useCallback(async () => {
    if (!vaultPath) return;
    setError("");
    try {
      const [found, allTasks] = await Promise.all([
        api.listVaultProjects(vaultPath, true),
        api.listTasks(vaultPath),
      ]);
      setProjects(found);
      setTasks(allTasks);
    } catch (e) {
      setError(String(e));
    }
  }, [vaultPath]);

  useEffect(() => {
    void api.getConfig().then(setConfig);
  }, [configVersion]);

  useEffect(() => {
    void load();
  }, [load]);

  // Obsidian and agents write these folders too. Re-read when the tab is
  // brought forward (a note edited in Obsidian changes a folder's counts and
  // its last-touched time, which no event reports), and again whenever a
  // project folder itself appears or disappears.
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  useEffect(() => {
    const unlisten = listen("projects-changed", () => void load());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [load]);

  const counts = useMemo(() => taskCountsByProject(tasks), [tasks]);
  const orphans = useMemo(
    () => unknownProjects(tasks, projects),
    [tasks, projects],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matched = projects.filter((p) => {
      if (p.archived && !showArchived) return false;
      if (!needle) return true;
      return (
        p.slug.toLowerCase().includes(needle) ||
        p.name.toLowerCase().includes(needle) ||
        p.summary.toLowerCase().includes(needle)
      );
    });
    // The backend already returns this order; sorting again keeps the list
    // right when a pin or a drag is applied to the local array (T-0231).
    return sortProjects(matched);
  }, [projects, search, showArchived]);

  // A search hides rows between the ones on screen, so a position computed
  // from what is visible would not be the position the user meant.
  const reorderable = search.trim() === "";
  const activeVisible = useMemo(() => visible.filter((p) => !p.archived), [visible]);
  const archivedVisible = useMemo(() => visible.filter((p) => p.archived), [visible]);

  // Keep a selection even as the list is filtered or reloaded: an empty detail
  // pane beside a populated list is a click the user never wants to make.
  useEffect(() => {
    if (visible.length === 0) {
      if (slug) setSlug("");
      return;
    }
    if (!visible.some((p) => p.slug === slug)) setSlug(visible[0].slug);
  }, [visible, slug]);

  const current = visible.find((p) => p.slug === slug) ?? null;
  /** One instant for every staleness check on the screen, refreshed when the
   * project list is — a shared space does not go stale between two renders,
   * and a per-row `new Date()` would make the memo below re-run forever. */
  const now = useMemo(() => new Date(), [projects]);
  useEffect(() => {
    if (!current) return;
    setEditName(current.name);
    setEditSummary(current.summary);
  }, [current?.slug, current?.name, current?.summary]);
  const currentRepos = useMemo(
    () => (current ? linkedRepos(current, repos) : []),
    [current, repos],
  );
  /** The project's default repository — the first entry that still resolves.
   *  A stale entry at the head should not disable the Repo button when the
   *  project links to a registered repo further down the list. */
  const defaultRepo = currentRepos.find((l) => l.repo)?.repo ?? null;
  // Only repos this project does not already link to are offered, so the
  // picker cannot produce a duplicate entry.
  const addableRepos = useMemo(
    () => repos.filter((r) => !currentRepos.some((l) => l.repo?.path === r.path)),
    [repos, currentRepos],
  );
  const currentCounts = current ? counts.get(current.slug) : undefined;
  // The scan already told us whether the entry point exists; Obsidian's URL
  // scheme opens files, not folders, so a project with no README falls back to
  // Explorer instead of opening nothing.
  const hasReadme =
    !!current &&
    !current.issues.some((i) => i.kind === "missing-file" && i.target === "README.md");

  /** Re-reads the vault and tells the other tabs' project pickers to do the
   * same. Every mutation this view performs ends here. */
  const refresh = useCallback(async () => {
    await load();
    onProjectsChangeRef.current?.();
  }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError("");
    setStatus(label);
    try {
      await fn();
      await refresh();
      setStatus("");
    } catch (e) {
      setStatus("");
      setError(String(e));
    }
  };

  /** Writes the whole `repos:` list back; every edit below is a list rewrite
   *  rather than a per-entry command, because order carries meaning (the first
   *  entry is the project's default repository) and a partial update would
   *  leave it ambiguous. */
  const saveRepos = (entries: string[]) => {
    if (!vaultPath || !current) return;
    void run("Linking…", async () => {
      await api.setVaultProjectRepos(vaultPath, current.slug, entries);
    });
  };

  const currentEntries = () => currentRepos.map((l) => l.entry);

  const addRepo = (value: string) => {
    if (value === NO_REPO) return;
    saveRepos([...currentEntries(), value]);
  };

  const removeRepo = (at: number) => {
    saveRepos(currentEntries().filter((_, i) => i !== at));
  };

  /** Promotes an entry one place; from index 1 that makes it the default. */
  const promoteRepo = (at: number) => {
    if (at <= 0) return;
    const next = currentEntries();
    [next[at - 1], next[at]] = [next[at], next[at - 1]];
    saveRepos(next);
  };

  /**
   * Applies the writes one pin or one drop implies.
   *
   * The local array is updated first and the vault written after: the list is
   * what the user just dragged, and waiting a file write and a rescan before
   * the row moves makes the drag feel like it failed. `refresh()` then
   * replaces the optimistic state with what is actually on disk.
   */
  const applyOrder = (writes: ProjectOrderWrite[]) => {
    if (!vaultPath || writes.length === 0) return;
    const by = new Map(writes.map((w) => [w.slug, w]));
    setProjects((prev) =>
      prev.map((p) => {
        const w = by.get(p.slug);
        return w ? { ...p, pinned: w.pinned, order: w.order } : p;
      }),
    );
    void run("Reordering…", async () => {
      for (const w of writes) {
        await api.setVaultProjectOrder(vaultPath, w.slug, w.pinned, w.order);
      }
    });
  };

  /** A star click. The position is left alone, so unpinning drops the project
   *  back where its own `order` puts it rather than at the end of the list. */
  const togglePin = (project: VaultProject) => {
    applyOrder([
      { slug: project.slug, pinned: !project.pinned, order: project.order },
    ]);
  };

  const detailsDirty =
    !!current &&
    (editName.trim() !== current.name || editSummary.trim() !== current.summary);

  const saveDetails = () => {
    if (!vaultPath || !current || current.archived) return;
    const name = editName.trim();
    if (!name) return;
    void run("Saving…", async () => {
      await api.setVaultProjectDetails(
        vaultPath,
        current.slug,
        name,
        editSummary.trim(),
      );
    });
  };

  if (!vaultPath) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Set a vault folder in Settings to manage projects.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <Input
          value={search}
          placeholder="Search projects…"
          className="h-8 max-w-64 text-sm"
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button
          size="sm"
          variant={showArchived ? "secondary" : "ghost"}
          className="h-8 gap-1.5"
          onClick={() => setShowArchived((v) => !v)}
        >
          <Archive className="size-3.5" />
          Archived
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
        <Button size="sm" className="ml-auto h-8 gap-1.5" onClick={() => setCreateOpen(true)}>
          <FolderPlus className="size-3.5" />
          New project
        </Button>
      </div>

      {(error || status) && (
        <div
          className={cn(
            "border-b px-3 py-1 text-xs",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error || status}
        </div>
      )}

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="projects-list" defaultSize="34%" minSize="22%" className="min-h-0">
          <div className="h-full overflow-y-auto">
            {visible.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                No projects yet. “New project” creates projects/&lt;slug&gt;/ from the
                bundled scaffold.
              </p>
            )}
            <ProjectList
              active={activeVisible}
              archived={archivedVisible}
              selected={slug}
              counts={counts}
              reorderable={reorderable}
              onSelect={setSlug}
              onTogglePin={togglePin}
              onMove={applyOrder}
            />

            {orphans.length > 0 && (
              <div className="border-b bg-muted/30 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <CircleAlert className="size-3" />
                  Task project values with no folder
                </p>
                <ul className="mt-1 space-y-0.5">
                  {orphans.map((o) => (
                    <li key={o.project} className="text-[11px] text-muted-foreground">
                      <span className="font-mono">{o.project}</span> — {o.counts.total} task
                      {o.counts.total === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="projects-detail" defaultSize="66%" minSize="40%" className="min-h-0">
          {!current ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a project.
            </div>
          ) : (
            <div className="h-full space-y-4 overflow-y-auto p-4">
              <div>
                {current.archived ? (
                  <>
                    <h2 className="text-base font-semibold">{current.name}</h2>
                    {current.summary && (
                      <p className="mt-2 text-sm">{current.summary}</p>
                    )}
                  </>
                ) : (
                  <>
                    <label className="block space-y-1">
                      <span className="text-xs text-muted-foreground">Name</span>
                      <Input
                        value={editName}
                        className="h-8 text-sm font-semibold"
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveDetails();
                        }}
                      />
                    </label>
                    <label className="mt-2 block space-y-1">
                      <span className="text-xs text-muted-foreground">
                        Description
                      </span>
                      <Textarea
                        value={editSummary}
                        placeholder="A short description of this project"
                        className="min-h-16 text-sm"
                        onChange={(e) => setEditSummary(e.target.value)}
                      />
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7"
                        disabled={!detailsDirty || !editName.trim()}
                        onClick={saveDetails}
                      >
                        Save
                      </Button>
                      {detailsDirty && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          onClick={() => {
                            setEditName(current.name);
                            setEditSummary(current.summary);
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </>
                )}
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                  {current.path}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {current.status && <span>status: {current.status}</span>}
                  <span>updated {current.updated ? timeAgo(current.updated) : "—"}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5"
                  onClick={() => {
                    if (hasReadme) void api.openInObsidian(`${current.path}/README.md`);
                    else void api.openExplorer(current.path);
                  }}
                >
                  <FolderOpen className="size-3.5" />
                  {hasReadme ? "Open README" : "Open folder"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5"
                  onClick={() => onNavigate("tasks", current.slug)}
                >
                  <ListTodo className="size-3.5" />
                  Tasks
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5"
                  onClick={() => onNavigate("schedule", current.slug)}
                >
                  <CalendarRange className="size-3.5" />
                  Schedule
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5"
                  onClick={() => onNavigate("mindmap", current.slug)}
                >
                  <Network className="size-3.5" />
                  Mindmap
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5"
                  disabled={!defaultRepo}
                  onClick={() => defaultRepo && onNavigate("repos", defaultRepo.path)}
                >
                  <GitBranch className="size-3.5" />
                  Repo
                </Button>
                <Button
                  size="sm"
                  variant={current.archived ? "outline" : "ghost"}
                  className="ml-auto h-7 gap-1.5"
                  onClick={() => setArchiveOpen(true)}
                >
                  {current.archived ? (
                    <>
                      <ArchiveRestore className="size-3.5" />
                      Restore
                    </>
                  ) : (
                    <>
                      <Archive className="size-3.5" />
                      Archive
                    </>
                  )}
                </Button>
              </div>

              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  Repositories
                </h3>
                {currentRepos.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No repository.</p>
                ) : (
                  <ul className="space-y-1">
                    {currentRepos.map((link, i) => (
                      <li key={link.entry} className="flex items-center gap-2 text-xs">
                        <span className="w-10 shrink-0 text-[10px] uppercase text-muted-foreground">
                          {i === 0 ? "default" : ""}
                        </span>
                        {link.repo ? (
                          <span className="truncate">{link.repo.name}</span>
                        ) : (
                          <span className="truncate text-destructive">
                            {link.entry} is not a registered repository
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[11px]"
                          disabled={current.archived || i === 0}
                          onClick={() => promoteRepo(i)}
                          title="Move up (the first entry is the default)"
                        >
                          Up
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[11px]"
                          disabled={current.archived}
                          onClick={() => removeRepo(i)}
                          title="Unlink this repository"
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {addableRepos.length > 0 && (
                  <Select
                    value={NO_REPO}
                    onValueChange={addRepo}
                    disabled={current.archived}
                  >
                    <SelectTrigger className="h-8 max-w-96 text-xs">
                      <SelectValue placeholder="Add repository…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_REPO}>Add repository…</SelectItem>
                      {addableRepos.map((r) => (
                        <SelectItem key={r.path} value={r.path}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Stored as <span className="font-mono">repos:</span> in the project's{" "}
                  <span className="font-mono">_index.md</span>, because a project and its
                  repositories do not share a naming scheme. The first entry is the one an
                  agent defaults to.
                </p>
              </section>

              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    Shared spaces
                  </h3>
                  <CopyPromptButton
                    showLabel
                    label="Copy survey prompt"
                    onCopy={() => writeText(buildSharedSpaceSurveyPrompt(current))}
                  />
                </div>
                {current.shared.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No team knowledge base registered yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {current.shared.map((space) => (
                      <li key={space.name} className="flex items-center gap-2 text-xs">
                        <span className="truncate">{space.title}</span>
                        {space.kind && (
                          <span className="shrink-0 rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">
                            {space.kind}
                          </span>
                        )}
                        <span
                          className={cn(
                            "shrink-0 rounded px-1 text-[10px] uppercase",
                            space.direction === "export-ok"
                              ? "bg-muted text-muted-foreground"
                              : "bg-muted font-medium text-foreground",
                          )}
                          title={
                            space.direction === "export-ok"
                              ? "The owner has said material may be filed into this place"
                              : "Read only — never write anything into this place"
                          }
                        >
                          {space.direction}
                        </span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground">
                          {space.location}
                        </span>
                        {isSurveyStale(space.surveyed, now) && (
                          <span
                            className="shrink-0 text-[10px] uppercase text-muted-foreground"
                            title={
                              space.surveyed
                                ? `Rules last checked ${space.surveyed} — worth another look`
                                : "This note never recorded when its rules were checked"
                            }
                          >
                            stale
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-6 shrink-0 px-1.5 text-[11px]"
                          onClick={() => void api.openInObsidian(space.path)}
                          title="Open the note"
                        >
                          Open
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-muted-foreground">
                  One note per place in the project's{" "}
                  <span className="font-mono">shared/</span> folder, recording how the team
                  organises it. The app only reads them — surveying a place is an agent's
                  job. <span className="text-foreground">Copy survey prompt</span> when a
                  team drive is not listed here yet, or its rules have gone stale: fill in
                  the location it asks for, then paste it into an agent.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">Tasks</h3>
                {currentCounts ? (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {TASK_STATUSES.map((s) => (
                      <span key={s} className="text-muted-foreground">
                        {s} <span className="font-medium text-foreground">{currentCounts[s]}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No task names this project in its <span className="font-mono">project:</span>{" "}
                    field.
                  </p>
                )}
              </section>

              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">Contents</h3>
                {current.folders.length === 0 ? (
                  <p className="text-xs text-muted-foreground">The folder has no subfolders.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {current.folders.map((f) => (
                      <span
                        key={f.name}
                        className={cn(
                          "rounded border px-2 py-0.5 text-[11px]",
                          f.known ? "text-muted-foreground" : "border-dashed text-foreground",
                        )}
                      >
                        <span className="font-mono">{f.name}/</span> {f.count}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    Layout findings
                  </h3>
                  {current.issues.length > 0 && (
                    <CopyPromptButton
                      showLabel
                      label="Copy fix prompt"
                      onCopy={() => writeText(buildProjectFixPrompt(current))}
                    />
                  )}
                </div>
                {current.issues.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CircleCheck className="size-3.5" />
                    This project matches the documented layout.
                  </p>
                ) : (
                  <>
                    <ul className="space-y-1">
                      {current.issues.map((issue, i) => (
                        <li
                          key={`${issue.kind}-${issue.target}-${i}`}
                          className={cn(
                            "flex items-center gap-1.5 text-xs",
                            issue.severity === "warn"
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {issue.severity === "warn" ? (
                            <CircleAlert className="size-3.5 shrink-0" />
                          ) : (
                            <Info className="size-3.5 shrink-0" />
                          )}
                          {issueLabel(issue)}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-muted-foreground">
                      The scan only reports — nothing here is changed for you.{" "}
                      <span className="text-foreground">Copy fix prompt</span> and paste it
                      into an agent to have the findings worked through; it needs nothing
                      filled in first, and tells the agent which of these are real gaps and
                      which are judgement calls to leave alone.
                    </p>
                  </>
                )}
              </section>
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      <ProjectCreateDialog
        vaultPath={vaultPath}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(created) => {
          setSlug(created);
          void refresh();
        }}
      />
      {current && (
        <ConfirmDialog
          open={archiveOpen}
          title={current.archived ? "Restore this project?" : "Archive this project?"}
          description={
            current.archived
              ? `projects/${current.slug}/ is restored from archive/projects/${current.slug}/. Nothing is deleted.`
              : `The folder moves to archive/projects/${current.slug}/. Nothing is deleted, and Restore brings it back.`
          }
          confirmLabel={current.archived ? "Restore" : "Archive"}
          onClose={() => setArchiveOpen(false)}
          onConfirm={() => {
            setArchiveOpen(false);
            const target = current;
            void run(target.archived ? "Restoring…" : "Archiving…", async () => {
              if (target.archived) await api.restoreVaultProject(vaultPath, target.slug);
              else await api.archiveVaultProject(vaultPath, target.slug);
            });
          }}
        />
      )}
    </div>
  );
}
